import type { OfficeLayout, PlacedFurniture } from '../../../../webview-ui/src/office/types.js';
import { Direction, TileType } from '../../../../webview-ui/src/office/types.js';
import { HOUSE_OF_WISDOM_SIGNAL } from '../../grammar/signal.js';
import { ARMILLARY_MOVING, armillaryAngles, armillaryEnvIntensity } from '../../world/armillary.js';
import type { PersonaRoster } from '../personas.js';
import type { PointOfInterest, WorldDefinition } from '../types.js';

const PERSONAS: PersonaRoster = {
  titles: [
    'Astronomer',
    'Geometer',
    'Translator',
    'Physician',
    'Librarian',
    'Sage',
    'Mapmaker',
    'Scribe',
    'Algebraist',
    'Grammarian',
    'Archivist',
    'Alchemist',
  ],
  apprentices: [
    'Yahya',
    'Ishaq',
    'Sahl',
    'Hasan',
    'Zayd',
    'Said',
    'Qusta',
    'Thabit',
    'Hunayn',
    'Jabir',
    'Rashid',
    'Faris',
  ],
  nouns: { agent: 'scholar', agents: 'scholars', subagent: 'apprentice', subagents: 'apprentices' },
};

const { UP, DOWN, LEFT, RIGHT } = Direction;

/** Where idle scholars like to be: stand on the tile, face the thing. All tiles are open floor. */
const POINTS_OF_INTEREST: PointOfInterest[] = [
  // Shelves at cols 1 and 18, rows 4-5 and 8-9: browse the upper pair, search the scroll racks below.
  { id: 'shelf-w-4', group: 'shelf-w', kind: 'shelf', col: 2, row: 4, facing: LEFT },
  { id: 'shelf-w-5', group: 'shelf-w', kind: 'shelf', col: 2, row: 5, facing: LEFT },
  { id: 'shelf-e-4', group: 'shelf-e', kind: 'shelf', col: 17, row: 4, facing: RIGHT },
  { id: 'shelf-e-5', group: 'shelf-e', kind: 'shelf', col: 17, row: 5, facing: RIGHT },
  { id: 'scrolls-w-8', group: 'scrolls-w', kind: 'scrolls', col: 2, row: 8, facing: LEFT },
  { id: 'scrolls-w-9', group: 'scrolls-w', kind: 'scrolls', col: 2, row: 9, facing: LEFT },
  { id: 'scrolls-e-8', group: 'scrolls-e', kind: 'scrolls', col: 17, row: 8, facing: RIGHT },
  { id: 'scrolls-e-9', group: 'scrolls-e', kind: 'scrolls', col: 17, row: 9, facing: RIGHT },
  // The armillary sphere stands at cols 9-10, rows 6-7: one tile out from its plinth, looking up.
  { id: 'armillary-w', group: 'armillary', kind: 'armillary', col: 8, row: 6, facing: RIGHT },
  { id: 'armillary-e', group: 'armillary', kind: 'armillary', col: 11, row: 7, facing: LEFT },
  { id: 'armillary-n', group: 'armillary', kind: 'armillary', col: 10, row: 5, facing: DOWN },
  { id: 'armillary-s', group: 'armillary', kind: 'armillary', col: 9, row: 8, facing: UP },
  // Palms at (8,4) and (11,4); the two planters at (3,9) and (16,9), beside the scroll racks.
  { id: 'palm-nw', group: 'palm-nw', kind: 'planter', col: 8, row: 3, facing: DOWN },
  { id: 'palm-ne', group: 'palm-ne', kind: 'planter', col: 11, row: 3, facing: DOWN },
  { id: 'planter-w', group: 'planter-w', kind: 'planter', col: 3, row: 10, facing: UP },
  { id: 'planter-e', group: 'planter-e', kind: 'planter', col: 16, row: 10, facing: UP },
  // Two scholars meet between the palms, two more in front of the armillary.
  {
    id: 'chat-n',
    group: 'chat-n',
    kind: 'converse',
    col: 9,
    row: 4,
    facing: RIGHT,
    partner: { col: 10, row: 4, facing: LEFT },
  },
  {
    id: 'chat-s',
    group: 'chat-s',
    kind: 'converse',
    col: 9,
    row: 9,
    facing: RIGHT,
    partner: { col: 10, row: 9, facing: LEFT },
  },
];

const COLS = 20;
const ROWS = 14;

function buildTiles(): TileType[] {
  const tiles: TileType[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const edge = row === 0 || row === ROWS - 1 || col === 0 || col === COLS - 1;
      tiles.push(edge ? TileType.WALL : TileType.FLOOR_1);
    }
  }
  return tiles;
}

