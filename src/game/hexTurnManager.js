/**
 * Server-side hex turn manager for Layer 2 strategic map.
 *
 * Manages hex units, city production, resource income, pending moves,
 * and simultaneous turn resolution.
 */

import { getTraversableHexesInRange } from "../utils/hexMath.js";
import {
  HEX_CITIES,
  HEX_GRID_COLS,
  HEX_GRID_ROWS,
  HEX_MOVEMENT_RANGE,
  INITIAL_HEX_UNITS,
} from "./hexConfig.js";
import {
  HEX_UNIT_PRODUCTION_CATALOG,
  addResourceIncome,
  buildHexCityOwnershipMap,
  canAffordCost,
  cloneResourceLedger,
  cloneResourceStockpile,
  computePlayerResourceIncome,
  createEmptyResourceStockpile,
  createInitialResourceLedger,
  deductResourceCost,
  getUnitBuildCost,
} from "./hexEconomy.js";
import { generateHexTerrain } from "../world/terrainGeneration.js";

function createTerrainSnapshot(seed = Date.now()) {
  const terrainSeed = (Number(seed) >>> 0) || 1;

  return {
    terrainSeed,
    terrainTiles: generateHexTerrain({
      cols: HEX_GRID_COLS,
      rows: HEX_GRID_ROWS,
      seed: terrainSeed,
      protectedCenters: HEX_CITIES,
    }),
  };
}

function getHexKey(col, row) {
  return `${col},${row}`;
}

function buildTerrainLookup(terrainTiles) {
  return new Map(
    terrainTiles.map((tile) => [getHexKey(tile.col, tile.row), tile]),
  );
}

function createInitialHexUnits() {
  return INITIAL_HEX_UNITS.map((unit) => ({
    ...unit,
    variantId: unit.variantId ?? "rifleman",
  }));
}

function cloneHexUnits(units) {
  return units.map((unit) => ({ ...unit }));
}

function createPlayerColors() {
  return [...new Set(HEX_CITIES.map((city) => city.owner).filter(Boolean))];
}

