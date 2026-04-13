export const PORT = Number(process.env.PORT ?? 10000);
export const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? "http://localhost:3000";
export const MAP_WIDTH = 3200;
export const MAP_HEIGHT = 3200;
export const TICK_RATE = 60;
export const WORLD_STATE_BROADCAST_INTERVAL_TICKS = 2;
export const UNIT_SPEED = 180;
export const FORMATION_SPACING = 28;
export const UNIT_RADIUS = 10;
export const COLLISION_PASSES = 3;
export const CELL_SIZE = 24;
export const PUSH_WEIGHT_IDLE = 0.35;
export const PUSH_WEIGHT_MOVING = 1;
export const STARTING_RESOURCES = 8000;
export const DEPLOYMENT_GRID_COLS = 5;
export const DEPLOYMENT_GRID_SPACING = 50;
export const STUCK_MOVEMENT_EPSILON = 1.1;
export const STUCK_PROGRESS_EPSILON = 0.75;
export const STUCK_TICKS_THRESHOLD = 18;
export const REPATH_COOLDOWN_TICKS = 12;
export const SPATIAL_HASH_CELL_SIZE = 120;

export const UNIT_CLASSES = {
  UNARMORED: "unarmored",
  ARMORED: "armored",
  HELICOPTER: "helicopter",
  PLANE: "plane",
};

export const PLANE_LOITER_RADIUS = 300;
export const PLANE_TURN_SPEED = 1.5;
export const PLANE_BURST_COUNT = 4;
export const PLANE_BURST_COOLDOWN = 0.1;
export const PLANE_RELOAD_COOLDOWN = 6.0;
export const PLANE_SHOOTING_CONE = Math.PI / 5;
export const PLANE_AIRSPACE_MARGIN = 600;
export const PLANE_AIRSPACE_TARGET_BUFFER = 120;
export const PLANE_ATTACK_RUN_EXTENSION = 220;
export const PLANE_LINEUP_DISTANCE = 180;
export const PLANE_LINEUP_LATERAL = 90;
export const PLANE_BREAKAWAY_DISTANCE = 260;
export const PLANE_BREAKAWAY_LATERAL = 140;
export const PLANE_MIN_ATTACK_SEPARATION = 110;
export const PLANE_LEAD_TIME_MIN = 0.15;
export const PLANE_LEAD_TIME_MAX = 0.85;
export const PLANE_ATTACK_MOVE_RADIUS = 280;
export const PLANE_ATTACK_MOVE_LEASH = 520;
export const BOMBER_RELOAD_COOLDOWN = 15.0;
export const BOMBER_DROP_RANGE = 70;
export const BOMBER_SPLASH_RADIUS = 95;
export const BOMBER_EGRESS_DISTANCE = 950;
export const BOMBER_EGRESS_LATERAL = 180;
export const BOMBER_REENGAGE_COOLDOWN = 4.5;

export const OBSTACLES = [
  { id: "rock-1", x: 640, y: 510, width: 350, height: 290 },
  { id: "rock-2", x: 1470, y: 1250, width: 320, height: 440 },
  { id: "rock-3", x: 2190, y: 890, width: 420, height: 300 },
  { id: "rock-4", x: 850, y: 2350, width: 480, height: 290 },
];

