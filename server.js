import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";

const PORT = Number(process.env.PORT ?? 10000);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? "http://localhost:3000";
const MAP_WIDTH = 3200;
const MAP_HEIGHT = 3200;
const TICK_RATE = 60;
const UNIT_SPEED = 180;
const FORMATION_SPACING = 28;
const UNIT_RADIUS = 10;
const COLLISION_PASSES = 3;
const CELL_SIZE = 24;
let currentTick = 0;
const PUSH_WEIGHT_IDLE = 0.35;
const STARTING_RESOURCES = 8000;
const DEPLOYMENT_GRID_COLS = 5;
const DEPLOYMENT_GRID_SPACING = 50;
const UNIT_CLASSES = {
  UNARMORED: "unarmored",
  ARMORED: "armored",
  HELICOPTER: "helicopter",
  PLANE: "plane"
};

const PLANE_LOITER_RADIUS = 300;
const PLANE_TURN_SPEED = 1.5;
const PLANE_BURST_COUNT = 4;
const PLANE_BURST_COOLDOWN = 0.1;
const PLANE_RELOAD_COOLDOWN = 6.0;
const PLANE_SHOOTING_CONE = Math.PI / 5;
const PLANE_AIRSPACE_MARGIN = 600;
const PLANE_AIRSPACE_TARGET_BUFFER = 120;
const PLANE_ATTACK_RUN_EXTENSION = 220;
const PLANE_LINEUP_DISTANCE = 180;
const PLANE_LINEUP_LATERAL = 90;
const PLANE_BREAKAWAY_DISTANCE = 260;
const PLANE_BREAKAWAY_LATERAL = 140;
const PLANE_MIN_ATTACK_SEPARATION = 110;
const PLANE_LEAD_TIME_MIN = 0.15;
const PLANE_LEAD_TIME_MAX = 0.85;
const PLANE_ATTACK_MOVE_RADIUS = 280;
const PLANE_ATTACK_MOVE_LEASH = 520;

