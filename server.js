import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";

const PORT = Number(process.env.PORT ?? 10000);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? "http://localhost:3000";
const MAP_WIDTH = 960;
const MAP_HEIGHT = 540;
const TICK_RATE = 60;
const UNIT_SPEED = 180;
const FORMATION_SPACING = 28;
const UNIT_RADIUS = 10;
const COLLISION_PASSES = 3;
const CELL_SIZE = 24;
const PUSH_WEIGHT_IDLE = 0.35;
const UNIT_MAX_HEALTH = 100;
const UNIT_ATTACK_DAMAGE = 10;
const UNIT_ATTACK_RANGE = 120;
const UNIT_ATTACK_COOLDOWN = 1.0;
const PUSH_WEIGHT_MOVING = 1;
const STUCK_MOVEMENT_EPSILON = 1.1;
const STUCK_PROGRESS_EPSILON = 0.75;
const STUCK_TICKS_THRESHOLD = 18;
const REPATH_COOLDOWN_TICKS = 12;
const GRID_COLUMNS = Math.ceil(MAP_WIDTH / CELL_SIZE);
const GRID_ROWS = Math.ceil(MAP_HEIGHT / CELL_SIZE);
const OBSTACLES = [
  { id: "rock-1", x: 240, y: 110, width: 150, height: 90 },
  { id: "rock-2", x: 470, y: 250, width: 120, height: 140 },
  { id: "rock-3", x: 690, y: 90, width: 120, height: 100 },
  { id: "rock-4", x: 150, y: 350, width: 180, height: 90 },
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
  units: [
    createUnit("unit-1", 120, 120, "player"),
    createUnit("unit-2", 180, 180, "player"),
    createUnit("unit-3", 140, 260, "player"),
    createUnit("unit-4", 720, 300, "player"),
    createUnit("unit-5", 820, 380, "player"),
    createUnit("enemy-1", 800, 200, "enemy"),
  ],
};

