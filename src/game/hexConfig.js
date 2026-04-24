export const HEX_GRID_COLS = 40;
export const HEX_GRID_ROWS = 30;
export const HEX_MOVEMENT_RANGE = 2;

export const HEX_CITIES = [
  { id: "city-blue", name: "Azure Crown", centerCol: 6, centerRow: 6, owner: "blue" },
  { id: "city-red", name: "Crimson Forge", centerCol: 33, centerRow: 22, owner: "red" },
];

export const INITIAL_HEX_UNITS = [
  { id: "hex-u1", col: 5, row: 4, owner: "blue", variantId: "rifleman" },
  { id: "hex-u2", col: 8, row: 8, owner: "blue", variantId: "antiTank" },
  { id: "hex-u3", col: 10, row: 6, owner: "blue", variantId: "lightTank" },
  { id: "hex-u4", col: 32, row: 21, owner: "red", variantId: "rifleman" },
  { id: "hex-u5", col: 35, row: 23, owner: "red", variantId: "antiTank" },
  { id: "hex-u6", col: 30, row: 24, owner: "red", variantId: "lightTank" },
];
