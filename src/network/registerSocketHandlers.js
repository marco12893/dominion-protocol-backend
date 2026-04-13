import {
  DEPLOYMENT_GRID_COLS,
  DEPLOYMENT_GRID_SPACING,
  MAP_HEIGHT,
  MAP_WIDTH,
  STARTING_RESOURCES,
  UNIT_RADIUS,
  UNIT_VARIANTS,
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
}) {
  const worldState = world.state;
  const playerAssignments = world.playerAssignments;

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
    });

    socket.on("player:deploy", (manifest) => {
      const color = playerAssignments.get(socket.id);
      if (!color || worldState.teamSelections[color].hasDeployed) return;

      let totalCost = 0;
      for (const [variantId, count] of Object.entries(manifest)) {
        if (!UNIT_VARIANTS[variantId] || count <= 0) continue;
        totalCost += UNIT_VARIANTS[variantId].cost * count;
      }

      if (totalCost > STARTING_RESOURCES) return;

      const spawnX = color === "blue" ? 400 : 2800;
      const spawnY = color === "blue" ? 400 : 2800;
      const direction = color === "blue" ? 1 : -1;

      let index = 0;
      for (const [variantId, count] of Object.entries(manifest)) {
        for (let i = 0; i < count; i += 1) {
          const col = index % DEPLOYMENT_GRID_COLS;
          const row = Math.floor(index / DEPLOYMENT_GRID_COLS);
          const x = spawnX + col * DEPLOYMENT_GRID_SPACING * direction;
          const y = spawnY + row * DEPLOYMENT_GRID_SPACING * direction;

          const unit = createUnit(`${color}-${variantId}-${i}-${Date.now()}`, x, y, color, variantId);
          worldState.units.push(unit);
          index += 1;
        }
      }

      worldState.teamSelections[color].hasDeployed = true;
      emitWorldSnapshot(io, world, serializeWorldState);
    });

    socket.on("unit:move", ({ unitIds, position, isQueued }) => {
      const playerColor = playerAssignments.get(socket.id);
      if (!playerColor) return;
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
      if (!playerColor) return;
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
      if (!playerColor) return;
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
      if (!playerColor) return;
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
      if (!playerColor) return;
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

      io.emit("game:reset");
      emitWorldSnapshot(io, world, serializeWorldState);
    });

    socket.on("disconnect", () => {
      const color = playerAssignments.get(socket.id);
      if (color && worldState.teamSelections[color]) {
        worldState.teamSelections[color].isOnline = false;
        emitWorldSnapshot(io, world, serializeWorldState);
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
  });
}
