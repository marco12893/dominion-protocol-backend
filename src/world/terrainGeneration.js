import { getHexNeighbors, getHexesInRange, hexDistance } from "../utils/hexMath.js";

const SQRT_3 = Math.sqrt(3);
const MAX_LAKE_SIZE = 10;
const PROTECTED_LAND_RADIUS = 3;
const PROTECTED_CORE_RADIUS = 2;
const COAST_EXTENSION_PASSES = 2;

const BIOME_ASSET_KEYS = {
  grassland: "Grassland",
  plains: "Plains",
  desert: "Desert",
  tundra: "Tundra",
  snow: "Snow",
};

const HILL_ASSET_KEYS = {
  grassland: "Grassland+Hill",
  plains: "Plains+Hill",
  desert: "Desert+Hill",
  tundra: "Tundra+Hill",
  snow: "Snow+Hill",
};

const PERMUTATION = [
  151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225,
  140, 36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148,
  247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32,
  57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175,
  74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122,
  60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54,
  65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169,
  200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64,
  52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212,
  207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213,
  119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9,
  129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104,
  218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241,
  81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157,
  184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93,
  222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180,
];

const GRADIENTS = [
  [1, 1, 0],
  [-1, 1, 0],
  [1, -1, 0],
  [-1, -1, 0],
  [1, 0, 1],
  [-1, 0, 1],
  [1, 0, -1],
  [-1, 0, -1],
  [0, 1, 1],
  [0, -1, 1],
  [0, 1, -1],
  [0, -1, -1],
  [1, 0, -1],
  [-1, 0, -1],
  [0, -1, 1],
  [0, 1, 1],
];

const PERLIN_LOOKUP = Array.from({ length: 512 }, (_, index) => (
  index < 256 ? PERMUTATION[index] : PERMUTATION[index - 256]
));

function createSeededRandom(seed) {
  let state = (Number(seed) >>> 0) || 1;

  function nextFloat() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  return {
    nextFloat,
    nextInt(max) {
      return Math.floor(nextFloat() * max);
    },
    chance(probability) {
      return nextFloat() < probability;
    },
  };
}

function createTerrainTile(col, row) {
  return {
    col,
    row,
    isWater: true,
    waterType: "ocean",
    biome: "plains",
    elevation: "flat",
    feature: null,
    baseAssetKey: "Ocean",
    overlayAssetKey: null,
    temperature: 0,
    humidity: 0,
    elevationScore: 0,
  };
}

function getTileIndex(col, row, cols) {
  return row * cols + col;
}

function getTileAt(tiles, col, row, cols, rows) {
  if (col < 0 || col >= cols || row < 0 || row >= rows) {
    return null;
  }

  return tiles[getTileIndex(col, row, cols)];
}

function offsetToWorld(col, row) {
  return {
    x: 1.5 * col,
    y: SQRT_3 * (row + 0.5 * (col & 1)),
  };
}

function fade(value) {
  return value * value * value * (value * (value * 6 - 15) + 10);
}

function lerp(t, a, b) {
  return a + t * (b - a);
}

function grad(hash, x, y, z) {
  const gradient = GRADIENTS[hash & 15];
  return x * gradient[0] + y * gradient[1] + z * gradient[2];
}

function baseNoise3d(x, y, z) {
  const xi = Math.floor(x) & 255;
  const yi = Math.floor(y) & 255;
  const zi = Math.floor(z) & 255;

  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const zf = z - Math.floor(z);

  const u = fade(xf);
  const v = fade(yf);
  const w = fade(zf);

  const a = PERLIN_LOOKUP[xi] + yi;
  const aa = PERLIN_LOOKUP[a] + zi;
  const ab = PERLIN_LOOKUP[a + 1] + zi;
  const b = PERLIN_LOOKUP[xi + 1] + yi;
  const ba = PERLIN_LOOKUP[b] + zi;
  const bb = PERLIN_LOOKUP[b + 1] + zi;

  return lerp(
    w,
    lerp(
      v,
      lerp(u, grad(PERLIN_LOOKUP[aa], xf, yf, zf), grad(PERLIN_LOOKUP[ba], xf - 1, yf, zf)),
      lerp(u, grad(PERLIN_LOOKUP[ab], xf, yf - 1, zf), grad(PERLIN_LOOKUP[bb], xf - 1, yf - 1, zf)),
    ),
    lerp(
      v,
      lerp(u, grad(PERLIN_LOOKUP[aa + 1], xf, yf, zf - 1), grad(PERLIN_LOOKUP[ba + 1], xf - 1, yf, zf - 1)),
      lerp(
        u,
        grad(PERLIN_LOOKUP[ab + 1], xf, yf - 1, zf - 1),
        grad(PERLIN_LOOKUP[bb + 1], xf - 1, yf - 1, zf - 1),
      ),
    ),
  );
}

