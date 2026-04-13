import {
  createSerializedWorldCache,
  createWorldDelta,
  hasWorldDeltaChanges,
} from "../units/units.js";

export function buildWorldSnapshot(world, serializeWorldState) {
  return {
    ...serializeWorldState(world.state),
    tick: world.currentTick,
  };
}

export function emitWorldSnapshot(target, world, serializeWorldState) {
  const snapshot = buildWorldSnapshot(world, serializeWorldState);

  target.emit("world:snapshot", snapshot);
  world.lastBroadcastState = createSerializedWorldCache(snapshot);
  world.lastBroadcastTick = world.currentTick;
  world.pendingBroadcast = false;
  world.forceFullSnapshot = false;
}

export function emitWorldDelta(io, world, serializeWorldState) {
  const snapshot = buildWorldSnapshot(world, serializeWorldState);

  if (world.forceFullSnapshot || !world.lastBroadcastState) {
    io.emit("world:snapshot", snapshot);
    world.lastBroadcastState = createSerializedWorldCache(snapshot);
    world.lastBroadcastTick = world.currentTick;
    world.pendingBroadcast = false;
    world.forceFullSnapshot = false;
    return true;
  }

  const delta = {
    ...createWorldDelta(snapshot, world.lastBroadcastState),
    tick: world.currentTick,
  };

  world.lastBroadcastState = createSerializedWorldCache(snapshot);
  world.lastBroadcastTick = world.currentTick;
  world.pendingBroadcast = false;

  if (!hasWorldDeltaChanges(delta)) {
    return false;
  }

  io.emit("world:delta", delta);
  return true;
}
