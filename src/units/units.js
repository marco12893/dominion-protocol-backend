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
    loiterCenter: null,
    burstTicks: 0,
    burstCooldown: 0,
    lastRetreatTick: 0,
  };
}

export function serializeWorldState(state) {
  return {
    obstacles: state.obstacles,
    teamSelections: state.teamSelections,
    units: state.units
      .filter((unit) => unit.health > 0)
      .map((unit) => ({
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
        orderQueue: unit.orderQueue || [],
        speed: unit.speed || 0,
        angle: unit.angle || 0,
        isPlane: !!unit.isPlane,
        isHelicopter: !!unit.isHelicopter,
        damageModifiers: unit.damageModifiers || {},
      })),
  };
}