export const UNIT_VARIANTS = {
  rifleman: {
    unitClass: UNIT_CLASSES.UNARMORED,
    maxHealth: 100,
    attackDamage: 10,
    attackRange: 120,
    attackCooldown: 0.5,
    defense: 0,
    speed: 180,
    cost: 100,
    damageModifiers: {
      [UNIT_CLASSES.UNARMORED]: 1.0,
      [UNIT_CLASSES.ARMORED]: 0.15,
      [UNIT_CLASSES.HELICOPTER]: 0.0,
      [UNIT_CLASSES.PLANE]: 0.0,
    },
    canTarget: [UNIT_CLASSES.UNARMORED, UNIT_CLASSES.ARMORED],
  },
  armoredCar: {
    unitClass: UNIT_CLASSES.ARMORED,
    maxHealth: 150,
    attackDamage: 20,
    attackRange: 140,
    attackCooldown: 0.6,
    defense: 6,
    speed: 230,
    cost: 500,
    damageModifiers: {
      [UNIT_CLASSES.UNARMORED]: 1.0,
      [UNIT_CLASSES.ARMORED]: 0.25,
      [UNIT_CLASSES.HELICOPTER]: 0.0,
      [UNIT_CLASSES.PLANE]: 0.0,
    },
    canTarget: [UNIT_CLASSES.UNARMORED, UNIT_CLASSES.ARMORED],
  },
  lightTank: {
    unitClass: UNIT_CLASSES.ARMORED,
    maxHealth: 300,
    attackDamage: 50,
    attackRange: 180,
    attackCooldown: 1.2,
    defense: 3,
    speed: 280,
    cost: 850,
    damageModifiers: {
      [UNIT_CLASSES.UNARMORED]: 0.35,
      [UNIT_CLASSES.ARMORED]: 1.0,
      [UNIT_CLASSES.HELICOPTER]: 0.0,
      [UNIT_CLASSES.PLANE]: 0.0,
    },
    canTarget: [UNIT_CLASSES.UNARMORED, UNIT_CLASSES.ARMORED],
  },
  heavyTank: {
    unitClass: UNIT_CLASSES.ARMORED,
    maxHealth: 800,
    attackDamage: 160,
    attackRange: 280,
    attackCooldown: 2.5,
    defense: 10,
    speed: 130,
    cost: 1500,
    damageModifiers: {
      [UNIT_CLASSES.UNARMORED]: 0.35,
      [UNIT_CLASSES.ARMORED]: 1.0,
      [UNIT_CLASSES.HELICOPTER]: 0.0,
      [UNIT_CLASSES.PLANE]: 0.0,
    },
    canTarget: [UNIT_CLASSES.UNARMORED, UNIT_CLASSES.ARMORED],
  },
  antiTank: {
    unitClass: UNIT_CLASSES.UNARMORED,
    maxHealth: 100,
    attackDamage: 45,
    attackRange: 160,
    attackCooldown: 2.0,
    defense: 0,
    speed: 140,
    cost: 250,
    damageModifiers: {
      [UNIT_CLASSES.UNARMORED]: 0.25,
      [UNIT_CLASSES.ARMORED]: 1.0,
      [UNIT_CLASSES.HELICOPTER]: 1.0,
      [UNIT_CLASSES.PLANE]: 0.0,
    },
    canTarget: [UNIT_CLASSES.UNARMORED, UNIT_CLASSES.ARMORED, UNIT_CLASSES.HELICOPTER],
  },
  fighter: {
    unitClass: UNIT_CLASSES.PLANE,
    maxHealth: 100,
    attackDamage: 32,
    attackRange: 280,
    attackCooldown: PLANE_RELOAD_COOLDOWN,
    defense: 0,
    speed: 420,
    cost: 1000,
    damageModifiers: {
      [UNIT_CLASSES.UNARMORED]: 0.7,
      [UNIT_CLASSES.ARMORED]: 0.3,
      [UNIT_CLASSES.HELICOPTER]: 1.0,
      [UNIT_CLASSES.PLANE]: 1.0,
    },
    canTarget: [UNIT_CLASSES.UNARMORED, UNIT_CLASSES.ARMORED, UNIT_CLASSES.HELICOPTER, UNIT_CLASSES.PLANE],
  },
  bomber: {
    unitClass: UNIT_CLASSES.PLANE,
    maxHealth: 200,
    attackDamage: 220,
    attackRange: BOMBER_DROP_RANGE,
    engagementRange: 280,
    attackCooldown: BOMBER_RELOAD_COOLDOWN,
    defense: 8,
    speed: 300,
    cost: 1800,
    damageModifiers: {
      [UNIT_CLASSES.UNARMORED]: 1.2,
      [UNIT_CLASSES.ARMORED]: 1.0,
      [UNIT_CLASSES.HELICOPTER]: 0.0,
      [UNIT_CLASSES.PLANE]: 0.0,
    },
    canTarget: [UNIT_CLASSES.UNARMORED, UNIT_CLASSES.ARMORED],
  },
  antiAir: {
    unitClass: UNIT_CLASSES.ARMORED,
    maxHealth: 140,
    attackDamage: 50,
    attackRange: 320,
    attackCooldown: 1.2,
    defense: 2,
    speed: 160,
    cost: 350,
    damageModifiers: {
      [UNIT_CLASSES.UNARMORED]: 0.0,
      [UNIT_CLASSES.ARMORED]: 0.0,
      [UNIT_CLASSES.HELICOPTER]: 1.0,
      [UNIT_CLASSES.PLANE]: 1.0,
    },
    canTarget: [UNIT_CLASSES.PLANE, UNIT_CLASSES.HELICOPTER],
  },
  attackHelicopter: {
    unitClass: UNIT_CLASSES.HELICOPTER,
    maxHealth: 150,
    attackDamage: 15,
    attackRange: 160,
    attackCooldown: 0.25,
    defense: 1,
    speed: 180,
    cost: 700,
    damageModifiers: {
      [UNIT_CLASSES.UNARMORED]: 1.0,
      [UNIT_CLASSES.ARMORED]: 0.5,
      [UNIT_CLASSES.HELICOPTER]: 0.5,
      [UNIT_CLASSES.PLANE]: 0.0,
    },
    canTarget: [UNIT_CLASSES.UNARMORED, UNIT_CLASSES.ARMORED, UNIT_CLASSES.HELICOPTER],
  },
};
