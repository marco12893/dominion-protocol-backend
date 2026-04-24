import { getHexesInRange } from "../utils/hexMath.js";

export const HEX_RESOURCE_ORDER = ["gold", "oil", "iron", "wheat"];

export const INITIAL_HEX_PLAYER_STOCKPILE = Object.freeze({
  gold: 60,
  oil: 8,
  iron: 12,
  wheat: 20,
});

export const HEX_RESOURCE_YIELDS = Object.freeze({
  city: Object.freeze({ gold: 4 }),
  farm: Object.freeze({ wheat: 2 }),
  mine: Object.freeze({ iron: 2 }),
  oilWell: Object.freeze({ oil: 2 }),
});

export const HEX_UNIT_PRODUCTION_CATALOG = Object.freeze({
  rifleman: Object.freeze({
    cost: Object.freeze({ gold: 1, wheat: 1 }),
    slotCapacity: 30,
  }),
  antiTank: Object.freeze({
    cost: Object.freeze({ gold: 2, wheat: 1, iron: 1 }),
    slotCapacity: 18,
  }),
  armoredCar: Object.freeze({
    cost: Object.freeze({ gold: 2, iron: 1, oil: 1 }),
    slotCapacity: 16,
  }),
  lightTank: Object.freeze({
    cost: Object.freeze({ gold: 3, iron: 1, oil: 1 }),
    slotCapacity: 12,
  }),
  heavyTank: Object.freeze({
    cost: Object.freeze({ gold: 5, iron: 2, oil: 2 }),
    slotCapacity: 8,
  }),
  fighter: Object.freeze({
    cost: Object.freeze({ gold: 4, iron: 1, oil: 2 }),
    slotCapacity: 6,
  }),
  bomber: Object.freeze({
    cost: Object.freeze({ gold: 6, iron: 1, oil: 3 }),
    slotCapacity: 4,
  }),
  antiAir: Object.freeze({
    cost: Object.freeze({ gold: 2, iron: 1, oil: 1 }),
    slotCapacity: 12,
  }),
  attackHelicopter: Object.freeze({
    cost: Object.freeze({ gold: 4, iron: 1, oil: 2 }),
    slotCapacity: 6,
  }),
});

function getHexKey(col, row) {
  return `${col},${row}`;
}

export function createEmptyResourceStockpile() {
  return {
    gold: 0,
    oil: 0,
    iron: 0,
    wheat: 0,
  };
}

export function cloneResourceStockpile(stockpile = {}) {
  const nextStockpile = createEmptyResourceStockpile();

  for (const resourceType of HEX_RESOURCE_ORDER) {
    const value = Number(stockpile?.[resourceType]);
    nextStockpile[resourceType] = Number.isFinite(value) ? value : 0;
  }

  return nextStockpile;
}

export function createStartingResourceStockpile() {
  return cloneResourceStockpile(INITIAL_HEX_PLAYER_STOCKPILE);
}

export function normalizeResourceCost(cost = {}) {
  const normalizedCost = createEmptyResourceStockpile();

  for (const resourceType of HEX_RESOURCE_ORDER) {
    const value = Number(cost?.[resourceType]);
    normalizedCost[resourceType] = Number.isFinite(value) && value > 0 ? value : 0;
  }

  return normalizedCost;
}

export function getUnitBuildCost(variantId) {
  return normalizeResourceCost(HEX_UNIT_PRODUCTION_CATALOG[variantId]?.cost);
}

export function multiplyResourceCost(cost, multiplier = 1) {
  const normalizedCost = normalizeResourceCost(cost);
  const normalizedMultiplier = Math.max(0, Math.floor(Number(multiplier) || 0));
  const totalCost = createEmptyResourceStockpile();

  for (const resourceType of HEX_RESOURCE_ORDER) {
    totalCost[resourceType] = normalizedCost[resourceType] * normalizedMultiplier;
  }

  return totalCost;
}

export function cloneResourceLedger(ledger = {}) {
  return Object.fromEntries(
    Object.entries(ledger).map(([playerColor, stockpile]) => [
      playerColor,
      cloneResourceStockpile(stockpile),
    ]),
  );
}

export function createInitialResourceLedger(playerColors = []) {
  const nextLedger = {};

  for (const playerColor of playerColors) {
    nextLedger[playerColor] = createStartingResourceStockpile();
  }

  return nextLedger;
}

export function canAffordCost(stockpile, cost) {
  const normalizedStockpile = cloneResourceStockpile(stockpile);
  const normalizedCost = normalizeResourceCost(cost);

  return HEX_RESOURCE_ORDER.every(
    (resourceType) => normalizedStockpile[resourceType] >= normalizedCost[resourceType],
  );
}

export function deductResourceCost(stockpile, cost) {
  const nextStockpile = cloneResourceStockpile(stockpile);
  const normalizedCost = normalizeResourceCost(cost);

  for (const resourceType of HEX_RESOURCE_ORDER) {
    nextStockpile[resourceType] -= normalizedCost[resourceType];
  }

  return nextStockpile;
}

export function addResourceIncome(stockpile, income) {
  const nextStockpile = cloneResourceStockpile(stockpile);
  const normalizedIncome = normalizeResourceCost(income);

  for (const resourceType of HEX_RESOURCE_ORDER) {
    nextStockpile[resourceType] += normalizedIncome[resourceType];
  }

  return nextStockpile;
}

export function buildHexCityOwnershipMap(cities, cols, rows) {
  const ownerByTileKey = new Map();
  const cityById = new Map();
  const cityCenterKeySet = new Set();
  const cityTileMap = new Map();

  for (const city of cities) {
    cityById.set(city.id, city);
    cityCenterKeySet.add(getHexKey(city.centerCol, city.centerRow));

    const cityHexes = getHexesInRange(city.centerCol, city.centerRow, 1, cols, rows);
    cityTileMap.set(city.id, cityHexes);

    for (const hex of cityHexes) {
      ownerByTileKey.set(getHexKey(hex.col, hex.row), city.owner ?? null);
    }
  }

  return {
    cityById,
    cityCenterKeySet,
    cityTileMap,
    ownerByTileKey,
  };
}

export function computePlayerResourceIncome({
  terrainTiles,
  cities,
  cols,
  rows,
}) {
  const ownership = buildHexCityOwnershipMap(cities, cols, rows);
  const incomeByPlayer = {};

  for (const city of cities) {
    const owner = city.owner;
    if (!owner) {
      continue;
    }

    if (!incomeByPlayer[owner]) {
      incomeByPlayer[owner] = createEmptyResourceStockpile();
    }

    for (const [resourceType, amount] of Object.entries(HEX_RESOURCE_YIELDS.city)) {
      incomeByPlayer[owner][resourceType] += amount;
    }
  }

  for (const tile of terrainTiles) {
    const owner = ownership.ownerByTileKey.get(getHexKey(tile.col, tile.row));
    if (!owner || !tile.improvementType || !HEX_RESOURCE_YIELDS[tile.improvementType]) {
      continue;
    }

    if (!incomeByPlayer[owner]) {
      incomeByPlayer[owner] = createEmptyResourceStockpile();
    }

    for (const [resourceType, amount] of Object.entries(HEX_RESOURCE_YIELDS[tile.improvementType])) {
      incomeByPlayer[owner][resourceType] += amount;
    }
  }

  return incomeByPlayer;
}
