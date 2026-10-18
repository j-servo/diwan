import type { LoadedAssetData } from '../../../webview-ui/src/office/layout/furnitureCatalog.js';
import type { Direction, OfficeLayout } from '../../../webview-ui/src/office/types.js';

import type { Clip, Prop } from '../agents/clipFor.js';
import type { CostumeFn } from '../agents/figureLogic.js';
import type { Signal } from '../grammar/signal.js';
import type { Vec3 } from '../scene/coords.js';
import type { WorldAssetMeta } from './assetMeta.js';
import type { PersonaRoster } from './personas.js';

/** Where the in-world message board hangs (centre, facing direction). */
export interface BoardPlacement {
  position: Vec3;
  rotationY: number;
}

/** Default camera pose (world units = tiles). Used for skinned worlds; the grey box keeps M0's. */
export interface CameraPose {
  position: Vec3;
  target: Vec3;
  fov: number;
}

/** A world's baked asset set, with every file name in the meta resolved to a served URL. */
export type WorldAssets = WorldAssetMeta & {
  baseUrl: string;
  resolve: (file: string) => string;
};

/** The kinds the idle director knows; a world may name more and give them an `activity`. */
export type BuiltinPoiKind =
  'shelf' | 'scrolls' | 'armillary' | 'board' | 'planter' | 'converse' | 'circuit';
/** What an idle scholar does at a point of interest. */
export type PoiKind = BuiltinPoiKind | (string & {});

/** What an agent plays at a point of interest (clip and prop names from the figures GLB). */
export interface PoiActivity {
  clip: Clip;
  prop: Prop | null;
  /** Radians of slow head sway while doing it (0 = none). */
  sway: number;
}

/** One stop on a circuit: the tile to reach, the way to face, and whether to pause and look up. */
export interface RouteStop {
  col: number;
  row: number;
  facing: Direction;
  /** Pause here and play the world's look-up clip. */
  look?: boolean;
}

/** A place idle scholars like to be: the tile to stand on, the way to face, what to do there. */
export interface PointOfInterest {
  id: string;
  kind: PoiKind;
  /** The spot this tile belongs to (a shelf run, the armillary...): at most two scholars per group. */
  group: string;
  col: number;
  row: number;
  /** Direction to face once there (towards the shelf, armillary, board, plant or conversation partner). */
  facing: Direction;
  /** Standing room, 1 or 2 (default 1: two figures on one tile would overlap). */
  capacity?: number;
  /** For a kind the director does not know (a world's own): what to play there. */
  activity?: PoiActivity;
  /** circuit only: the stops of a walk all round something, in order (the director goes round once). */
  route?: RouteStop[];
  /** converse only: where the second speaker stands. */
  partner?: { col: number; row: number; facing: Direction };
}

/** A look-dev camera pose in tiles. */
export interface LookDevPose {
  pos: Vec3;
  target: Vec3;
  fov: number;
}

/**
 * The look-dev poses a world defines beyond `wide` (its default camera) and the lamp-based ones;
 * the House of Life adds its pyramid and Architects' chamber stills.
 */
export type LookDevPoses = Record<'gobo' | 'material' | 'ui' | 'armillary', LookDevPose> &
  Partial<Record<'pyramid' | 'architects' | 'facade' | 'wall' | 'title' | 'water', LookDevPose>>;

/**
 * The animated centrepiece's motion: named nodes of its own GLB, each turned about its local +Y.
 * `angles(t)` has an entry for every `moving` node.
 */
export interface CentrepieceMotion {
  moving: readonly string[];
  angles: (t: number) => Record<string, number>;
  /** Reflection strength of its metal for a mood mix (0 golden .. 1 dusk). */
  envIntensity: (mix: number) => number;
}

/**
 * The pool of Nun's life (the House of Life): nodes and materials of its centrepiece GLB that the
 * runtime animates on the engine clock. The water gets its own shader, the named stone materials
 * caustics, the lily nodes a slow bob.
 */
export interface PoolFxConfig {
  /** The water sheet's node. */
  waterNode: string;
  /** Materials that catch caustics below the water line. */
  causticMaterials: readonly string[];
  /** Node-name prefix of the floating lilies. */
  lilyPrefix: string;
  /** Lamp flames that glint on the water at dusk, hall metres. */
  lamps: readonly (readonly [number, number, number])[];
}

/** How the scene treats this world's baked hall. */
export interface WorldRender {
  /** The hall node the sun shafts start from (a grille, a clerestory slot). */
  lightSourceNode: string;
  /** Node and material names that cast shadows (spike gotcha 9). */
  castsShadow: RegExp;
  centrepiece?: CentrepieceMotion;
  /** The centrepiece's pool: water shader, caustics, lilies (the House of Life). */
  poolFx?: PoolFxConfig;
  /** A hall node whose emissive map glows and breathes (the House of Life's title). */
  titleGlow?: { node: string };
}

/** M0: the logical part of a world. M1 adds the 3D skin components. */
export interface WorldDefinition {
  id: string;
  name: string;
  /**
   * False keeps a world out of the HUD switcher and ignores it as a remembered choice, so a
   * scaffold is never shown as the real thing; `?world=<id>` still opens it. Default true.
   */
  listed?: boolean;
  /** Tile grid + furniture. Chairs next to desks become seats (layoutToSeats). */
  floorPlan: OfficeLayout;
  /** Furniture types used by floorPlan: footprint, isDesk and category drive seats and walking. */
  catalog: LoadedAssetData['catalog'];
  /**
   * The in-world message board, or null for none: nothing mounts and the bake hangs no panel.
   * The House of Wisdom has none for now (Yousef, 2026-10-15: too small to read); the on-screen
   * Message board panel is separate and always shows.
   */
  board: BoardPlacement | null;
  /** Names for agents and subagents in this world's voice. */
  personas: PersonaRoster;
  /** Where idle main agents wander to and what they do there (ambient life). */
  pointsOfInterest: PointOfInterest[];
  camera?: CameraPose;
  /** The reserved "needs you" colour of this world and the guard around its hue. */
  signal: Signal;
  /** Robe trim colours (six, clear of the signal); the House of Wisdom's palette when absent. */
  trimColors?: readonly string[];
  /** The figures GLB's file name (the House of Wisdom's figures.glb when absent). */
  figures?: string;
  /** Which garments a persona wears; needs a figures file whose materials carry the variants. */
  costume?: CostumeFn;
  /** Look-dev poses (e2e frames, DebugBridge); only the House of Wisdom's are tuned so far. */
  lookDev?: LookDevPoses;
  render: WorldRender;
  /** Present only when the baked hall exists; without it the world renders as the grey box. */
  assets?: () => Promise<WorldAssets>;
}