io.on("connection", (socket) => {
  socket.emit("world:state", serializeWorldState(worldState));

  socket.on("unit:move", ({ unitIds, position }) => {
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
      .map((unitId) => worldState.units.find((entry) => entry.id === unitId && entry.owner === "player"))
      .filter(Boolean);

    if (units.length === 0) {
      return;
    }

    for (const unit of units) {
      unit.attackTargetId = null;
      unit.isAttackMove = false;
    }

    const slots = buildFormation(units.length, {
      x: clamp(position.x, UNIT_RADIUS, MAP_WIDTH - UNIT_RADIUS),
      y: clamp(position.y, UNIT_RADIUS, MAP_HEIGHT - UNIT_RADIUS),
    });
    const assignments = assignFormationSlots(units, slots);

    assignments.forEach(({ unit, slot }) => {
      assignUnitPath(unit, slot);
    });

    io.emit("world:state", serializeWorldState(worldState));
  });

  socket.on("unit:attack", ({ unitIds, targetId }) => {
    if (
      !Array.isArray(unitIds) ||
      unitIds.length === 0 ||
      typeof targetId !== "string"
    ) {
      return;
    }

    const target = worldState.units.find(
      (entry) => entry.id === targetId && entry.owner === "enemy" && entry.health > 0,
    );

    if (!target) {
      return;
    }

    const units = unitIds
      .map((unitId) => worldState.units.find((entry) => entry.id === unitId && entry.owner === "player"))
      .filter(Boolean);

    for (const unit of units) {
      unit.attackTargetId = targetId;
      unit.isAttackMove = false;
      unit.path = [];
      unit.targetX = unit.x;
      unit.targetY = unit.y;
      unit.destinationX = unit.x;
      unit.destinationY = unit.y;
      unit.isMoving = false;
    }

    io.emit("world:state", serializeWorldState(worldState));
  });

  socket.on("unit:attackMove", ({ unitIds, position }) => {
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
      .map((unitId) => worldState.units.find((entry) => entry.id === unitId && entry.owner === "player"))
      .filter(Boolean);

    if (units.length === 0) {
      return;
    }

    for (const unit of units) {
      unit.attackTargetId = null;
      unit.isAttackMove = true;
    }

    const slots = buildFormation(units.length, {
      x: clamp(position.x, UNIT_RADIUS, MAP_WIDTH - UNIT_RADIUS),
      y: clamp(position.y, UNIT_RADIUS, MAP_HEIGHT - UNIT_RADIUS),
    });
    const assignments = assignFormationSlots(units, slots);

    assignments.forEach(({ unit, slot }) => {
      assignUnitPath(unit, slot);
      unit.attackMoveDestinationX = unit.destinationX;
      unit.attackMoveDestinationY = unit.destinationY;
    });

    io.emit("world:state", serializeWorldState(worldState));
  });

  socket.on("unit:stop", ({ unitIds }) => {
    if (!Array.isArray(unitIds) || unitIds.length === 0) {
      return;
    }

    const units = unitIds
      .map((unitId) => worldState.units.find((entry) => entry.id === unitId && entry.owner === "player"))
      .filter(Boolean);

    for (const unit of units) {
      unit.attackTargetId = null;
      unit.isAttackMove = false;
      unit.path = [];
      unit.targetX = unit.x;
      unit.targetY = unit.y;
      unit.destinationX = unit.x;
      unit.destinationY = unit.y;
      unit.isMoving = false;
    }

    io.emit("world:state", serializeWorldState(worldState));
  });

  socket.on("player:reset", () => {
    worldState.units = worldState.units.filter((entry) => entry.owner !== "player");
    worldState.units.push(
      createUnit("unit-1", 120, 120, "player"),
      createUnit("unit-2", 180, 180, "player"),
      createUnit("unit-3", 140, 260, "player"),
      createUnit("unit-4", 720, 300, "player"),
      createUnit("unit-5", 820, 380, "player"),
    );

    io.emit("world:state", serializeWorldState(worldState));
  });

  socket.on("enemy:respawn", () => {
    const existingEnemy = worldState.units.find((entry) => entry.id === "enemy-1");

    if (existingEnemy && existingEnemy.health > 0) {
      return;
    }

    if (existingEnemy) {
      worldState.units = worldState.units.filter((entry) => entry.id !== "enemy-1");
    }

    worldState.units.push(createUnit("enemy-1", 800, 200, "enemy"));

    for (const unit of worldState.units) {
      if (unit.attackTargetId === "enemy-1") {
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

    if (!hasActiveOrder || unit.isAttackMove) {
      let nearestTarget = null;
      let minDistance = UNIT_ATTACK_RANGE;

      for (const otherUnit of worldState.units) {
        if (otherUnit.id === unit.id || otherUnit.health <= 0 || otherUnit.owner === unit.owner) {
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
}, 1000 / TICK_RATE);

httpServer.listen(PORT, () => {
  console.log(`Dominion Protocol backend listening on port ${PORT}`);
});

function createUnit(id, x, y, owner = "player") {
  const clampedX = clamp(x, UNIT_RADIUS, MAP_WIDTH - UNIT_RADIUS);
  const clampedY = clamp(y, UNIT_RADIUS, MAP_HEIGHT - UNIT_RADIUS);

  return {
    id,
    owner,
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
    health: UNIT_MAX_HEALTH,
    maxHealth: UNIT_MAX_HEALTH,
    attackTargetId: null,
    isAttackMove: false,
    attackMoveDestinationX: null,
    attackMoveDestinationY: null,
    attackCooldown: 0,
    isMoving: false,
  };
}

function serializeWorldState(state) {
  return {
    obstacles: state.obstacles,
    units: state.units
      .filter((unit) => unit.health > 0)
      .map((unit) => ({
        id: unit.id,
        owner: unit.owner,
        x: unit.x,
        y: unit.y,
        health: unit.health,
        maxHealth: unit.maxHealth,
        attackTargetId: unit.attackTargetId,
      })),
  };
}

function processAttacks(units, deltaTime) {
  let hasChanged = false;

  for (const unit of units) {
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

    if (distance > UNIT_ATTACK_RANGE) {
      const dx = target.x - unit.x;
      const dy = target.y - unit.y;
      const stopDistance = UNIT_ATTACK_RANGE * 0.8;
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
    unit.isMoving = false;

    if (unit.attackCooldown > 0) {
      unit.attackCooldown -= deltaTime;
      continue;
    }

    target.health = Math.max(0, target.health - UNIT_ATTACK_DAMAGE);
    unit.attackCooldown = UNIT_ATTACK_COOLDOWN;
    hasChanged = true;

    if (target.health <= 0) {
      for (const attacker of units) {
        if (attacker.attackTargetId === target.id) {
          attacker.attackTargetId = null;
          if (attacker.isAttackMove) {
            assignUnitPath(attacker, { x: attacker.attackMoveDestinationX, y: attacker.attackMoveDestinationY });
          }
        }
      }
    }
  }

  return hasChanged;
}

function assignUnitPath(unit, desiredDestination) {
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

  const maxStep = UNIT_SPEED * deltaTime;
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

function resolveObstacleCollisions(units) {
  let hasAdjusted = false;

  for (const unit of units) {
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

        unit.x = clamp(unit.x - firstSeparationX, UNIT_RADIUS, MAP_WIDTH - UNIT_RADIUS);
        unit.y = clamp(unit.y - firstSeparationY, UNIT_RADIUS, MAP_HEIGHT - UNIT_RADIUS);
        otherUnit.x = clamp(
          otherUnit.x + secondSeparationX,
          UNIT_RADIUS,
          MAP_WIDTH - UNIT_RADIUS,
        );
        otherUnit.y = clamp(
          otherUnit.y + secondSeparationY,
          UNIT_RADIUS,
          MAP_HEIGHT - UNIT_RADIUS,
        );

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
