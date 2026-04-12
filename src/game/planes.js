import {
  MAP_HEIGHT,
  MAP_WIDTH,
  PLANE_AIRSPACE_MARGIN,
  PLANE_AIRSPACE_TARGET_BUFFER,
  PLANE_ATTACK_MOVE_LEASH,
  PLANE_ATTACK_RUN_EXTENSION,
  PLANE_BREAKAWAY_DISTANCE,
  PLANE_BREAKAWAY_LATERAL,
  PLANE_LEAD_TIME_MAX,
  PLANE_LEAD_TIME_MIN,
  PLANE_LINEUP_DISTANCE,
  PLANE_LINEUP_LATERAL,
  PLANE_MIN_ATTACK_SEPARATION,
  TICK_RATE,
  UNIT_RADIUS,
} from "../config/gameConstants.js";
import {
  clamp,
  dotProduct,
  getDistanceBetweenPoints,
  negateVector,
  normalizeVector,
} from "../utils/math.js";

export function clampPlanePoint(point) {
  return {
    x: clamp(
      point.x,
      -PLANE_AIRSPACE_MARGIN + PLANE_AIRSPACE_TARGET_BUFFER,
      MAP_WIDTH + PLANE_AIRSPACE_MARGIN - PLANE_AIRSPACE_TARGET_BUFFER,
    ),
    y: clamp(
      point.y,
      -PLANE_AIRSPACE_MARGIN + PLANE_AIRSPACE_TARGET_BUFFER,
      MAP_HEIGHT + PLANE_AIRSPACE_MARGIN - PLANE_AIRSPACE_TARGET_BUFFER,
    ),
  };
}

export function clampPointToMap(point) {
  return {
    x: clamp(point.x, UNIT_RADIUS, MAP_WIDTH - UNIT_RADIUS),
    y: clamp(point.y, UNIT_RADIUS, MAP_HEIGHT - UNIT_RADIUS),
  };
}

export function clampUnitPosition(unit, point) {
  if (unit.isPlane) {
    return {
      x: clamp(point.x, -PLANE_AIRSPACE_MARGIN, MAP_WIDTH + PLANE_AIRSPACE_MARGIN),
      y: clamp(point.y, -PLANE_AIRSPACE_MARGIN, MAP_HEIGHT + PLANE_AIRSPACE_MARGIN),
    };
  }

  return {
    x: clamp(point.x, UNIT_RADIUS, MAP_WIDTH - UNIT_RADIUS),
    y: clamp(point.y, UNIT_RADIUS, MAP_HEIGHT - UNIT_RADIUS),
  };
}

export function getUnitVelocity(unit) {
  return {
    x: (unit.x - (unit.previousX ?? unit.x)) * TICK_RATE,
    y: (unit.y - (unit.previousY ?? unit.y)) * TICK_RATE,
  };
}

export function getPlanePredictedTargetPosition(unit, target) {
  const targetVelocity = getUnitVelocity(target);
  const targetSpeed = Math.hypot(targetVelocity.x, targetVelocity.y);
  const distance = getDistanceBetweenPoints(unit.x, unit.y, target.x, target.y);
  const closingSpeed = Math.max(120, unit.speed + targetSpeed * 0.75);
  const leadTime = clamp(
    distance / closingSpeed,
    PLANE_LEAD_TIME_MIN,
    PLANE_LEAD_TIME_MAX,
  );

  return clampPlanePoint({
    x: target.x + targetVelocity.x * leadTime,
    y: target.y + targetVelocity.y * leadTime,
  });
}

export function getPlaneCombatDestination(unit, target) {
  const predictedTarget = getPlanePredictedTargetPosition(unit, target);
  const planeForward = normalizeVector(Math.cos(unit.angle ?? 0), Math.sin(unit.angle ?? 0)) ?? { x: 1, y: 0 };
  const toPredicted =
    normalizeVector(predictedTarget.x - unit.x, predictedTarget.y - unit.y) ??
    planeForward;
  const targetVelocity = getUnitVelocity(target);
  const targetMotion = normalizeVector(targetVelocity.x, targetVelocity.y);
  const pursuitAxis = targetMotion ?? toPredicted;
  const turnCross = planeForward.x * toPredicted.y - planeForward.y * toPredicted.x;
  const lateralSign = Math.abs(turnCross) < 0.001 ? 1 : Math.sign(turnCross);
  const lateral = { x: -pursuitAxis.y * lateralSign, y: pursuitAxis.x * lateralSign };
  const distance = getDistanceBetweenPoints(unit.x, unit.y, target.x, target.y);
  const aspect = dotProduct(planeForward, toPredicted);

  if (distance < PLANE_MIN_ATTACK_SEPARATION || aspect < -0.15) {
    return clampPlanePoint({
      x: unit.x + planeForward.x * PLANE_BREAKAWAY_DISTANCE + lateral.x * PLANE_BREAKAWAY_LATERAL,
      y: unit.y + planeForward.y * PLANE_BREAKAWAY_DISTANCE + lateral.y * PLANE_BREAKAWAY_LATERAL,
    });
  }

  if (distance <= unit.attackRange * 1.05 && aspect > 0.55) {
    return clampPlanePoint({
      x: predictedTarget.x + toPredicted.x * PLANE_ATTACK_RUN_EXTENSION,
      y: predictedTarget.y + toPredicted.y * PLANE_ATTACK_RUN_EXTENSION,
    });
  }

  const trailDirection = targetMotion ? negateVector(targetMotion) : negateVector(toPredicted);
  if (distance <= unit.attackRange * 1.6) {
    return clampPlanePoint({
      x: predictedTarget.x + trailDirection.x * PLANE_LINEUP_DISTANCE + lateral.x * PLANE_LINEUP_LATERAL,
      y: predictedTarget.y + trailDirection.y * PLANE_LINEUP_DISTANCE + lateral.y * PLANE_LINEUP_LATERAL,
    });
  }

  return predictedTarget;
}

export function getPlaneAttackMoveCenter(unit) {
  if (
    !unit.isAttackMove ||
    typeof unit.attackMoveDestinationX !== "number" ||
    typeof unit.attackMoveDestinationY !== "number"
  ) {
    return null;
  }

  return {
    x: unit.attackMoveDestinationX,
    y: unit.attackMoveDestinationY,
  };
}

export function shouldPlaneDisengageFromAttackMove(unit, target) {
  const attackMoveCenter = getPlaneAttackMoveCenter(unit);
  if (!attackMoveCenter) {
    return false;
  }

  return getDistanceBetweenPoints(
    attackMoveCenter.x,
    attackMoveCenter.y,
    target.x,
    target.y,
  ) > PLANE_ATTACK_MOVE_LEASH;
}

export function getPlaneLoiterDestination(unit, center, radius) {
  const offsetX = unit.x - center.x;
  const offsetY = unit.y - center.y;
  const offsetDistance = Math.hypot(offsetX, offsetY);
  const radialAngle = offsetDistance < 1
    ? unit.angle ?? 0
    : Math.atan2(offsetY, offsetX);
  const tangentAngle = radialAngle + Math.PI / 2;
  const orbitX = center.x + Math.cos(radialAngle) * radius;
  const orbitY = center.y + Math.sin(radialAngle) * radius;
  const tangentLookahead = Math.max(80, radius * 0.35);

  return clampPlanePoint({
    x: orbitX + Math.cos(tangentAngle) * tangentLookahead,
    y: orbitY + Math.sin(tangentAngle) * tangentLookahead,
  });
}