function layeredNoise3d(x, y, z, {
  octaves = 6,
  persistence = 0.5,
  lacunarity = 2,
  scale = 10,
  ridged = false,
} = {}) {
  let frequency = 1;
  let amplitude = 1;
  let total = 0;
  let maxAmplitude = 0;

  for (let octave = 0; octave < octaves; octave += 1) {
    let value = baseNoise3d(
      (x * frequency) / scale,
      (y * frequency) / scale,
      (z * frequency) / scale,
    );

    if (ridged) {
      value = Math.abs(value);
    }

    total += value * amplitude;
    maxAmplitude += amplitude;
    frequency *= lacunarity;
    amplitude *= persistence;
  }

  return total / Math.max(maxAmplitude, 1);
}

function getTileNoise(tile, seed, options) {
  const world = offsetToWorld(tile.col, tile.row);
  return layeredNoise3d(world.x, world.y, seed, options);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function signedPow(value, exponent) {
  return Math.sign(value) * Math.pow(Math.abs(value), exponent);
}

function getEdgeWaterTransform(tile, cols, rows) {
  const maxX = Math.max(1, (cols - 1) / 2);
  const maxY = Math.max(1, (rows - 1) / 2);
  const centerX = (cols - 1) / 2;
  const centerY = (rows - 1) / 2;

  const xDistanceRatio = Math.abs(tile.col - centerX) / maxX;
  const yDistanceRatio = Math.abs(tile.row - centerY) / maxY;
  const distanceFromCenter = Math.sqrt(xDistanceRatio * xDistanceRatio + yDistanceRatio * yDistanceRatio);
  const startDropoffRatio = 0.8;

  if (distanceFromCenter <= startDropoffRatio) {
    return 0;
  }

  const dropoffDistance = distanceFromCenter - startDropoffRatio;
  const normalizedDropoff = dropoffDistance / (1 - startDropoffRatio);
  return -Math.min(0.35, normalizedDropoff * 0.35);
}

function pickBiome(temperature, humidity) {
  if (temperature < -0.4) {
    return humidity < 0.5 ? "snow" : "tundra";
  }

  if (temperature < 0.8) {
    return humidity < 0.5 ? "plains" : "grassland";
  }

  return humidity < 0.7 ? "desert" : "plains";
}

function getNeighborTiles(tile, tiles, cols, rows) {
  return getHexNeighbors(tile.col, tile.row, cols, rows)
    .map((neighbor) => getTileAt(tiles, neighbor.col, neighbor.row, cols, rows))
    .filter(Boolean);
}

function markProtectedZones(centers, cols, rows) {
  const landIndices = new Set();
  const coreIndices = new Set();
  const minRingByIndex = new Map();

  for (const center of centers) {
    for (const tile of getHexesInRange(
      center.centerCol,
      center.centerRow,
      PROTECTED_LAND_RADIUS,
      cols,
      rows,
    )) {
      const index = getTileIndex(tile.col, tile.row, cols);
      const ring = hexDistance(center.centerCol, center.centerRow, tile.col, tile.row);
      landIndices.add(index);

      if (!minRingByIndex.has(index) || ring < minRingByIndex.get(index)) {
        minRingByIndex.set(index, ring);
      }

      if (ring <= PROTECTED_CORE_RADIUS) {
        coreIndices.add(index);
      }
    }
  }

  return { landIndices, coreIndices, minRingByIndex };
}

function applyLandmass(tiles, cols, rows, seeds, protectedIndices) {
  let waterThreshold = 0.08;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    let waterCount = 0;

    for (const tile of tiles) {
      const macroNoise = getTileNoise(tile, seeds.landMacroSeed, {
        octaves: 4,
        persistence: 0.78,
        lacunarity: 1.8,
        scale: Math.max(cols, rows) * 1.15,
      });
      const detailNoise = getTileNoise(tile, seeds.landDetailSeed, {
        octaves: 6,
        persistence: 0.58,
        lacunarity: 2.05,
        scale: Math.max(cols, rows) * 0.7,
      });
      const landScore = macroNoise * 0.65 + detailNoise * 0.35 + getEdgeWaterTransform(tile, cols, rows);
      tile.isWater = landScore < waterThreshold;

      if (protectedIndices.landIndices.has(getTileIndex(tile.col, tile.row, cols))) {
        tile.isWater = false;
      }

      if (tile.isWater) {
        waterCount += 1;
      }
    }

    const waterPercent = waterCount / tiles.length;
    if (waterPercent >= 0.4 && waterPercent <= 0.66) {
      break;
    }

    if (waterPercent > 0.66) {
      waterThreshold -= 0.03;
    } else {
      waterThreshold += 0.02;
    }
  }
}

