import { OBSTACLES } from "../config/gameConstants.js";
import { createHexTurnManager } from "../game/hexTurnManager.js";

export function createWorld() {
  return {
    currentTick: 0,
    lastBroadcastTick: -Infinity,
    lastBroadcastState: null,
    pendingBroadcast: false,
    forceFullSnapshot: false,
    state: {
      obstacles: OBSTACLES,
      units: [],
      layer3Battle: {
        status: "idle",
        battleId: null,
        queueLength: 0,
        hex: null,
        maxDurationSeconds: 180,
        startedAtTick: null,
        endsAtTick: null,
        blueArmy: null,
        redArmy: null,
      },
      teamSelections: {
        blue: { socketId: null, isOnline: false, hasDeployed: false },
        red: { socketId: null, isOnline: false, hasDeployed: false },
      },
    },
    playerAssignments: new Map(),
    hexTurnManager: createHexTurnManager(),
  };
}
