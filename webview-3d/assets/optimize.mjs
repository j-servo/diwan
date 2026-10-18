#!/usr/bin/env node
// Tuned asset optimisation chain (gltf-transform 4.5.1 + KTX-Software 4.4.2), no network.
//
//   node assets/optimize.mjs                              every worlds/$DIWAN_WORLD/out/raw/*.raw.glb -> out/*.glb
//                                                         (DIWAN_WORLD defaults to house-of-wisdom)
//   node assets/optimize.mjs <in.glb> [out.glb]          optimise one raw bake
//   node assets/optimize.mjs --lightmap <in.png> [out.ktx2]   encode one lightmap (ETC1S, sRGB)
//
// GLB chain: geometry passes, UASTC+RDO on normals and on brand-true colour (the logo panel),
// ETC1S on the remaining colour, AO and metallic-roughness, Meshopt.
// --simplify false and --prune-attributes false are mandatory: the lightmap ships outside the
// GLB, so TEXCOORD_1 is referenced by no material and the default prune would delete it.
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  statSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';

const GT = findCli(dirname(fileURLToPath(import.meta.url)));
const KTX = process.env.KTX || '/usr/local/bin/ktx';
// UASTC RDO strength for normal maps. Lower keeps more quality; 0.5 saved 31% in the spike.
const NORMAL_RDO_LAMBDA = '0.5';
// Materials whose base colour is a real brand mark: UASTC keeps its flat colours and edges
// true, where ETC1S blocks and shifts them. Encoded before the ETC1S pass, which skips KTX2.
const BRAND_TRUE = new Set(['logo_panel_mat']);
const BRAND_RDO_LAMBDA = '0.25';

// The CLI package does not export its entry point, so walk up to the hoisted node_modules.
function findCli(dir) {
  for (let d = dir; ; d = dirname(d)) {
    const cli = join(d, 'node_modules', '@gltf-transform', 'cli', 'bin', 'cli.js');
    if (existsSync(cli)) return cli;
    if (dirname(d) === d) throw new Error('@gltf-transform/cli not found in any node_modules');
  }
}

