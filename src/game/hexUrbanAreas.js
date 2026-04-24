import { getHexesInRange, hexDistance } from "../utils/hexMath.js";

export const HEX_URBAN_AREA_TIER_ORDER = Object.freeze(["town", "city", "metropolis"]);

export const HEX_URBAN_AREA_RANGE_BY_TIER = Object.freeze({
  town: 1,
  city: 2,
  metropolis: 3,
});

export const HEX_URBAN_AREA_BASE_RESOURCE_YIELDS = Object.freeze({
  town: Object.freeze({ gold: 4 }),
  city: Object.freeze({ gold: 4 }),
  metropolis: Object.freeze({ gold: 4 }),
});

export const HEX_URBAN_AREA_UPGRADE_COSTS = Object.freeze({
  town: Object.freeze({ gold: 45, wheat: 18, iron: 12, oil: 6 }),
  city: Object.freeze({ gold: 90, wheat: 36, iron: 24, oil: 14 }),
});

function getHexKey(col, row) {
  return `${col},${row}`;
}

export function normalizeUrbanAreaTier(tier) {
  return HEX_URBAN_AREA_TIER_ORDER.includes(tier) ? tier : "town";
}

export function getUrbanAreaRange(urbanAreaOrTier) {
  const tier = typeof urbanAreaOrTier === "string"
    ? urbanAreaOrTier
    : urbanAreaOrTier?.tier;
  return HEX_URBAN_AREA_RANGE_BY_TIER[normalizeUrbanAreaTier(tier)] ?? 1;
}

export function getUrbanAreaHexes(urbanArea, cols, rows) {
  if (
    typeof urbanArea?.centerCol !== "number" ||
    typeof urbanArea?.centerRow !== "number"
  ) {
    return [];
  }

  return getHexesInRange(
    urbanArea.centerCol,
    urbanArea.centerRow,
    getUrbanAreaRange(urbanArea),
    cols,
    rows,
  );
}

export function getNextUrbanAreaTier(tier) {
  const normalizedTier = normalizeUrbanAreaTier(tier);
  const tierIndex = HEX_URBAN_AREA_TIER_ORDER.indexOf(normalizedTier);

  if (tierIndex < 0 || tierIndex >= HEX_URBAN_AREA_TIER_ORDER.length - 1) {
    return null;
  }

  return HEX_URBAN_AREA_TIER_ORDER[tierIndex + 1];
}

export function buildUrbanAreaOwnershipMap(urbanAreas, cols, rows) {
  const ownerByTileKey = new Map();
  const cityById = new Map();
  const cityCenterKeySet = new Set();
  const cityTileMap = new Map();
  const claimByTileKey = new Map();

  for (const urbanArea of urbanAreas) {
    cityById.set(urbanArea.id, urbanArea);
    cityCenterKeySet.add(getHexKey(urbanArea.centerCol, urbanArea.centerRow));

    const urbanAreaHexes = getUrbanAreaHexes(urbanArea, cols, rows);
    cityTileMap.set(urbanArea.id, urbanAreaHexes);

    for (const hex of urbanAreaHexes) {
      const tileKey = getHexKey(hex.col, hex.row);
      const distance = hexDistance(
        urbanArea.centerCol,
        urbanArea.centerRow,
        hex.col,
        hex.row,
      );
      const existingClaim = claimByTileKey.get(tileKey);

      if (existingClaim && existingClaim.distance <= distance) {
        continue;
      }

      claimByTileKey.set(tileKey, {
        cityId: urbanArea.id,
        distance,
        owner: urbanArea.owner ?? null,
      });
      ownerByTileKey.set(tileKey, urbanArea.owner ?? null);
    }
  }

  return {
    cityById,
    cityCenterKeySet,
    cityTileMap,
    ownerByTileKey,
  };
}
