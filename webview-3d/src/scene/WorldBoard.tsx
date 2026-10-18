// webview-3d/src/scene/WorldBoard.tsx
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import type { Mesh, Object3D } from 'three';
import { CanvasTexture, Color, MeshStandardMaterial, SRGBColorSpace } from 'three';

import { reportBoard, reportBoardBound } from '../debug.js';
import { BOARD_H, BOARD_W, drawBoard } from '../board/boardCanvas.js';
import type { FeedEntry } from '../board/feed.js';
import { useNoticeBoardNode } from '../board/noticeBoardNode.js';
import { worldVoice } from '../board/worldVoice.js';
import type { BoardPlacement } from '../worlds/types.js';

function firstMesh(node: Object3D): Mesh | null {
  let found: Mesh | null = null;
  node.traverse((o) => {
    if (!found && (o as Mesh).isMesh) found = o as Mesh;
  });
  return found;
}

/**
 * The in-world notice wall: the five newest entries, in the world's voice, painted on a canvas
 * texture. With a baked hall it maps onto the `notice_board` node (lit by the scene); without
 * one (grey box, or the node is missing) it sits on a plain panel at the board placement.
 */
export function WorldBoard({
  entries,
  placement,
  worldId = 'house-of-wisdom',
}: {
  entries: FeedEntry[];
  placement: BoardPlacement;
  worldId?: string;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const node = useNoticeBoardNode();
  const target = useMemo(() => {
    const mesh = node ? firstMesh(node) : null;
    return mesh && mesh.material instanceof MeshStandardMaterial ? mesh : null;
  }, [node]);

  const { canvas, texture } = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = BOARD_W;
    c.height = BOARD_H;
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    t.flipY = false; // glTF UV convention: v runs down from the top-left, as in the baked panel
    t.anisotropy = 8;
    return { canvas: c, texture: t };
  }, []);

  useEffect(() => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const lines = entries.slice(0, 5).map((e) => ({ text: worldVoice(e, worldId), tone: e.tone }));
    drawBoard(ctx, lines);
    reportBoard(lines.map((l) => l.text));
    texture.needsUpdate = true;
    invalidate();
  }, [entries, worldId, canvas, texture, invalidate]);

  // Swap only `map` on the panel's own material, so its patched dual lightmap (mood cross-fade)
  // and AO keep working. The old map is restored on teardown.
  useEffect(() => {
    const mat = target?.material;
    if (!target || !(mat instanceof MeshStandardMaterial)) return;
    const { map, color } = mat;
    mat.map = texture;
    mat.color = new Color(0xffffff);
    mat.needsUpdate = true;
    reportBoardBound(mat.map === texture);
    invalidate();
    return () => {
      reportBoardBound(false);
      mat.map = map;
      mat.color = color;
      mat.needsUpdate = true;
    };
  }, [target, texture, invalidate]);

  // PlaneGeometry's v runs up from the bottom, the opposite of the glTF panel: flip in UV space.
  useEffect(() => {
    texture.repeat.set(1, target ? 1 : -1);
    texture.offset.set(0, target ? 0 : 1);
    invalidate();
  }, [target, texture, invalidate]);

  useEffect(() => () => texture.dispose(), [texture]);

  if (target) return null;
  return (
    <group position={placement.position} rotation={[0, placement.rotationY, 0]}>
      <mesh receiveShadow>
        <planeGeometry args={[4.4, 2.2]} />
        <meshStandardMaterial map={texture} roughness={0.9} />
      </mesh>
    </group>
  );
}
