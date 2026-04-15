import {
  BOMBER_REENGAGE_COOLDOWN,
  COLLISION_PASSES,
  FORMATION_SPACING,
  MAP_HEIGHT,
  MAP_WIDTH,
  OBSTACLES,
  PLANE_AIRSPACE_MARGIN,
  PLANE_ATTACK_MOVE_RADIUS,
  PLANE_LOITER_RADIUS,
  PLANE_TURN_SPEED,
  PUSH_WEIGHT_IDLE,
  PUSH_WEIGHT_MOVING,
  REPATH_COOLDOWN_TICKS,
  STUCK_PROGRESS_EPSILON,
  STUCK_TICKS_THRESHOLD,
  UNIT_RADIUS,
  UNIT_SPEED,
} from "../config/gameConstants.js";
import {
  cellToPoint,
  expandObstacle,
  findNearestWalkableCell,
  findPath,
  isPointInsideRect,
  pointToCell,
  smoothPath,
} from "../navigation/pathfinding.js";
import {
  clamp,
  dotProduct,
  getAngleDelta,
  getDistanceBetweenPoints,
  negateVector,
  normalizeVector,
} from "../utils/math.js";
import { createSpatialIndex } from "./spatialIndex.js";
import {
  clampPointToMap,
  clampUnitPosition,
  getPlaneAttackMoveCenter,
  getPlaneCombatDestination,
  getPlaneEgressDestination,
  getPlaneLoiterDestination,
} from "./planes.js";