const UNIT_VARIANTS = {
  rifleman: {
    unitClass: UNIT_CLASSES.UNARMORED,
    maxHealth: 100,
    attackDamage: 10,
    attackRange: 120,
    attackCooldown: 0.5,
    defense: 0,
    speed: 180,
    cost: 100,
    damageModifiers: {
      [UNIT_CLASSES.UNARMORED]: 1.0,
      [UNIT_CLASSES.ARMORED]: 0.15,
      [UNIT_CLASSES.HELICOPTER]: 0.0,
      [UNIT_CLASSES.PLANE]: 0.0,
    },
    canTarget: [UNIT_CLASSES.UNARMORED, UNIT_CLASSES.ARMORED]
  },
  armoredCar: {
    unitClass: UNIT_CLASSES.ARMORED,
    maxHealth: 150,
    attackDamage: 20,
    attackRange: 140,
    attackCooldown: 0.6,
    defense: 6,
    speed: 230,
    cost: 500,
    damageModifiers: {
      [UNIT_CLASSES.UNARMORED]: 1.0,
      [UNIT_CLASSES.ARMORED]: 0.25,
      [UNIT_CLASSES.HELICOPTER]: 0.0,
      [UNIT_CLASSES.PLANE]: 0.0,
    },
    canTarget: [UNIT_CLASSES.UNARMORED, UNIT_CLASSES.ARMORED]
  },
  lightTank: {
    unitClass: UNIT_CLASSES.ARMORED,
    maxHealth: 300,
    attackDamage: 50,
    attackRange: 180,
    attackCooldown: 1.2,
    defense: 3,
    speed: 280,
    cost: 850,
    damageModifiers: {
      [UNIT_CLASSES.UNARMORED]: 0.35,
      [UNIT_CLASSES.ARMORED]: 1.0,
      [UNIT_CLASSES.HELICOPTER]: 0.0,
      [UNIT_CLASSES.PLANE]: 0.0,
    },
    canTarget: [UNIT_CLASSES.UNARMORED, UNIT_CLASSES.ARMORED]
  },
  heavyTank: {
    unitClass: UNIT_CLASSES.ARMORED,
    maxHealth: 600,
    attackDamage: 100,
    attackRange: 200,
    attackCooldown: 2.5,
    defense: 5,
    speed: 130,
    cost: 1600,
    damageModifiers: {
      [UNIT_CLASSES.UNARMORED]: 0.35,
      [UNIT_CLASSES.ARMORED]: 1.0,
      [UNIT_CLASSES.HELICOPTER]: 0.0,
      [UNIT_CLASSES.PLANE]: 0.0,
    },
    canTarget: [UNIT_CLASSES.UNARMORED, UNIT_CLASSES.ARMORED]
  },
  antiTank: {
    unitClass: UNIT_CLASSES.UNARMORED,
    maxHealth: 100,
    attackDamage: 45,
    attackRange: 160,
    attackCooldown: 2.0,
    defense: 0,
    speed: 140,
    cost: 250,
    damageModifiers: {
      [UNIT_CLASSES.UNARMORED]: 0.25,
      [UNIT_CLASSES.ARMORED]: 1.0,
      [UNIT_CLASSES.HELICOPTER]: 1.0,
      [UNIT_CLASSES.PLANE]: 0.0,
    },
    canTarget: [UNIT_CLASSES.UNARMORED, UNIT_CLASSES.ARMORED, UNIT_CLASSES.HELICOPTER]
  },
  fighter: {
    unitClass: UNIT_CLASSES.PLANE,
    maxHealth: 40,
    attackDamage: 12,
    attackRange: 280,
    attackCooldown: PLANE_RELOAD_COOLDOWN,
    defense: 0,
    speed: 380,
    cost: 1000,
    damageModifiers: {
      [UNIT_CLASSES.UNARMORED]: 0.7,
      [UNIT_CLASSES.ARMORED]: 0.3,
      [UNIT_CLASSES.HELICOPTER]: 1.0,
      [UNIT_CLASSES.PLANE]: 1.0,
    },
    canTarget: [UNIT_CLASSES.UNARMORED, UNIT_CLASSES.ARMORED, UNIT_CLASSES.HELICOPTER, UNIT_CLASSES.PLANE]
  },
  antiAir: {
    unitClass: UNIT_CLASSES.ARMORED,
    maxHealth: 120,
    attackDamage: 14,
    attackRange: 320,
    attackCooldown: 2.0,
    defense: 1,
    speed: 160,
    cost: 600,
    damageModifiers: {
      [UNIT_CLASSES.UNARMORED]: 0.0,
      [UNIT_CLASSES.ARMORED]: 0.0,
      [UNIT_CLASSES.HELICOPTER]: 1.0,
      [UNIT_CLASSES.PLANE]: 1.0,
    },
    canTarget: [UNIT_CLASSES.PLANE, UNIT_CLASSES.HELICOPTER]
  },
  attackHelicopter: {
    unitClass: UNIT_CLASSES.HELICOPTER,
    maxHealth: 150,
    attackDamage: 12,
    attackRange: 160,
    attackCooldown: 0.25,
    defense: 1,
    speed: 180,
    cost: 700,
    damageModifiers: {
      [UNIT_CLASSES.UNARMORED]: 1.0,
      [UNIT_CLASSES.ARMORED]: 0.5,
      [UNIT_CLASSES.HELICOPTER]: 0.5,
      [UNIT_CLASSES.PLANE]: 0.0,
    },
    canTarget: [UNIT_CLASSES.UNARMORED, UNIT_CLASSES.ARMORED, UNIT_CLASSES.HELICOPTER]
  }
};
const PUSH_WEIGHT_MOVING = 1;
const STUCK_MOVEMENT_EPSILON = 1.1;
const STUCK_PROGRESS_EPSILON = 0.75;
const STUCK_TICKS_THRESHOLD = 18;
const REPATH_COOLDOWN_TICKS = 12;
const GRID_COLUMNS = Math.ceil(MAP_WIDTH / CELL_SIZE);
const GRID_ROWS = Math.ceil(MAP_HEIGHT / CELL_SIZE);
const OBSTACLES = [
  { id: "rock-1", x: 640, y: 510, width: 350, height: 290 },
  { id: "rock-2", x: 1470, y: 1250, width: 320, height: 440 },
  { id: "rock-3", x: 2190, y: 890, width: 420, height: 300 },
  { id: "rock-4", x: 850, y: 2350, width: 480, height: 290 },
];
const WALKABLE_GRID = buildWalkableGrid();

const app = express();
app.use(
  cors({
    origin: CLIENT_ORIGIN,
  }),
);

app.get("/health", (_request, response) => {
  response.json({ ok: true });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: CLIENT_ORIGIN,
  },
});

const worldState = {
  obstacles: OBSTACLES,
  units: [],
  teamSelections: {
    blue: { socketId: null, isOnline: false, hasDeployed: false },
    red: { socketId: null, isOnline: false, hasDeployed: false }
  }
};

const playerAssignments = new Map(); // socket.id -> color

