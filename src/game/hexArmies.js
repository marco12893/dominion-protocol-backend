import { HEX_UNIT_PRODUCTION_CATALOG } from "./hexEconomy.js";

export const HEX_ARMY_MAX_SLOTS = 6;

function normalizeArmySlot(slot) {
  if (!slot || !HEX_UNIT_PRODUCTION_CATALOG[slot.variantId]) {
    return null;
  }

  const count = Math.max(0, Math.floor(Number(slot.count) || 0));
  if (count <= 0) {
    return null;
  }

  return {
    variantId: slot.variantId,
    count,
  };
}

export function normalizeHexArmySlots(slots = []) {
  if (!Array.isArray(slots)) {
    return [];
  }

  return slots
    .map(normalizeArmySlot)
    .filter(Boolean)
    .slice(0, HEX_ARMY_MAX_SLOTS);
}

export function getArmySlotCapacity(variantId) {
  const rawCapacity = Number(HEX_UNIT_PRODUCTION_CATALOG[variantId]?.slotCapacity);
  if (!Number.isFinite(rawCapacity) || rawCapacity <= 0) {
    return 0;
  }

  return Math.floor(rawCapacity);
}

export function normalizeHexArmy(army = {}) {
  const legacySlots = army.variantId
    ? [{ variantId: army.variantId, count: army.count ?? 1 }]
    : [];
  const slots = normalizeHexArmySlots(army.slots ?? legacySlots);
  const totalUnits = slots.reduce((sum, slot) => sum + slot.count, 0);
  const uniqueVariantCount = new Set(slots.map((slot) => slot.variantId)).size;
  const leadSlot = slots[0] ?? null;

  return {
    ...army,
    slots,
    variantId: leadSlot?.variantId ?? null,
    totalUnits,
    usedSlots: slots.length,
    uniqueVariantCount,
  };
}

export function cloneHexArmy(army) {
  return normalizeHexArmy(army);
}

export function getRemainingArmySlots(army, maxSlots = HEX_ARMY_MAX_SLOTS) {
  const normalizedArmy = normalizeHexArmy(army);
  return Math.max(0, maxSlots - normalizedArmy.usedSlots);
}

export function getMaxAddableUnits(army, variantId, maxSlots = HEX_ARMY_MAX_SLOTS) {
  const slotCapacity = getArmySlotCapacity(variantId);
  if (!slotCapacity) {
    return 0;
  }

  const normalizedArmy = normalizeHexArmy(army);
  const roomInMatchingSlots = normalizedArmy.slots.reduce((sum, slot) => {
    if (slot.variantId !== variantId) {
      return sum;
    }

    return sum + Math.max(0, slotCapacity - slot.count);
  }, 0);

  return roomInMatchingSlots + getRemainingArmySlots(normalizedArmy, maxSlots) * slotCapacity;
}

export function addUnitsToArmy(army, variantId, quantity, maxSlots = HEX_ARMY_MAX_SLOTS) {
  const slotCapacity = getArmySlotCapacity(variantId);
  const normalizedQuantity = Math.max(0, Math.floor(Number(quantity) || 0));
  if (!slotCapacity || normalizedQuantity <= 0) {
    return null;
  }

  if (normalizedQuantity > getMaxAddableUnits(army, variantId, maxSlots)) {
    return null;
  }

  const normalizedArmy = normalizeHexArmy(army);
  const nextSlots = normalizedArmy.slots.map((slot) => ({ ...slot }));
  let remaining = normalizedQuantity;

  for (const slot of nextSlots) {
    if (slot.variantId !== variantId || slot.count >= slotCapacity) {
      continue;
    }

    const freeCapacity = slotCapacity - slot.count;
    const addedCount = Math.min(freeCapacity, remaining);
    slot.count += addedCount;
    remaining -= addedCount;

    if (remaining <= 0) {
      break;
    }
  }

  while (remaining > 0) {
    if (nextSlots.length >= maxSlots) {
      return null;
    }

    const slotCount = Math.min(slotCapacity, remaining);
    nextSlots.push({ variantId, count: slotCount });
    remaining -= slotCount;
  }

  return normalizeHexArmy({
    ...normalizedArmy,
    slots: nextSlots,
  });
}
