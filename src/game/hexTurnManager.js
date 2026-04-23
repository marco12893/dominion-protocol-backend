/**
 * Server-side hex turn manager for Layer 2 strategic map.
 *
 * Manages hex units, pending moves, turn resolution, and player readiness.
 * Moves are private — each player can only see their own pending moves
 * until the turn resolves.
 */

import { hexDistance, getHexesInRange } from "../utils/hexMath.js";

// ─── Constants ───────────────────────────────────────────────────────────────
const GRID_COLS = 40;
const GRID_ROWS = 30;
const MOVEMENT_RANGE = 2;

const INITIAL_HEX_UNITS = [
  { id: "hex-u1", col: 5, row: 4, owner: "blue" },
  { id: "hex-u2", col: 8, row: 8, owner: "blue" },
  { id: "hex-u3", col: 10, row: 6, owner: "blue" },
  { id: "hex-u4", col: 32, row: 21, owner: "red" },
  { id: "hex-u5", col: 35, row: 23, owner: "red" },
  { id: "hex-u6", col: 30, row: 24, owner: "red" },
];

// ─── Manager ─────────────────────────────────────────────────────────────────

export function createHexTurnManager() {
  let hexUnits = INITIAL_HEX_UNITS.map((u) => ({ ...u }));
  const pendingMoves = new Map(); // unitId → { toCol, toRow, owner }
  const readyPlayers = new Set(); // "blue" | "red"
  let turnNumber = 1;
  let isResolving = false;

  /**
   * Returns the full state snapshot (for initial sync on connect).
   */
  function getState() {
    return {
      hexUnits: hexUnits.map((u) => ({ ...u })),
      turnNumber,
      readyPlayers: [...readyPlayers],
      isResolving,
    };
  }

  /**
   * Returns the state visible to a specific player.
   * Each player only sees their own pending moves.
   */
  function getStateForPlayer(playerColor) {
    const ownMoves = {};
    for (const [unitId, move] of pendingMoves) {
      if (move.owner === playerColor) {
        ownMoves[unitId] = { toCol: move.toCol, toRow: move.toRow };
      }
    }

    return {
      hexUnits: hexUnits.map((u) => ({ ...u })),
      turnNumber,
      readyPlayers: [...readyPlayers],
      isResolving,
      pendingMoves: ownMoves,
    };
  }

  /**
   * Submit a move for a unit. Returns { success, error? }.
   */
  function submitMove(playerColor, unitId, toCol, toRow) {
    if (isResolving) {
      return { success: false, error: "Turn is resolving" };
    }

    if (readyPlayers.has(playerColor)) {
      return { success: false, error: "Already marked ready" };
    }

    const unit = hexUnits.find((u) => u.id === unitId);
    if (!unit) {
      return { success: false, error: "Unit not found" };
    }

    if (unit.owner !== playerColor) {
      return { success: false, error: "Not your unit" };
    }

    // Validate grid bounds
    if (toCol < 0 || toCol >= GRID_COLS || toRow < 0 || toRow >= GRID_ROWS) {
      return { success: false, error: "Out of bounds" };
    }

    // Validate movement range
    const dist = hexDistance(unit.col, unit.row, toCol, toRow);
    if (dist > MOVEMENT_RANGE || dist === 0) {
      return { success: false, error: "Out of range" };
    }

    // Check if target hex is occupied by another unit
    const occupied = hexUnits.some((u) => u.col === toCol && u.row === toRow);
    if (occupied) {
      return { success: false, error: "Hex occupied by unit" };
    }

    // Check if another of this player's pending moves targets this hex
    for (const [existingUnitId, move] of pendingMoves) {
      if (move.owner === playerColor && move.toCol === toCol && move.toRow === toRow) {
        return { success: false, error: "Hex targeted by another pending move" };
      }
    }

    pendingMoves.set(unitId, { toCol, toRow, owner: playerColor });
    return { success: true };
  }

  /**
   * Cancel a pending move. Returns { success, error? }.
   */
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

  /**
   * Mark a player as ready. Returns { success, allReady }.
   */
  function setPlayerReady(playerColor) {
    if (isResolving) {
      return { success: false, allReady: false, error: "Turn is resolving" };
    }

    readyPlayers.add(playerColor);

    const allReady = readyPlayers.has("blue") && readyPlayers.has("red");
    return { success: true, allReady };
  }

  /**
   * Unmark a player as ready. Returns { success }.
   */
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

  /**
   * Resolve the current turn. Applies all pending moves simultaneously.
   * Returns the resolved state with applied moves for animation.
   */
  function resolveTurn() {
    isResolving = true;

    // Collect all moves to apply
    const appliedMoves = [];
    for (const [unitId, move] of pendingMoves) {
      const unit = hexUnits.find((u) => u.id === unitId);
      if (unit) {
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
    }

    pendingMoves.clear();
    readyPlayers.clear();
    turnNumber += 1;
    isResolving = false;

    return {
      hexUnits: hexUnits.map((u) => ({ ...u })),
      turnNumber,
      appliedMoves,
    };
  }

  /**
   * Reset to initial state.
   */
  function reset() {
    hexUnits = INITIAL_HEX_UNITS.map((u) => ({ ...u }));
    pendingMoves.clear();
    readyPlayers.clear();
    turnNumber = 1;
    isResolving = false;
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
