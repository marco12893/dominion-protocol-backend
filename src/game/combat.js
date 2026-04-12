import {
  MAP_HEIGHT,
  MAP_WIDTH,
  PLANE_BURST_COOLDOWN,
  PLANE_BURST_COUNT,
  PLANE_SHOOTING_CONE,
  UNIT_RADIUS,
} from "../config/gameConstants.js";
import { clamp, getAngleDelta, getDistanceBetweenPoints } from "../utils/math.js";
import {
  getPlanePredictedTargetPosition,
  shouldPlaneDisengageFromAttackMove,
} from "./planes.js";

export function createCombatSystem({ io, world, assignUnitPath }) {
  const worldState = world.state;

  function handleSkirmishRetreat(unit, attacker) {
    if (unit.isHoldingPosition) return false;

    const canHitBack = unit.canTarget.includes(attacker.unitClass);
    const shouldRetreat = unit.variantId === "antiAir" || !canHitBack;

    if (!shouldRetreat) return false;
    if (world.currentTick - (unit.lastRetreatTick || 0) < 40) return false;

    const dx = unit.x - attacker.x;
    const dy = unit.y - attacker.y;
    const dist = Math.hypot(dx, dy);

    if (dist < 1) return false;

    const retreatDistance = 120;
    const targetX = clamp(unit.x + (dx / dist) * retreatDistance, UNIT_RADIUS, MAP_WIDTH - UNIT_RADIUS);
    const targetY = clamp(unit.y + (dy / dist) * retreatDistance, UNIT_RADIUS, MAP_HEIGHT - UNIT_RADIUS);

    unit.orderQueue = [];
    unit.attackTargetId = null;
    assignUnitPath(unit, { x: targetX, y: targetY });
    unit.lastRetreatTick = world.currentTick;
    return true;
  }

  function applyDamage(target, shooter, damage) {
    if (target.health <= 0) return false;

    target.health = Math.max(0, target.health - damage);
    handleSkirmishRetreat(target, shooter);

    if (target.health <= 0) {
      shooter.kills = (shooter.kills || 0) + 1;
      handleTargetDeath(target);
      return true;
    }

    if (!target.attackTargetId && target.canTarget.includes(shooter.unitClass)) {
      target.attackTargetId = shooter.id;
    }

    return false;
  }

  function handleTargetDeath(target) {
    for (const attacker of worldState.units) {
      if (attacker.attackTargetId === target.id) {
        attacker.attackTargetId = null;
        if (attacker.isAttackMove) {
          assignUnitPath(attacker, { x: attacker.attackMoveDestinationX, y: attacker.attackMoveDestinationY });
        }
      }
    }
  }

  function processPlaneAttack(unit, target, deltaTime) {
    let hasChanged = false;
    unit.isFiring = false;

    if (unit.attackCooldown > 0) {
      unit.attackCooldown = Math.max(0, unit.attackCooldown - deltaTime);
      hasChanged = true;
    }

    if (unit.burstCooldown > 0) {
      unit.burstCooldown = Math.max(0, unit.burstCooldown - deltaTime);
      hasChanged = true;
    }

    const distance = getDistanceBetweenPoints(unit.x, unit.y, target.x, target.y);
    if (distance > unit.attackRange) {
      return hasChanged;
    }

    const predictedTarget = getPlanePredictedTargetPosition(unit, target);
    const dx = predictedTarget.x - unit.x;
    const dy = predictedTarget.y - unit.y;
    const targetAngle = Math.atan2(dy, dx);
    const angleDiff = getAngleDelta(unit.angle ?? 0, targetAngle);

    if (Math.abs(angleDiff) > PLANE_SHOOTING_CONE) {
      return hasChanged;
    }

    if (unit.attackCooldown > 0 || unit.burstCooldown > 0) {
      unit.isFiring = unit.attackCooldown <= 0;
      return true;
    }

    unit.isFiring = true;
    const initialDamage = unit.attackDamage * (unit.damageModifiers[target.unitClass] ?? 1);
    const finalDamage = Math.max(1, initialDamage - (target.defense || 0));

    io.emit("unit:shootProjectile", {
      id: `bullet-${unit.id}-${Date.now()}-${unit.burstTicks}`,
      shooterId: unit.id,
      targetId: target.id,
      startX: unit.x,
      startY: unit.y,
      damage: finalDamage,
      speed: 800,
      variantId: "fighter_bullet",
    });

    applyDamage(target, unit, finalDamage);

    unit.burstTicks += 1;
    if (unit.burstTicks >= PLANE_BURST_COUNT) {
      unit.burstTicks = 0;
      unit.attackCooldown = unit.attackCooldownTime;
    } else {
      unit.burstCooldown = PLANE_BURST_COOLDOWN;
    }

    return true;
  }

  function processAttacks(units, deltaTime) {
    let hasChanged = false;

    for (const unit of units) {
      unit.isFiring = false;

      if (unit.health <= 0 || !unit.attackTargetId) {
        continue;
      }

      const target = units.find(
        (entry) => entry.id === unit.attackTargetId && entry.health > 0,
      );

      if (!target) {
        unit.attackTargetId = null;
        if (unit.isAttackMove) {
          assignUnitPath(unit, { x: unit.attackMoveDestinationX, y: unit.attackMoveDestinationY });
        }
        hasChanged = true;
        continue;
      }

      const distance = getDistanceBetweenPoints(unit.x, unit.y, target.x, target.y);

      if (unit.isPlane) {
        if (shouldPlaneDisengageFromAttackMove(unit, target)) {
          unit.attackTargetId = null;
          hasChanged = true;
          continue;
        }

        if (unit.isHoldingPosition && distance > unit.attackRange) {
          unit.attackTargetId = null;
          hasChanged = true;
          continue;
        }

        if (processPlaneAttack(unit, target, deltaTime)) {
          hasChanged = true;
        }
        continue;
      }

      if (distance > unit.attackRange) {
        if (unit.isHoldingPosition) {
          unit.attackTargetId = null;
          hasChanged = true;
          continue;
        }

        if (unit.variantId === "antiAir") {
          unit.attackTargetId = null;
          hasChanged = true;
          continue;
        }

        const dx = target.x - unit.x;
        const dy = target.y - unit.y;
        const stopDistance = unit.attackRange * 0.8;
        const moveToX = target.x - (dx / distance) * stopDistance;
        const moveToY = target.y - (dy / distance) * stopDistance;

        if (
          Math.abs(unit.destinationX - moveToX) > 5 ||
          Math.abs(unit.destinationY - moveToY) > 5
        ) {
          assignUnitPath(unit, { x: moveToX, y: moveToY });
          hasChanged = true;
        }

        continue;
      }

      unit.path = [];
      unit.targetX = unit.x;
      unit.targetY = unit.y;
      unit.destinationX = unit.x;
      unit.destinationY = unit.y;
      unit.isFiring = true;
      hasChanged = true;

      if (unit.attackCooldown > 0) {
        unit.attackCooldown -= deltaTime;
        continue;
      }

      const initialDamage = unit.attackDamage * (unit.damageModifiers[target.unitClass] ?? 1);
      const finalDamage = Math.max(1, initialDamage - (target.defense || 0));

      if (unit.variantId === "antiTank" || unit.variantId === "antiAir") {
        const isAA = unit.variantId === "antiAir";
        const projectileDistance = getDistanceBetweenPoints(unit.x, unit.y, target.x, target.y);
        const speed = isAA ? 550 : 450;
        const flightTime = projectileDistance / speed;

        io.emit("unit:shootProjectile", {
          id: `msl-${unit.id}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          shooterId: unit.id,
          targetId: target.id,
          startX: unit.x,
          startY: unit.y,
          damage: finalDamage,
          speed,
          variantId: isAA ? "aa_missile" : "antiTank_missile",
        });

        setTimeout(() => {
          const currentTarget = worldState.units.find((entry) => entry.id === target.id);
          if (currentTarget && currentTarget.health > 0) {
            applyDamage(currentTarget, unit, finalDamage);
          }
        }, flightTime * 1000);
      } else if (unit.isHelicopter) {
        io.emit("unit:shootProjectile", {
          id: `bullet-heli-${unit.id}-${Date.now()}`,
          shooterId: unit.id,
          targetId: target.id,
          startX: unit.x,
          startY: unit.y,
          damage: finalDamage,
          speed: 800,
          variantId: "fighter_bullet",
        });
        applyDamage(target, unit, finalDamage);
      } else {
        applyDamage(target, unit, finalDamage);

        io.emit("unit:attack", {
          id: `atk-${unit.id}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          unitId: unit.id,
          targetId: target.id,
          shooterPos: { x: unit.x, y: unit.y },
          targetPos: { x: target.x, y: target.y },
          variantId: unit.variantId,
        });
      }

      unit.attackCooldown = unit.attackCooldownTime;
      hasChanged = true;
    }

    return hasChanged;
  }

  return {
    applyDamage,
    handleTargetDeath,
    processAttacks,
  };
}