function executeOrder(unit, order) {
  if (order.type === 'move') {
    unit.attackTargetId = null;
    unit.isAttackMove = false;
    unit.isHoldingPosition = false;
    unit.loiterCenter = null;
    assignUnitPath(unit, order.position);
  } else if (order.type === 'attack') {
    unit.attackTargetId = order.targetId;
    unit.isAttackMove = false;
    unit.isHoldingPosition = false;
    unit.loiterCenter = null;
    unit.path = [];
    unit.targetX = unit.x;
    unit.targetY = unit.y;
    unit.destinationX = unit.x;
    unit.destinationY = unit.y;
    unit.isMoving = false;
  } else if (order.type === 'attackMove') {
    unit.attackTargetId = null;
    unit.isAttackMove = true;
    unit.isHoldingPosition = false;
    assignUnitPath(unit, order.position);
    unit.attackMoveDestinationX = unit.destinationX;
    unit.attackMoveDestinationY = unit.destinationY;
    unit.loiterCenter = { x: unit.destinationX, y: unit.destinationY };
  } else if (order.type === 'stop') {
    unit.attackTargetId = null;
    unit.isAttackMove = false;
    unit.isHoldingPosition = false;
    unit.loiterCenter = null;
    unit.path = [];
    unit.targetX = unit.x;
    unit.targetY = unit.y;
    unit.destinationX = unit.x;
    unit.destinationY = unit.y;
    unit.isMoving = false;
  } else if (order.type === 'holdPosition') {
    unit.attackTargetId = null;
    unit.isAttackMove = false;
    unit.isHoldingPosition = true;
    unit.loiterCenter = null;
    unit.path = [];
    unit.targetX = unit.x;
    unit.targetY = unit.y;
    unit.destinationX = unit.x;
    unit.destinationY = unit.y;
    unit.isMoving = false;
  }
}

function processUnitOrder(unit, order, isQueued) {
  const isIdle = !unit.isMoving && !unit.attackTargetId && !unit.isHoldingPosition;
  if (!isQueued) {
    unit.orderQueue = [];
    executeOrder(unit, order);
  } else {
    if (isIdle && unit.orderQueue.length === 0) {
      executeOrder(unit, order);
    } else {
      unit.orderQueue.push(order);
    }
  }
}

io.on("connection", (socket) => {
  socket.emit("world:state", serializeWorldState(worldState));

  socket.on("player:join", (color) => {
    if (color !== "blue" && color !== "red") return;
    if (worldState.teamSelections[color].socketId && worldState.teamSelections[color].isOnline) {
      return; // Already taken and online
    }

    // Assign player
    worldState.teamSelections[color].socketId = socket.id;
    worldState.teamSelections[color].isOnline = true;
    playerAssignments.set(socket.id, color);

    io.emit("world:state", serializeWorldState(worldState));
  });

  socket.on("player:deploy", (manifest) => {
    const color = playerAssignments.get(socket.id);
    if (!color || worldState.teamSelections[color].hasDeployed) return;

    // Validate Manifest
    let totalCost = 0;
    for (const [variantId, count] of Object.entries(manifest)) {
      if (!UNIT_VARIANTS[variantId] || count <= 0) continue;
      totalCost += UNIT_VARIANTS[variantId].cost * count;
    }

    if (totalCost > STARTING_RESOURCES) return;

    // Spawn in Grid
    const spawnX = color === "blue" ? 400 : 2800;
    const spawnY = color === "blue" ? 400 : 2800;
    const direction = color === "blue" ? 1 : -1;

    let index = 0;
    for (const [variantId, count] of Object.entries(manifest)) {
      for (let i = 0; i < count; i++) {
        const col = index % DEPLOYMENT_GRID_COLS;
        const row = Math.floor(index / DEPLOYMENT_GRID_COLS);
        
        const x = spawnX + col * DEPLOYMENT_GRID_SPACING * direction;
        const y = spawnY + row * DEPLOYMENT_GRID_SPACING * direction;
        
        const unit = createUnit(`${color}-${variantId}-${i}-${Date.now()}`, x, y, color, variantId);
        worldState.units.push(unit);
        index++;
      }
    }

    worldState.teamSelections[color].hasDeployed = true;
    io.emit("world:state", serializeWorldState(worldState));
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
      processUnitOrder(unit, { type: 'move', position: slot }, isQueued);
    });

    io.emit("world:state", serializeWorldState(worldState));
  });

  socket.on("unit:attack", ({ unitIds, targetId, isQueued }) => {
    const playerColor = playerAssignments.get(socket.id);
    if (!playerColor) return;
    if (
      !Array.isArray(unitIds) ||
      unitIds.length === 0 ||
      typeof targetId !== "string"
    ) {
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
      processUnitOrder(unit, { type: 'attack', targetId }, isQueued);
    }

    io.emit("world:state", serializeWorldState(worldState));
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
      processUnitOrder(unit, { type: 'attackMove', position: slot }, isQueued);
    });

    io.emit("world:state", serializeWorldState(worldState));
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
      processUnitOrder(unit, { type: 'stop' }, isQueued);
    }

    io.emit("world:state", serializeWorldState(worldState));
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
      processUnitOrder(unit, { type: 'holdPosition' }, isQueued);
    }

    io.emit("world:state", serializeWorldState(worldState));
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
    io.emit("world:state", serializeWorldState(worldState));
  });

  socket.on("disconnect", () => {
    const color = playerAssignments.get(socket.id);
    if (color && worldState.teamSelections[color]) {
      worldState.teamSelections[color].isOnline = false;
      // We don't remove the socketId yet, so the spot stays taken but "offline"
      io.emit("world:state", serializeWorldState(worldState));
    }
    playerAssignments.delete(socket.id);
  });

  socket.on("enemy:respawn", () => {
    worldState.units = worldState.units.filter((entry) => entry.owner !== "enemy");

    worldState.units.push(
      createUnit("enemy-1", 2000, 2000, "enemy", "rifleman"),
      createUnit("enemy-2", 2100, 2000, "enemy", "armoredDummy")
    );

    for (const unit of worldState.units) {
      if (unit.owner === "player" && unit.attackTargetId && worldState.units.find(u => u.id === unit.attackTargetId) === undefined) {
        unit.attackTargetId = null;
        if (unit.isAttackMove) {
          assignUnitPath(unit, { x: unit.attackMoveDestinationX, y: unit.attackMoveDestinationY });
        }
      }
    }

    io.emit("world:state", serializeWorldState(worldState));
  });
});

