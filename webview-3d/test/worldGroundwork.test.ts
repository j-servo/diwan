import { Color, SRGBColorSpace } from 'three';
import { afterEach, describe, expect, test } from 'vitest';

import { OfficeState } from '../../webview-ui/src/office/engine/officeState.js';
import { buildLayout } from '../scripts/export-layout.js';
import { TRIM_COLORS, setActiveTrimColors, trimColor } from '../src/agents/figureLogic.js';
import { createDirector } from '../src/agents/idleDirector.js';
import { ARMILLARY_MOTION } from '../src/world/armillary.js';
import { castsShadow } from '../src/world/loadWorldAssets.js';
import { clashesWithSignal } from '../src/grammar/signal.js';
import { installWorldCatalog } from '../src/worlds/catalog.js';
import { activeNouns, capitalized, setActiveNouns } from '../src/worlds/personas.js';
import { activeWorld, getWorld, WORLDS, worldHref } from '../src/worlds/registry.js';

const hsl = (hex: string) => new Color(hex).getHSL({ h: 0, s: 0, l: 0 }, SRGBColorSpace);

describe('the registry and the switcher', () => {
  test('registers the House of Wisdom first and a House of Life preview', () => {
    expect(WORLDS.map((w) => w.id)).toEqual(['house-of-wisdom', 'house-of-life']);
    expect(getWorld('house-of-life').name).toBe('House of Life (preview)');
    expect(getWorld('house-of-life').assets).toBeDefined(); // the temple bake (E2)
    expect(getWorld('house-of-life').listed).not.toBe(false); // in the switcher (Yousef, 2026-10-18)
  });
  test('?world= picks a world, an unknown id falls back to the first', () => {
    expect(activeWorld('?world=house-of-life').id).toBe('house-of-life');
    expect(activeWorld('?world=atlantis').id).toBe('house-of-wisdom');
    expect(activeWorld('?demo=1').id).toBe('house-of-wisdom');
  });
  test('worldHref sets world and keeps the other parameters', () => {
    const href = worldHref(
      'http://127.0.0.1:4173/?demo=1&mood=dusk&world=house-of-wisdom',
      'house-of-life',
    );
    const u = new URL(href);
    expect(u.searchParams.get('world')).toBe('house-of-life');
    expect(u.searchParams.get('demo')).toBe('1');
    expect(u.searchParams.get('mood')).toBe('dusk');
  });
});

describe.each(WORLDS.map((w) => [w.id, w] as const))('%s', (_id, w) => {
  test('the grid has 12 seats, the cast has 12 short titles and only attested names, <= 10 characters', () => {
    expect(buildLayout(w).seats).toHaveLength(12);
    expect(w.personas.titles).toHaveLength(12);
    // only names with an opened attestation (E0b); repeats get numerals
    expect(w.personas.apprentices.length).toBeGreaterThanOrEqual(7);
    expect(new Set(w.personas.titles).size).toBe(12);
    expect(new Set(w.personas.apprentices).size).toBe(w.personas.apprentices.length);
    for (const n of [...w.personas.titles, ...w.personas.apprentices])
      expect(n.length, n).toBeLessThanOrEqual(10);
  });
  test('points of interest are walkable', () => {
    installWorldCatalog(w);
    const os = new OfficeState(w.floorPlan);
    const walkable = new Set(os.walkableTiles.map((t) => `${t.col},${t.row}`));
    for (const p of w.pointsOfInterest) expect(walkable.has(`${p.col},${p.row}`), p.id).toBe(true);
  });
  test('every trim colour keeps clear of the world signal band', () => {
    const colors = w.trimColors ?? TRIM_COLORS;
    expect(colors).toHaveLength(6);
    for (const hex of colors) expect(clashesWithSignal(hex, w.signal, 40), hex).toBe(false);
    setActiveTrimColors(w.trimColors);
    expect(trimColor(1)).toBe(colors[1]);
    setActiveTrimColors(undefined);
  });
  test('a custom POI kind carries its own activity', () => {
    for (const p of w.pointsOfInterest) {
      const known = ['shelf', 'scrolls', 'armillary', 'board', 'planter', 'converse', 'circuit'];
      if (!known.includes(p.kind)) expect(p.activity, p.id).toBeDefined();
    }
    expect(createDirector().plans.size).toBe(0);
  });
});

describe('House of Life specifics', () => {
  const hol = getWorld('house-of-life');
  test('scribes and pupils, amethyst, its own furniture ids', () => {
    expect(hol.personas.nouns).toEqual({
      agent: 'scribe',
      agents: 'scribes',
      subagent: 'pupil',
      subagents: 'pupils',
    });
    expect(hol.personas.titles[0]).toBe('Lector');
    expect(hol.signal.color).toBe('#A21CAF');
    expect(hol.catalog.every((c) => c.id.startsWith('hl_'))).toBe(true);
    expect(hol.floorPlan.furniture.every((f) => f.type.startsWith('hl_'))).toBe(true);
  });
  test('the trim palette no longer uses the violet and magenta the amethyst forbids', () => {
    const hues = (hol.trimColors ?? []).map((c) => hsl(c).h * 360);
    for (const h of hues) expect(h < 255 || h > 335).toBe(true);
  });
  test('the nouns reach UI strings', () => {
    setActiveNouns(hol.personas.nouns);
    expect(capitalized(activeNouns().agent)).toBe('Scribe');
    setActiveNouns(getWorld('house-of-wisdom').personas.nouns);
    expect(capitalized(activeNouns().agent)).toBe('Scholar');
  });
});

describe('House of Wisdom is unchanged', () => {
  const how = getWorld('house-of-wisdom');
  afterEach(() => setActiveTrimColors(undefined));
  test('same cobalt, nouns, trim palette and shadow names', () => {
    expect(how.signal).toEqual({ color: '#2f5bea', ink: '#1d40b0', guardDeg: 25 });
    expect(how.trimColors).toBeUndefined();
    expect(how.personas.nouns.agent).toBe('scholar');
    expect(castsShadow('hw_desk')).toBe(true);
    expect(castsShadow('wall_plaster')).toBe(false);
    expect(how.render.castsShadow.test('Cedar_trim')).toBe(true);
    expect(how.render.lightSourceNode).toBe('grille_west');
  });
  test('the centrepiece keeps the armillary motion exactly', () => {
    const c = how.render.centrepiece!;
    expect(ARMILLARY_MOTION).toEqual({ cagePeriodSec: 100, sunPeriodSec: 300, moonPeriodSec: 40 });
    expect(c.moving).toEqual(['cage', 'sun', 'moon']);
    const T = 2 * Math.PI;
    const a = c.angles(10);
    expect(a.cage).toBeCloseTo(-T * 0.1, 12);
    expect(a.sun).toBeCloseTo(T * (10 / 300), 12);
    expect(a.moon).toBeCloseTo(T * 0.25, 12);
    expect(c.envIntensity(0)).toBeCloseTo(0.36, 12);
    expect(c.envIntensity(1)).toBeCloseTo(0.18, 12);
  });
  test('the look-dev poses moved into the definition unchanged', () => {
    const M = 1 / 1.5;
    expect(how.lookDev!.armillary).toEqual({
      pos: [21 * M, 5.2 * M, 18 * M],
      target: [15 * M, 2.4 * M, 10.5 * M],
      fov: 36,
    });
    expect(how.lookDev!.ui).toEqual({ pos: [10, 10.5, 15.5], target: [10, 0.7, 4.6], fov: 46 });
  });
});
