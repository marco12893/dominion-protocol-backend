import { FORMATION_SPACING } from "../config/gameConstants.js";

export function buildFormation(count, center) {
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const xOffset = ((columns - 1) * FORMATION_SPACING) / 2;
  const yOffset = ((rows - 1) * FORMATION_SPACING) / 2;

  return Array.from({ length: count }, (_value, index) => ({
    x: center.x + ((index % columns) * FORMATION_SPACING - xOffset),
    y: center.y + (Math.floor(index / columns) * FORMATION_SPACING - yOffset),
  }));
}

export function assignFormationSlots(units, slots) {
  const { sortedUnits, sortedSlots } = getFormationOrdering(units, slots);

  if (sortedUnits.length > 12) {
    return sortedUnits.map((unit, index) => ({
      unit,
      slot: sortedSlots[index],
    }));
  }

  const orderPenalty = FORMATION_SPACING * FORMATION_SPACING * 0.5;
  const assignment = findOptimalSlotAssignment(
    sortedUnits.map((unit, unitIndex) =>
      sortedSlots.map((slot, slotIndex) => {
        const dx = slot.x - unit.x;
        const dy = slot.y - unit.y;

        return (
          dx * dx +
          dy * dy +
          Math.abs(unitIndex - slotIndex) * orderPenalty
        );
      }),
    ),
  );

  return sortedUnits.map((unit, index) => ({
    unit,
    slot: sortedSlots[assignment[index]],
  }));
}

function getFormationOrdering(units, slots) {
  const unitCenter = getCenterPoint(units);
  const slotCenter = getCenterPoint(slots);
  const moveVector = {
    x: slotCenter.x - unitCenter.x,
    y: slotCenter.y - unitCenter.y,
  };
  const axis = getFormationAxis(moveVector);
  const sortedUnits = [...units].sort((left, right) =>
    compareFormationOrder(left, right, axis, unitCenter),
  );
  const sortedSlots = [...slots].sort((left, right) =>
    compareFormationOrder(left, right, axis, slotCenter),
  );

  return {
    sortedUnits,
    sortedSlots,
  };
}

function findOptimalSlotAssignment(costMatrix) {
  const memo = new Map();

  return solve(0, 0).assignment;

  function solve(unitIndex, usedMask) {
    if (unitIndex === costMatrix.length) {
      return {
        cost: 0,
        assignment: [],
      };
    }

    const key = `${unitIndex}:${usedMask}`;
    const cached = memo.get(key);

    if (cached) {
      return cached;
    }

    let best = {
      cost: Number.POSITIVE_INFINITY,
      assignment: [],
    };

    for (let slotIndex = 0; slotIndex < costMatrix[unitIndex].length; slotIndex += 1) {
      if ((usedMask & (1 << slotIndex)) !== 0) {
        continue;
      }

      const next = solve(unitIndex + 1, usedMask | (1 << slotIndex));
      const totalCost = costMatrix[unitIndex][slotIndex] + next.cost;

      if (totalCost >= best.cost) {
        continue;
      }

      best = {
        cost: totalCost,
        assignment: [slotIndex, ...next.assignment],
      };
    }

    memo.set(key, best);
    return best;
  }
}

function getCenterPoint(points) {
  const total = points.reduce(
    (sum, point) => ({
      x: sum.x + point.x,
      y: sum.y + point.y,
    }),
    { x: 0, y: 0 },
  );

  return {
    x: total.x / points.length,
    y: total.y / points.length,
  };
}

function getFormationAxis(moveVector) {
  if (Math.abs(moveVector.x) >= Math.abs(moveVector.y)) {
    return {
      primary: "y",
      secondary: "x",
      primaryDirection: moveVector.y >= 0 ? 1 : -1,
      secondaryDirection: moveVector.x >= 0 ? 1 : -1,
    };
  }

  return {
    primary: "x",
    secondary: "y",
    primaryDirection: moveVector.x >= 0 ? 1 : -1,
    secondaryDirection: moveVector.y >= 0 ? 1 : -1,
  };
}

function compareFormationOrder(left, right, axis, center) {
  const primaryDiff =
    (left[axis.primary] - center[axis.primary]) * axis.primaryDirection -
    (right[axis.primary] - center[axis.primary]) * axis.primaryDirection;

  if (Math.abs(primaryDiff) > 0.001) {
    return primaryDiff;
  }

  return (
    (left[axis.secondary] - center[axis.secondary]) * axis.secondaryDirection -
    (right[axis.secondary] - center[axis.secondary]) * axis.secondaryDirection
  );
}