function applyClimate(tiles, cols, rows, seeds) {
  const rowMid = (rows - 1) / 2;

  for (const tile of tiles) {
    const humidityNoise = getTileNoise(tile, seeds.humiditySeed, {
      octaves: 2,
      persistence: 0.65,
      lacunarity: 2,
      scale: 14,
    });
    const humidity = clamp((humidityNoise + 1) / 2, 0, 1);
    tile.humidity = humidity;

    const shiftedRow = tile.row + 0.5 * (tile.col & 1);
    const latitudeTemperature = 1 - (2 * Math.abs(shiftedRow - rowMid)) / Math.max(1, rowMid);
    const randomTemperature = getTileNoise(tile, seeds.temperatureSeed, {
      octaves: 2,
      persistence: 0.6,
      lacunarity: 2,
      scale: 14,
    });

    let temperature = (5 * latitudeTemperature + randomTemperature) / 6;
    temperature = signedPow(temperature, 0.55);
    temperature = clamp(temperature, -1, 1);
    tile.temperature = temperature;

    if (tile.isWater) {
      tile.waterType = "ocean";
      tile.baseAssetKey = "Ocean";
      continue;
    }

    tile.biome = pickBiome(temperature, humidity);
    tile.baseAssetKey = BIOME_ASSET_KEYS[tile.biome];
    tile.waterType = null;
  }
}

function applyElevation(tiles, cols, rows, seeds, protectedIndices) {
  const mountainSet = new Set();
  const hillSet = new Set();

  for (const tile of tiles) {
    const index = getTileIndex(tile.col, tile.row, cols);
    if (tile.isWater || protectedIndices.coreIndices.has(index)) {
      tile.elevationScore = 0;
      continue;
    }

    const rawElevation = getTileNoise(tile, seeds.elevationSeed, {
      octaves: 4,
      persistence: 0.55,
      lacunarity: 2,
      scale: 10,
    });

    tile.elevationScore = signedPow(rawElevation, 0.65);

    if (tile.elevationScore > 0.56) {
      mountainSet.add(index);
    } else if (tile.elevationScore > 0.34) {
      hillSet.add(index);
    }
  }

  for (let pass = 0; pass < 4; pass += 1) {
    const nextMountains = new Set(mountainSet);

    for (const tile of tiles) {
      const index = getTileIndex(tile.col, tile.row, cols);
      if (tile.isWater || protectedIndices.coreIndices.has(index)) {
        nextMountains.delete(index);
        continue;
      }

      const mountainNeighbors = getNeighborTiles(tile, tiles, cols, rows)
        .filter((neighbor) => mountainSet.has(getTileIndex(neighbor.col, neighbor.row, cols)))
        .length;

      if (mountainSet.has(index)) {
        if (
          (mountainNeighbors === 0 && tile.elevationScore < 0.68) ||
          (mountainNeighbors > 4 && tile.elevationScore < 0.62)
        ) {
          nextMountains.delete(index);
        }
      } else if (tile.elevationScore > 0.46 && mountainNeighbors >= 1) {
        nextMountains.add(index);
      }
    }

    mountainSet.clear();
    for (const index of nextMountains) {
      mountainSet.add(index);
    }
  }

  if (mountainSet.size === 0) {
    const fallbackMountains = tiles
      .filter((tile) => {
        const index = getTileIndex(tile.col, tile.row, cols);
        return !tile.isWater && !protectedIndices.coreIndices.has(index);
      })
      .sort((a, b) => b.elevationScore - a.elevationScore)
      .slice(0, 3);

    for (const tile of fallbackMountains) {
      mountainSet.add(getTileIndex(tile.col, tile.row, cols));
    }
  }

  for (const mountainIndex of mountainSet) {
    hillSet.delete(mountainIndex);
  }

  for (let pass = 0; pass < 3; pass += 1) {
    const nextHills = new Set(hillSet);

    for (const tile of tiles) {
      const index = getTileIndex(tile.col, tile.row, cols);
      if (tile.isWater || mountainSet.has(index) || protectedIndices.coreIndices.has(index)) {
        nextHills.delete(index);
        continue;
      }

      const neighbors = getNeighborTiles(tile, tiles, cols, rows);
      const hillNeighbors = neighbors.filter((neighbor) => hillSet.has(getTileIndex(neighbor.col, neighbor.row, cols))).length;
      const mountainNeighbors = neighbors.filter((neighbor) => mountainSet.has(getTileIndex(neighbor.col, neighbor.row, cols))).length;

      if (hillSet.has(index)) {
        if (
          (hillNeighbors + mountainNeighbors === 0 && tile.elevationScore < 0.4) ||
          (hillNeighbors > 4 && tile.elevationScore < 0.34)
        ) {
          nextHills.delete(index);
        }
      } else if (tile.elevationScore > 0.26 && hillNeighbors + mountainNeighbors >= 1) {
        nextHills.add(index);
      }
    }

    hillSet.clear();
    for (const index of nextHills) {
      hillSet.add(index);
    }
  }

  for (const tile of tiles) {
    const index = getTileIndex(tile.col, tile.row, cols);
    if (tile.isWater) {
      tile.elevation = "flat";
      tile.overlayAssetKey = null;
      continue;
    }

    if (protectedIndices.coreIndices.has(index)) {
      tile.elevation = "flat";
      tile.baseAssetKey = BIOME_ASSET_KEYS[tile.biome];
      tile.overlayAssetKey = null;
      continue;
    }

    if (mountainSet.has(index)) {
      tile.elevation = "mountain";
      tile.baseAssetKey = BIOME_ASSET_KEYS[tile.biome];
      tile.overlayAssetKey = "Mountain";
      continue;
    }

    if (hillSet.has(index)) {
      tile.elevation = "hill";
      tile.baseAssetKey = HILL_ASSET_KEYS[tile.biome];
      tile.overlayAssetKey = null;
      continue;
    }

    tile.elevation = "flat";
    tile.baseAssetKey = BIOME_ASSET_KEYS[tile.biome];
    tile.overlayAssetKey = null;
  }
}