export function createHexTurnManager() {
  const playerColors = createPlayerColors();
  let hexUnits = createInitialHexUnits();
  const pendingMoves = new Map();
  const readyPlayers = new Set();
  let turnNumber = 1;
  let isResolving = false;
  let nextBuiltUnitSequence = 1;
  let { terrainSeed, terrainTiles } = createTerrainSnapshot();
  let terrainLookup = buildTerrainLookup(terrainTiles);
  let cityOwnership = buildHexCityOwnershipMap(HEX_CITIES, HEX_GRID_COLS, HEX_GRID_ROWS);
  let resourceIncome = createInitialResourceLedger(playerColors);
  let resourceStockpiles = createInitialResourceLedger(playerColors);

  function initializeEconomy() {
    cityOwnership = buildHexCityOwnershipMap(HEX_CITIES, HEX_GRID_COLS, HEX_GRID_ROWS);

    resourceIncome = createInitialResourceLedger(playerColors);
    const calculatedIncome = computePlayerResourceIncome({
      terrainTiles,
      cities: HEX_CITIES,
      cols: HEX_GRID_COLS,
      rows: HEX_GRID_ROWS,
    });

    for (const playerColor of playerColors) {
      resourceIncome[playerColor] = cloneResourceStockpile(
        calculatedIncome[playerColor] ?? createEmptyResourceStockpile(),
      );
    }

    resourceStockpiles = createInitialResourceLedger(playerColors);
  }

  function buildBaseState() {
    return {
      terrainSeed,
      terrainTiles,
      cities: HEX_CITIES.map((city) => ({ ...city })),
      hexUnits: cloneHexUnits(hexUnits),
      turnNumber,
      readyPlayers: [...readyPlayers],
      isResolving,
      resourceStockpiles: cloneResourceLedger(resourceStockpiles),
      resourceIncome: cloneResourceLedger(resourceIncome),
      unitProductionCatalog: HEX_UNIT_PRODUCTION_CATALOG,
    };
  }

  function createPendingMoveState(playerColor) {
    const ownMoves = {};

    for (const [unitId, move] of pendingMoves) {
      if (move.owner === playerColor) {
        ownMoves[unitId] = { toCol: move.toCol, toRow: move.toRow };
      }
    }

    return ownMoves;
  }

  function getState() {
    return buildBaseState();
  }

  function getStateForPlayer(playerColor) {
    return {
      ...buildBaseState(),
      pendingMoves: createPendingMoveState(playerColor),
    };
  }

  function submitMove(playerColor, unitId, toCol, toRow) {
    if (isResolving) {
      return { success: false, error: "Turn is resolving" };
    }

    if (readyPlayers.has(playerColor)) {
      return { success: false, error: "Already marked ready" };
    }

    const unit = hexUnits.find((entry) => entry.id === unitId);
    if (!unit) {
      return { success: false, error: "Unit not found" };
    }

    if (unit.owner !== playerColor) {
      return { success: false, error: "Not your unit" };
    }

    if (toCol < 0 || toCol >= HEX_GRID_COLS || toRow < 0 || toRow >= HEX_GRID_ROWS) {
      return { success: false, error: "Out of bounds" };
    }

    if (toCol === unit.col && toRow === unit.row) {
      return { success: false, error: "Out of range" };
    }

    const occupiedHexKeys = new Set(
      hexUnits
        .filter((entry) => entry.id !== unitId)
        .map((entry) => getHexKey(entry.col, entry.row)),
    );
    const blockedPendingTargets = new Set(
      [...pendingMoves.entries()]
        .filter(([pendingUnitId, move]) => pendingUnitId !== unitId && move.owner === playerColor)
        .map(([, move]) => getHexKey(move.toCol, move.toRow)),
    );

    const reachableHexes = getTraversableHexesInRange(
      unit.col,
      unit.row,
      HEX_MOVEMENT_RANGE,
      HEX_GRID_COLS,
      HEX_GRID_ROWS,
      (col, row) => {
        const terrainTile = terrainLookup.get(getHexKey(col, row));
        if (!terrainTile || terrainTile.isWater) {
          return false;
        }

        const key = getHexKey(col, row);
        if (cityOwnership.cityCenterKeySet.has(key)) {
          return false;
        }

        return !occupiedHexKeys.has(key) && !blockedPendingTargets.has(key);
      },
    );

    if (!reachableHexes.some((hex) => hex.col === toCol && hex.row === toRow)) {
      return { success: false, error: "Hex is blocked or impassable" };
    }

    pendingMoves.set(unitId, { toCol, toRow, owner: playerColor });
    return { success: true };
  }

  function cancelMove(playerColor, unitId) {
    if (isResolving) {
      return { success: false, error: "Turn is resolving" };
    }

    if (readyPlayers.has(playerColor)) {
      return { success: false, error: "Already marked ready" };
    }

    const move = pendingMoves.get(unitId);
    if (!move || move.owner !== playerColor) {
      return { success: false, error: "No pending move for this unit" };
    }

    pendingMoves.delete(unitId);
    return { success: true };
  }

  function findBuildSpawnHex(city) {
    const cityHexes = cityOwnership.cityTileMap.get(city.id) ?? [];
    const occupiedHexKeys = new Set(
      hexUnits.map((unit) => getHexKey(unit.col, unit.row)),
    );
    const reservedPendingTargets = new Set(
      [...pendingMoves.values()].map((move) => getHexKey(move.toCol, move.toRow)),
    );

    return cityHexes
      .filter((hex) => hex.col !== city.centerCol || hex.row !== city.centerRow)
      .find((hex) => {
        const key = getHexKey(hex.col, hex.row);
        const terrainTile = terrainLookup.get(key);
        return (
          terrainTile &&
          !terrainTile.isWater &&
          !occupiedHexKeys.has(key) &&
          !reservedPendingTargets.has(key)
        );
      }) ?? null;
  }

  function buildUnit(playerColor, cityId, variantId) {
    if (isResolving) {
      return { success: false, error: "Turn is resolving" };
    }

    if (readyPlayers.has(playerColor)) {
      return { success: false, error: "Already marked ready" };
    }

    const city = cityOwnership.cityById.get(cityId);
    if (!city) {
      return { success: false, error: "City not found" };
    }

    if (city.owner !== playerColor) {
      return { success: false, error: "You can only build in your own city" };
    }

    if (!HEX_UNIT_PRODUCTION_CATALOG[variantId]) {
      return { success: false, error: "Unknown unit type" };
    }

    const cost = getUnitBuildCost(variantId);
    const playerStockpile = resourceStockpiles[playerColor] ?? createEmptyResourceStockpile();
    if (!canAffordCost(playerStockpile, cost)) {
      return { success: false, error: "Insufficient resources" };
    }

    const spawnHex = findBuildSpawnHex(city);
    if (!spawnHex) {
      return { success: false, error: "All city deployment tiles are occupied" };
    }

    const unit = {
      id: `hex-built-${playerColor}-${nextBuiltUnitSequence}`,
      col: spawnHex.col,
      row: spawnHex.row,
      owner: playerColor,
      variantId,
    };
    nextBuiltUnitSequence += 1;

    hexUnits = [...hexUnits, unit];
    resourceStockpiles = {
      ...resourceStockpiles,
      [playerColor]: deductResourceCost(playerStockpile, cost),
    };

    return {
      success: true,
      unit: { ...unit },
      resourceStockpiles: cloneResourceLedger(resourceStockpiles),
    };
  }

  function setPlayerReady(playerColor) {
    if (isResolving) {
      return { success: false, allReady: false, error: "Turn is resolving" };
    }

    readyPlayers.add(playerColor);

    const allReady = readyPlayers.has("blue") && readyPlayers.has("red");
    return { success: true, allReady };
  }

  function setPlayerUnready(playerColor) {
    if (isResolving) {
      return { success: false, error: "Turn is resolving" };
    }

    if (!readyPlayers.has(playerColor)) {
      return { success: false, error: "Not marked ready" };
    }

    readyPlayers.delete(playerColor);
    return { success: true };
  }

  function resolveTurn() {
    isResolving = true;

    const appliedMoves = [];
    for (const [unitId, move] of pendingMoves) {
      const unit = hexUnits.find((entry) => entry.id === unitId);
      if (!unit) {
        continue;
      }

      appliedMoves.push({
        unitId,
        fromCol: unit.col,
        fromRow: unit.row,
        toCol: move.toCol,
        toRow: move.toRow,
        owner: move.owner,
      });
      unit.col = move.toCol;
      unit.row = move.toRow;
    }

    for (const playerColor of playerColors) {
      resourceStockpiles[playerColor] = addResourceIncome(
        resourceStockpiles[playerColor],
        resourceIncome[playerColor],
      );
    }

    pendingMoves.clear();
    readyPlayers.clear();
    turnNumber += 1;
    isResolving = false;

    return {
      hexUnits: cloneHexUnits(hexUnits),
      turnNumber,
      appliedMoves,
      resourceStockpiles: cloneResourceLedger(resourceStockpiles),
      resourceIncome: cloneResourceLedger(resourceIncome),
    };
  }

  function reset() {
    hexUnits = createInitialHexUnits();
    pendingMoves.clear();
    readyPlayers.clear();
    turnNumber = 1;
    isResolving = false;
    nextBuiltUnitSequence = 1;

    ({ terrainSeed, terrainTiles } = createTerrainSnapshot());
    terrainLookup = buildTerrainLookup(terrainTiles);
    initializeEconomy();
  }

  initializeEconomy();

  return {
    buildUnit,
    cancelMove,
    getState,
    getStateForPlayer,
    resolveTurn,
    reset,
    setPlayerReady,
    setPlayerUnready,
    submitMove,
  };
}
