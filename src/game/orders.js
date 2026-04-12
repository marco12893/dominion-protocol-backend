export function createOrderController({ assignUnitPath }) {
  function executeOrder(unit, order) {
    if (order.type === "move") {
      unit.attackTargetId = null;
      unit.isAttackMove = false;
      unit.isHoldingPosition = false;
      unit.loiterCenter = null;
      assignUnitPath(unit, order.position);
    } else if (order.type === "attack") {
      unit.attackTargetId = order.targetId;
      unit.isAttackMove = false;
      unit.isHoldingPosition = false;
      unit.loiterCenter = null;
      unit.path = [];
      unit.targetX = unit.x;
      unit.targetY = unit.y;
      unit.destinationX = unit.x;
      unit.destinationY = unit.y;
      unit.isMoving = false;
    } else if (order.type === "attackMove") {
      unit.attackTargetId = null;
      unit.isAttackMove = true;
      unit.isHoldingPosition = false;
      assignUnitPath(unit, order.position);
      unit.attackMoveDestinationX = unit.destinationX;
      unit.attackMoveDestinationY = unit.destinationY;
      unit.loiterCenter = { x: unit.destinationX, y: unit.destinationY };
    } else if (order.type === "stop") {
      unit.attackTargetId = null;
      unit.isAttackMove = false;
      unit.isHoldingPosition = false;
      unit.loiterCenter = null;
      unit.path = [];
      unit.targetX = unit.x;
      unit.targetY = unit.y;
      unit.destinationX = unit.x;
      unit.destinationY = unit.y;
      unit.isMoving = false;
    } else if (order.type === "holdPosition") {
      unit.attackTargetId = null;
      unit.isAttackMove = false;
      unit.isHoldingPosition = true;
      unit.loiterCenter = null;
      unit.path = [];
      unit.targetX = unit.x;
      unit.targetY = unit.y;
      unit.destinationX = unit.x;
      unit.destinationY = unit.y;
      unit.isMoving = false;
    }
  }

  function processUnitOrder(unit, order, isQueued) {
    const isIdle = !unit.isMoving && !unit.attackTargetId && !unit.isHoldingPosition;
    if (!isQueued) {
      unit.orderQueue = [];
      executeOrder(unit, order);
      return;
    }

    if (isIdle && unit.orderQueue.length === 0) {
      executeOrder(unit, order);
      return;
    }

    unit.orderQueue.push(order);
  }

  return {
    executeOrder,
    processUnitOrder,
  };
}
