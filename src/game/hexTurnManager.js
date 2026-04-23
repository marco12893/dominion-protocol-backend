/**
 * Server-side hex turn manager for Layer 2 strategic map.
 *
 * Manages hex units, pending moves, turn resolution, and player readiness.
 * Moves are private - each player can only see their own pending moves
 * until the turn resolves.
 */

import { hexDistance } from "../utils/hexMath.js";
import {
  HEX_CITIES,
  HEX_GRID_COLS,
  HEX_GRID_ROWS,
  HEX_MOVEMENT_RANGE,
  INITIAL_HEX_UNITS,
} from "./hexConfig.js";
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

export function createHexTurnManager() {
  let hexUnits = INITIAL_HEX_UNITS.map((unit) => ({ ...unit }));
  const pendingMoves = new Map();
  const readyPlayers = new Set();
  let turnNumber = 1;
  let isResolving = false;
  let { terrainSeed, terrainTiles } = createTerrainSnapshot();

  function getState() {
    return {
      terrainSeed,
      terrainTiles,
      hexUnits: hexUnits.map((unit) => ({ ...unit })),
      turnNumber,
      readyPlayers: [...readyPlayers],
      isResolving,
    };
  }

  function getStateForPlayer(playerColor) {
    const ownMoves = {};
    for (const [unitId, move] of pendingMoves) {
      if (move.owner === playerColor) {
        ownMoves[unitId] = { toCol: move.toCol, toRow: move.toRow };
      }
    }

    return {
      terrainSeed,
      terrainTiles,
      hexUnits: hexUnits.map((unit) => ({ ...unit })),
      turnNumber,
      readyPlayers: [...readyPlayers],
      isResolving,
      pendingMoves: ownMoves,
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

    const distance = hexDistance(unit.col, unit.row, toCol, toRow);
    if (distance > HEX_MOVEMENT_RANGE || distance === 0) {
      return { success: false, error: "Out of range" };
    }

    const occupied = hexUnits.some((entry) => entry.col === toCol && entry.row === toRow);
    if (occupied) {
      return { success: false, error: "Hex occupied by unit" };
    }

    for (const [, move] of pendingMoves) {
      if (move.owner === playerColor && move.toCol === toCol && move.toRow === toRow) {
        return { success: false, error: "Hex targeted by another pending move" };
      }
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

    pendingMoves.clear();
    readyPlayers.clear();
    turnNumber += 1;
    isResolving = false;

    return {
      hexUnits: hexUnits.map((unit) => ({ ...unit })),
      turnNumber,
      appliedMoves,
    };
  }

  function reset() {
    hexUnits = INITIAL_HEX_UNITS.map((unit) => ({ ...unit }));
    pendingMoves.clear();
    readyPlayers.clear();
    turnNumber = 1;
    isResolving = false;

    ({ terrainSeed, terrainTiles } = createTerrainSnapshot());
  }

  return {
    getState,
    getStateForPlayer,
    submitMove,
    cancelMove,
    setPlayerReady,
    setPlayerUnready,
    resolveTurn,
    reset,
  };
}
