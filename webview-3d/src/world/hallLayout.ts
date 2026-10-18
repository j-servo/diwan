import type { Object3D } from 'three';
import { Euler, Quaternion, Vector3 } from 'three';

import type { Vec3 } from '../scene/coords.js';
import type { ShaftSpec } from './Atmosphere.tsx';

export interface HallAtmosphere {
  shafts: ShaftSpec[];
  motes: { center: Vec3; size: Vec3 };
}

const BEAM_LENGTH_MIN = 3;

/**
 * Where the atmosphere goes, from the hall's own nodes (GLB metres, inside the scaled hall
 * group): the shaft runs from the world's light-source node (the west grille) along the gobo sun's direction to the floor.
 */
export function hallAtmosphere(
  root: Object3D,
  sun: { position: Vec3; target: Vec3 },
  lightSourceNode = 'grille_west',
): HallAtmosphere {
  const shafts: ShaftSpec[] = [];
  const grille = root.getObjectByName(lightSourceNode);
  let motes: HallAtmosphere['motes'] = { center: [8, 2, 10.5], size: [10, 3, 6] };
  if (grille) {
    const window = new Vector3().copy(grille.position);
    const dir = new Vector3(...sun.target).sub(new Vector3(...sun.position)).normalize();
    // distance along the beam from the window down to the floor
    const toFloor = dir.y < -1e-3 ? window.y / -dir.y : BEAM_LENGTH_MIN;
    const length = Math.max(BEAM_LENGTH_MIN, toFloor);
    const up = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.clone().negate());
    const rotation = new Euler().setFromQuaternion(up);
    const rot: Vec3 = [rotation.x, rotation.y, rotation.z];
    const across = new Vector3(0, 0, 1);
    for (const offset of [-0.22, 0.22]) {
      const centre = window
        .clone()
        .addScaledVector(dir, length / 2)
        .addScaledVector(across, offset);
      shafts.push({
        position: [centre.x, centre.y, centre.z],
        rotation: rot,
        length,
        radius: 0.55,
      });
    }
    const mid = window.clone().addScaledVector(dir, length / 2);
    motes = { center: [mid.x, mid.y, mid.z], size: [length * 0.6, 2.4, 1.8] };
  }
  return { shafts, motes };
}
