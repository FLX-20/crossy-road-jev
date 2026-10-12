// Every tunable constant of the simulation. Units: cells (1 cell = 1 column = 1 row) and seconds.
// The simulation runs at a fixed 60 ticks per second in every environment (browser, server, tests).

export const TICK_RATE = 60;

// Playable columns are -4..4 (9 cells), as in the original. The world is drawn wider and darkened at the sides.
export const COL_MIN = -4;
export const COL_MAX = 4;
export const VIEW_HALF = 11;
// A log carrying the player beyond this |x| kills them (carried off screen).
export const CARRY_LIMIT = 4.6;

export const HOP_TICKS = 9; // 0.15 s per hop
export const PLAYER_HALF = 0.3; // half-width of the player's hitbox
export const LAND_TOLERANCE = 0.2; // how far past a log's end a landing still counts as on the log

// Start area: rows 0..-3 are grass, row -4 and below are a solid tree wall.
export const START_WALL_ROW = -4;

// Camera and eagle. The camera starts creeping forward after the first move and catches up when the
// player is ahead. Falling EAGLE_ROWS behind the camera row (the bottom of the screen) calls the eagle.
// Standing still therefore brings the eagle after ~(EAGLE_ROWS / CAM_BASE_SPEED) ≈ 7.5 s, like the original.
export const CAM_BASE_SPEED = 0.55; // rows per second
export const CAM_CATCHUP = 2.0; // per second, proportional to how far ahead the player is
export const EAGLE_ROWS = 4;

// Moving lanes wrap around a span of this many cells centered on x = 0.
export const LANE_PERIOD = 30;

// Difficulty ramps from 0 at row 0 to 1 at DIFFICULTY_ROWS and stays there.
export const DIFFICULTY_ROWS = 160;

export const ROAD = {
  carLen: 1.3,
  truckLens: [2.3, 2.9],
  carSpeed: [1.6, 4.2], // cells/s at difficulty 0 and 1 (randomized ±25% per lane)
  truckFactor: 0.7,
  minGap: 2.6,
  extraGap: [7, 2.5], // extra random gap at difficulty 0 and 1
  truckChance: 0.3,
  colors: ['#e5413a', '#2f80ed', '#f2c94c', '#27ae60', '#9b51e0', '#f2994a', '#56ccf2', '#eb5757'],
  truckColors: ['#f2f2f2', '#2f80ed', '#e5413a', '#27ae60'],
};

export const RIVER = {
  logLens: [2, 4], // integer lengths in cells
  logSpeed: [0.9, 2.1],
  minGap: 1.2,
  extraGap: [1.6, 2.6],
  padChance: 0.22, // chance a river lane is static lily pads instead of logs
};

export const RAIL = {
  speed: 34, // cells/s
  warnSeconds: 1.0, // signal flashes this long before the front enters the view (+ ~0.4 s travel)
  period: [8.5, 4.5], // seconds between trains at difficulty 0 and 1 (randomized ±1 s)
  edge: VIEW_HALF + 3, // trains enter and leave this far from the center
  locoLen: 3.2,
  carLen: 3.0,
  cars: [3, 6],
};

export const GRASS = {
  treeChance: [0.12, 0.28], // per playable cell, at difficulty 0 and 1
  minOpen: 3,
  coinChance: 0.09,
};

export const COIN_CHANCE_ROAD = 0.07;

export const MOVES = ['up', 'down', 'left', 'right'];
export const ACTIONS = ['up', 'down', 'left', 'right', 'wait'];
