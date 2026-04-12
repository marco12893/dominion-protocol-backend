import { TICK_RATE, UNIT_RADIUS } from "../config/gameConstants.js";
import { getDistanceBetweenPoints } from "../utils/math.js";

export function createGameLoop({
  world,
  executeOrder,
  processAttacks,
  advanceUnit,
  resolveObstacleCollisions,
  resolveUnitCollisions,
  detectAndResolveDeadlocks,
  serializeWorldState,
  io,
}) {
  return function tick() {
    const worldState = world.state;
    let hasMoved = false;

    for (const unit of worldState.units) {
      if (unit.health <= 0) continue;

      const isIdle = !unit.isMoving && !unit.attackTargetId && !unit.isHoldingPosition;
      if (isIdle && unit.orderQueue.length > 0) {
        const nextOrder = unit.orderQueue.shift();
        executeOrder(unit, nextOrder);
        hasMoved = true;
      }
    }

    for (const unit of worldState.units) {
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
        let minDistance = unit.isPlane ? unit.attackRange * 1.5 : unit.attackRange;

        for (const otherUnit of worldState.units) {
          if (otherUnit.id === unit.id || otherUnit.health <= 0 || otherUnit.owner === unit.owner) {
            continue;
          }

          if (!unit.canTarget.includes(otherUnit.unitClass)) {
            continue;
          }

          const distance = getDistanceBetweenPoints(unit.x, unit.y, otherUnit.x, otherUnit.y);
          if (distance <= minDistance) {
            minDistance = distance;
            nearestTarget = otherUnit;
          }
        }

        if (nearestTarget) {
          unit.attackTargetId = nearestTarget.id;
          hasMoved = true;
        }
      }
    }

    hasMoved = processAttacks(worldState.units, 1 / TICK_RATE) || hasMoved;

    for (const unit of worldState.units) {
      if (unit.health <= 0) {
        continue;
      }

      hasMoved = advanceUnit(unit, 1 / TICK_RATE) || hasMoved;
    }

    const aliveUnits = worldState.units.filter((unit) => unit.health > 0);
    hasMoved = resolveObstacleCollisions(aliveUnits) || hasMoved;
    hasMoved = resolveUnitCollisions(aliveUnits) || hasMoved;
    hasMoved = detectAndResolveDeadlocks(aliveUnits) || hasMoved;

    if (hasMoved) {
      io.emit("world:state", serializeWorldState(worldState));
    }

    world.currentTick += 1;
  };
}
