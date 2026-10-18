import type { OfficeState } from '../../webview-ui/src/office/engine/officeState.js';
import { toVisualState } from './grammar/visualState.js';

export interface DiwanSnapshotEntry {
  id: number;
  isSubagent: boolean;
  signal: 'permission' | 'waiting' | null;
  pose: string;
  /** The engine tile the character stands on (tests check it is never a blocked tile). */
  col: number;
  row: number;
}

export type CameraPoseName =
  | 'wide'
  | 'gobo'
  | 'material'
  | 'alcove'
  | 'chamber'
  | 'ui'
  | 'armillary'
  | 'pyramid'
  | 'architects'
  | 'facade'
  | 'wall'
  | 'title'
  | 'water';

export interface LampScreen {
  seat: string;
  /** CSS pixels relative to the canvas' top-left corner. */
  x: number;
  y: number;
  /** False when the lamp is behind the camera or outside the canvas. */
  inFrame: boolean;
}

export interface FigureScreen {
  id: number;
  isSubagent: boolean;
  /** CSS pixels from the window's top-left corner (the canvas fills the window). */
  x: number;
  y: number;
  inFrame: boolean;
}

/** What the scene registers once it is mounted (see DebugBridge). */
export interface SceneProbe {
  mix: () => number;
  setCamera: (name: CameraPoseName, seat?: string) => boolean;
  /** Puts the camera at an arbitrary pose, in tiles (orbit sweeps for look-dev measurements). */
  setCameraPose: (
    pos: [number, number, number],
    target: [number, number, number],
    fov: number,
  ) => boolean;
  /** Hides every mesh whose node or material name matches (null shows all again): attribution probes. */
  hideMatching: (pattern: string | null) => number;
  /** A point in tiles to CSS pixels from the window's top-left corner; null behind the camera. */
  project: (p: [number, number, number]) => { x: number; y: number } | null;
  /** Every seat that is asking for approval, with its lamp's screen position. */
  lampScreens: () => LampScreen[];
  /** The first approval seat's lamp, even when out of frame; null when no seat is asking. */
  lampScreen: () => LampScreen | null;
  /** Every figure's chest, projected to the screen, for click and hover tests. */
  figureScreens: () => FigureScreen[];
}

declare global {
  interface Window {
    __diwan?: {
      snapshot: () => DiwanSnapshotEntry[];
      /** Tiles the engine treats as blocked by furniture ("col,row"). */
      blocked: () => string[];
      world: () => { loaded: boolean; mood: 'golden' | 'dusk'; figures: number };
      board: () => { entries: string[]; version: number; bound: boolean };
      /** Frames the camera on a named pose; mutating, so only present in dev or with ?frames / ?bench. */
      camera?: (name: CameraPoseName, seat?: string) => boolean;
      /** Screen position of the lamp of the seat that is asking for approval, or null. */
      /** Camera at an arbitrary pose (tiles); the orbit's distance limits still apply. */
      cameraPose?: (
        pos: [number, number, number],
        target: [number, number, number],
        fov: number,
      ) => boolean;
      hideMatching?: (pattern: string | null) => number;
      project?: (p: [number, number, number]) => { x: number; y: number } | null;
      approvalLamp?: () => LampScreen | null;
      approvalLamps?: () => LampScreen[];
      /** Screen position of every figure (click and hover targets). */
      figures?: () => FigureScreen[];
    };
  }
}

const state = {
  loaded: false,
  figures: 0,
  boardEntries: [] as string[],
  boardVersion: 0,
  boardBound: false,
  scene: null as SceneProbe | null,
};

export function reportWorldLoaded(loaded: boolean): void {
  state.loaded = loaded;
}

/** Counts mounted skinned figures; returns the unmount callback. */
export function trackFigure(): () => void {
  state.figures += 1;
  return () => {
    state.figures -= 1;
  };
}

export function reportBoard(texts: string[]): void {
  state.boardEntries = texts;
  state.boardVersion += 1;
}

/** True while the board's canvas texture is mapped onto the hall's `notice_board` panel. */
export function reportBoardBound(bound: boolean): void {
  state.boardBound = bound;
}

export function registerSceneProbe(probe: SceneProbe | null): void {
  state.scene = probe;
}

/** State probe for browser tests and look-dev frames. Exposes no controls beyond camera framing. */
export function installDebugHook(getOfficeState: () => OfficeState): void {
  window.__diwan = {
    snapshot: () =>
      getOfficeState()
        .getCharacters()
        .filter((ch) => !ch.isGreeter)
        .map((ch) => {
          const v = toVisualState(ch);
          return {
            id: ch.id,
            isSubagent: ch.isSubagent,
            signal: v.signal,
            pose: v.pose,
            col: ch.tileCol,
            row: ch.tileRow,
          };
        }),
    blocked: () => [...getOfficeState().blockedTiles],
    world: () => ({
      loaded: state.loaded,
      mood: (state.scene?.mix() ?? 0) < 0.5 ? 'golden' : 'dusk',
      figures: state.figures,
    }),
    board: () => ({
      entries: [...state.boardEntries],
      version: state.boardVersion,
      bound: state.boardBound,
    }),
  };
  // The mutating probes exist only in dev builds and when a look-dev/bench URL asks for them.
  const params = new URLSearchParams(window.location.search);
  if (import.meta.env.DEV || params.has('frames') || params.has('bench')) {
    window.__diwan.camera = (name, seat) => state.scene?.setCamera(name, seat) ?? false;
    window.__diwan.cameraPose = (pos, target, fov) =>
      state.scene?.setCameraPose(pos, target, fov) ?? false;
    window.__diwan.hideMatching = (pattern) => state.scene?.hideMatching(pattern) ?? 0;
    window.__diwan.project = (p) => state.scene?.project(p) ?? null;
    window.__diwan.approvalLamp = () => state.scene?.lampScreen() ?? null;
    window.__diwan.approvalLamps = () => state.scene?.lampScreens() ?? [];
    window.__diwan.figures = () => state.scene?.figureScreens() ?? [];
  }
}