function run(cmd, args) {
  const started = Date.now();
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status ?? r.signal})`);
  console.log(
    `[time] ${((Date.now() - started) / 1000).toFixed(1)} s: ${args
      .filter((a) => !a.includes('/'))
      .slice(0, 2)
      .join(' ')}`,
  );
}

const gt = (...args) => run(process.execPath, [GT, ...args]);

function uastc(png, out, srgb, lambda) {
  run(KTX, [
    'create',
    '--format',
    srgb ? 'R8G8B8_SRGB' : 'R8G8B8_UNORM',
    '--assign-tf',
    srgb ? 'srgb' : 'linear',
    '--encode',
    'uastc',
    '--uastc-quality',
    '2',
    '--uastc-rdo',
    '--uastc-rdo-l',
    lambda,
    '--zstd',
    '18',
    '--generate-mipmap',
    png,
    out,
  ]);
}

// Normal maps (linear) and brand-true base colours (sRGB) as UASTC; everything else stays PNG
// for the ETC1S pass.
async function uastcTextures(inPath, outPath, tmp) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(inPath);
  const jobs = new Map();
  for (const mat of doc.getRoot().listMaterials()) {
    const normal = mat.getNormalTexture();
    if (normal) jobs.set(normal, { srgb: false, lambda: NORMAL_RDO_LAMBDA });
    const base = mat.getBaseColorTexture();
    if (base && BRAND_TRUE.has(mat.getName()))
      jobs.set(base, { srgb: true, lambda: BRAND_RDO_LAMBDA });
  }
  let i = 0;
  for (const [tex, { srgb, lambda }] of jobs) {
    const png = join(tmp, `u${i}.png`);
    const out = join(tmp, `u${i}.ktx2`);
    writeFileSync(png, tex.getImage());
    uastc(png, out, srgb, lambda);
    tex.setImage(new Uint8Array(readFileSync(out))).setMimeType('image/ktx2');
    i++;
  }
  if (jobs.size > 0) doc.createExtension(KHRTextureBasisu).setRequired(true);
  await io.write(outPath, doc);
}

// A world's colour law on its busiest painted maps (the House of Life's reliefs and screen walls):
// ETC1S keeps one chroma per block and a shared codebook, so a texel can come back in the signal's
// band though no source texel is. These maps are ETC1S-encoded here, closed-loop: encode, decode,
// grey out the 4 x 4 blocks round any texel the decode puts in the band, encode again.
const COLOUR_GUARD = {
  'house-of-life': { hue: 295, guard: 40, materials: new Set(['relief', 'screen']) },
};

async function basisDecoder() {
  const require = createRequire(import.meta.url);
  const file = require.resolve('three/examples/jsm/libs/basis/basis_transcoder.js');
  const src = readFileSync(file, 'utf8');
  const factory = new Function('require', '__filename', '__dirname', `${src}\nreturn BASIS;`)(
    require,
    file,
    dirname(file),
  );
  const basis = await factory({});
  basis.initializeBasis();
  return (data) => {
    const ktx = new basis.KTX2File(data);
    try {
      ktx.startTranscoding();
      const w = ktx.getWidth();
      const h = ktx.getHeight();
      const rgba = new Uint8Array(ktx.getImageTranscodedSizeInBytes(0, 0, 0, 13));
      ktx.transcodeImage(rgba, 0, 0, 0, 13, 0, -1, -1);
      return { w, h, rgba };
    } finally {
      ktx.close();
      ktx.delete();
    }
  };
}

function inBand(r, g, b, hue, guard) {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (max < 0.15 || d / max < 0.25) return false;
  let h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return Math.min(Math.abs(h - hue), 360 - Math.abs(h - hue)) < guard;
}

async function guardedTextures(inPath, outPath, tmp) {
  const law = COLOUR_GUARD[process.env.DIWAN_WORLD ?? ''];
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(inPath);
  if (!law) return io.write(outPath, doc);
  const require = createRequire(import.meta.url);
  const { PNG } = require('pngjs');
  const decode = await basisDecoder();
  let i = 0;
  for (const mat of doc.getRoot().listMaterials()) {
    const tex = mat.getBaseColorTexture();
    if (!tex || !law.materials.has(mat.getName()) || tex.getMimeType() === 'image/ktx2') continue;
    const img = PNG.sync.read(Buffer.from(tex.getImage()));
    const png = join(tmp, `g${i}.png`);
    const out = join(tmp, `g${i}.ktx2`);
    let fixed = 0;
    for (let pass = 0; pass < 10; pass++) {
      writeFileSync(png, PNG.sync.write(img, { colorType: 2, inputColorType: 6 }));
      run(KTX, [
        'create',
        '--format',
        'R8G8B8_SRGB',
        '--assign-tf',
        'srgb',
        '--encode',
        'basis-lz',
        '--qlevel',
        '255',
        '--generate-mipmap',
        png,
        out,
      ]);
      const { w, rgba } = decode(new Uint8Array(readFileSync(out)));
      const bad = [];
      for (let p = 0; p < rgba.length / 4; p++) {
        const q = p * 4;
        if (inBand(rgba[q] / 255, rgba[q + 1] / 255, rgba[q + 2] / 255, law.hue, law.guard))
          bad.push(p);
      }
      console.log(`colour guard ${mat.getName()} pass ${pass}: ${bad.length} texels in the band`);
      if (process.env.DIWAN_GUARD_DEBUG)
        for (const p of bad.slice(0, 6)) {
          const q = p * 4;
          console.log(
            '  at',
            p % w,
            Math.floor(p / w),
            'decoded',
            rgba[q],
            rgba[q + 1],
            rgba[q + 2],
            'source',
            img.data[q],
            img.data[q + 1],
            img.data[q + 2],
          );
        }
      if (bad.length === 0) break;
      for (const p of bad) {
        const bx = Math.floor((p % w) / 4) * 4;
        const by = Math.floor(Math.floor(p / w) / 4) * 4;
        // greyed, then warmed a little (a codebook colour shared with violet-grey blocks
        // elsewhere still serves a pure grey one); wider each time a block comes back
        const r = 4 + 2 * Math.min(pass, 4);
        const warm = 4 + 3 * pass;
        for (let y = Math.max(0, by - r); y < Math.min(img.height, by + 4 + r); y++) {
          for (let x = Math.max(0, bx - r); x < Math.min(img.width, bx + 4 + r); x++) {
            const q = (y * img.width + x) * 4;
            const l = 0.299 * img.data[q] + 0.587 * img.data[q + 1] + 0.114 * img.data[q + 2];
            const t = [l + warm, l + warm * 0.2, l - warm];
            for (let c = 0; c < 3; c++)
              img.data[q + c] = Math.max(
                0,
                Math.min(255, Math.round(t[c] + (img.data[q + c] - l) * 0.2)),
              );
            fixed++;
          }
        }
      }
      if (pass === 9)
        throw new Error(`colour guard: ${mat.getName()} still has texels in the band`);
    }
    tex.setImage(new Uint8Array(readFileSync(out))).setMimeType('image/ktx2');
    console.log(`colour guard ${mat.getName()}: ${fixed} texels greyed`);
    i++;
  }
  doc.createExtension(KHRTextureBasisu).setRequired(true);
  await io.write(outPath, doc);
}

async function optimizeGlb(input, output) {
  const tmp = mkdtempSync(join(tmpdir(), 'diwan-opt-'));
  try {
    // Named nodes and per-node materials are runtime contracts (desk_<seatUid>, lamp_<seatUid>,
    // notice_board with a material of its own): never join named nodes or palette materials.
    // The armillary's node tree is its motion (cage > ecliptic > sun ...): never flatten it.
    const keep = [
      '--flatten',
      'false',
      '--simplify',
      'false',
      '--prune-attributes',
      'false',
      '--join-named',
      'false',
      '--palette',
      'false',
    ];
    gt(
      'optimize',
      input,
      join(tmp, 'geo.glb'),
      '--compress',
      'false',
      '--texture-compress',
      'false',
      ...keep,
    );
    await uastcTextures(join(tmp, 'geo.glb'), join(tmp, 'uastc0.glb'), tmp);
    await guardedTextures(join(tmp, 'uastc0.glb'), join(tmp, 'uastc.glb'), tmp);
    gt(
      'etc1s',
      join(tmp, 'uastc.glb'),
      join(tmp, 'etc.glb'),
      '--slots',
      '{baseColorTexture,occlusionTexture,metallicRoughnessTexture}',
    );
    gt('meshopt', join(tmp, 'etc.glb'), output);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`optimised ${input} (${mb(input)}) -> ${output} (${mb(output)})`);
}

function lightmap(input, output) {
  // 8-bit sRGB; KTX2Loader decodes to linear. Spike: ETC1S qlevel 192 = 0.17 MB per 1024^2.
  run(KTX, [
    'create',
    '--format',
    'R8G8B8_SRGB',
    '--encode',
    'basis-lz',
    '--qlevel',
    '192',
    '--generate-mipmap',
    input,
    output,
  ]);
  console.log(`lightmap ${input} -> ${output} (${mb(output)})`);
}

const mb = (p) => `${(statSync(p).size / 1e6).toFixed(2)} MB`;

const args = process.argv.slice(2);
if (args[0] === '--lightmap') {
  if (!args[1]) throw new Error('usage: optimize.mjs --lightmap <in.png> [out.ktx2]');
  lightmap(resolve(args[1]), resolve(args[2] ?? args[1].replace(/\.png$/, '.ktx2')));
} else if (!args[0]) {
  // no file given: every out/raw/*.raw.glb of $DIWAN_WORLD (default house-of-wisdom)
  const world = process.env.DIWAN_WORLD || 'house-of-wisdom';
  const out = join(dirname(fileURLToPath(import.meta.url)), 'worlds', world, 'out');
  const raw = join(out, 'raw');
  const bakes = existsSync(raw) ? readdirSync(raw).filter((f) => f.endsWith('.raw.glb')) : [];
  if (bakes.length === 0) throw new Error(`no *.raw.glb in ${raw}; run assets:bake first`);
  for (const f of bakes) await optimizeGlb(join(raw, f), join(out, f.replace('.raw.glb', '.glb')));
} else {
  await optimizeGlb(
    resolve(args[0]),
    resolve(args[1] ?? args[0].replace(/(\.raw)?\.glb$/, '.ktx2.glb')),
  );
}