export function createMovementSystem({ worldState }) {
  function assignUnitPath(unit, desiredDestination) {
    if (unit.isPlane) {
      const destinationPoint = clampPointToMap(desiredDestination);
      unit.path = [];
      unit.targetX = destinationPoint.x;
      unit.targetY = destinationPoint.y;
      unit.destinationX = destinationPoint.x;
      unit.destinationY = destinationPoint.y;
      unit.isMoving = true;
      return;
    }

    if (unit.isHelicopter) {
      unit.path = [];
      unit.targetX = desiredDestination.x;
      unit.targetY = desiredDestination.y;
      unit.destinationX = desiredDestination.x;
      unit.destinationY = desiredDestination.y;
      unit.isMoving = true;
      return;
    }

    const startCell = pointToCell(unit.x, unit.y);
    const goalCell = findNearestWalkableCell(desiredDestination);

    if (!goalCell) {
      unit.path = [];
      unit.targetX = unit.x;
      unit.targetY = unit.y;
      unit.destinationX = unit.x;
      unit.destinationY = unit.y;
      unit.isMoving = false;
      return;
    }

    const pathCells = findPath(startCell, goalCell);
    const destinationPoint = cellToPoint(goalCell.col, goalCell.row);

    if (!pathCells) {
      unit.path = [];
      unit.targetX = unit.x;
      unit.targetY = unit.y;
      unit.destinationX = destinationPoint.x;
      unit.destinationY = destinationPoint.y;
      unit.isMoving = true;
      return;
    }

    unit.path = smoothPath(pathCells.map((cell) => cellToPoint(cell.col, cell.row)))
      .slice(1)
      .map((point) => ({
        x: point.x,
        y: point.y,
      }));
    unit.destinationX = destinationPoint.x;
    unit.destinationY = destinationPoint.y;

    if (unit.path.length > 0) {
      unit.targetX = unit.path[0].x;
      unit.targetY = unit.path[0].y;
    } else {
      unit.targetX = destinationPoint.x;
      unit.targetY = destinationPoint.y;
    }

    unit.isMoving = true;
  }

  function advanceUnit(unit, deltaTime, tickContext) {
    if (unit.isPlane) {
      return advancePlane(unit, deltaTime, tickContext);
    }

    if (!unit.isMoving) {
      unit.destinationX = unit.x;
      unit.destinationY = unit.y;
      unit.targetX = unit.x;
      unit.targetY = unit.y;
      return false;
    }

    syncUnitTarget(unit);

    const dx = unit.targetX - unit.x;
    const dy = unit.targetY - unit.y;
    const distance = Math.hypot(dx, dy);

    if (distance < 0.5) {
      if (distance !== 0) {
        unit.x = unit.targetX;
        unit.y = unit.targetY;
      }

      const progressed = advanceToNextWaypoint(unit);
      if (!progressed) {
        unit.isMoving = false;
      }
      return progressed || distance !== 0;
    }

    const maxStep = (unit.speed || UNIT_SPEED) * deltaTime;
    const step = Math.min(distance, maxStep);

    unit.x += (dx / distance) * step;
    unit.y += (dy / distance) * step;

    const targetAngle = Math.atan2(dy, dx);
    const angleDiff = getAngleDelta(unit.angle || 0, targetAngle);
    const turnSpeed = 10.0; // Radians per second
    const turnStep = turnSpeed * deltaTime;

    if (Math.abs(angleDiff) < turnStep) {
      unit.angle = targetAngle;
    } else {
      unit.angle += Math.sign(angleDiff) * turnStep;
    }

    return true;
  }

  function resolveObstacleCollisions(units) {
    let hasAdjusted = false;

    for (const unit of units) {
      if (unit.isPlane || unit.isHelicopter) continue;
      for (const obstacle of OBSTACLES) {
        const expanded = expandObstacle(obstacle, UNIT_RADIUS);

        if (!isPointInsideRect(unit.x, unit.y, expanded)) {
          continue;
        }

        const distances = [
          { side: "left", value: Math.abs(unit.x - expanded.x) },
          { side: "right", value: Math.abs(expanded.x + expanded.width - unit.x) },
          { side: "top", value: Math.abs(unit.y - expanded.y) },
          { side: "bottom", value: Math.abs(expanded.y + expanded.height - unit.y) },
        ];
        distances.sort((left, right) => left.value - right.value);

        switch (distances[0].side) {
          case "left":
            unit.x = expanded.x;
            break;
          case "right":
            unit.x = expanded.x + expanded.width;
            break;
          case "top":
            unit.y = expanded.y;
            break;
          default:
            unit.y = expanded.y + expanded.height;
            break;
        }

        unit.x = clamp(unit.x, UNIT_RADIUS, MAP_WIDTH - UNIT_RADIUS);
        unit.y = clamp(unit.y, UNIT_RADIUS, MAP_HEIGHT - UNIT_RADIUS);
        hasAdjusted = true;
      }
    }

    return hasAdjusted;
  }

  function resolveUnitCollisions(units) {
    let hasAdjusted = false;
    const minimumDistance = UNIT_RADIUS * 2;

    for (let pass = 0; pass < COLLISION_PASSES; pass += 1) {
      let passAdjusted = false;
      const spatialIndex = createSpatialIndex(units);

      for (let index = 0; index < units.length; index += 1) {
        const unit = units[index];
        spatialIndex.forEachInRange(unit.x, unit.y, minimumDistance, (otherUnit) => {
          const compareIndex = spatialIndex.getUnitOrder(otherUnit.id);
          if (compareIndex <= index) {
            return;
          }

          const unitIsAir = unit.isPlane || unit.isHelicopter;
          const otherIsAir = otherUnit.isPlane || otherUnit.isHelicopter;
          if (unitIsAir !== otherIsAir) {
            return;
          }

          const dx = otherUnit.x - unit.x;
          const dy = otherUnit.y - unit.y;
          const distance = Math.hypot(dx, dy);

          if (distance >= minimumDistance) {
            return;
          }

          const overlap = minimumDistance - distance;
          const separationNormal = getCollisionSeparationNormal(unit, otherUnit, dx, dy);
          const normalX = separationNormal.x;
          const normalY = separationNormal.y;
          const pushWeights = getPushWeights(unit, otherUnit);
          const totalWeight = pushWeights.first + pushWeights.second;
          const firstShare = totalWeight === 0 ? 0.5 : pushWeights.second / totalWeight;
          const secondShare = totalWeight === 0 ? 0.5 : pushWeights.first / totalWeight;
          const firstSeparationX = normalX * overlap * firstShare;
          const firstSeparationY = normalY * overlap * firstShare;
          const secondSeparationX = normalX * overlap * secondShare;
          const secondSeparationY = normalY * overlap * secondShare;

          const unitResolvedPosition = clampUnitPosition(unit, {
            x: unit.x - firstSeparationX,
            y: unit.y - firstSeparationY,
          });
          const otherResolvedPosition = clampUnitPosition(otherUnit, {
            x: otherUnit.x + secondSeparationX,
            y: otherUnit.y + secondSeparationY,
          });

          unit.x = unitResolvedPosition.x;
          unit.y = unitResolvedPosition.y;
          otherUnit.x = otherResolvedPosition.x;
          otherUnit.y = otherResolvedPosition.y;

          passAdjusted = true;
        });
      }

      hasAdjusted = passAdjusted || hasAdjusted;

      if (!passAdjusted) {
        break;
      }
    }

    return hasAdjusted;
  }

  function detectAndResolveDeadlocks(units) {
    let hasRepathed = false;

    for (const unit of units) {
      if (unit.isPlane) {
        unit.stuckTicks = 0;
        unit.repathCooldownTicks = 0;
        unit.previousX = unit.x;
        unit.previousY = unit.y;
        continue;
      }

      const previousRemainingTargetDistance = getDistanceBetweenPoints(
        unit.previousX,
        unit.previousY,
        unit.targetX,
        unit.targetY,
      );
      const remainingTargetDistance = getDistanceBetweenPoints(
        unit.x,
        unit.y,
        unit.targetX,
        unit.targetY,
      );
      const targetProgress = previousRemainingTargetDistance - remainingTargetDistance;

      if (unit.repathCooldownTicks > 0) {
        unit.repathCooldownTicks -= 1;
      }

      if (unit.isMoving && targetProgress <= STUCK_PROGRESS_EPSILON) {
        unit.stuckTicks += 1;
      } else if (unit.isMoving) {
        unit.stuckTicks = Math.max(0, unit.stuckTicks - 2);
      } else {
        unit.stuckTicks = 0;
      }

      if (
        unit.isMoving &&
        unit.stuckTicks >= STUCK_TICKS_THRESHOLD &&
        unit.repathCooldownTicks === 0
      ) {
        assignUnitPath(unit, {
          x: unit.destinationX,
          y: unit.destinationY,
        });
        unit.stuckTicks = 0;
        unit.repathCooldownTicks = REPATH_COOLDOWN_TICKS;
        hasRepathed = true;
      }

      unit.previousX = unit.x;
      unit.previousY = unit.y;
    }

    return hasRepathed;
  }

  return {
    assignUnitPath,
    advanceUnit,
    resolveObstacleCollisions,
    resolveUnitCollisions,
    detectAndResolveDeadlocks,
  };

  function syncUnitTarget(unit) {
    if (unit.path.length === 0) {
      unit.targetX = unit.destinationX;
      unit.targetY = unit.destinationY;
      return;
    }

    unit.targetX = unit.path[0].x;
    unit.targetY = unit.path[0].y;
  }

  function advanceToNextWaypoint(unit) {
    if (unit.path.length === 0) {
      unit.targetX = unit.destinationX;
      unit.targetY = unit.destinationY;
      return false;
    }

    unit.path.shift();
    syncUnitTarget(unit);
    return true;
  }

  function advancePlane(unit, deltaTime, tickContext) {
    const indexedTarget = unit.attackTargetId
      ? tickContext?.unitMap?.get(unit.attackTargetId) ?? null
      : null;
    const attackTarget = indexedTarget && indexedTarget.health > 0 ? indexedTarget : null;
    const attackMoveCenter = getPlaneAttackMoveCenter(unit);
    const shouldMaintainEgress =
      unit.variantId === "bomber" &&
      unit.egressPoint &&
      unit.attackCooldown > BOMBER_REENGAGE_COOLDOWN;

    if (shouldMaintainEgress) {
      unit.loiterCenter = null;

      const distanceToEgress = getDistanceBetweenPoints(
        unit.x,
        unit.y,
        unit.egressPoint.x,
        unit.egressPoint.y,
      );
      if (distanceToEgress < 80) {
        unit.egressPoint = getPlaneEgressDestination(
          unit,
          attackTarget ?? unit.egressPoint,
          unit.egressDistance ?? 0,
          unit.egressLateral ?? 0,
        );
      }

      unit.targetX = unit.egressPoint.x;
      unit.targetY = unit.egressPoint.y;
    } else if (attackTarget) {
      unit.egressPoint = null;
      unit.loiterCenter = null;
      const combatDestination = getPlaneCombatDestination(unit, attackTarget);
      unit.targetX = combatDestination.x;
      unit.targetY = combatDestination.y;
    } else if (unit.isAttackMove && attackMoveCenter) {
      unit.egressPoint = null;
      unit.loiterCenter = attackMoveCenter;
      const distanceToCenter = getDistanceBetweenPoints(unit.x, unit.y, attackMoveCenter.x, attackMoveCenter.y);

      if (distanceToCenter > PLANE_ATTACK_MOVE_RADIUS * 0.9) {
        unit.targetX = attackMoveCenter.x;
        unit.targetY = attackMoveCenter.y;
      } else {
        const patrolTarget = getPlaneLoiterDestination(unit, attackMoveCenter, PLANE_ATTACK_MOVE_RADIUS);
        unit.targetX = patrolTarget.x;
        unit.targetY = patrolTarget.y;
      }
    } else if (!unit.isMoving && !unit.attackTargetId) {
      unit.egressPoint = null;
      if (!unit.loiterCenter) {
        unit.loiterCenter = { x: unit.x, y: unit.y };
      }
      const loiterTarget = getPlaneLoiterDestination(unit, unit.loiterCenter, PLANE_LOITER_RADIUS);
      unit.targetX = loiterTarget.x;
      unit.targetY = loiterTarget.y;
    } else if (unit.isMoving) {
      unit.egressPoint = null;
      unit.loiterCenter = null;
      unit.targetX = unit.destinationX;
      unit.targetY = unit.destinationY;
    } else if (unit.egressPoint) {
      unit.targetX = unit.egressPoint.x;
      unit.targetY = unit.egressPoint.y;
    }

    const dx = unit.targetX - unit.x;
    const dy = unit.targetY - unit.y;
    const targetAngle = Math.atan2(dy, dx);

    if (unit.angle === undefined || Number.isNaN(unit.angle)) {
      unit.angle = targetAngle;
    }

    const angleDiff = getAngleDelta(unit.angle, targetAngle);
    const turnStep = PLANE_TURN_SPEED * deltaTime;
    if (Math.abs(angleDiff) < turnStep) {
      unit.angle = targetAngle;
    } else {
      unit.angle += Math.sign(angleDiff) * turnStep;
    }

    const dist = (unit.speed || UNIT_SPEED) * deltaTime;
    unit.x += Math.cos(unit.angle) * dist;
    unit.y += Math.sin(unit.angle) * dist;

    unit.x = clamp(unit.x, -PLANE_AIRSPACE_MARGIN, MAP_WIDTH + PLANE_AIRSPACE_MARGIN);
    unit.y = clamp(unit.y, -PLANE_AIRSPACE_MARGIN, MAP_HEIGHT + PLANE_AIRSPACE_MARGIN);

    const distToTarget = Math.hypot(unit.targetX - unit.x, unit.targetY - unit.y);
    if (distToTarget < 20 && unit.isMoving && !unit.isAttackMove && !attackTarget) {
      unit.isMoving = false;
      unit.destinationX = unit.x;
      unit.destinationY = unit.y;
      unit.loiterCenter = { x: unit.x, y: unit.y };
    }

    return true;
  }
}

