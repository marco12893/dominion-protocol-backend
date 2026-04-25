import {
  MAP_HEIGHT,
  MAP_WIDTH,
  UNIT_RADIUS,
} from "../config/gameConstants.js";
import { buildWorldSnapshot, emitWorldSnapshot } from "./worldBroadcast.js";
import { clamp } from "../utils/math.js";

export function registerSocketHandlers({
  io,
  world,
  createUnit,
  serializeWorldState,
  buildFormation,
  assignFormationSlots,
  processUnitOrder,
  assignUnitPath,
  layer3BattleManager,
}) {
  const worldState = world.state;
  const playerAssignments = world.playerAssignments;
  const hexManager = world.hexTurnManager;

  io.on("connection", (socket) => {
    socket.emit("world:snapshot", buildWorldSnapshot(world, serializeWorldState));

    socket.on("player:join", (color) => {
      if (color !== "blue" && color !== "red") return;
      if (worldState.teamSelections[color].socketId && worldState.teamSelections[color].isOnline) {
        return;
      }

      worldState.teamSelections[color].socketId = socket.id;
      worldState.teamSelections[color].isOnline = true;
      playerAssignments.set(socket.id, color);

      emitWorldSnapshot(io, world, serializeWorldState);
      socket.emit("hex:state", world.hexTurnManager.getStateForPlayer(color));
    });

    socket.on("player:deploy", (_manifest) => {
    });

    socket.on("unit:move", ({ unitIds, position, isQueued }) => {
      const playerColor = playerAssignments.get(socket.id);
      if (!playerColor || worldState.layer3Battle?.status !== "active") return;
      if (
        !Array.isArray(unitIds) ||
        unitIds.length === 0 ||
        typeof position?.x !== "number" ||
        typeof position?.y !== "number" ||
        Number.isNaN(position.x) ||
        Number.isNaN(position.y)
      ) {
        return;
      }

      const units = unitIds
        .map((unitId) => worldState.units.find((entry) => entry.id === unitId && entry.owner === playerColor))
        .filter(Boolean);

      if (units.length === 0) {
        return;
      }

      const slots = buildFormation(units.length, {
        x: clamp(position.x, UNIT_RADIUS, MAP_WIDTH - UNIT_RADIUS),
        y: clamp(position.y, UNIT_RADIUS, MAP_HEIGHT - UNIT_RADIUS),
      });
      const assignments = assignFormationSlots(units, slots);

      assignments.forEach(({ unit, slot }) => {
        processUnitOrder(unit, { type: "move", position: slot }, isQueued);
      });

      world.pendingBroadcast = true;
    });

    socket.on("unit:attack", ({ unitIds, targetId, isQueued }) => {
      const playerColor = playerAssignments.get(socket.id);
      if (!playerColor || worldState.layer3Battle?.status !== "active") return;
      if (!Array.isArray(unitIds) || unitIds.length === 0 || typeof targetId !== "string") {
        return;
      }

      const target = worldState.units.find(
        (entry) => entry.id === targetId && entry.owner !== playerColor && entry.health > 0,
      );

      if (!target) {
        return;
      }

      const units = unitIds
        .map((unitId) => worldState.units.find((entry) => entry.id === unitId && entry.owner === playerColor))
        .filter(Boolean);

      for (const unit of units) {
        if (!unit.canTarget.includes(target.unitClass)) {
          continue;
        }
        processUnitOrder(unit, { type: "attack", targetId }, isQueued);
      }

      world.pendingBroadcast = true;
    });

    socket.on("unit:attackMove", ({ unitIds, position, isQueued }) => {
      const playerColor = playerAssignments.get(socket.id);
      if (!playerColor || worldState.layer3Battle?.status !== "active") return;
      if (
        !Array.isArray(unitIds) ||
        unitIds.length === 0 ||
        typeof position?.x !== "number" ||
        typeof position?.y !== "number" ||
        Number.isNaN(position.x) ||
        Number.isNaN(position.y)
      ) {
        return;
      }

      const units = unitIds
        .map((unitId) => worldState.units.find((entry) => entry.id === unitId && entry.owner === playerColor))
        .filter(Boolean);

      if (units.length === 0) {
        return;
      }

      const slots = buildFormation(units.length, {
        x: clamp(position.x, UNIT_RADIUS, MAP_WIDTH - UNIT_RADIUS),
        y: clamp(position.y, UNIT_RADIUS, MAP_HEIGHT - UNIT_RADIUS),
      });
      const assignments = assignFormationSlots(units, slots);

      assignments.forEach(({ unit, slot }) => {
        processUnitOrder(unit, { type: "attackMove", position: slot }, isQueued);
      });

      world.pendingBroadcast = true;
    });

    socket.on("unit:stop", ({ unitIds, isQueued }) => {
      const playerColor = playerAssignments.get(socket.id);
      if (!playerColor || worldState.layer3Battle?.status !== "active") return;
      if (!Array.isArray(unitIds) || unitIds.length === 0) {
        return;
      }

      const units = unitIds
        .map((unitId) => worldState.units.find((entry) => entry.id === unitId && entry.owner === playerColor))
        .filter(Boolean);

      for (const unit of units) {
        processUnitOrder(unit, { type: "stop" }, isQueued);
      }

      world.pendingBroadcast = true;
    });

    socket.on("unit:holdPosition", ({ unitIds, isQueued }) => {
      const playerColor = playerAssignments.get(socket.id);
      if (!playerColor || worldState.layer3Battle?.status !== "active") return;
      if (!Array.isArray(unitIds) || unitIds.length === 0) {
        return;
      }

      const units = unitIds
        .map((unitId) => worldState.units.find((entry) => entry.id === unitId && entry.owner === playerColor))
        .filter(Boolean);

      for (const unit of units) {
        processUnitOrder(unit, { type: "holdPosition" }, isQueued);
      }

      world.pendingBroadcast = true;
    });

    socket.on("player:reset", () => {
      worldState.units = [];
      worldState.teamSelections.blue.socketId = null;
      worldState.teamSelections.blue.isOnline = false;
      worldState.teamSelections.blue.hasDeployed = false;
      worldState.teamSelections.red.socketId = null;
      worldState.teamSelections.red.isOnline = false;
      worldState.teamSelections.red.hasDeployed = false;
      playerAssignments.clear();

      // Reset hex grid state
      world.hexTurnManager.reset();
      layer3BattleManager?.reset();

      io.emit("game:reset");
      emitWorldSnapshot(io, world, serializeWorldState);
      io.emit("hex:state", world.hexTurnManager.getState());
    });

    socket.on("disconnect", () => {
      const color = playerAssignments.get(socket.id);
      if (color && worldState.teamSelections[color]) {
        // Only mark offline if this socket is still the active one for this team.
        // A newer socket may have already taken over (e.g. after reconnect),
        // so a stale socket disconnecting should not flip the team offline.
        if (worldState.teamSelections[color].socketId === socket.id) {
          worldState.teamSelections[color].isOnline = false;
          emitWorldSnapshot(io, world, serializeWorldState);
        }
      }
      playerAssignments.delete(socket.id);
    });

    socket.on("enemy:respawn", () => {
      worldState.units = worldState.units.filter((entry) => entry.owner !== "enemy");

      worldState.units.push(
        createUnit("enemy-1", 2000, 2000, "enemy", "rifleman"),
        createUnit("enemy-2", 2100, 2000, "enemy", "armoredDummy"),
      );

      for (const unit of worldState.units) {
        if (
          unit.owner === "player" &&
          unit.attackTargetId &&
          worldState.units.find((entry) => entry.id === unit.attackTargetId) === undefined
        ) {
          unit.attackTargetId = null;
          if (unit.isAttackMove) {
            assignUnitPath(unit, { x: unit.attackMoveDestinationX, y: unit.attackMoveDestinationY });
          }
        }
      }

      emitWorldSnapshot(io, world, serializeWorldState);
    });

    // ─── Hex Grid (Layer 2) Events ─────────────────────────────────────────

    // Send hex state on connect (player-specific, with only their own pending moves)
    const initialColor = playerAssignments.get(socket.id);
    socket.emit(
      "hex:state",
      initialColor ? hexManager.getStateForPlayer(initialColor) : hexManager.getState(),
    );

    socket.on("hex:submitMove", ({ unitId, toCol, toRow }) => {
      const color = playerAssignments.get(socket.id);
      if (!color) return;

      const result = hexManager.submitMove(color, unitId, toCol, toRow);
      if (result.success) {
        // Only send back to the player who submitted — moves are private
        socket.emit("hex:moveSubmitted", { unitId, toCol, toRow });
      } else {
        socket.emit("hex:moveRejected", { unitId, error: result.error });
      }
    });

    socket.on("hex:cancelMove", ({ unitId }) => {
      const color = playerAssignments.get(socket.id);
      if (!color) return;

      const result = hexManager.cancelMove(color, unitId);
      if (result.success) {
        socket.emit("hex:moveCancelled", { unitId });
      }
    });

    socket.on("hex:buildUnit", ({ cityId, variantId, quantity }) => {
      const color = playerAssignments.get(socket.id);
      if (!color) return;

      const result = hexManager.buildUnit(color, cityId, variantId, quantity);
      if (!result.success) {
        socket.emit("hex:buildRejected", {
          cityId,
          variantId,
          quantity,
          error: result.error,
        });
        return;
      }

      emitHexStateUpdates(io, world);
    });

    socket.on("hex:upgradeCity", ({ cityId }) => {
      const color = playerAssignments.get(socket.id);
      if (!color) return;

      const result = hexManager.upgradeCity(color, cityId);
      if (!result.success) {
        socket.emit("hex:upgradeRejected", {
          cityId,
          error: result.error,
        });
        return;
      }

      emitHexStateUpdates(io, world);
    });

    socket.on("hex:endTurn", () => {
      const color = playerAssignments.get(socket.id);
      if (!color) return;

      const result = hexManager.setPlayerReady(color);
      if (!result.success) return;

      // Broadcast to all that this player is ready
      io.emit("hex:playerReady", { playerColor: color });

      // If both players are ready, resolve the turn
      if (result.allReady) {
        const resolved = hexManager.resolveTurn();
        if (Array.isArray(resolved?.engagements) && resolved.engagements.length > 0) {
          layer3BattleManager?.queueEngagements(resolved.engagements);
        }

        const latestHexState = hexManager.getState();
        io.emit("hex:turnResolved", {
          ...resolved,
          hexUnits: latestHexState.hexUnits,
          layer3Battle: latestHexState.layer3Battle,
        });
        emitHexStateUpdates(io, world);
      }
    });

    socket.on("hex:cancelReady", () => {
      const color = playerAssignments.get(socket.id);
      if (!color) return;

      const result = hexManager.setPlayerUnready(color);
      if (result.success) {
        io.emit("hex:playerUnready", { playerColor: color });
      }
    });

    socket.on("hex:requestState", () => {
      const color = playerAssignments.get(socket.id);
      if (!color) {
        socket.emit("hex:state", hexManager.getState());
      } else {
        socket.emit("hex:state", hexManager.getStateForPlayer(color));
      }
    });
  });
}

export function emitHexStateUpdates(io, world) {
  const worldState = world.state;
  const hexManager = world.hexTurnManager;
  const blueSocketId = worldState.teamSelections.blue.socketId;
  const redSocketId = worldState.teamSelections.red.socketId;

  if (worldState.teamSelections.blue.isOnline && blueSocketId) {
    io.to(blueSocketId).emit("hex:state", hexManager.getStateForPlayer("blue"));
  }

  if (worldState.teamSelections.red.isOnline && redSocketId) {
    io.to(redSocketId).emit("hex:state", hexManager.getStateForPlayer("red"));
  }
}