setInterval(() => {
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
      let minDistance = unit.isPlane ? unit.attackRange * 1.5 : unit.attackRange; // Planes have slightly larger aggro

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
  currentTick++;
}, 1000 / TICK_RATE);

httpServer.listen(PORT, () => {
  console.log(`Dominion Protocol backend listening on port ${PORT}`);
});

function createUnit(id, x, y, owner = "player", variantId = "rifleman") {
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
    // Plane properties
    angle: 0,
    isPlane: variantProps.unitClass === UNIT_CLASSES.PLANE,
    isHelicopter: variantProps.unitClass === UNIT_CLASSES.HELICOPTER,
    loiterCenter: null,
    burstTicks: 0,
    burstCooldown: 0,
    lastRetreatTick: 0,
  };
}

function handleSkirmishRetreat(unit, attacker) {
  if (unit.isHoldingPosition) return false;
  
  // Anti-Air always retreats when hit (skirmishing)
  // Others retreat if they can't target the attacker
  const canHitBack = unit.canTarget.includes(attacker.unitClass);
  const shouldRetreat = unit.variantId === "antiAir" || !canHitBack;
  
  if (!shouldRetreat) return false;

  // Internal cooldown: 2 seconds (40 ticks at 20fps)
  if (currentTick - (unit.lastRetreatTick || 0) < 40) return false;

  const dx = unit.x - attacker.x;
  const dy = unit.y - attacker.y;
  const dist = Math.hypot(dx, dy);
  
  if (dist < 1) return false; // Avoid div by zero

  const retreatDistance = 120;
  const targetX = clamp(unit.x + (dx / dist) * retreatDistance, UNIT_RADIUS, MAP_WIDTH - UNIT_RADIUS);
  const targetY = clamp(unit.y + (dy / dist) * retreatDistance, UNIT_RADIUS, MAP_HEIGHT - UNIT_RADIUS);

  // Clear orders and retreat
  unit.orderQueue = [];
  unit.attackTargetId = null;
  assignUnitPath(unit, { x: targetX, y: targetY });
  unit.lastRetreatTick = currentTick;
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
  
  // Retaliation: if target is idle, retaliate against attacker
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

function serializeWorldState(state) {
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
        // Anti-Air does not chase planes/helicopters
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
      // Missile logic
      const isAA = unit.variantId === "antiAir";
      const distance = getDistanceBetweenPoints(unit.x, unit.y, target.x, target.y);
      const speed = isAA ? 550 : 450;
      const flightTime = distance / speed;

      io.emit("unit:shootProjectile", {
        id: `msl-${unit.id}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        shooterId: unit.id,
        targetId: target.id,
        startX: unit.x,
        startY: unit.y,
        damage: finalDamage,
        speed: speed,
        variantId: isAA ? "aa_missile" : "antiTank_missile"
      });

      setTimeout(() => {
        const currentTarget = worldState.units.find(u => u.id === target.id);
        if (currentTarget && currentTarget.health > 0) {
          applyDamage(currentTarget, unit, finalDamage);
        }
      }, flightTime * 1000);
    } else if (unit.isHelicopter) {
      // Helicopter Machine Gun (Projectile-based)
      io.emit("unit:shootProjectile", {
        id: `bullet-heli-${unit.id}-${Date.now()}`,
        shooterId: unit.id,
        targetId: target.id,
        startX: unit.x,
        startY: unit.y,
        damage: finalDamage,
        speed: 800, // Faster bullets like fighters
        variantId: "fighter_bullet"
      });
      applyDamage(target, unit, finalDamage);
    } else {
      // Normal instant damage
      applyDamage(target, unit, finalDamage);

      // Emit attack event for hitscan visuals
      io.emit("unit:attack", {
        id: `atk-${unit.id}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        unitId: unit.id,
        targetId: target.id,
        shooterPos: { x: unit.x, y: unit.y },
        targetPos: { x: target.x, y: target.y },
        variantId: unit.variantId
      });
    }

    unit.attackCooldown = unit.attackCooldownTime;
    hasChanged = true;
    continue;
  }

  return hasChanged;
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
    speed: 800, // Faster bullets
    variantId: "fighter_bullet"
  });

  applyDamage(target, unit, finalDamage);

  unit.burstTicks++;
  if (unit.burstTicks >= PLANE_BURST_COUNT) {
    unit.burstTicks = 0;
    unit.attackCooldown = unit.attackCooldownTime; // Full reload
  } else {
    unit.burstCooldown = PLANE_BURST_COOLDOWN;
  }

  return true;
}


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

  unit.path = smoothPath(
    pathCells
      .map((cell) => cellToPoint(cell.col, cell.row)),
  )
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

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function advanceUnit(unit, deltaTime) {
  if (unit.isPlane) {
    return advancePlane(unit, deltaTime);
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
  return true;
}

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

function advancePlane(unit, deltaTime) {
  // Planes never stop. If they have no target or destination, they loiter.
  const attackTarget = unit.attackTargetId
    ? worldState.units.find((entry) => entry.id === unit.attackTargetId && entry.health > 0)
    : null;
  const attackMoveCenter = getPlaneAttackMoveCenter(unit);

  if (attackTarget) {
    unit.loiterCenter = null;
    const combatDestination = getPlaneCombatDestination(unit, attackTarget);
    unit.targetX = combatDestination.x;
    unit.targetY = combatDestination.y;
  } else if (unit.isAttackMove && attackMoveCenter) {
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
    if (!unit.loiterCenter) {
      unit.loiterCenter = { x: unit.x, y: unit.y };
    }
    const loiterTarget = getPlaneLoiterDestination(unit, unit.loiterCenter, PLANE_LOITER_RADIUS);
    unit.targetX = loiterTarget.x;
    unit.targetY = loiterTarget.y;
  } else if (unit.isMoving) {
    // Air units fly straight to destination, bypass pathfinder
    unit.loiterCenter = null;
    unit.targetX = unit.destinationX;
    unit.targetY = unit.destinationY;
  }

  const dx = unit.targetX - unit.x;
  const dy = unit.targetY - unit.y;
  const targetAngle = Math.atan2(dy, dx);
  
  // Graduate turn
  if (unit.angle === undefined || isNaN(unit.angle)) {
    unit.angle = targetAngle;
  }

  const angleDiff = getAngleDelta(unit.angle, targetAngle);
  const turnStep = PLANE_TURN_SPEED * deltaTime;
  if (Math.abs(angleDiff) < turnStep) {
    unit.angle = targetAngle;
  } else {
    unit.angle += Math.sign(angleDiff) * turnStep;
  }

  // Move forward
  const dist = (unit.speed || UNIT_SPEED) * deltaTime;
  unit.x += Math.cos(unit.angle) * dist;
  unit.y += Math.sin(unit.angle) * dist;

  // Boundary check - Planes can go off-map to complete turns
  unit.x = clamp(unit.x, -PLANE_AIRSPACE_MARGIN, MAP_WIDTH + PLANE_AIRSPACE_MARGIN);
  unit.y = clamp(unit.y, -PLANE_AIRSPACE_MARGIN, MAP_HEIGHT + PLANE_AIRSPACE_MARGIN);

  // Waypoint progression
  const distToTarget = Math.hypot(unit.targetX - unit.x, unit.targetY - unit.y);
  if (distToTarget < 20 && unit.isMoving && !unit.isAttackMove && !attackTarget) {
    unit.isMoving = false;
    unit.destinationX = unit.x;
    unit.destinationY = unit.y;
    unit.loiterCenter = { x: unit.x, y: unit.y };
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

    for (let index = 0; index < units.length; index += 1) {
      for (let compareIndex = index + 1; compareIndex < units.length; compareIndex += 1) {
        const unit = units[index];
        const otherUnit = units[compareIndex];

        // Air units (Planes/Helicopters) do not collide with ground units
        const unitIsAir = unit.isPlane || unit.isHelicopter;
        const otherIsAir = otherUnit.isPlane || otherUnit.isHelicopter;
        if (unitIsAir !== otherIsAir) {
          continue;
        }

        const dx = otherUnit.x - unit.x;
        const dy = otherUnit.y - unit.y;
        const distance = Math.hypot(dx, dy);

        if (distance >= minimumDistance) {
          continue;
        }

        const overlap = minimumDistance - distance;
        const separationNormal = getCollisionSeparationNormal(
          unit,
          otherUnit,
          dx,
          dy,
        );
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
      }
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

function buildFormation(count, center) {
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const xOffset = ((columns - 1) * FORMATION_SPACING) / 2;
  const yOffset = ((rows - 1) * FORMATION_SPACING) / 2;

  return Array.from({ length: count }, (_value, index) => ({
    x: center.x + ((index % columns) * FORMATION_SPACING - xOffset),
    y: center.y + (Math.floor(index / columns) * FORMATION_SPACING - yOffset),
  }));
}

function assignFormationSlots(units, slots) {
  const { sortedUnits, sortedSlots } = getFormationOrdering(units, slots);

  if (sortedUnits.length > 12) {
    return sortedUnits.map((unit, index) => ({
      unit,
      slot: sortedSlots[index],
    }));
  }

  const orderPenalty = FORMATION_SPACING * FORMATION_SPACING * 0.5;
  const assignment = findOptimalSlotAssignment(
    sortedUnits.map((unit, unitIndex) =>
      sortedSlots.map((slot, slotIndex) => {
        const dx = slot.x - unit.x;
        const dy = slot.y - unit.y;

        return (
          dx * dx +
          dy * dy +
          Math.abs(unitIndex - slotIndex) * orderPenalty
        );
      }),
    ),
  );

  return sortedUnits.map((unit, index) => ({
    unit,
    slot: sortedSlots[assignment[index]],
  }));
}

function getFormationOrdering(units, slots) {
  const unitCenter = getCenterPoint(units);
  const slotCenter = getCenterPoint(slots);
  const moveVector = {
    x: slotCenter.x - unitCenter.x,
    y: slotCenter.y - unitCenter.y,
  };
  const axis = getFormationAxis(moveVector);
  const sortedUnits = [...units].sort((left, right) =>
    compareFormationOrder(left, right, axis, unitCenter),
  );
  const sortedSlots = [...slots].sort((left, right) =>
    compareFormationOrder(left, right, axis, slotCenter),
  );

  return {
    sortedUnits,
    sortedSlots,
  };
}

function findOptimalSlotAssignment(costMatrix) {
  const memo = new Map();

  return solve(0, 0).assignment;

  function solve(unitIndex, usedMask) {
    if (unitIndex === costMatrix.length) {
      return {
        cost: 0,
        assignment: [],
      };
    }

    const key = `${unitIndex}:${usedMask}`;
    const cached = memo.get(key);

    if (cached) {
      return cached;
    }

    let best = {
      cost: Number.POSITIVE_INFINITY,
      assignment: [],
    };

    for (let slotIndex = 0; slotIndex < costMatrix[unitIndex].length; slotIndex += 1) {
      if ((usedMask & (1 << slotIndex)) !== 0) {
        continue;
      }

      const next = solve(unitIndex + 1, usedMask | (1 << slotIndex));
      const totalCost = costMatrix[unitIndex][slotIndex] + next.cost;

      if (totalCost >= best.cost) {
        continue;
      }

      best = {
        cost: totalCost,
        assignment: [slotIndex, ...next.assignment],
      };
    }

    memo.set(key, best);
    return best;
  }
}

function getCenterPoint(points) {
  const total = points.reduce(
    (sum, point) => ({
      x: sum.x + point.x,
      y: sum.y + point.y,
    }),
    { x: 0, y: 0 },
  );

  return {
    x: total.x / points.length,
    y: total.y / points.length,
  };
}

function getFormationAxis(moveVector) {
  if (Math.abs(moveVector.x) >= Math.abs(moveVector.y)) {
    return {
      primary: "y",
      secondary: "x",
      primaryDirection: moveVector.y >= 0 ? 1 : -1,
      secondaryDirection: moveVector.x >= 0 ? 1 : -1,
    };
  }

  return {
    primary: "x",
    secondary: "y",
    primaryDirection: moveVector.x >= 0 ? 1 : -1,
    secondaryDirection: moveVector.y >= 0 ? 1 : -1,
  };
}

function compareFormationOrder(left, right, axis, center) {
  const primaryDiff =
    (left[axis.primary] - center[axis.primary]) * axis.primaryDirection -
    (right[axis.primary] - center[axis.primary]) * axis.primaryDirection;

  if (Math.abs(primaryDiff) > 0.001) {
    return primaryDiff;
  }

  return (
    (left[axis.secondary] - center[axis.secondary]) * axis.secondaryDirection -
    (right[axis.secondary] - center[axis.secondary]) * axis.secondaryDirection
  );
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

function negateVector(vector) {
  return {
    x: -vector.x,
    y: -vector.y,
  };
}

function getAngleDelta(fromAngle, toAngle) {
  let angleDiff = toAngle - fromAngle;
  while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
  while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
  return angleDiff;
}

function getUnitVelocity(unit) {
  return {
    x: (unit.x - (unit.previousX ?? unit.x)) * TICK_RATE,
    y: (unit.y - (unit.previousY ?? unit.y)) * TICK_RATE,
  };
}

function clampPlanePoint(point) {
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

function clampPointToMap(point) {
  return {
    x: clamp(point.x, UNIT_RADIUS, MAP_WIDTH - UNIT_RADIUS),
    y: clamp(point.y, UNIT_RADIUS, MAP_HEIGHT - UNIT_RADIUS),
  };
}

function clampUnitPosition(unit, point) {
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

function getPlanePredictedTargetPosition(unit, target) {
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

// Air combat uses attack runs and short breakaways so fighters do not collapse into tight circles.
function getPlaneCombatDestination(unit, target) {
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

function getPlaneAttackMoveCenter(unit) {
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

function shouldPlaneDisengageFromAttackMove(unit, target) {
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

function getPlaneLoiterDestination(unit, center, radius) {
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

function normalizeVector(x, y) {
  const magnitude = Math.hypot(x, y);

  if (magnitude < 0.001) {
    return null;
  }

  return {
    x: x / magnitude,
    y: y / magnitude,
  };
}

function dotProduct(left, right) {
  return left.x * right.x + left.y * right.y;
}

function getDistanceBetweenPoints(fromX, fromY, toX, toY) {
  return Math.hypot(toX - fromX, toY - fromY);
}

function buildWalkableGrid() {
  return Array.from({ length: GRID_ROWS }, (_rowValue, row) =>
    Array.from({ length: GRID_COLUMNS }, (_colValue, col) => isCellWalkable(col, row)),
  );
}

function isCellWalkable(col, row) {
  const point = cellToPoint(col, row);

  return !OBSTACLES.some((obstacle) =>
    isPointInsideRect(point.x, point.y, expandObstacle(obstacle, UNIT_RADIUS)),
  );
}

function pointToCell(x, y) {
  return {
    col: clamp(Math.floor(x / CELL_SIZE), 0, GRID_COLUMNS - 1),
    row: clamp(Math.floor(y / CELL_SIZE), 0, GRID_ROWS - 1),
  };
}

function cellToPoint(col, row) {
  return {
    x: clamp(col * CELL_SIZE + CELL_SIZE / 2, UNIT_RADIUS, MAP_WIDTH - UNIT_RADIUS),
    y: clamp(row * CELL_SIZE + CELL_SIZE / 2, UNIT_RADIUS, MAP_HEIGHT - UNIT_RADIUS),
  };
}

function findNearestWalkableCell(position) {
  const origin = pointToCell(position.x, position.y);

  if (isWalkable(origin.col, origin.row)) {
    return origin;
  }

  const visited = new Set([cellKey(origin.col, origin.row)]);
  const queue = [origin];

  while (queue.length > 0) {
    const current = queue.shift();

    for (const neighbor of getNeighbors(current.col, current.row, false)) {
      const key = cellKey(neighbor.col, neighbor.row);

      if (visited.has(key)) {
        continue;
      }

      if (isWalkable(neighbor.col, neighbor.row)) {
        return neighbor;
      }

      visited.add(key);
      queue.push(neighbor);
    }
  }

  return null;
}

function findPath(start, goal) {
  const openSet = [start];
  const cameFrom = new Map();
  const gScore = new Map([[cellKey(start.col, start.row), 0]]);
  const fScore = new Map([[cellKey(start.col, start.row), heuristic(start, goal)]]);

  while (openSet.length > 0) {
    openSet.sort(
      (left, right) =>
        (fScore.get(cellKey(left.col, left.row)) ?? Number.POSITIVE_INFINITY) -
        (fScore.get(cellKey(right.col, right.row)) ?? Number.POSITIVE_INFINITY),
    );

    const current = openSet.shift();
    const currentKey = cellKey(current.col, current.row);

    if (current.col === goal.col && current.row === goal.row) {
      return reconstructPath(cameFrom, current);
    }

    for (const neighbor of getNeighbors(current.col, current.row, true)) {
      if (!isWalkable(neighbor.col, neighbor.row)) {
        continue;
      }

      const neighborKey = cellKey(neighbor.col, neighbor.row);
      const tentativeGScore =
        (gScore.get(currentKey) ?? Number.POSITIVE_INFINITY) + neighbor.cost;

      if (tentativeGScore >= (gScore.get(neighborKey) ?? Number.POSITIVE_INFINITY)) {
        continue;
      }

      cameFrom.set(neighborKey, current);
      gScore.set(neighborKey, tentativeGScore);
      fScore.set(neighborKey, tentativeGScore + heuristic(neighbor, goal));

      if (!openSet.some((entry) => entry.col === neighbor.col && entry.row === neighbor.row)) {
        openSet.push({ col: neighbor.col, row: neighbor.row });
      }
    }
  }

  return null;
}

function reconstructPath(cameFrom, current) {
  const path = [current];
  let cursor = current;

  while (cameFrom.has(cellKey(cursor.col, cursor.row))) {
    cursor = cameFrom.get(cellKey(cursor.col, cursor.row));
    path.unshift(cursor);
  }

  return path;
}

function smoothPath(points) {
  if (points.length <= 2) {
    return points;
  }

  const smoothed = [points[0]];
  let anchorIndex = 0;

  while (anchorIndex < points.length - 1) {
    let furthestVisibleIndex = anchorIndex + 1;

    for (let candidateIndex = anchorIndex + 1; candidateIndex < points.length; candidateIndex += 1) {
      if (!hasLineOfSight(points[anchorIndex], points[candidateIndex])) {
        break;
      }

      furthestVisibleIndex = candidateIndex;
    }

    smoothed.push(points[furthestVisibleIndex]);
    anchorIndex = furthestVisibleIndex;
  }

  return smoothed;
}

function getNeighbors(col, row, allowDiagonal) {
  const directions = allowDiagonal
    ? [
        { col: -1, row: 0, cost: 1 },
        { col: 1, row: 0, cost: 1 },
        { col: 0, row: -1, cost: 1 },
        { col: 0, row: 1, cost: 1 },
        { col: -1, row: -1, cost: Math.SQRT2 },
        { col: 1, row: -1, cost: Math.SQRT2 },
        { col: -1, row: 1, cost: Math.SQRT2 },
        { col: 1, row: 1, cost: Math.SQRT2 },
      ]
    : [
        { col: -1, row: 0, cost: 1 },
        { col: 1, row: 0, cost: 1 },
        { col: 0, row: -1, cost: 1 },
        { col: 0, row: 1, cost: 1 },
      ];

  return directions
    .map((direction) => ({
      col: col + direction.col,
      row: row + direction.row,
      cost: direction.cost,
    }))
    .filter((neighbor) => isWithinGrid(neighbor.col, neighbor.row))
    .filter((neighbor) => {
      if (!allowDiagonal || neighbor.col === col || neighbor.row === row) {
        return true;
      }

      return (
        isWalkable(col, neighbor.row) &&
        isWalkable(neighbor.col, row)
      );
    });
}

function isWithinGrid(col, row) {
  return col >= 0 && row >= 0 && col < GRID_COLUMNS && row < GRID_ROWS;
}

function isWalkable(col, row) {
  return Boolean(WALKABLE_GRID[row]?.[col]);
}

function heuristic(from, to) {
  return Math.hypot(to.col - from.col, to.row - from.row);
}

function cellKey(col, row) {
  return `${col}:${row}`;
}

function expandObstacle(obstacle, padding) {
  return {
    x: obstacle.x - padding,
    y: obstacle.y - padding,
    width: obstacle.width + padding * 2,
    height: obstacle.height + padding * 2,
  };
}

function isPointInsideRect(x, y, rect) {
  return (
    x >= rect.x &&
    x <= rect.x + rect.width &&
    y >= rect.y &&
    y <= rect.y + rect.height
  );
}

function hasLineOfSight(start, end) {
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const steps = Math.max(1, Math.ceil(distance / (CELL_SIZE / 3)));

  for (let step = 0; step <= steps; step += 1) {
    const ratio = step / steps;
    const x = start.x + (end.x - start.x) * ratio;
    const y = start.y + (end.y - start.y) * ratio;

    if (OBSTACLES.some((obstacle) => isPointInsideRect(x, y, expandObstacle(obstacle, UNIT_RADIUS)))) {
      return false;
    }
  }

  return true;
}
