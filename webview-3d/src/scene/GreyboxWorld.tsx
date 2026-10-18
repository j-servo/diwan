import { useLayoutEffect, useMemo, useRef } from 'react';
import type { InstancedMesh } from 'three';
import { Matrix4 } from 'three';

import { getCatalogEntry } from '../../../webview-ui/src/office/layout/furnitureCatalog.js';
import type { OfficeLayout } from '../../../webview-ui/src/office/types.js';
import { footprintCenter } from './coords.js';
import type { TileCoord } from './tiles.js';
import { splitTiles } from './tiles.js';

const HEIGHT_BY_CATEGORY: Record<string, number> = {
  desks: 0.55,
  chairs: 0.2,
  storage: 2.2,
  decor: 0.8,
};
const COLOR_BY_CATEGORY: Record<string, string> = {
  desks: '#8a6a48',
  chairs: '#b5523b',
  storage: '#6b4f35',
  decor: '#7f9c8a',
};

function TileInstances(props: {
  tiles: TileCoord[];
  baseY: number;
  height: number;
  color: string;
}) {
  const { tiles, baseY, height, color } = props;
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const matrix = new Matrix4();
    tiles.forEach((tile, i) => {
      matrix.makeTranslation(tile.col + 0.5, baseY + height / 2, tile.row + 0.5);
      mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [tiles, baseY, height]);
  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, tiles.length]}
      castShadow={height > 0.5}
      receiveShadow
    >
      <boxGeometry args={[1, height, 1]} />
      <meshStandardMaterial color={color} roughness={0.9} />
    </instancedMesh>
  );
}

/** M0 stand-in for the House of Wisdom: walls, floor and furniture as plain blocks. */
export function GreyboxWorld({ layout }: { layout: OfficeLayout }) {
  const { floor, walls } = useMemo(() => splitTiles(layout), [layout]);
  return (
    <group>
      <TileInstances tiles={floor} baseY={-0.1} height={0.1} color="#d8c7a6" />
      <TileInstances tiles={walls} baseY={0} height={2.4} color="#b89a72" />
      {layout.furniture.map((item) => {
        const entry = getCatalogEntry(item.type);
        if (!entry) return null;
        const height = HEIGHT_BY_CATEGORY[entry.category] ?? 0.5;
        const [x, , z] = footprintCenter(item.col, item.row, entry.footprintW, entry.footprintH);
        return (
          <mesh key={item.uid} position={[x, height / 2, z]} castShadow receiveShadow>
            <boxGeometry args={[entry.footprintW * 0.9, height, entry.footprintH * 0.9]} />
            <meshStandardMaterial
              color={COLOR_BY_CATEGORY[entry.category] ?? '#999999'}
              roughness={0.8}
            />
          </mesh>
        );
      })}
    </group>
  );
}
