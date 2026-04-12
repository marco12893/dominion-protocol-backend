import {
  CELL_SIZE,
  MAP_HEIGHT,
  MAP_WIDTH,
  OBSTACLES,
  UNIT_RADIUS,
} from "../config/gameConstants.js";
import { clamp } from "../utils/math.js";

const GRID_COLUMNS = Math.ceil(MAP_WIDTH / CELL_SIZE);
const GRID_ROWS = Math.ceil(MAP_HEIGHT / CELL_SIZE);
const WALKABLE_GRID = buildWalkableGrid();

export function pointToCell(x, y) {
  return {
    col: clamp(Math.floor(x / CELL_SIZE), 0, GRID_COLUMNS - 1),
    row: clamp(Math.floor(y / CELL_SIZE), 0, GRID_ROWS - 1),
  };
}

export function cellToPoint(col, row) {
  return {
    x: clamp(col * CELL_SIZE + CELL_SIZE / 2, UNIT_RADIUS, MAP_WIDTH - UNIT_RADIUS),
    y: clamp(row * CELL_SIZE + CELL_SIZE / 2, UNIT_RADIUS, MAP_HEIGHT - UNIT_RADIUS),
  };
}

export function findNearestWalkableCell(position) {
  const origin = pointToCell(position.x, position.y);

  if (isWalkable(origin.col, origin.row)) {
    return origin;
  }

  const visited = new Set([cellKey(origin.col, origin.row)]);
  const queue = [origin];

  while (queue.length > 0) {
    const current = queue.shift();

    for (const neighbor of getNeighbors(current.col, current.row, false)) {
      const key = cellKey(neighbor.col, neighbor.row);

      if (visited.has(key)) {
        continue;
      }

      if (isWalkable(neighbor.col, neighbor.row)) {
        return neighbor;
      }

      visited.add(key);
      queue.push(neighbor);
    }
  }

  return null;
}

export function findPath(start, goal) {
  const openSet = [start];
  const cameFrom = new Map();
  const gScore = new Map([[cellKey(start.col, start.row), 0]]);
  const fScore = new Map([[cellKey(start.col, start.row), heuristic(start, goal)]]);

  while (openSet.length > 0) {
    openSet.sort(
      (left, right) =>
        (fScore.get(cellKey(left.col, left.row)) ?? Number.POSITIVE_INFINITY) -
        (fScore.get(cellKey(right.col, right.row)) ?? Number.POSITIVE_INFINITY),
    );

    const current = openSet.shift();
    const currentKey = cellKey(current.col, current.row);

    if (current.col === goal.col && current.row === goal.row) {
      return reconstructPath(cameFrom, current);
    }

    for (const neighbor of getNeighbors(current.col, current.row, true)) {
      if (!isWalkable(neighbor.col, neighbor.row)) {
        continue;
      }

      const neighborKey = cellKey(neighbor.col, neighbor.row);
      const tentativeGScore =
        (gScore.get(currentKey) ?? Number.POSITIVE_INFINITY) + neighbor.cost;

      if (tentativeGScore >= (gScore.get(neighborKey) ?? Number.POSITIVE_INFINITY)) {
        continue;
      }

      cameFrom.set(neighborKey, current);
      gScore.set(neighborKey, tentativeGScore);
      fScore.set(neighborKey, tentativeGScore + heuristic(neighbor, goal));

      if (!openSet.some((entry) => entry.col === neighbor.col && entry.row === neighbor.row)) {
        openSet.push({ col: neighbor.col, row: neighbor.row });
      }
    }
  }

  return null;
}

export function smoothPath(points) {
  if (points.length <= 2) {
    return points;
  }

  const smoothed = [points[0]];
  let anchorIndex = 0;

  while (anchorIndex < points.length - 1) {
    let furthestVisibleIndex = anchorIndex + 1;

    for (let candidateIndex = anchorIndex + 1; candidateIndex < points.length; candidateIndex += 1) {
      if (!hasLineOfSight(points[anchorIndex], points[candidateIndex])) {
        break;
      }

      furthestVisibleIndex = candidateIndex;
    }

    smoothed.push(points[furthestVisibleIndex]);
    anchorIndex = furthestVisibleIndex;
  }

  return smoothed;
}

export function expandObstacle(obstacle, padding) {
  return {
    x: obstacle.x - padding,
    y: obstacle.y - padding,
    width: obstacle.width + padding * 2,
    height: obstacle.height + padding * 2,
  };
}

export function isPointInsideRect(x, y, rect) {
  return (
    x >= rect.x &&
    x <= rect.x + rect.width &&
    y >= rect.y &&
    y <= rect.y + rect.height
  );
}

function buildWalkableGrid() {
  return Array.from({ length: GRID_ROWS }, (_rowValue, row) =>
    Array.from({ length: GRID_COLUMNS }, (_colValue, col) => isCellWalkable(col, row)),
  );
}

function isCellWalkable(col, row) {
  const point = cellToPoint(col, row);

  return !OBSTACLES.some((obstacle) =>
    isPointInsideRect(point.x, point.y, expandObstacle(obstacle, UNIT_RADIUS)),
  );
}

function reconstructPath(cameFrom, current) {
  const path = [current];
  let cursor = current;

  while (cameFrom.has(cellKey(cursor.col, cursor.row))) {
    cursor = cameFrom.get(cellKey(cursor.col, cursor.row));
    path.unshift(cursor);
  }

  return path;
}

function getNeighbors(col, row, allowDiagonal) {
  const directions = allowDiagonal
    ? [
        { col: -1, row: 0, cost: 1 },
        { col: 1, row: 0, cost: 1 },
        { col: 0, row: -1, cost: 1 },
        { col: 0, row: 1, cost: 1 },
        { col: -1, row: -1, cost: Math.SQRT2 },
        { col: 1, row: -1, cost: Math.SQRT2 },
        { col: -1, row: 1, cost: Math.SQRT2 },
        { col: 1, row: 1, cost: Math.SQRT2 },
      ]
    : [
        { col: -1, row: 0, cost: 1 },
        { col: 1, row: 0, cost: 1 },
        { col: 0, row: -1, cost: 1 },
        { col: 0, row: 1, cost: 1 },
      ];

  return directions
    .map((direction) => ({
      col: col + direction.col,
      row: row + direction.row,
      cost: direction.cost,
    }))
    .filter((neighbor) => isWithinGrid(neighbor.col, neighbor.row))
    .filter((neighbor) => {
      if (!allowDiagonal || neighbor.col === col || neighbor.row === row) {
        return true;
      }

      return (
        isWalkable(col, neighbor.row) &&
        isWalkable(neighbor.col, row)
      );
    });
}

function isWithinGrid(col, row) {
  return col >= 0 && row >= 0 && col < GRID_COLUMNS && row < GRID_ROWS;
}

function isWalkable(col, row) {
  return Boolean(WALKABLE_GRID[row]?.[col]);
}

function heuristic(from, to) {
  return Math.hypot(to.col - from.col, to.row - from.row);
}

function cellKey(col, row) {
  return `${col}:${row}`;
}

function hasLineOfSight(start, end) {
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const steps = Math.max(1, Math.ceil(distance / (CELL_SIZE / 3)));

  for (let step = 0; step <= steps; step += 1) {
    const ratio = step / steps;
    const x = start.x + (end.x - start.x) * ratio;
    const y = start.y + (end.y - start.y) * ratio;

    if (OBSTACLES.some((obstacle) => isPointInsideRect(x, y, expandObstacle(obstacle, UNIT_RADIUS)))) {
      return false;
    }
  }

  return true;
}
