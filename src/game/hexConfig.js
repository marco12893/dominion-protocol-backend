export const HEX_GRID_COLS = 40;
export const HEX_GRID_ROWS = 30;
export const HEX_MOVEMENT_RANGE = 2;

export const HEX_CITIES = [
  { id: "city-blue", name: "Azure Crown", centerCol: 6, centerRow: 6, owner: "blue" },
  { id: "city-red", name: "Crimson Forge", centerCol: 33, centerRow: 22, owner: "red" },
];

export const INITIAL_HEX_UNITS = [
  { id: "hex-u1", col: 5, row: 4, owner: "blue", slots: [{ variantId: "rifleman", count: 18 }] },
  { id: "hex-u2", col: 8, row: 8, owner: "blue", slots: [{ variantId: "antiTank", count: 8 }] },
  { id: "hex-u3", col: 10, row: 6, owner: "blue", slots: [{ variantId: "lightTank", count: 5 }] },
  { id: "hex-u4", col: 32, row: 21, owner: "red", slots: [{ variantId: "rifleman", count: 18 }] },
  { id: "hex-u5", col: 35, row: 23, owner: "red", slots: [{ variantId: "antiTank", count: 8 }] },
  { id: "hex-u6", col: 30, row: 24, owner: "red", slots: [{ variantId: "lightTank", count: 5 }] },
];