function normalizeProtectedStarts(tiles, protectedIndices) {
  for (const index of protectedIndices.landIndices) {
    const tile = tiles[index];
    const ring = protectedIndices.minRingByIndex.get(index) ?? PROTECTED_LAND_RADIUS;

    tile.isWater = false;
    tile.waterType = null;
    tile.feature = null;

    if (ring <= 1) {
      tile.biome = "grassland";
    } else if (tile.biome === "desert" || tile.biome === "snow") {
      tile.biome = "plains";
    }

    if (protectedIndices.coreIndices.has(index)) {
      tile.elevation = "flat";
      tile.overlayAssetKey = null;
    } else if (tile.elevation === "mountain") {
      tile.elevation = "hill";
      tile.overlayAssetKey = null;
    }

    tile.baseAssetKey = tile.elevation === "hill"
      ? HILL_ASSET_KEYS[tile.biome]
      : BIOME_ASSET_KEYS[tile.biome];
  }
}

function ensureMountainPresence(tiles, cols, protectedIndices) {
  if (tiles.some((tile) => tile.elevation === "mountain")) {
    return;
  }

  const fallbackMountains = tiles
    .filter((tile) => {
      const index = getTileIndex(tile.col, tile.row, cols);
      return !tile.isWater && !protectedIndices.landIndices.has(index);
    })
    .sort((a, b) => b.elevationScore - a.elevationScore)
    .slice(0, 3);

  for (const tile of fallbackMountains) {
    tile.elevation = "mountain";
    tile.baseAssetKey = BIOME_ASSET_KEYS[tile.biome];
    tile.overlayAssetKey = "Mountain";
  }
}

