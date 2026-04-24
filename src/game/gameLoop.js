import {
  TICK_RATE,
  UNIT_RADIUS,
  WORLD_STATE_BROADCAST_INTERVAL_TICKS,
} from "../config/gameConstants.js";
import { emitWorldDelta } from "../network/worldBroadcast.js";
import { createSpatialIndex } from "./spatialIndex.js";
import { getDistanceBetweenPoints } from "../utils/math.js";

export function createGameLoop({
  world,
  executeOrder,
  processAttacks,
  advanceUnit,
  resolveObstacleCollisions,
  resolveUnitCollisions,
  detectAndResolveDeadlocks,
  tickLayer3Battle,
  serializeWorldState,
  io,
}) {
  return function tick() {
    const worldState = world.state;
    let hasMoved = false;
    const isBattlePreparing = worldState.layer3Battle?.status === "countdown";

    if (!isBattlePreparing) {
      for (const unit of worldState.units) {
        if (unit.health <= 0) continue;

        const isIdle = !unit.isMoving && !unit.attackTargetId && !unit.isHoldingPosition;
        if (isIdle && unit.orderQueue.length > 0) {
          const nextOrder = unit.orderQueue.shift();
          executeOrder(unit, nextOrder);
          hasMoved = true;
        }
      }

      const startOfTickAliveUnits = worldState.units.filter((unit) => unit.health > 0);
      const tickSpatialIndex = createSpatialIndex(startOfTickAliveUnits);
      const tickContext = {
        spatialIndex: tickSpatialIndex,
        unitMap: tickSpatialIndex.unitMap,
      };

      for (const unit of startOfTickAliveUnits) {
        if (unit.health <= 0 || unit.attackTargetId) {
          continue;
        }

        const remainingDistance = getDistanceBetweenPoints(
          unit.x,
          unit.y,
          unit.destinationX,
          unit.destinationY,
        );
        const hasActiveOrder =
          remainingDistance > UNIT_RADIUS &&
          (unit.path.length > 0 || remainingDistance > 1);

        const canAutoEngage = !hasActiveOrder || unit.isAttackMove || (unit.isPlane && !unit.attackTargetId);

        if (canAutoEngage) {
          let nearestTarget = null;
          const engagementRange = unit.engagementRange ?? unit.attackRange;
          let minDistance = unit.isPlane ? engagementRange * 1.5 : engagementRange;

          tickSpatialIndex.forEachInRange(unit.x, unit.y, minDistance, (otherUnit) => {
            if (otherUnit.id === unit.id || otherUnit.health <= 0 || otherUnit.owner === unit.owner) {
              return;
            }

            if (!unit.canTarget.includes(otherUnit.unitClass)) {
              return;
            }

            const distance = getDistanceBetweenPoints(unit.x, unit.y, otherUnit.x, otherUnit.y);
            if (distance <= minDistance) {
              minDistance = distance;
              nearestTarget = otherUnit;
            }
          });

          if (nearestTarget) {
            unit.attackTargetId = nearestTarget.id;
            hasMoved = true;
          }
        }
      }

      hasMoved = processAttacks(startOfTickAliveUnits, 1 / TICK_RATE, tickContext) || hasMoved;

      for (const unit of startOfTickAliveUnits) {
        if (unit.health <= 0) {
          continue;
        }

        hasMoved = advanceUnit(unit, 1 / TICK_RATE, tickContext) || hasMoved;
      }

      const aliveUnits = worldState.units.filter((unit) => unit.health > 0);
      hasMoved = resolveObstacleCollisions(aliveUnits) || hasMoved;
      hasMoved = resolveUnitCollisions(aliveUnits) || hasMoved;
      hasMoved = detectAndResolveDeadlocks(aliveUnits) || hasMoved;
    }

    hasMoved = tickLayer3Battle?.() || hasMoved;

    world.pendingBroadcast = world.pendingBroadcast || hasMoved;

    if (
      world.pendingBroadcast &&
      world.currentTick - (world.lastBroadcastTick ?? -Infinity) >=
        WORLD_STATE_BROADCAST_INTERVAL_TICKS
    ) {
      emitWorldDelta(io, world, serializeWorldState);
    }

    world.currentTick += 1;
  };
}
