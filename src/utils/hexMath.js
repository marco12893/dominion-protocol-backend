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

// ─── Distance ────────────────────────────────────────────────────────────────

export function hexDistance(col1, row1, col2, row2) {
  const a = offsetToCube(col1, row1);
  const b = offsetToCube(col2, row2);
  return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.s - b.s));
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
