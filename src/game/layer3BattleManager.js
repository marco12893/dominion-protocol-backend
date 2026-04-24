import { MAP_HEIGHT, MAP_WIDTH, TICK_RATE } from "../config/gameConstants.js";
import {
  LAYER_3_BATTLE_DURATION_SECONDS,
  LAYER_3_BATTLE_PREPARATION_SECONDS,
} from "./layer3BattleConstants.js";

const BATTLE_DURATION_TICKS = LAYER_3_BATTLE_DURATION_SECONDS * TICK_RATE;
const BATTLE_PREPARATION_TICKS = LAYER_3_BATTLE_PREPARATION_SECONDS * TICK_RATE;
const BLUE_SPAWN_CENTER = Object.freeze({
  x: 420,
  y: 420,
});
const RED_SPAWN_CENTER = Object.freeze({
  x: MAP_WIDTH - 420,
  y: MAP_HEIGHT - 420,
});

function cloneArmySlots(slots = []) {
  return Array.isArray(slots)
    ? slots.map((slot) => ({ variantId: slot.variantId, count: slot.count }))
    : [];
}

function cloneBattleArmySummary(army) {
  if (!army) {
    return null;
  }

  const totalUnits = Array.isArray(army.slots)
    ? army.slots.reduce((sum, slot) => sum + (slot.count ?? 0), 0)
    : 0;

  return {
    id: army.id ?? null,
    owner: army.owner ?? null,
    totalUnits,
    usedSlots: Array.isArray(army.slots) ? army.slots.length : 0,
    slots: cloneArmySlots(army.slots),
  };
}

function createIdleBattleState() {
  return {
    status: "idle",
    battleId: null,
    queueLength: 0,
    hex: null,
    maxDurationSeconds: LAYER_3_BATTLE_DURATION_SECONDS,
    countdownEndsAtTick: null,
    startedAtTick: null,
    endsAtTick: null,
    blueArmy: null,
    redArmy: null,
  };
}

function cloneEngagement(engagement) {
  return {
    battleId: engagement.battleId,
    hex: { ...engagement.hex },
    blueArmyId: engagement.blueArmyId,
    redArmyId: engagement.redArmyId,
    blueArmy: cloneBattleArmySummary(engagement.blueArmy),
    redArmy: cloneBattleArmySummary(engagement.redArmy),
  };
}

function expandArmyToVariantList(army) {
  const variants = [];

  for (const slot of army?.slots ?? []) {
    for (let index = 0; index < slot.count; index += 1) {
      variants.push(slot.variantId);
    }
  }

  return variants;
}

function summarizeSurvivors(units, owner) {
  return units.reduce((counts, unit) => {
    if (unit.owner !== owner || unit.health <= 0) {
      return counts;
    }

    counts[unit.variantId] = (counts[unit.variantId] ?? 0) + 1;
    return counts;
  }, {});
}

