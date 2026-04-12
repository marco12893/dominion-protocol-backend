import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";

import { CLIENT_ORIGIN, PORT, TICK_RATE } from "./src/config/gameConstants.js";
import { createCombatSystem } from "./src/game/combat.js";
import { buildFormation, assignFormationSlots } from "./src/game/formation.js";
import { createGameLoop } from "./src/game/gameLoop.js";
import { createMovementSystem } from "./src/game/movement.js";
import { createOrderController } from "./src/game/orders.js";
import { registerSocketHandlers } from "./src/network/registerSocketHandlers.js";
import { createUnit, serializeWorldState } from "./src/units/units.js";
import { createWorld } from "./src/world/state.js";

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

const world = createWorld();
const movement = createMovementSystem({ worldState: world.state });
const orders = createOrderController({ assignUnitPath: movement.assignUnitPath });
const combat = createCombatSystem({
  io,
  world,
  assignUnitPath: movement.assignUnitPath,
});

registerSocketHandlers({
  io,
  world,
  createUnit,
  serializeWorldState,
  buildFormation,
  assignFormationSlots,
  processUnitOrder: orders.processUnitOrder,
  assignUnitPath: movement.assignUnitPath,
});

const tick = createGameLoop({
  world,
  executeOrder: orders.executeOrder,
  processAttacks: combat.processAttacks,
  advanceUnit: movement.advanceUnit,
  resolveObstacleCollisions: movement.resolveObstacleCollisions,
  resolveUnitCollisions: movement.resolveUnitCollisions,
  detectAndResolveDeadlocks: movement.detectAndResolveDeadlocks,
  serializeWorldState,
  io,
});

setInterval(tick, 1000 / TICK_RATE);

httpServer.listen(PORT, () => {
  console.log(`Dominion Protocol backend listening on port ${PORT}`);
});
