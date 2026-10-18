import type { OfficeLayout, PlacedFurniture } from '../../../../webview-ui/src/office/types.js';
import { Direction, TileType } from '../../../../webview-ui/src/office/types.js';
import { HOUSE_OF_LIFE_SIGNAL } from '../../grammar/signal.js';
import { houseOfWisdomGreybox as how } from '../houseOfWisdom/greybox.js';
import type { PersonaRoster } from '../personas.js';
import { egyptCostume } from './costumes.js';
import type { PointOfInterest, WorldDefinition } from '../types.js';

// The House of Life: a temple court in the Dendera manner (late Ptolemaic / early Roman), the
// temple's scriptorium. Its own floor plan (E2 look-dev, 2026-10-18) on the House of Wisdom's
// grid; the bake is assets/blender/temple.py. Offered in the World switcher as a preview.

/**
 * Twelve House of Life roles (all <= 10 characters), checked in E0b (research-e0.md, 2026-10-18).
 * Lector, Physician, Sculptor, Timekeeper and Astronomer are attested Egyptian offices; Draftsman
 * is the outline draughtsman. Architect, Surveyor, Archivist, Teacher, Copyist and Herbalist have
 * no attested title of their own, so they stay English function labels and never get hieroglyphs.
 */
const PERSONAS: PersonaRoster = {
  titles: [
    'Lector',
    'Astronomer',
    'Timekeeper',
    'Physician',
    'Architect',
    'Surveyor',
    'Copyist',
    'Archivist',
    'Teacher',
    'Sculptor',
    'Draftsman',
    'Herbalist',
  ],
  // Pupils' names with an opened attestation (E0b): Late/Ptolemaic bearers for each. Unattested
  // fillers were dropped; a repeat name gets a numeral, as in the House of Wisdom.
  apprentices: [
    'Nesmin',
    'Peteharpre',
    'Tai-Amun',
    'Harsiese',
    'Djedhor',
    'Ankh-Hor',
    'Nes-Khonsu',
  ],
  nouns: { agent: 'scribe', agents: 'scribes', subagent: 'pupil', subagents: 'pupils' },
};

const { UP, DOWN, LEFT, RIGHT } = Direction;
const COLS = 20;
const ROWS = 14;

/**
 * The temple court on the House of Wisdom's 20 x 14 grid (E2, 2026-10-18). North: the Hathor
 * facade of six columns (cols 5-14; behind it the roofed pronaos, out of bounds) between two
 * pairs of small chambers, each pair fronted by a lower Hathor colonnade running east and west. The seats moved
 * outwards from the House of Wisdom's cols 2/6/12/16 so the 15 m facade fits between them and no
 * column stands in a seat's sight line. The court: the pool of Nun with the pyramid model in the
 * middle (cols 7-12, rows 5-10), the granite obelisk pair on the planters' tiles, the two
 * overflow benches and the scroll chests where the shelves were. South: four scribes' places.
 *
 * Round F (2026-10-19): the pool moved one row south so a lane runs all round it: row 4 north,
 * row 11 south, cols 6 and 13 east and west (cols 5 and 14 too from row 5 to 9). Everything that
 * stood on that lane stands beside it now (lamp stands, papyrus, the middle south seats, the
 * benches), and scholars sometimes walk the whole ring (the 'circuit' point below).
 */
const FACADE = { col: 5, row: 3, w: 10 }; // the facade's footprint on the court (columns, bases)
const PRONAOS = { col0: 5, col1: 14, row0: 1, row1: 2 }; // the roofed hall behind it

function buildTiles(): TileType[] {
  const tiles: TileType[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const edge = row === 0 || row === ROWS - 1 || col === 0 || col === COLS - 1;
      const hall =
        col >= PRONAOS.col0 && col <= PRONAOS.col1 && row >= PRONAOS.row0 && row <= PRONAOS.row1;
      tiles.push(edge || hall ? TileType.WALL : TileType.FLOOR_1);
    }
  }
  return tiles;
}

