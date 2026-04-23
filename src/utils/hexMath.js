/**
 * Hex math utilities for flat-top hexagonal grids (backend copy).
 *
 * Only the pure math functions needed for server-side validation.
 * No pixel/rendering helpers.
 */

// ─── Offset ↔ Cube ──────────────────────────────────────────────────────────

export function offsetToCube(col, row) {
  const q = col;
  const r = row - (col - (col & 1)) / 2;
  const s = -q - r;
  return { q, r, s };
}

export function cubeToOffset(q, r) {
  const col = q;
  const row = r + (q - (q & 1)) / 2;
  return { col, row };
}

const CUBE_DIRECTIONS = [
  { q: 1, r: 0, s: -1 },
  { q: 1, r: -1, s: 0 },
  { q: 0, r: -1, s: 1 },
  { q: -1, r: 0, s: 1 },
  { q: -1, r: 1, s: 0 },
  { q: 0, r: 1, s: -1 },
];

// ─── Distance ────────────────────────────────────────────────────────────────

export function hexDistance(col1, row1, col2, row2) {
  const a = offsetToCube(col1, row1);
  const b = offsetToCube(col2, row2);
  return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.s - b.s));
}

export function getHexNeighbors(col, row, gridCols, gridRows) {
  const cube = offsetToCube(col, row);

  return CUBE_DIRECTIONS.map((dir) => {
    const neighbor = cubeToOffset(cube.q + dir.q, cube.r + dir.r);
    return neighbor;
  }).filter((neighbor) => {
    if (gridCols === undefined || gridRows === undefined) {
      return true;
    }

    return (
      neighbor.col >= 0 &&
      neighbor.col < gridCols &&
      neighbor.row >= 0 &&
      neighbor.row < gridRows
    );
  });
}

// ─── Range query ─────────────────────────────────────────────────────────────

export function getHexesInRange(centerCol, centerRow, range, gridCols, gridRows) {
  const center = offsetToCube(centerCol, centerRow);
  const results = [];

  for (let dq = -range; dq <= range; dq++) {
    for (let dr = Math.max(-range, -dq - range); dr <= Math.min(range, -dq + range); dr++) {
      const ds = -dq - dr;
      const q = center.q + dq;
      const r = center.r + dr;
      const off = cubeToOffset(q, r);

      if (gridCols !== undefined && gridRows !== undefined) {
        if (off.col < 0 || off.col >= gridCols || off.row < 0 || off.row >= gridRows) {
          continue;
        }
      }

      results.push(off);
    }
  }

  return results;
}

export function getTraversableHexesInRange(
  centerCol,
  centerRow,
  range,
  gridCols,
  gridRows,
  isPassable,
) {
  const visited = new Set([`${centerCol},${centerRow}`]);
  const frontier = [{ col: centerCol, row: centerRow, distance: 0 }];
  const results = [];

  while (frontier.length > 0) {
    const current = frontier.shift();
    if (current.distance >= range) {
      continue;
    }

    for (const neighbor of getHexNeighbors(current.col, current.row, gridCols, gridRows)) {
      const key = `${neighbor.col},${neighbor.row}`;
      if (visited.has(key)) {
        continue;
      }

      if (typeof isPassable === "function" && !isPassable(neighbor.col, neighbor.row, current.distance + 1)) {
        continue;
      }

      visited.add(key);
      results.push(neighbor);
      frontier.push({
        col: neighbor.col,
        row: neighbor.row,
        distance: current.distance + 1,
      });
    }
  }

  return results;
}
