export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function normalizeVector(x, y) {
  const magnitude = Math.hypot(x, y);

  if (magnitude < 0.001) {
    return null;
  }

  return {
    x: x / magnitude,
    y: y / magnitude,
  };
}

export function dotProduct(left, right) {
  return left.x * right.x + left.y * right.y;
}

export function negateVector(vector) {
  return {
    x: -vector.x,
    y: -vector.y,
  };
}

export function getAngleDelta(fromAngle, toAngle) {
  let angleDiff = toAngle - fromAngle;
  while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
  while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
  return angleDiff;
}

export function getDistanceBetweenPoints(fromX, fromY, toX, toY) {
  return Math.hypot(toX - fromX, toY - fromY);
}
