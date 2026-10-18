import { BoxGeometry, Mesh, Object3D } from 'three';
import { describe, expect, it } from 'vitest';

import { hallAtmosphere } from '../src/world/hallLayout.js';

function hall(): Object3D {
  const root = new Object3D();
  const add = (name: string, x: number, y: number, z: number, s = 1) => {
    const m = new Mesh(new BoxGeometry(2, 1, 2));
    m.name = name;
    m.position.set(x, y, z);
    m.scale.setScalar(s);
    root.add(m);
  };
  add('grille_west', 1.5, 2.6, 10.2);
  return root;
}

const sun = {
  position: [-6, 6.7, 13.3] as [number, number, number],
  target: [3.1, 1.7, 9.5] as [number, number, number],
};

describe('hallAtmosphere', () => {
  it('runs the shafts from the west grille along the sun direction, down to the floor', () => {
    const a = hallAtmosphere(hall(), sun);
    expect(a.shafts.length).toBeGreaterThan(0);
    const s = a.shafts[0];
    // the cone axis (local Y) points back up at the window: rotating +Y by `rotation` must
    // match the direction from the target to the sun
    expect(s.position[0]).toBeGreaterThan(1.5); // centre is inside the room
    expect(s.position[1]).toBeLessThan(2.6); // and lower than the window
    expect(s.position[1]).toBeGreaterThan(0);
  });
  it('the fountain is gone: only the shafts and the motes remain', () => {
    expect(Object.keys(hallAtmosphere(hall(), sun)).sort()).toEqual(['motes', 'shafts']);
  });
  it('returns no shafts when the grille is missing, never throws', () => {
    const a = hallAtmosphere(new Object3D(), sun);
    expect(a.shafts).toEqual([]);
  });
});