function getPushWeights(unit, otherUnit) {
  return {
    first: getUnitPushWeight(unit),
    second: getUnitPushWeight(otherUnit),
  };
}

function getUnitPushWeight(unit) {
  if (unit.isHoldingPosition) {
    return 10000;
  }

  if (!unit.isMoving) {
    return PUSH_WEIGHT_IDLE;
  }

  return PUSH_WEIGHT_MOVING;
}

function getCollisionSeparationNormal(unit, otherUnit, dx, dy) {
  const displacementNormal = normalizeVector(dx, dy);
  const destinationNormal = normalizeVector(
    otherUnit.destinationX - unit.destinationX,
    otherUnit.destinationY - unit.destinationY,
  );
  const unitDirection = getUnitTravelDirection(unit);
  const otherDirection = getUnitTravelDirection(otherUnit);
  const destinationsNearby =
    getDistanceBetweenPoints(
      unit.destinationX,
      unit.destinationY,
      otherUnit.destinationX,
      otherUnit.destinationY,
    ) <= FORMATION_SPACING * 1.5;

  if (destinationNormal && destinationsNearby) {
    return alignVectorToReference(destinationNormal, displacementNormal);
  }

  const converging =
    displacementNormal &&
    unitDirection &&
    otherDirection &&
    dotProduct(unitDirection, displacementNormal) > 0.25 &&
    dotProduct(otherDirection, negateVector(displacementNormal)) > 0.25;
  const headOn =
    unitDirection &&
    otherDirection &&
    dotProduct(unitDirection, otherDirection) < -0.2;

  if (converging || headOn) {
    const sharedDirection = getSharedMovementDirection(unitDirection, otherDirection);
    const basis =
      displacementNormal ??
      sharedDirection ??
      normalizeVector(
        (unitDirection?.x ?? 0) - (otherDirection?.x ?? 0),
        (unitDirection?.y ?? 0) - (otherDirection?.y ?? 0),
      );

    if (basis) {
      return choosePerpendicularVector(basis, destinationNormal ?? sharedDirection);
    }
  }

  if (displacementNormal) {
    return displacementNormal;
  }

  if (destinationNormal) {
    return destinationNormal;
  }

  return otherUnit.id.localeCompare(unit.id) >= 0
    ? { x: 0, y: 1 }
    : { x: 0, y: -1 };
}

function getUnitTravelDirection(unit) {
  return (
    normalizeVector(unit.targetX - unit.x, unit.targetY - unit.y) ??
    normalizeVector(unit.destinationX - unit.x, unit.destinationY - unit.y)
  );
}

function getSharedMovementDirection(first, second) {
  return normalizeVector(
    (first?.x ?? 0) + (second?.x ?? 0),
    (first?.y ?? 0) + (second?.y ?? 0),
  );
}

function choosePerpendicularVector(basis, preferredDirection) {
  const clockwise = { x: basis.y, y: -basis.x };
  const counterClockwise = { x: -basis.y, y: basis.x };

  if (!preferredDirection) {
    return counterClockwise;
  }

  return dotProduct(counterClockwise, preferredDirection) >=
    dotProduct(clockwise, preferredDirection)
    ? counterClockwise
    : clockwise;
}

function alignVectorToReference(vector, reference) {
  if (!reference || dotProduct(vector, reference) >= 0) {
    return vector;
  }

  return negateVector(vector);
}