export function createLayer3BattleManager({
  world,
  hexManager,
  createUnit,
  buildFormation,
  executeOrder,
  emitHexStateUpdates,
}) {
  const worldState = world.state;
  const queuedBattles = [];
  let activeBattle = null;

  function markWorldDirty() {
    world.pendingBroadcast = true;
    world.forceFullSnapshot = true;
  }

  function syncBattleState() {
    const nextState = activeBattle
      ? {
        status: activeBattle.status,
        battleId: activeBattle.battleId,
        queueLength: queuedBattles.length,
        hex: { ...activeBattle.hex },
        maxDurationSeconds: LAYER_3_BATTLE_DURATION_SECONDS,
        countdownEndsAtTick: activeBattle.countdownEndsAtTick ?? null,
        startedAtTick: activeBattle.startedAtTick,
        endsAtTick: activeBattle.endsAtTick,
        blueArmy: cloneBattleArmySummary(activeBattle.blueArmy),
        redArmy: cloneBattleArmySummary(activeBattle.redArmy),
      }
      : createIdleBattleState();

    worldState.layer3Battle = nextState;
    worldState.teamSelections.blue.hasDeployed = Boolean(activeBattle);
    worldState.teamSelections.red.hasDeployed = Boolean(activeBattle);
    hexManager.setLayer3BattleState(nextState);
  }

  function createBattleUnits(battle) {
    const units = [];
    const blueVariants = expandArmyToVariantList(battle.blueArmy);
    const redVariants = expandArmyToVariantList(battle.redArmy);
    const blueSlots = buildFormation(blueVariants.length, BLUE_SPAWN_CENTER);
    const redSlots = buildFormation(redVariants.length, RED_SPAWN_CENTER);

    for (let index = 0; index < blueVariants.length; index += 1) {
      const unit = createUnit(
        `l3-${battle.battleId}-blue-${blueVariants[index]}-${index + 1}`,
        blueSlots[index].x,
        blueSlots[index].y,
        "blue",
        blueVariants[index],
      );
      unit.sourceBattleId = battle.battleId;
      unit.sourceArmyId = battle.blueArmy.id;
      executeOrder(unit, { type: "holdPosition" });
      units.push(unit);
    }

    for (let index = 0; index < redVariants.length; index += 1) {
      const unit = createUnit(
        `l3-${battle.battleId}-red-${redVariants[index]}-${index + 1}`,
        redSlots[index].x,
        redSlots[index].y,
        "red",
        redVariants[index],
      );
      unit.sourceBattleId = battle.battleId;
      unit.sourceArmyId = battle.redArmy.id;
      executeOrder(unit, { type: "holdPosition" });
      units.push(unit);
    }

    return units;
  }

  function startNextBattle() {
    if (activeBattle || queuedBattles.length === 0) {
      return activeBattle;
    }

    const nextBattle = queuedBattles.shift();
    activeBattle = {
      ...nextBattle,
      status: "countdown",
      countdownEndsAtTick: world.currentTick + BATTLE_PREPARATION_TICKS,
      startedAtTick: null,
      endsAtTick: null,
    };

    worldState.units = createBattleUnits(activeBattle);
    syncBattleState();
    markWorldDirty();
    emitHexStateUpdates?.();

    return activeBattle;
  }

  function queueEngagements(engagements = []) {
    if (!Array.isArray(engagements) || engagements.length === 0) {
      return activeBattle;
    }

    queuedBattles.push(...engagements.map(cloneEngagement));

    if (!activeBattle) {
      return startNextBattle();
    }

    syncBattleState();
    markWorldDirty();
    emitHexStateUpdates?.();
    return activeBattle;
  }

  function finishActiveBattle(reason) {
    if (!activeBattle) {
      return null;
    }

    const completedBattle = activeBattle;
    const survivorsByOwner = {
      blue: summarizeSurvivors(worldState.units, "blue"),
      red: summarizeSurvivors(worldState.units, "red"),
    };

    hexManager.applyBattleOutcome({
      battleId: completedBattle.battleId,
      blueArmyId: completedBattle.blueArmy.id,
      redArmyId: completedBattle.redArmy.id,
      survivorsByOwner,
      reason,
    });

    worldState.units = [];
    activeBattle = null;

    if (queuedBattles.length > 0) {
      return startNextBattle();
    }

    syncBattleState();
    markWorldDirty();
    emitHexStateUpdates?.();
    return completedBattle;
  }

  function tick() {
    if (!activeBattle) {
      return false;
    }

    if (activeBattle.status === "countdown") {
      if (world.currentTick < activeBattle.countdownEndsAtTick) {
        return false;
      }

      activeBattle = {
        ...activeBattle,
        status: "active",
        startedAtTick: world.currentTick,
        endsAtTick: world.currentTick + BATTLE_DURATION_TICKS,
      };
      syncBattleState();
      markWorldDirty();
      emitHexStateUpdates?.();
      return true;
    }

    const blueAlive = worldState.units.some((unit) => unit.owner === "blue" && unit.health > 0);
    const redAlive = worldState.units.some((unit) => unit.owner === "red" && unit.health > 0);

    if (!blueAlive || !redAlive) {
      finishActiveBattle("elimination");
      return true;
    }

    if (world.currentTick >= activeBattle.endsAtTick) {
      finishActiveBattle("timer");
      return true;
    }

    return false;
  }

  function reset() {
    queuedBattles.length = 0;
    activeBattle = null;
    worldState.units = [];
    syncBattleState();
    markWorldDirty();
  }

  syncBattleState();

  return {
    queueEngagements,
    tick,
    reset,
  };
}