function classifyWaterTiles(tiles, cols, rows, rng) {
  const visited = new Set();

  for (const tile of tiles) {
    const index = getTileIndex(tile.col, tile.row, cols);
    if (!tile.isWater || visited.has(index)) {
      continue;
    }

    const cluster = [];
    const queue = [tile];
    let touchesEdge = false;
    visited.add(index);

    while (queue.length > 0) {
      const current = queue.shift();
      cluster.push(current);

      if (
        current.col === 0 ||
        current.row === 0 ||
        current.col === cols - 1 ||
        current.row === rows - 1
      ) {
        touchesEdge = true;
      }

      for (const neighbor of getNeighborTiles(current, tiles, cols, rows)) {
        if (!neighbor.isWater) {
          continue;
        }

        const neighborIndex = getTileIndex(neighbor.col, neighbor.row, cols);
        if (visited.has(neighborIndex)) {
          continue;
        }

        visited.add(neighborIndex);
        queue.push(neighbor);
      }
    }

    const isLake = !touchesEdge && cluster.length <= MAX_LAKE_SIZE;
    for (const waterTile of cluster) {
      waterTile.waterType = isLake ? "lakes" : "ocean";
      waterTile.baseAssetKey = isLake ? "Lakes" : "Ocean";
      waterTile.overlayAssetKey = null;
      waterTile.elevation = "flat";
    }
  }

  for (let pass = 0; pass < COAST_EXTENSION_PASSES; pass += 1) {
    const toCoast = [];

    for (const tile of tiles) {
      if (!tile.isWater || tile.waterType !== "ocean") {
        continue;
      }

      const neighbors = getNeighborTiles(tile, tiles, cols, rows);
      const adjacentLand = neighbors.some((neighbor) => !neighbor.isWater);
      const adjacentCoast = neighbors.some((neighbor) => neighbor.waterType === "coast");

      if (adjacentLand || (adjacentCoast && rng.chance(0.55))) {
        toCoast.push(tile);
      }
    }

    for (const coastTile of toCoast) {
      coastTile.waterType = "coast";
      coastTile.baseAssetKey = "Coast";
    }
  }
}

function spawnAtolls(tiles, cols, rows, seeds, protectedIndices) {
  const candidates = [];

  for (const tile of tiles) {
    const index = getTileIndex(tile.col, tile.row, cols);
    if (tile.waterType !== "coast" || protectedIndices.landIndices.has(index)) {
      continue;
    }

    const neighbors = getNeighborTiles(tile, tiles, cols, rows);
    const adjacentLandCount = neighbors.filter((neighbor) => !neighbor.isWater).length;
    const adjacentAtoll = neighbors.some((neighbor) => neighbor.feature === "atoll");

    if (adjacentLandCount > 2 || adjacentAtoll || tile.temperature <= 0.25) {
      continue;
    }

    const atollNoise = getTileNoise(tile, seeds.featureSeed, {
      octaves: 1,
      persistence: 0.5,
      lacunarity: 2,
      scale: 7,
    });

    candidates.push({ tile, atollNoise });

    if (atollNoise > 0.62) {
      tile.feature = "atoll";
      tile.overlayAssetKey = "Atoll";
    }
  }

  if (tiles.some((tile) => tile.feature === "atoll") || candidates.length === 0) {
    return;
  }

  candidates.sort((a, b) => b.atollNoise - a.atollNoise);
  candidates[0].tile.feature = "atoll";
  candidates[0].tile.overlayAssetKey = "Atoll";
}

function serializeTerrain(tiles) {
  return tiles.map((tile) => ({
    col: tile.col,
    row: tile.row,
    terrainType: tile.isWater ? tile.waterType : tile.elevation === "mountain" ? "mountain" : tile.biome,
    biome: tile.isWater ? null : tile.biome,
    waterType: tile.isWater ? tile.waterType : null,
    elevation: tile.elevation,
    feature: tile.feature,
    isWater: tile.isWater,
    baseAssetKey: tile.baseAssetKey,
    overlayAssetKey: tile.overlayAssetKey,
  }));
}

export function generateHexTerrain({
  cols,
  rows,
  seed,
  protectedCenters = [],
}) {
  const normalizedSeed = (Number(seed) >>> 0) || 1;
  const rng = createSeededRandom(normalizedSeed);
  const tiles = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      tiles.push(createTerrainTile(col, row));
    }
  }

  const protectedIndices = markProtectedZones(protectedCenters, cols, rows);
  const seeds = {
    landMacroSeed: rng.nextFloat() * 10000,
    landDetailSeed: rng.nextFloat() * 10000,
    humiditySeed: rng.nextFloat() * 10000,
    temperatureSeed: rng.nextFloat() * 10000,
    elevationSeed: rng.nextFloat() * 10000,
    featureSeed: rng.nextFloat() * 10000,
  };

  applyLandmass(tiles, cols, rows, seeds, protectedIndices);
  applyClimate(tiles, cols, rows, seeds);
  applyElevation(tiles, cols, rows, seeds, protectedIndices);
  normalizeProtectedStarts(tiles, protectedIndices);
  ensureMountainPresence(tiles, cols, protectedIndices);
  classifyWaterTiles(tiles, cols, rows, rng);
  spawnAtolls(tiles, cols, rows, seeds, protectedIndices);

  return serializeTerrain(tiles);
}
