import { OBSTACLES } from "../config/gameConstants.js";

export function createWorld() {
  return {
    currentTick: 0,
    lastBroadcastTick: -Infinity,
    pendingBroadcast: false,
    state: {
      obstacles: OBSTACLES,
      units: [],
      teamSelections: {
        blue: { socketId: null, isOnline: false, hasDeployed: false },
        red: { socketId: null, isOnline: false, hasDeployed: false },
      },
    },
    playerAssignments: new Map(),
  };
}
