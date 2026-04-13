import { SPATIAL_HASH_CELL_SIZE } from "../config/gameConstants.js";

function getCellCoordinate(value, cellSize) {
  return Math.floor(value / cellSize);
}

function getCellKey(col, row) {
  return `${col}:${row}`;
}

export function createSpatialIndex(units, cellSize = SPATIAL_HASH_CELL_SIZE) {
  const buckets = new Map();
  const unitMap = new Map();
  const unitOrder = new Map();

  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index];
    unitMap.set(unit.id, unit);
    unitOrder.set(unit.id, index);

    const col = getCellCoordinate(unit.x, cellSize);
    const row = getCellCoordinate(unit.y, cellSize);
    const key = getCellKey(col, row);
    const bucket = buckets.get(key);

    if (bucket) {
      bucket.push(unit);
    } else {
      buckets.set(key, [unit]);
    }
  }

  return {
    cellSize,
    unitMap,
    unitOrder,
    getUnitById(unitId) {
      return unitMap.get(unitId) ?? null;
    },
    getUnitOrder(unitId) {
      return unitOrder.get(unitId) ?? -1;
    },
    forEachInRange(x, y, radius, callback) {
      const minCol = getCellCoordinate(x - radius, cellSize);
      const maxCol = getCellCoordinate(x + radius, cellSize);
      const minRow = getCellCoordinate(y - radius, cellSize);
      const maxRow = getCellCoordinate(y + radius, cellSize);

      for (let col = minCol; col <= maxCol; col += 1) {
        for (let row = minRow; row <= maxRow; row += 1) {
          const bucket = buckets.get(getCellKey(col, row));
          if (!bucket) {
            continue;
          }

          for (const unit of bucket) {
            callback(unit);
          }
        }
      }
    },
  };
}