function buildFurniture(): PlacedFurniture[] {
  const items: PlacedFurniture[] = [];
  const add = (uid: string, type: string, col: number, row: number) =>
    items.push({ uid, type, col, row });

  // Four north chambers, three metres each (two tiles): a scribe's table and the seat in front of
  // it, and a chest on the chamber's other tile, so nobody walks along row 2 through a partition.
  // The inner seats sit on the outer tile of their table, clear of the facade's end columns.
  for (const [desk, seat, chest] of [
    [1, 1, 2],
    [3, 4, 3],
    [15, 15, 16],
    [17, 18, 17],
  ]) {
    add(`alcove-n-${seat}-desk`, 'hl_desk', desk, 1);
    add(`alcove-n-${seat}-seat`, 'hl_seat', seat, 2);
    add(`chest-n-${chest}`, 'hl_chest', chest, 2);
  }
  // Four scribes' places along the south wall. The two middle ones stand at cols 4 and 14 rather
  // than the House of Wisdom's 6 and 12: row 11 is the pool's south walking lane (round F).
  for (const col of [2, 4, 14, 16]) {
    add(`alcove-s-${col}-desk`, 'hl_desk', col, 12);
    add(`alcove-s-${col}-seat`, 'hl_seat', col, 11);
  }
  // The two overflow benches in the court, one tile further out than they were so the lanes east
  // and west of the pool are two tiles wide (cols 5-6 and 13-14).
  for (const col of [3, 15]) {
    add(`court-${col}-desk`, 'hl_desk', col, 6);
    add(`court-${col}-seat-a`, 'hl_seat', col, 7);
    add(`court-${col}-seat-b`, 'hl_seat', col + 1, 7);
  }
  add('facade', 'hl_facade', FACADE.col, FACADE.row);
  add('pool', 'hl_pool', 7, 5);
  for (const [col, row] of [
    [1, 4],
    [1, 8],
    [18, 4],
    [18, 8],
  ]) {
    add(`shelf-${col}-${row}`, 'hl_shelf', col, row);
  }
  for (const [col, row] of [
    [3, 9],
    [16, 9],
  ]) {
    add(`obelisk-${col}-${row}`, 'hl_obelisk', col, row);
  }
  // The court's dressing (A2): offering tables at the obelisks' feet, lamp stands at the pool's
  // south corners, potted papyrus at its north corners and by the side walls, storage jars in the
  // south corners and beside the gate. Each blocks its tile; the paths and seats stay clear.
  for (const [col, row] of [
    [3, 8],
    [16, 8],
  ]) {
    add(`offering-${col}-${row}`, 'hl_offering', col, row);
  }
  for (const [col, row] of [
    [5, 10],
    [14, 10],
  ]) {
    add(`stand-${col}-${row}`, 'hl_stand', col, row);
  }
  for (const [col, row] of [
    [5, 4],
    [14, 4],
    [1, 6],
    [18, 6],
  ]) {
    add(`papyrus-${col}-${row}`, 'hl_papyrus', col, row);
  }
  for (const [col, row] of [
    [1, 12],
    [18, 12],
    [8, 12],
    [11, 12],
  ]) {
    add(`jars-${col}-${row}`, 'hl_jars', col, row);
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

// Where scribes stand to look at the pyramid model or an obelisk: both play a slow look-up; the
// director's table knows neither kind, so the POI says so.
const LOOK_UP = { clip: 'look_up', prop: null, sway: 0.35 } as const;
const POINTS_OF_INTEREST: PointOfInterest[] = [
  // the scroll chests at cols 1 and 18, rows 4-5 and 8-9 (the House of Wisdom's shelves)
  { id: 'shelf-w-4', group: 'shelf-w', kind: 'shelf', col: 2, row: 4, facing: LEFT },
  { id: 'shelf-w-5', group: 'shelf-w', kind: 'shelf', col: 2, row: 5, facing: LEFT },
  { id: 'shelf-e-4', group: 'shelf-e', kind: 'shelf', col: 17, row: 4, facing: RIGHT },
  { id: 'shelf-e-5', group: 'shelf-e', kind: 'shelf', col: 17, row: 5, facing: RIGHT },
  { id: 'scrolls-w-8', group: 'scrolls-w', kind: 'scrolls', col: 2, row: 8, facing: LEFT },
  { id: 'scrolls-w-9', group: 'scrolls-w', kind: 'scrolls', col: 2, row: 9, facing: LEFT },
  { id: 'scrolls-e-8', group: 'scrolls-e', kind: 'scrolls', col: 17, row: 8, facing: RIGHT },
  { id: 'scrolls-e-9', group: 'scrolls-e', kind: 'scrolls', col: 17, row: 9, facing: RIGHT },
  // the pool (cols 7-12, rows 5-10): the lane all round it; scholars look up at the pyramid from
  // its west, east and south sides
  {
    id: 'pyramid-w',
    group: 'pyramid',
    kind: 'pyramid',
    col: 6,
    row: 6,
    facing: RIGHT,
    activity: LOOK_UP,
  },
  {
    id: 'pyramid-e',
    group: 'pyramid',
    kind: 'pyramid',
    col: 13,
    row: 7,
    facing: LEFT,
    activity: LOOK_UP,
  },
  {
    id: 'pyramid-s',
    group: 'pyramid',
    kind: 'pyramid',
    col: 9,
    row: 11,
    facing: UP,
    activity: LOOK_UP,
  },
  {
    id: 'pyramid-s2',
    group: 'pyramid',
    kind: 'pyramid',
    col: 10,
    row: 11,
    facing: UP,
    activity: LOOK_UP,
  },
  // the obelisks at (3,9) and (16,9), seen from the south
  {
    id: 'obelisk-w',
    group: 'obelisk-w',
    kind: 'obelisk',
    col: 3,
    row: 10,
    facing: UP,
    activity: LOOK_UP,
  },
  {
    id: 'obelisk-e',
    group: 'obelisk-e',
    kind: 'obelisk',
    col: 16,
    row: 10,
    facing: UP,
    activity: LOOK_UP,
  },
  // two scribes meet in the north-west of the court, two more south-east of the pool
  {
    id: 'chat-n',
    group: 'chat-n',
    kind: 'converse',
    col: 3,
    row: 4,
    facing: RIGHT,
    partner: { col: 4, row: 4, facing: LEFT },
  },
  {
    id: 'chat-s',
    group: 'chat-s',
    kind: 'converse',
    col: 12,
    row: 11,
    facing: RIGHT,
    partner: { col: 13, row: 11, facing: LEFT },
  },
  // Round F: now and then one scholar walks the whole lane round the pool, pausing twice to look up
  // at the pyramid. The route's corners are the lane's corners; the director picks the stop
  // nearest the scholar to start from and goes round once (clockwise from there).
  {
    id: 'circle-pyramid',
    group: 'circle',
    kind: 'circuit',
    col: 6,
    row: 4,
    facing: DOWN,
    route: [
      { col: 6, row: 4, facing: DOWN },
      { col: 9, row: 4, facing: DOWN, look: true },
      { col: 13, row: 4, facing: DOWN },
      { col: 13, row: 7, facing: LEFT },
      { col: 13, row: 11, facing: UP },
      { col: 10, row: 11, facing: UP, look: true },
      { col: 6, row: 11, facing: UP },
      { col: 6, row: 7, facing: RIGHT },
    ],
  },
];

const M = 1 / 1.5; // look-dev poses are authored in metres; the scene is in tiles

const CATALOG: WorldDefinition['catalog'] = [
  {
    id: 'hl_desk',
    label: 'Scribe table',
    category: 'desks',
    width: 32,
    height: 16,
    footprintW: 2,
    footprintH: 1,
    isDesk: true,
  },
  {
    id: 'hl_seat',
    label: 'Reed mat',
    category: 'chairs',
    width: 16,
    height: 16,
    footprintW: 1,
    footprintH: 1,
    isDesk: false,
  },
  {
    id: 'hl_chest',
    label: 'Chest',
    category: 'storage',
    width: 16,
    height: 16,
    footprintW: 1,
    footprintH: 1,
    isDesk: false,
  },
  {
    id: 'hl_shelf',
    label: 'Scroll chest',
    category: 'storage',
    width: 16,
    height: 32,
    footprintW: 1,
    footprintH: 2,
    isDesk: false,
  },
  {
    id: 'hl_pool',
    label: 'Pool of Nun',
    category: 'decor',
    width: 96,
    height: 96,
    footprintW: 6,
    footprintH: 6,
    isDesk: false,
  },
  {
    id: 'hl_obelisk',
    label: 'Obelisk',
    category: 'decor',
    width: 16,
    height: 16,
    footprintW: 1,
    footprintH: 1,
    isDesk: false,
  },
  {
    id: 'hl_offering',
    label: 'Offering table',
    category: 'decor',
    width: 16,
    height: 16,
    footprintW: 1,
    footprintH: 1,
    isDesk: false,
  },
  {
    id: 'hl_stand',
    label: 'Lamp stand',
    category: 'decor',
    width: 16,
    height: 16,
    footprintW: 1,
    footprintH: 1,
    isDesk: false,
  },
  {
    id: 'hl_papyrus',
    label: 'Potted papyrus',
    category: 'decor',
    width: 16,
    height: 16,
    footprintW: 1,
    footprintH: 1,
    isDesk: false,
  },
  {
    id: 'hl_jars',
    label: 'Storage jars',
    category: 'storage',
    width: 16,
    height: 16,
    footprintW: 1,
    footprintH: 1,
    isDesk: false,
  },
  {
    id: 'hl_facade',
    label: 'Hathor facade',
    category: 'decor',
    width: 192,
    height: 16,
    footprintW: FACADE.w,
    footprintH: 1,
    isDesk: false,
  },
];

export const houseOfLifeGreybox: WorldDefinition = {
  id: 'house-of-life',
  // "(preview)" until Yousef approves the E2 look-dev stills; listed in the switcher again at his
  // request (2026-10-18)
  name: 'House of Life (preview)',
  floorPlan,
  board: null,
  personas: PERSONAS,
  pointsOfInterest: POINTS_OF_INTEREST,
  // the House of Wisdom's camera, so the two worlds compare frame for frame
  camera: how.camera,
  lookDev: {
    gobo: how.lookDev!.gobo,
    material: how.lookDev!.material,
    ui: how.lookDev!.ui,
    armillary: how.lookDev!.armillary,
    // three-quarter on the whole pyramid in its pool from the south-west, gold point and water
    // (look-dev poses stay 12 m out, the orbit's minimum: a long lens)
    pyramid: {
      pos: [8.4 * M, 5.4 * M, 23.1 * M],
      target: [15.0 * M, 1.7 * M, 12.0 * M],
      fov: 26,
    },
    // the glowing title over the door, from the court (round C)
    title: {
      pos: [17.6 * M, 4.4 * M, 17.0 * M],
      target: [15.0 * M, 3.85 * M, 4.97 * M],
      fov: 14,
    },
    // the water close (round C): low over the pool's south-east shelf, lilies and plinth
    water: {
      pos: [23.5 * M, 3.4 * M, 20.5 * M],
      target: [17.2 * M, -0.1 * M, 11.9 * M],
      fov: 22,
    },
    // the facade close (A2): three-quarter from the south-east on the Hathor capitals and the
    // title over the door, the pyramid's gold point in the foreground
    facade: {
      pos: [20.5 * M, 6.2 * M, 17.4 * M],
      target: [14.6 * M, 4.9 * M, 4.65 * M],
      fov: 34,
    },
    // the reliefs close (A2): the court's west wall from the court, its south half
    wall: {
      pos: [12.5 * M, 4.4 * M, 11.0 * M],
      target: [1.5 * M, 3.3 * M, 15.8 * M],
      fov: 32,
    },
    // into the Architects' chamber (alcove-n-4, x 4.65-7.5 m) from the court, a little east
    architects: {
      pos: [6.6 * M, 3.2 * M, 13.95 * M],
      target: [5.9 * M, 1.35 * M, 2.0 * M],
      fov: 22,
    },
  },
  signal: HOUSE_OF_LIFE_SIGNAL,
  // costumes: figures-egypt.glb (figures.py --world egypt), baked into this world's out/
  figures: 'figures-egypt.glb',
  costume: egyptCostume,
  // Six trims clear of the amethyst band (255-335 deg): the House of Wisdom's violet and magenta
  // give way to gold and azure.
  trimColors: ['#d11a3a', '#0fa59b', '#1fa24a', '#d9a521', '#2a9df4', '#f0501c'],
  render: {
    // no grille: the noon sun is baked whole, so there are no live shafts
    lightSourceNode: 'clerestory',
    castsShadow: /table|lamp|figure/i,
    // the pyramid stands still in its pool; its casing and gold take the room's reflection, dimmed
    // towards dusk, and PoolFx (round C) animates the water, the caustics and the lilies
    centrepiece: { moving: [], angles: () => ({}), envIntensity: (mix) => 0.12 - 0.09 * mix },
    poolFx: {
      waterNode: 'pool_water',
      causticMaterials: ['granite', 'poolstone'],
      lilyPrefix: 'lotus_',
      // the lamp stands beside the pool's south corners (tiles (5,10) and (14,10)), flame height
      lamps: [
        [8.25, 1.5, 15.75],
        [21.75, 1.5, 15.75],
      ],
    },
    // the title 𓉐𓋹 over the door glows royal blue and breathes
    titleGlow: { node: 'facade_title' },
  },
  catalog: CATALOG,
};
