import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";

const PORT = Number(process.env.PORT ?? 4000);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? "http://localhost:3000";
const MAP_WIDTH = 960;
const MAP_HEIGHT = 540;
const TICK_RATE = 60;
const UNIT_SPEED = 180;
const FORMATION_SPACING = 28;
const UNIT_RADIUS = 10;
const COLLISION_PASSES = 3;

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
  units: [
    createUnit("unit-1", 180, 160),
    createUnit("unit-2", 300, 240),
    createUnit("unit-3", 420, 180),
    createUnit("unit-4", 540, 300),
    createUnit("unit-5", 660, 220),
  ],
};

io.on("connection", (socket) => {
  socket.emit("world:state", worldState);

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
      .map((unitId) => worldState.units.find((entry) => entry.id === unitId))
      .filter(Boolean);

    if (units.length === 0) {
      return;
    }

    const slots = buildFormation(units.length, {
      x: clamp(position.x, 0, MAP_WIDTH),
      y: clamp(position.y, 0, MAP_HEIGHT),
    });

    units.forEach((unit, index) => {
      unit.targetX = clamp(slots[index].x, 0, MAP_WIDTH);
      unit.targetY = clamp(slots[index].y, 0, MAP_HEIGHT);
    });
  });
});

setInterval(() => {
  let hasMoved = false;

  for (const unit of worldState.units) {
    hasMoved = advanceUnit(unit, 1 / TICK_RATE) || hasMoved;
  }

  hasMoved = resolveUnitCollisions(worldState.units) || hasMoved;

  if (hasMoved) {
    io.emit("world:state", worldState);
  }
}, 1000 / TICK_RATE);

httpServer.listen(PORT, () => {
  console.log(`Dominion Protocol backend listening on port ${PORT}`);
});

function createUnit(id, x, y) {
  return {
    id,
    x,
    y,
    targetX: x,
    targetY: y,
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function advanceUnit(unit, deltaTime) {
  const dx = unit.targetX - unit.x;
  const dy = unit.targetY - unit.y;
  const distance = Math.hypot(dx, dy);

  if (distance < 0.5) {
    if (distance === 0) {
      return false;
    }

    unit.x = unit.targetX;
    unit.y = unit.targetY;
    return true;
  }

  const maxStep = UNIT_SPEED * deltaTime;
  const step = Math.min(distance, maxStep);

  unit.x += (dx / distance) * step;
  unit.y += (dy / distance) * step;
  return true;
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
        const normalX = distance === 0 ? 1 : dx / distance;
        const normalY = distance === 0 ? 0 : dy / distance;
        const separationX = normalX * (overlap / 2);
        const separationY = normalY * (overlap / 2);

        unit.x = clamp(unit.x - separationX, UNIT_RADIUS, MAP_WIDTH - UNIT_RADIUS);
        unit.y = clamp(unit.y - separationY, UNIT_RADIUS, MAP_HEIGHT - UNIT_RADIUS);
        otherUnit.x = clamp(
          otherUnit.x + separationX,
          UNIT_RADIUS,
          MAP_WIDTH - UNIT_RADIUS,
        );
        otherUnit.y = clamp(
          otherUnit.y + separationY,
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
