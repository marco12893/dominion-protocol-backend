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
  multiplyResourceCost,
} from "./hexEconomy.js";
import { generateHexTerrain } from "../world/terrainGeneration.js";
import {
  HEX_ARMY_MAX_SLOTS,
  addUnitsToArmy,
  cloneHexArmy,
  getMaxAddableUnits,
  normalizeHexArmy,
} from "./hexArmies.js";
import { LAYER_3_BATTLE_DURATION_SECONDS } from "./layer3BattleConstants.js";

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
  return INITIAL_HEX_UNITS.map((unit) => normalizeHexArmy(unit));
}

function cloneHexUnits(units) {
  return units.map((unit) => cloneHexArmy(unit));
}

function createPlayerColors() {
  return [...new Set(HEX_CITIES.map((city) => city.owner).filter(Boolean))];
}

function cloneArmySlots(slots = []) {
  return Array.isArray(slots)
    ? slots.map((slot) => ({ variantId: slot.variantId, count: slot.count }))
    : [];
}

function cloneBattleArmySummary(army) {
  if (!army) {
    return null;
  }

  const normalizedArmy = normalizeHexArmy(army);

  return {
    id: normalizedArmy.id ?? null,
    owner: normalizedArmy.owner ?? null,
    totalUnits: normalizedArmy.totalUnits ?? 0,
    usedSlots: normalizedArmy.usedSlots ?? 0,
    slots: cloneArmySlots(normalizedArmy.slots),
  };
}

function createLayer3BattleState(nextState = {}) {
  const normalizedStatus = nextState.status === "active" ? "active" : "idle";
  const startedAtTick = Number(nextState.startedAtTick);
  const endsAtTick = Number(nextState.endsAtTick);
  const queueLength = Math.max(0, Math.floor(Number(nextState.queueLength) || 0));
  const hex =
    typeof nextState.hex?.col === "number" && typeof nextState.hex?.row === "number"
      ? { col: nextState.hex.col, row: nextState.hex.row }
      : null;

  return {
    status: normalizedStatus,
    battleId: typeof nextState.battleId === "string" ? nextState.battleId : null,
    queueLength,
    hex,
    maxDurationSeconds: LAYER_3_BATTLE_DURATION_SECONDS,
    startedAtTick: Number.isFinite(startedAtTick) ? startedAtTick : null,
    endsAtTick: Number.isFinite(endsAtTick) ? endsAtTick : null,
    blueArmy: cloneBattleArmySummary(nextState.blueArmy),
    redArmy: cloneBattleArmySummary(nextState.redArmy),
  };
}

function clearArmyBattleMetadata(army) {
  if (!army) {
    return army;
  }

  const {
    battleId,
    battleState,
    battleHex,
    ...rest
  } = army;

  return rest;
}

function normalizeSurvivorCounts(survivorCounts = {}) {
  return Object.fromEntries(
    Object.entries(survivorCounts)
      .map(([variantId, count]) => [variantId, Math.max(0, Math.floor(Number(count) || 0))])
      .filter(([, count]) => count > 0),
  );
}

function buildSurvivorSlots(originalArmy, survivorCounts) {
  const remainingByVariant = new Map(Object.entries(normalizeSurvivorCounts(survivorCounts)));
  const nextSlots = [];

  for (const slot of originalArmy?.slots ?? []) {
    const remaining = remainingByVariant.get(slot.variantId) ?? 0;
    if (remaining <= 0) {
      continue;
    }

    const slotCount = Math.min(slot.count, remaining);
    nextSlots.push({ variantId: slot.variantId, count: slotCount });
    remainingByVariant.set(slot.variantId, remaining - slotCount);
  }

  let rebuiltArmy = normalizeHexArmy({
    id: originalArmy?.id,
    col: originalArmy?.col,
    row: originalArmy?.row,
    owner: originalArmy?.owner,
    slots: nextSlots,
  });

  for (const [variantId, remaining] of remainingByVariant.entries()) {
    if (remaining <= 0) {
      continue;
    }

    rebuiltArmy = addUnitsToArmy(rebuiltArmy, variantId, remaining, HEX_ARMY_MAX_SLOTS) ?? rebuiltArmy;
  }

  return rebuiltArmy.slots;
}

