import {
  MAP_HEIGHT,
  MAP_WIDTH,
  UNIT_CLASSES,
  UNIT_RADIUS,
  UNIT_SPEED,
  UNIT_VARIANTS,
} from "../config/gameConstants.js";
import { clamp } from "../utils/math.js";

export function createUnit(id, x, y, owner = "player", variantId = "rifleman") {
  const clampedX = clamp(x, UNIT_RADIUS, MAP_WIDTH - UNIT_RADIUS);
  const clampedY = clamp(y, UNIT_RADIUS, MAP_HEIGHT - UNIT_RADIUS);
  const variantProps = UNIT_VARIANTS[variantId];

  return {
    id,
    owner,
    variantId,
    unitClass: variantProps.unitClass,
    x: clampedX,
    y: clampedY,
    previousX: clampedX,
    previousY: clampedY,
    previousRemainingDistance: 0,
    targetX: clampedX,
    targetY: clampedY,
    destinationX: clampedX,
    destinationY: clampedY,
    path: [],
    stuckTicks: 0,
    repathCooldownTicks: 0,
    health: variantProps.maxHealth,
    maxHealth: variantProps.maxHealth,
    attackDamage: variantProps.attackDamage,
    attackRange: variantProps.attackRange,
    engagementRange: variantProps.engagementRange ?? variantProps.attackRange,
    attackCooldownTime: variantProps.attackCooldown,
    damageModifiers: variantProps.damageModifiers,
    canTarget: variantProps.canTarget,
    attackTargetId: null,
    isAttackMove: false,
    attackMoveDestinationX: null,
    attackMoveDestinationY: null,
    attackCooldown: 0,
    isMoving: false,
    isFiring: false,
    isHoldingPosition: false,
    defense: variantProps.defense || 0,
    speed: variantProps.speed || UNIT_SPEED,
    orderQueue: [],
    kills: 0,
    angle: 0,
    isPlane: variantProps.unitClass === UNIT_CLASSES.PLANE,
    isHelicopter: variantProps.unitClass === UNIT_CLASSES.HELICOPTER,
    width: variantProps.width || 20,
    height: variantProps.height || 20,
    loiterCenter: null,
    egressPoint: null,
    egressDistance: 0,
    egressLateral: 0,
    burstTicks: 0,
    burstCooldown: 0,
    lastRetreatTick: 0,
  };
}

export function serializeUnit(unit) {
  return {
    id: unit.id,
    owner: unit.owner,
    variantId: unit.variantId,
    unitClass: unit.unitClass,
    x: unit.x,
    y: unit.y,
    health: unit.health,
    maxHealth: unit.maxHealth,
    attackDamage: unit.attackDamage,
    attackRange: unit.attackRange,
    attackCooldownTime: unit.attackCooldownTime,
    armor: unit.defense || 0,
    kills: unit.kills || 0,
    attackTargetId: unit.attackTargetId || null,
    isFiring: !!unit.isFiring,
    isHoldingPosition: !!unit.isHoldingPosition,
    isMoving: !!unit.isMoving,
    destinationX: unit.destinationX,
    destinationY: unit.destinationY,
    orderQueue: unit.orderQueue || [],
    speed: unit.speed || 0,
    angle: unit.angle || 0,
    isPlane: !!unit.isPlane,
    isHelicopter: !!unit.isHelicopter,
    width: unit.width || 20,
    height: unit.height || 20,
    damageModifiers: unit.damageModifiers || {},
  };
}

export function serializeWorldState(state) {
  return {
    obstacles: state.obstacles,
    teamSelections: state.teamSelections,
    units: state.units.filter((unit) => unit.health > 0).map(serializeUnit),
  };
}

function clonePlainValue(value) {
  if (Array.isArray(value)) {
    return value.map(clonePlainValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, clonePlainValue(entryValue)]),
    );
  }

  return value;
}

function areValuesEqual(left, right) {
  if (left === right) {
    return true;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return false;
    }

    for (let index = 0; index < left.length; index += 1) {
      if (!areValuesEqual(left[index], right[index])) {
        return false;
      }
    }

    return true;
  }

  if (
    left &&
    right &&
    typeof left === "object" &&
    typeof right === "object"
  ) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);

    if (leftKeys.length !== rightKeys.length) {
      return false;
    }

    for (const key of leftKeys) {
      if (!areValuesEqual(left[key], right[key])) {
        return false;
      }
    }

    return true;
  }

  return false;
}

function createUnitPatch(previousUnit, nextUnit) {
  const patch = { id: nextUnit.id };
  let hasChanges = false;

  for (const [key, value] of Object.entries(nextUnit)) {
    if (key === "id") {
      continue;
    }

    if (!areValuesEqual(previousUnit[key], value)) {
      patch[key] = clonePlainValue(value);
      hasChanges = true;
    }
  }

  return hasChanges ? patch : null;
}

export function createSerializedWorldCache(snapshot) {
  return {
    obstacles: clonePlainValue(snapshot.obstacles),
    teamSelections: clonePlainValue(snapshot.teamSelections),
    unitsById: new Map(snapshot.units.map((unit) => [unit.id, clonePlainValue(unit)])),
  };
}

export function createWorldDelta(snapshot, previousCache) {
  const delta = {
    units: [],
    removedUnitIds: [],
  };
  const previousUnitsById = previousCache?.unitsById ?? new Map();
  const nextUnitsById = new Map(snapshot.units.map((unit) => [unit.id, unit]));

  for (const unit of snapshot.units) {
    const previousUnit = previousUnitsById.get(unit.id);

    if (!previousUnit) {
      delta.units.push(clonePlainValue(unit));
      continue;
    }

    const patch = createUnitPatch(previousUnit, unit);
    if (patch) {
      delta.units.push(patch);
    }
  }

  for (const previousUnitId of previousUnitsById.keys()) {
    if (!nextUnitsById.has(previousUnitId)) {
      delta.removedUnitIds.push(previousUnitId);
    }
  }

  if (!areValuesEqual(previousCache?.teamSelections, snapshot.teamSelections)) {
    delta.teamSelections = clonePlainValue(snapshot.teamSelections);
  }

  if (!areValuesEqual(previousCache?.obstacles, snapshot.obstacles)) {
    delta.obstacles = clonePlainValue(snapshot.obstacles);
  }

  return delta;
}

export function hasWorldDeltaChanges(delta) {
  return (
    delta.units.length > 0 ||
    delta.removedUnitIds.length > 0 ||
    delta.teamSelections !== undefined ||
    delta.obstacles !== undefined
  );
}