function buildFurniture(): PlacedFurniture[] {
  const items: PlacedFurniture[] = [];
  const add = (uid: string, type: string, col: number, row: number) =>
    items.push({ uid, type, col, row });

  // Eight scholar alcoves: desks against the north and south walls, a cushion in front of each.
  for (const col of [2, 6, 12, 16]) {
    add(`alcove-n-${col}-desk`, 'hw_desk', col, 1);
    add(`alcove-n-${col}-seat`, 'hw_seat', col, 2);
    add(`alcove-s-${col}-desk`, 'hw_desk', col, 12);
    add(`alcove-s-${col}-seat`, 'hw_seat', col, 11);
  }
  // Courtyard study tables: overflow seating for extra sessions.
  for (const col of [4, 14]) {
    add(`court-${col}-desk`, 'hw_desk', col, 6);
    add(`court-${col}-seat-a`, 'hw_seat', col, 7);
    add(`court-${col}-seat-b`, 'hw_seat', col + 1, 7);
  }
  add('armillary', 'hw_armillary', 9, 6);
  for (const [col, row] of [
    [1, 4],
    [1, 8],
    [18, 4],
    [18, 8],
  ]) {
    add(`shelf-${col}-${row}`, 'hw_shelf', col, row);
  }
  // The two back palms flank the armillary; the front pair (lustre planters in the bake) stand
  // out by the scroll racks on the same row, leaving the centre to the instrument.
  for (const [col, row] of [
    [8, 4],
    [11, 4],
    [3, 9],
    [16, 9],
  ]) {
    add(`palm-${col}-${row}`, 'hw_palm', col, row);
  }
  return items;
}

const floorPlan: OfficeLayout = {
  version: 1,
  cols: COLS,
  rows: ROWS,
  tiles: buildTiles(),
  furniture: buildFurniture(),
  pets: [],
};

const M = 1 / 1.5; // the spike look-dev poses are in metres; the scene is in tiles

export const houseOfWisdomGreybox: WorldDefinition = {
  id: 'house-of-wisdom',
  name: 'House of Wisdom',
  floorPlan,
  // No in-world board for now (Yousef, 2026-10-15: too small, hard to read). It hung on the
  // north wall in the portal bay at { position: [10, 1.5, 1.04], rotationY: 0 }; set that back
  // (and its look-at points of interest at (9,2) and (10,2), facing UP) to bring it back.
  board: null,
  personas: PERSONAS,
  pointsOfInterest: POINTS_OF_INTEREST,
  // 22 deg lens, ~35 deg elevation, 34 tiles out: standing figures ~75 px at 1440x900, the hall
  // fills the width (the cutaway's outer edges just crop). Tuned by eye in Task 7b.
  camera: { position: [10, 20.1, 35.2], target: [10, 1, 7], fov: 22 },
  signal: HOUSE_OF_WISDOM_SIGNAL,
  lookDev: {
    gobo: { pos: [11.5 * M, 7.5 * M, 17.5 * M], target: [5.6 * M, 0.2 * M, 8.3 * M], fov: 30 },
    material: { pos: [15 * M, 8.5 * M, 22 * M], target: [15 * M, 3.2 * M, 3.5 * M], fov: 34 },
    ui: { pos: [10, 10.5, 15.5], target: [10, 0.7, 4.6], fov: 46 },
    // three-quarter on the armillary sphere from the south-east, a little above its horizon ring
    armillary: { pos: [21 * M, 5.2 * M, 18 * M], target: [15 * M, 2.4 * M, 10.5 * M], fov: 36 },
  },
  render: {
    // the west grille is where the gobo sun comes in
    lightSourceNode: 'grille_west',
    // only desks, lamps and figures cast (spike gotcha 9): walls and the grille are in the gobo
    castsShadow: /desk|lamp|cushion|figure|cedar|glaze|brass/i,
    centrepiece: {
      moving: ARMILLARY_MOVING,
      angles: armillaryAngles,
      envIntensity: armillaryEnvIntensity,
    },
  },
  catalog: [
    {
      id: 'hw_desk',
      label: 'Scholar desk',
      category: 'desks',
      width: 32,
      height: 16,
      footprintW: 2,
      footprintH: 1,
      isDesk: true,
    },
    {
      id: 'hw_seat',
      label: 'Cushion',
      category: 'chairs',
      width: 16,
      height: 16,
      footprintW: 1,
      footprintH: 1,
      isDesk: false,
    },
    {
      id: 'hw_shelf',
      label: 'Book shelf',
      category: 'storage',
      width: 16,
      height: 32,
      footprintW: 1,
      footprintH: 2,
      isDesk: false,
    },
    {
      id: 'hw_armillary',
      label: 'Armillary sphere',
      category: 'decor',
      width: 32,
      height: 32,
      footprintW: 2,
      footprintH: 2,
      isDesk: false,
    },
    {
      id: 'hw_palm',
      label: 'Date palm',
      category: 'decor',
      width: 16,
      height: 16,
      footprintW: 1,
      footprintH: 1,
      isDesk: false,
    },
  ],
};