export function createHexTurnManager() {
  const playerColors = createPlayerColors();
  let hexUnits = createInitialHexUnits();
  const pendingMoves = new Map();
  const readyPlayers = new Set();
  let turnNumber = 1;
  let isResolving = false;
  let nextBuiltUnitSequence = 1;
  let nextBattleSequence = 1;
  let { terrainSeed, terrainTiles } = createTerrainSnapshot();
  let terrainLookup = buildTerrainLookup(terrainTiles);
  let cityOwnership = buildHexCityOwnershipMap(HEX_CITIES, HEX_GRID_COLS, HEX_GRID_ROWS);
  let resourceIncome = createInitialResourceLedger(playerColors);
  let resourceStockpiles = createInitialResourceLedger(playerColors);
  let layer3Battle = createLayer3BattleState();

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
      layer3Battle: createLayer3BattleState(layer3Battle),
      resourceStockpiles: cloneResourceLedger(resourceStockpiles),
      resourceIncome: cloneResourceLedger(resourceIncome),
      unitProductionCatalog: HEX_UNIT_PRODUCTION_CATALOG,
      armyRules: { maxSlotsPerArmy: HEX_ARMY_MAX_SLOTS },
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

  function isLayer3BattleLocked() {
    return layer3Battle.status !== "idle";
  }

  function createBattleLockError() {
    return { success: false, error: "Layer 3 battle is active" };
  }

  function submitMove(playerColor, unitId, toCol, toRow) {
    if (isResolving) {
      return { success: false, error: "Turn is resolving" };
    }

    if (isLayer3BattleLocked()) {
      return createBattleLockError();
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

    if (unit.battleId || unit.battleState) {
      return { success: false, error: "This army is committed to a Layer 3 battle" };
    }

    if (toCol < 0 || toCol >= HEX_GRID_COLS || toRow < 0 || toRow >= HEX_GRID_ROWS) {
      return { success: false, error: "Out of bounds" };
    }

    if (toCol === unit.col && toRow === unit.row) {
      return { success: false, error: "Out of range" };
    }

    const occupiedHexKeys = new Set(
      hexUnits
        .filter((entry) => entry.id !== unitId && entry.owner === playerColor)
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

    if (isLayer3BattleLocked()) {
      return createBattleLockError();
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

  function getHexArmiesAt(col, row) {
    return hexUnits.filter((unit) => unit.col === col && unit.row === row);
  }

  function getHexArmyAt(col, row) {
    return hexUnits.find((unit) => unit.col === col && unit.row === row) ?? null;
  }

  function hasPendingMoveTo(col, row, ignoredUnitId = null) {
    for (const [unitId, move] of pendingMoves) {
      if (unitId === ignoredUnitId) {
        continue;
      }

      if (move.toCol === col && move.toRow === row) {
        return true;
      }
    }

    return false;
  }

  function buildUnit(playerColor, cityId, variantId, quantity = 1) {
    if (isResolving) {
      return { success: false, error: "Turn is resolving" };
    }

    if (isLayer3BattleLocked()) {
      return createBattleLockError();
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

    const normalizedQuantity = Math.max(0, Math.floor(Number(quantity) || 0));
    if (normalizedQuantity <= 0) {
      return { success: false, error: "Quantity must be at least 1" };
    }

    const cityCenterArmies = getHexArmiesAt(city.centerCol, city.centerRow);
    const cityCenterArmy = cityCenterArmies.find((army) => army.owner === playerColor) ?? null;
    const cityCenterHasHostileOccupant = cityCenterArmies.some((army) => army.owner !== playerColor);

    if (cityCenterHasHostileOccupant) {
      return { success: false, error: "City center is occupied by hostile forces" };
    }

    if (!cityCenterArmy && hasPendingMoveTo(city.centerCol, city.centerRow)) {
      return { success: false, error: "City center is reserved for movement this turn" };
    }

    const targetArmy = cityCenterArmy ?? normalizeHexArmy({
      id: `hex-built-${playerColor}-${nextBuiltUnitSequence}`,
      col: city.centerCol,
      row: city.centerRow,
      owner: playerColor,
      slots: [],
    });
    const maxAddableUnits = getMaxAddableUnits(targetArmy, variantId, HEX_ARMY_MAX_SLOTS);
    if (maxAddableUnits <= 0) {
      return { success: false, error: "This army has no free slot capacity for that unit type" };
    }

    if (normalizedQuantity > maxAddableUnits) {
      return {
        success: false,
        error: `Only ${maxAddableUnits} of that unit type can fit in the selected army`,
      };
    }

    const cost = multiplyResourceCost(getUnitBuildCost(variantId), normalizedQuantity);
    const playerStockpile = resourceStockpiles[playerColor] ?? createEmptyResourceStockpile();
    if (!canAffordCost(playerStockpile, cost)) {
      return { success: false, error: "Insufficient resources" };
    }

    const reinforcedArmy = addUnitsToArmy(targetArmy, variantId, normalizedQuantity, HEX_ARMY_MAX_SLOTS);
    if (!reinforcedArmy) {
      return { success: false, error: "Unable to reinforce this army" };
    }

    if (cityCenterArmy) {
      hexUnits = hexUnits.map((unit) => (
        unit.id === cityCenterArmy.id ? reinforcedArmy : unit
      ));
    } else {
      hexUnits = [...hexUnits, reinforcedArmy];
      nextBuiltUnitSequence += 1;
    }

    resourceStockpiles = {
      ...resourceStockpiles,
      [playerColor]: deductResourceCost(playerStockpile, cost),
    };

    return {
      success: true,
      unit: cloneHexArmy(reinforcedArmy),
      resourceStockpiles: cloneResourceLedger(resourceStockpiles),
    };
  }

  function setPlayerReady(playerColor) {
    if (isResolving) {
      return { success: false, allReady: false, error: "Turn is resolving" };
    }

    if (isLayer3BattleLocked()) {
      return { success: false, allReady: false, error: "Layer 3 battle is active" };
    }

    readyPlayers.add(playerColor);

    const allReady = readyPlayers.has("blue") && readyPlayers.has("red");
    return { success: true, allReady };
  }

  function setPlayerUnready(playerColor) {
    if (isResolving) {
      return { success: false, error: "Turn is resolving" };
    }

    if (isLayer3BattleLocked()) {
      return { success: false, error: "Layer 3 battle is active" };
    }

    if (!readyPlayers.has(playerColor)) {
      return { success: false, error: "Not marked ready" };
    }

    readyPlayers.delete(playerColor);
    return { success: true };
  }

  function buildContestedHexEngagements() {
    const contestedHexes = new Map();

    for (const army of hexUnits) {
      const key = getHexKey(army.col, army.row);
      const entry = contestedHexes.get(key) ?? {
        hex: { col: army.col, row: army.row },
        blueArmy: null,
        redArmy: null,
      };

      if (army.owner === "blue" && !entry.blueArmy) {
        entry.blueArmy = cloneHexArmy(army);
      } else if (army.owner === "red" && !entry.redArmy) {
        entry.redArmy = cloneHexArmy(army);
      }

      contestedHexes.set(key, entry);
    }

    const engagements = [];

    for (const entry of contestedHexes.values()) {
      if (!entry.blueArmy || !entry.redArmy) {
        continue;
      }

      engagements.push({
        battleId: `layer3-battle-${nextBattleSequence}`,
        hex: { ...entry.hex },
        blueArmyId: entry.blueArmy.id,
        redArmyId: entry.redArmy.id,
        blueArmy: entry.blueArmy,
        redArmy: entry.redArmy,
      });
      nextBattleSequence += 1;
    }

    return engagements;
  }

  function markArmiesForBattle(engagements) {
    if (!engagements.length) {
      return;
    }

    const engagementByArmyId = new Map();
    for (const engagement of engagements) {
      engagementByArmyId.set(engagement.blueArmyId, engagement);
      engagementByArmyId.set(engagement.redArmyId, engagement);
    }

    hexUnits = hexUnits.map((army) => {
      const engagement = engagementByArmyId.get(army.id);
      if (!engagement) {
        return army;
      }

      return normalizeHexArmy({
        ...army,
        battleId: engagement.battleId,
        battleState: "active",
        battleHex: { ...engagement.hex },
      });
    });
  }

  function setLayer3BattleState(nextBattleState = {}) {
    layer3Battle = createLayer3BattleState(nextBattleState);
  }

  function applyBattleOutcome({
    battleId,
    blueArmyId,
    redArmyId,
    survivorsByOwner = {},
  }) {
    const blueSurvivors = normalizeSurvivorCounts(survivorsByOwner.blue);
    const redSurvivors = normalizeSurvivorCounts(survivorsByOwner.red);

    hexUnits = hexUnits.flatMap((army) => {
      if (army.id !== blueArmyId && army.id !== redArmyId) {
        return [army];
      }

      const nextSlots = buildSurvivorSlots(
        army,
        army.id === blueArmyId ? blueSurvivors : redSurvivors,
      );

      if (!nextSlots.length) {
        return [];
      }

      return [
        normalizeHexArmy({
          ...clearArmyBattleMetadata(army),
          slots: nextSlots,
        }),
      ];
    });

    layer3Battle = createLayer3BattleState();

    return {
      battleId,
      hexUnits: cloneHexUnits(hexUnits),
      layer3Battle: createLayer3BattleState(layer3Battle),
    };
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

    const engagements = buildContestedHexEngagements();
    markArmiesForBattle(engagements);

    pendingMoves.clear();
    readyPlayers.clear();
    turnNumber += 1;
    isResolving = false;

    return {
      hexUnits: cloneHexUnits(hexUnits),
      turnNumber,
      appliedMoves,
      engagements,
      layer3Battle: createLayer3BattleState(layer3Battle),
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
    nextBattleSequence = 1;
    layer3Battle = createLayer3BattleState();

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
    setLayer3BattleState,
    applyBattleOutcome,
    resolveTurn,
    reset,
    setPlayerReady,
    setPlayerUnready,
    submitMove,
  };
}
