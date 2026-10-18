#!/usr/bin/env node
// Optimise the figurine GLB (gltf-transform 4.5.1, no network).
//
//   node assets/figures/optimize-figures.mjs [in.raw.glb] [out.glb]
//   defaults: assets/figures/out/raw/figures.raw.glb -> assets/figures/out/figures.glb
//
// Not assets/optimize.mjs: its CLI `optimize` pass would palette-merge the flat-colour materials
// (losing the `trim` material the runtime tints) and flatten/join the figure hierarchies. This
// chain keeps nodes, skins, animations and materials, and only:
//   1. renames Blender's ".001" duplicates inside the apprentice so both figures carry the
//      same bone and prop names,
//   2. dedups, prunes, welds and losslessly resamples the clips,
//   3. Meshopt-compresses geometry and animation. POSITION is deliberately NOT quantised:
//      quantize() folds its dequantisation scale/offset into node transforms, which moved the
//      origin of candle_wax (the runtime Y-scales it from its base) and of the codex page and
//      astrolabe rete (animated pivots). Normals, joints, weights and keyframes still compress.
import { statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, quantize, reorder, resample, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const here = dirname(fileURLToPath(import.meta.url));
const input = resolve(process.argv[2] ?? join(here, 'out', 'raw', 'figures.raw.glb'));
const output = resolve(process.argv[3] ?? join(here, 'out', 'figures.glb'));

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(input);

const top = doc.getRoot().getDefaultScene().listChildren();
const subtree = (n) => [n, ...n.listChildren().flatMap(subtree)];
for (const name of ['scholar', 'apprentice']) {
  const root = top.find((n) => n.getName() === name);
  if (!root) throw new Error(`missing figure root node: ${name}`);
  for (const n of subtree(root)) n.setName(n.getName().replace(/\.\d{3}$/, ''));
}
for (const m of doc.getRoot().listMaterials()) {
  if (/\.\d{3}$/.test(m.getName())) throw new Error(`duplicate material ${m.getName()}`);
}

await doc.transform(
  dedup(),
  prune(),
  weld(),
  resample({ tolerance: 1e-4 }),
  reorder({ encoder: MeshoptEncoder, target: 'size' }),
  // as meshopt({level: 'high'}) does, minus POSITION (see above)
  quantize({
    pattern: /^(TEXCOORD|JOINTS|WEIGHTS|COLOR)(_\d+)?$/,
    patternTargets: /^(TEXCOORD|JOINTS|WEIGHTS|COLOR|NORMAL|TANGENT)(_\d+)?$/,
  }),
);
doc
  .createExtension(EXTMeshoptCompression)
  .setRequired(true)
  .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
await io.write(output, doc);

const mb = (p) => `${(statSync(p).size / 1e6).toFixed(2)} MB`;
console.log(`optimised ${input} (${mb(input)}) -> ${output} (${mb(output)})`);
