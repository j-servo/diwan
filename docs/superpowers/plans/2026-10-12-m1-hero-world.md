# Diwan M1 (hero world: House of Wisdom) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the grey box with the real House of Wisdom: a baked, lit, living miniature where Claude Code agents are robed figurines doing visible work, at the quality bar in spec §5–§6 and the "Rendering techniques" block.

**Architecture:**

- Assets are generated in code inside headless Blender 5.2.2, baked with Cycles on Metal, optimised by gltf-transform 4.5.1, and loaded by three's own loaders. No CDNs.
- The runtime is a `WorldSkin` that replaces `GreyboxWorld`:
  - two baked lightmaps (golden and dusk) blended by one shader uniform
  - a gobo SpotLight as the signature window light
  - NEUTRAL tone mapping, bloom tuned so only emissives bloom, and tilt-shift
  - a 22° camera
- Agents are rigged figurines driven by upstream's `OfficeState` through the M0 grammar layer.
- The engine clock is decoupled from rendering, so the canvas redraws only on demand.

**Tech Stack:**

- Blender 5.2.2 (bpy/bmesh, Cycles + Metal, numpy 2.3)
- gltf-transform 4.5.1 + KTX-Software 4.4.2
- three 0.185, @react-three/fiber 9.8, drei 10.7, @react-three/postprocessing 3.2, postprocessing 6.39
- Vitest 4, Playwright 1.62

**Spec:** `docs/superpowers/specs/2026-10-12-history-worlds-design.md` (§4 grammar, §5 art, §6 hero world, "Rendering techniques"). **Proven inputs:**

- `docs/superpowers/spikes/2026-10-12-m1-pipeline.md`: read §3 Gotchas before touching assets or rendering. It is binding.
- spike scripts in `spikes/m1-pipeline/`
- spike runtime in `webview-3d/src/spike/SpikeApp.tsx`
- carried-over items in `docs/superpowers/m0-carryover.md`

## Global Constraints

- Every M0 constraint still applies:
  - upstream files untouched except those in `PATCHES.md`
  - TS `strict` + `erasableSyntaxOnly` + `verbatimModuleSyntax`
  - the read-only live client
  - the product name "Diwan · J. Servo edition"
  - no "Claude" or Ubisoft marks
  - gitleaks + prettier hook, never bypassed
  - every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- **No network at runtime or build time.** No CDNs, no downloads. drei `useGLTF`/`useKTX2` defaults are forbidden; use three's `GLTFLoader` + `KTX2Loader` + `MeshoptDecoder`. drei `<Environment>` may only contain `<Lightformer>` children.
- **History:** Abbasid motifs only: Samarra bevelled stucco, baked brick, pointed arches, pierced stucco or stone window grilles, star-pattern floors.
  - No turned-wood mashrabiya.
  - Kufic bands carry "بيت الحكمة" (Bayt al-Hikma) or a non-scriptural wisdom saying. Never Qur'anic text. Every Arabic string is listed in `docs/superpowers/arabic-strings.md` for Yousef to verify.
- **Colour:**
  - Cobalt glaze `#2f5bea`-family (about 226° hue) means "needs you". No other saturated colour (saturation ≥ 0.35: element, trim or tool-kind) sits within 25° of its hue; near-grey colours and brand marks are exempt. This changed from turquoise on 2026-10-12 at Yousef's request; turquoise is now the fountain water.
  - Robe trims are saturated and clearly apart from the stone, brass and cedar tones.
  - Tone mapping is Khronos NEUTRAL.
- **gltf-transform:** always `--simplify false --prune-attributes false`. Commit optimised outputs only (`git add -f` past the root `out/` ignore rule). Raw bakes stay local.
- **Scale:** 1 engine tile = 1.5 m. Blender builds in metres; the R3F world group is scaled 1/1.5, so tile coordinates match M0. Figures are about 1.65 m tall.
- **Budgets:**
  - optimised hall GLB + lightmaps ≤ 12 MB total (KTX2)
  - figures GLB ≤ 3 MB
  - frame time ≤ 8 ms at 1440×900 on this Mac (headless measurement)
  - the low tier disables tilt-shift, bloom, shafts and motes

## Review Focus

1. **Seat alignment.** If world geometry and the logical floor plan disagree, agents sit inside walls or float beside desks. Every seat must sit directly in front of a modelled desk, and the walkable tiles must be free of geometry. Pinned in Task 2 by a test that reads the generated layout manifest against `greybox.ts`.
2. **A lit world, unlit figures.** Figures that ignore the baked light look pasted on. They need probe light that varies between the courtyard sun and the alcove shade. Pinned in Task 5 by a test that probe values differ between a sunny and a shaded sample point.
3. **The dusk cross-fade must not pop.** A mood switch must interpolate over about 4 s, never step. Pinned in Task 7 by a test of the blend schedule.
4. **A hidden tab must not fast-forward or freeze.** Once the engine clock is decoupled, returning to the tab must not teleport agents, and the demo must keep its agents. Pinned in Task 3 by clock tests.
5. **The approval signal must survive the post stack.** Cobalt has to stay cobalt after tone mapping and bloom (not drifting to purple). Pinned in Task 8 by sampling the approval lamp's pixel hue in the browser test.

## Execution order and models

| Task                                      | Depends on | Model                          | Runs alongside |
| ----------------------------------------- | ---------- | ------------------------------ | -------------- |
| 1 Pipeline + layout manifest              | none       | sonnet                         | none           |
| 2 Hall architecture + bakes               | 1          | **opus**                       | 3, 4           |
| 3 Runtime world skin + engine clock       | 1          | sonnet                         | 2, 4           |
| 4 Figurines (Blender rig + clips + props) | 1          | **opus**                       | 2, 3           |
| 5 Avatar runtime                          | 3, 4       | sonnet (opus if it gets stuck) | none           |
| 6 UI + in-scene board + carry-overs       | 5          | sonnet                         | none           |
| 7 Atmosphere, mood, camera, director mode | 6          | sonnet                         | none           |
| 8 Verification, frames, perf, art review  | 7          | sonnet + opus art review       | none           |

Parallel implementers never commit. The controller commits each task's files after review. Reviews run on sonnet; the final whole-branch review runs on opus.

Art and asset tasks (2, 4) state outcomes, constraints and acceptance tests, not line-by-line code. They start from the spike's proven scripts, and the implementer has design latitude within the spec. Logic tasks give exact tests.

---

### Task 1: Promote the pipeline and make the floor plan the single source of layout

**Files:**

- Create:
  - `webview-3d/assets/blender/` (promoted from `spikes/m1-pipeline/blender/`: `bl_common.py`, `patterns.py`, `trim_bake.py`; cleaned, with no "throwaway" headers)
  - `webview-3d/assets/optimize.mjs`: the tuned chain from `optimize.sh` as Node, using `@gltf-transform/core` for UASTC+RDO on normals, ETC1S on colour/AO, Meshopt, and `ktx create` for lightmaps
  - `webview-3d/assets/README.md`
  - `webview-3d/scripts/export-layout.ts`: writes `webview-3d/assets/worlds/house-of-wisdom/layout.json` from `houseOfWisdomGreybox`
  - `webview-3d/src/worlds/assetMeta.ts`
  - `webview-3d/test/assetMeta.test.ts`
  - `webview-3d/test/layoutExport.test.ts`
- Modify:
  - `webview-3d/package.json` scripts: `assets:layout`, `assets:bake`, `assets:optimize`, `assets` (all of them in order)

**Interfaces (produced):**

- `layout.json`:
  ```json
  { "worldId", "tileMeters": 1.5, "cols", "rows",
    "tiles": number[],
    "furniture": [{ "uid", "type", "col", "row", "footprintW", "footprintH", "category", "isDesk" }],
    "seats": [{ "uid", "col", "row", "facing": "UP"|"DOWN"|"LEFT"|"RIGHT" }],
    "board": { "position": [x,y,z], "rotationY" } }
  ```
  Seats are computed with upstream `layoutToSeats` after `installWorldCatalog`.
- `src/worlds/assetMeta.ts`: the typed schema of every bake's `*.meta.json`:

  ```ts
  export interface LightmapMeta {
    file: string;
    uv: 1;
    intensity: number;
    colorSpace: 'srgb';
  }
  export interface SunMeta {
    color: [number, number, number];
    intensity: number;
    position: Vec3;
    target: Vec3;
    angle: number;
    penumbra: number;
    near: number;
    far: number;
    size: number;
    gobo: string;
  }
  export interface PracticalLightMeta {
    id: string;
    position: Vec3;
    color: [number, number, number];
    intensity: number;
    distance: number;
    seatUid?: string;
  }
  export interface WorldAssetMeta {
    worldId: string;
    tileMeters: number;
    glb: string;
    moods: {
      golden: { lightmap: LightmapMeta; sun: SunMeta };
      dusk: { lightmap: LightmapMeta; sun: SunMeta | null };
    };
    practicals: PracticalLightMeta[];
  }
  export function parseWorldAssetMeta(json: unknown): WorldAssetMeta; // throws with a precise message on any missing or ill-typed field
  export function lightMapIntensity(meta: LightmapMeta, exposure: number): number; // spike gotcha 6: intensity already holds π×M; multiply by exposure
  ```

- [ ] **Step 1:** Write the failing tests.
  - `assetMeta.test.ts`: `parseWorldAssetMeta` accepts a full valid object, and rejects each of a missing `moods.golden.lightmap`, a non-numeric `intensity` and a `uv` other than 1, each with an error naming the path. `lightMapIntensity` multiplies by exposure.
  - `layoutExport.test.ts`: running the export function (exported from the script as `buildLayout(world)`) on `houseOfWisdomGreybox`:
    - gives 12 seats, `tileMeters` 1.5 and 20×14
    - puts every seat orthogonally next to a desk tile, in its `facing` direction
- [ ] **Step 2:** Run the tests and watch them fail.
- [ ] **Step 3:** Implement `assetMeta.ts`, `scripts/export-layout.ts` (run with `npx tsx`; tsx is installed at the root), and the promoted assets folder.
  - `assets:bake` runs `/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 --python assets/blender/<script>.py -- <args>`. The Blender path is overridable with `BLENDER`.
  - `optimize.mjs` reproduces the spike's tuned numbers on the spike corner: 3.7 MB or less, and TEXCOORD_1 kept.
- [ ] **Step 4:** Verify:
  - tests pass
  - `npm --workspace webview-3d run assets:layout` writes `layout.json`
  - `node webview-3d/assets/optimize.mjs <spike raw glb>` keeps TEXCOORD_1, checked by a small `@gltf-transform/core` read in the verification output
- [ ] **Step 5:** Commit: `feat(3d): asset pipeline scripts, world asset meta schema, layout manifest`

---

### Task 2: The House of Wisdom hall, both moods baked (OPUS)

**Files:**

- Create:
  - `webview-3d/assets/blender/hall.py`: generates the hall from `layout.json` and bakes it
  - `webview-3d/assets/blender/kufic.py`: square Kufic band generator; optional, see below
  - `webview-3d/assets/worlds/house-of-wisdom/out/`: committed optimised outputs: `hall.glb`, `lightmap_golden.ktx2`, `lightmap_dusk.ktx2`, `gobo_west.png` (or `.ktx2`), `hall.meta.json` matching `WorldAssetMeta`
  - `webview-3d/test/hallAsset.test.ts`
  - `docs/superpowers/arabic-strings.md`

**Outcome required (spec §6):**

- **The hall:** an Abbasid courtyard hall built on the 20×14-tile layout at 1.5 m per tile, about 30 × 21 m.
  - **Outer walls:** baked brick dado, Samarra bevelled-stucco bands, plaster above.
  - **North and south rows:** eight scholar alcoves (iwans) framed by pointed-arch arcades whose piers stand on tile corners, never on walkable tile centres. Each alcove has the low cedar desk from the layout, a cushion at the seat tile, and a niche for its lamp.
  - **Courtyard:** central, open to the sky, star-pattern floor, the fountain at the layout's position, date palms (stylised low-poly) at the palm tiles, and two study tables.
  - **Shelves:** codices and scroll racks at the shelf tiles, on the east and west walls.
  - **Signature:** at least one pierced stucco grille window in the west wall (afternoon sun), positioned so the gobo pattern lands on the courtyard floor in the default camera view.
  - **Notice wall:** a framed plaster panel at the layout's `board` position, for Task 6's board.
  - **Diorama cutaway:** the south wall, nearest the default camera, stops at dado height. The camera sees into the hall over it.
  - **Kufic band:** a square-Kufic band reading بيت الحكمة on the north wall above the arcade. If legible square Kufic can't be achieved, replace it with a geometric band and record that in the findings. Never ship illegible pseudo-script.
- **Bakes:**
  - **Golden:** low warm sun from the west-south-west, sky light reduced relative to the sun. The real arcade piers occlude, so the light breaks into arch-shaped pools; this fixes the spike's flat, hot upper wall.
  - **Dusk:** the sun is gone, with a deep blue sky term and warm practical lamps as area or point lights in each alcove.
  - Calibrate both with the spike's π×M method. Every practical's live counterpart goes into `practicals` (with `seatUid` for alcove lamps).
- **Optimisation:** run the Task 1 chain. Trim sheets are shared; lightmaps are 2048², or atlases, per mood, in ETC1S.

**Acceptance tests (`hallAsset.test.ts`, reading the committed outputs with `@gltf-transform/core` and `parseWorldAssetMeta`):**

- The meta parses, and both moods are present.
- The GLB has TEXCOORD_1 on every lightmapped primitive, and its triangle count is ≤ 150k.
- The total committed size is ≤ 12 MB.
- For every seat in `layout.json`, the GLB contains a node named `desk_<seatUid>` whose world-space bounding box overlaps the desk tile in front of the seat, and no mesh except floor and cushions intersects the seat tile's column 0–1.6 m above the floor. Node names are part of the contract.
- No mesh except the floor intersects the centre of any walkable tile from 0.1 to 1.8 m (a small 0.2 m probe box), except listed furniture tiles.

**Visual acceptance:** render the hall with the Task 3 runtime, or the spike page pointed at the new assets if Task 3 isn't merged yet, at the 22° default camera in both moods, plus the gobo floor close-up. Save to `docs/superpowers/m1/img/task2-*.jpg`. Look at them and iterate until the spike's "upper wall flat and hot" problem is gone and the gobo reads clearly.

- [ ] Implement, iterate on the frames, run the tests, record the bake timings in `webview-3d/assets/README.md`, and hand over (no commit when running in parallel).

---

### Task 3: Runtime world skin and the decoupled engine clock

**Files:**

- Create:
  - `webview-3d/src/engine/engineClock.ts`
  - `webview-3d/src/world/loadWorldAssets.ts`
  - `webview-3d/src/world/dualLightmap.ts`
  - `webview-3d/src/world/WorldSkin.tsx`
  - `webview-3d/src/world/PostStack.tsx`
  - `webview-3d/src/world/quality.ts`
  - `webview-3d/test/engineClock.test.ts`
  - `webview-3d/test/dualLightmap.test.ts`
  - `webview-3d/test/quality.test.ts`
- Modify:
  - `webview-3d/src/scene/Scene.tsx`: camera, `frameloop="demand"`, `WorldSkin` replaces `GreyboxWorld` when the world has assets; the grey box stays the fallback
  - `webview-3d/src/scene/useCharacterIds.ts`, `AgentAvatar.tsx`: drive from the clock, not `useFrame`
  - `webview-3d/src/worlds/types.ts`: optional `assets?: () => Promise<WorldAssetMeta & { baseUrl: string }>`
  - `webview-3d/src/worlds/houseOfWisdom/greybox.ts`: wire the assets via `import.meta.glob`/`?url`

**Interfaces (produced):**

```ts
// engineClock.ts
export interface EngineClock {
  start(): void;
  stop(): void;
  onTick(cb: (dt: number) => void): () => void;
  readonly running: boolean;
}
export function createEngineClock(opts: {
  now: () => number;
  schedule: (cb: () => void) => () => void;
  maxDt: number;
}): EngineClock;
// Ticks at ~60 Hz via `schedule` while running; dt is clamped to maxDt (MAX_DELTA_TIME_SEC). Before every tick it calls getOfficeState().update(dt) and then
// invalidate() only if anything changed (characters moved, a signature changed). In a hidden tab it keeps ticking at a low rate (schedule = setTimeout 250 ms),
// so the engine never fast-forwards and the demo keeps its agents.
export function engineSignature(chars: Character[]): string; // positions rounded to 1 cm + visual signatures, used for change detection
// dualLightmap.ts
export function patchDualLightmap(
  material: MeshStandardMaterial,
  golden: Texture,
  dusk: Texture,
  intensity: { golden: number; dusk: number },
): { setMix(t: number): void };
export function lightmapMixUniformName(): string; // 'uLightmapMix'
// quality.ts
export type Quality = 'low' | 'balanced' | 'high';
export interface QualityProfile {
  dpr: [number, number];
  tiltShift: boolean;
  bloom: boolean;
  atmosphere: boolean;
  shadowMapSize: number;
}
export function profileFor(q: Quality): QualityProfile;
export function stepDown(q: Quality): Quality;
```

**Requirements:**

- **Loading:** `loadWorldAssets` uses three's `GLTFLoader` with `MeshoptDecoder` and `KTX2Loader` (`detectSupport(gl)`), with no transcoder path (spike gotcha 10). Lightmaps are applied with `channel = 1` (gotcha 5), intensity via `lightMapIntensity` (Task 1), and the AO split per gotcha 7.
- **Dual lightmap:** `patchDualLightmap` uses `onBeforeCompile` to sample the second lightmap and mix by `uLightmapMix`, with `customProgramCacheKey` set. It is unit-testable through the generated shader string: the test asserts the mix uniform, the second sampler and the mix expression appear in `material.onBeforeCompile`'s output.
- **Lights:** a gobo `SpotLight` from `moods.golden.sun`, with `map` set to the gobo texture (linear, `NoColorSpace`), `penumbra > 0`, and shadows only for figures, desks and lamps (gotchas 8–9). Practicals become point lights with matching colour and intensity. The canvas's shadow type is explicit (`VSMShadowMap` or `PCFShadowMap`, chosen and justified in the report) to drop the deprecation warning.
- **Post stack:**
  - `<EffectComposer multisampling={4}>` containing `<Bloom luminanceThreshold={1.0} mipmapBlur />`, `<TiltShift />` (the postprocessing one, gotcha 13) and `<ToneMapping mode={NEUTRAL} />` (gotchas 14–15)
  - canvas `antialias: false`, every effect gated by the quality profile
  - drei `<PerformanceMonitor onDecline={() => stepDown}>` drives the quality
- **Camera:** perspective 22°, positioned so the whole hall plus the cutaway fills the frame at 16:10, with OrbitControls clamped to keep the miniature framing. The default camera pose lives in the world definition.

**Tests:**

- clock:
  - a fake `now`/`schedule` shows dt clamped
  - `update` is called once per tick
  - `invalidate` only fires when the signature changes
  - `stop()` halts ticks
- `engineSignature` stability
- `dualLightmap` shader-string assertions
- `quality`: profiles plus `stepDown` order high→balanced→low→low

**Verification:**

- typecheck, test, build and e2e (the M0 e2e must still pass, since the grey box is the fallback for worlds without assets)
- a screenshot with the spike corner assets, or the Task 2 hall if available, saved to `docs/superpowers/m1/img/task3-*.jpg`

- [ ] TDD per the interfaces above. Hand over (no commit when running in parallel).

---

### Task 4: Figurines: rigged, animated, with props (OPUS)

**Files:**

- Create:
  - `webview-3d/assets/blender/figures.py`
  - `webview-3d/assets/figures/out/figures.glb` (committed, optimised)
  - `webview-3d/assets/figures/out/figures.meta.json`
  - `webview-3d/test/figuresAsset.test.ts`

**Outcome required (spec §5, "living miniature"):**

- **Figures:** two stylised robed figurines, a **scholar** and an **apprentice** (about 85% scale, simpler robe), built procedurally in Blender. No downloads (ruling, see ledger).
  - Elegant, simplified people in Abbasid-era dress: long robe (thawb/qaba), an outer cloak for the scholar, turban or cap, sleeves, hands, and a simplified face with no cartoon features.
  - Clay-matte skin, fabric with sheen.
  - The robe-trim material is named `trim` so the runtime can tint it per agent palette.
- **Rig:** one armature shared by both figurines (same bone names).
- **Clips:** `idle` (breathing), `walk` (in place; root motion is stripped, and the runtime moves the root), `sit_idle`, `write` (reed pen), `read` (page turn), `astrolabe`, `scroll_search`, `receive_letter`, `gesture_beckon` (delegate), `look_up` (done or waiting), `stand_up`, `sit_down`.
  - Each loops cleanly where it should, 24–30 fps.
- **Props:** separate nodes, hidden by default, parented to `hand.R` / `hand.L`: `prop_reed_pen`, `prop_codex`, `prop_astrolabe`, `prop_scroll`, `prop_letter`. Plus a desk candle as its own node: `candle` with a child `candle_wax` that the runtime scales for the context gauge.
- **Budget:** `figures.glb` ≤ 3 MB, each figure ≤ 8k triangles.

**Acceptance tests (`figuresAsset.test.ts` via `@gltf-transform/core`):**

- Both figure root nodes exist.
- All listed clips exist with duration > 0.
- The bone names match between the figures.
- The `trim` material exists.
- The prop nodes exist under hand bones.
- Size and triangle budgets hold.

**Visual acceptance:** a turntable of both figures, plus contact sheets of 4 frames per clip, rendered in Blender (Eevee is fine) to `docs/superpowers/m1/img/task4-*.jpg`. Iterate until the silhouettes read clearly at the 22° camera's distance: the figure is about 70–90 px tall on screen at 1440×900.

- [ ] Implement, iterate, test, hand over (no commit when running in parallel).

---

### Task 5: Avatar runtime: figures doing the grammar

**Files:**

- Create:
  - `webview-3d/src/agents/Figure.tsx`
  - `webview-3d/src/agents/clipFor.ts`
  - `webview-3d/src/agents/pathSmoothing.ts`
  - `webview-3d/src/agents/probes.ts`
  - `webview-3d/src/agents/inkDissolve.ts`
  - `webview-3d/src/world/AlcoveLamps.tsx`
  - `webview-3d/test/clipFor.test.ts`
  - `webview-3d/test/pathSmoothing.test.ts`
  - `webview-3d/test/probes.test.ts`
- Modify:
  - `webview-3d/src/scene/AgentAvatar.tsx`: render `Figure` when figure assets exist, the capsule otherwise
  - `webview-3d/src/scene/Workstations.tsx`: superseded by `AlcoveLamps` in skinned worlds

**Interfaces:**

```ts
export type Clip = 'idle'|'walk'|'sit_idle'|'write'|'read'|'astrolabe'|'scroll_search'|'receive_letter'|'gesture_beckon'|'look_up'
export function clipFor(v: VisualState): { clip: Clip; prop: 'prop_reed_pen'|'prop_codex'|'prop_astrolabe'|'prop_scroll'|'prop_letter'|null }
// walk → walk; work+read → read/codex; work+write → write/reed pen; work+run → astrolabe; work+search → scroll_search/scroll;
// work+web → receive_letter/letter; work+delegate → gesture_beckon; signal waiting → look_up; idle seated → sit_idle; idle standing → idle
export function smoothPosition(prev: Vec2, target: Vec2, dt: number, speed: number): Vec2 // critically-damped follow; never overshoots the target tile centre
export function headingTowards(from: Vec2, to: Vec2, currentYaw: number, dt: number): number // slerped yaw, ≤ 540°/s
export function sampleProbe(grid: ProbeGrid, x: number, z: number): [number, number, number] // trilinear RGB irradiance
export function buildProbeGrid(...): ProbeGrid // built once at load by rendering the baked hall with three's CubeCamera + LightProbeGenerator, on a coarse grid (one probe per 3×3 tiles at 1.2 m height)
```

**Requirements:**

- **Figure.tsx:**
  - clones the scholar (agents) or the apprentice (subagents) via `SkeletonUtils.clone`
  - one `AnimationMixer` per figure, 0.25 s cross-fades on clip change, `sit_down`/`stand_up` transitions when entering or leaving the seat
  - the `trim` colour comes from the agent's palette; trims must be saturated and must not sit within 25° of cobalt
  - the root position comes from `smoothPosition` towards the engine's tile position, and the yaw from `headingTowards`
  - an ambient term from `sampleProbe` (a `LightProbe` per figure, or a `MeshStandardMaterial` `envMapIntensity` tweak), plus a soft blob shadow decal
  - the figure casts shadows in the sun spot
- **Ink dissolve (`inkDissolve.ts`):** an `onBeforeCompile` patch that discards fragments by noise threshold, with a dark-ink edge glow. Driven by `matrixEffect` progress, it replaces the M0 scale effect. Apprentices dissolve in or out at the spawn and despawn tile.
- **AlcoveLamps:** one lamp per seat from `practicals` (by `seatUid`).
  - Active agent: warm on, with a subtle GLSL flicker.
  - Permission: cobalt glaze glow with a 1.2 s pulse.
  - Idle: dim.
  - The emissive values are tuned so only the lamps cross the bloom threshold.
- **Candle gauge:** the `candle_wax` height follows `contextRatio`. It is hidden when that is null.
- **Clock:** everything ticks off the Task 3 engine clock and calls `invalidate()`.

**Tests:**

- `clipFor`: the full mapping table
- `smoothPosition`: converges, no overshoot, clamps large dt
- `headingTowards`: shortest arc, rate-limited
- `sampleProbe`: interpolates and clamps
- a probe-grid test with a synthetic grid: a sunny cell and a shaded cell give different values (Review Focus 2)

**Verification:** typecheck/test/build/e2e, plus screenshots of the demo at several timeline points (agents writing; an apprentice dissolving in; an approval lamp) saved to `docs/superpowers/m1/img/task5-*.jpg`.

- [ ] TDD and implement. Commit: `feat(3d): figurines driven by the agent grammar (clips, props, probes, ink dissolve, alcove lamps)`

---

### Task 6: UI in the world's voice, the in-scene notice wall, carry-overs

**Files:**

- Modify:
  - `webview-3d/src/scene/SpeechBubble.tsx`, `webview-3d/src/index.css`: House of Wisdom bubble style
  - `webview-3d/src/scene/WorldBoard.tsx`: replaced by an in-scene `CanvasTexture` board
  - `webview-3d/src/board/feed.ts`
  - `webview-3d/src/grammar/visualState.ts`
  - `webview-3d/src/hud/Hud.tsx`
- Create:
  - `webview-3d/src/board/boardCanvas.ts`
  - `webview-3d/src/board/worldVoice.ts`
  - `webview-3d/test/boardCanvas.test.ts`
  - `webview-3d/test/worldVoice.test.ts`

**Requirements:**

- **Bubbles:**
  - Parchment-tinted frosted glass: `backdrop-filter: blur() saturate()`, with an `@supports not (backdrop-filter: blur(1px))` solid parchment fallback.
  - A thin calligraphic-feel border and a serif display face from the system stack (Georgia / "Iowan Old Style"). No web-font downloads.
  - Approval tone is cobalt glaze, replacing M0 gold.
  - Bubbles stack: a subagent's bubble offsets above its parent's when they're within 1 tile (M0 design note).
  - Text clamps to 2 lines.
- **In-scene notice wall (M0 D2):**
  - `boardCanvas.ts` draws the five newest feed entries onto a 1024×512 canvas in parchment and ink, with cobalt for approvals and green ink for done.
  - It is pure enough to test: `layoutBoardLines(entries, measure): Line[]` is tested with a fake `measure` for wrapping and clamping.
  - `WorldBoard` maps the canvas as a `CanvasTexture` on the notice panel from Task 2 (`notice_board` node), lit by the scene and redrawn on feed change.
- **World voice (spec §4, M1):**
  - `worldVoice(entry, worldId)` rewrites feed text for the House of Wisdom, e.g. "ledger-api needs your approval" → "The scholar of ledger-api requests your seal", "joined" → "takes a seat in the hall", "delegated: X" → "sends an apprentice: X".
  - The on-screen panel keeps the plain text. The in-world board uses the voice.
  - Tested by a table.
- **Carry-overs:**
  - The background-subagent approval path: count a subagent permission in `needsYou` when its parent has none, and add `subagentToolDone`/`subagentClear` to the feed's clearing set for that subagent's approval. Tests included.
  - The HUD restyle matches the parchment glass. The legend uses the tool-kind colours.
  - A mood toggle button (Golden / Dusk / Auto) is wired to Task 7's mood controller via a prop; until Task 7 lands, it is a no-op callback.

**Tests:** as listed, plus updated feed/grammar tests for the carry-overs.

- [ ] TDD and implement. Commit: `feat(3d): House of Wisdom UI voice, in-scene notice wall, approval path carry-overs`

---

### Task 7: Atmosphere, mood, camera and director mode

**Files:**

- Create:
  - `webview-3d/src/world/mood.ts`
  - `webview-3d/src/world/Atmosphere.tsx`: light shafts as additive cone meshes with scrolling noise, dust motes, fountain water shader, palm sway (vertex shader)
  - `webview-3d/src/camera/focus.ts`
  - `webview-3d/src/camera/director.ts`
  - `webview-3d/test/mood.test.ts`
  - `webview-3d/test/director.test.ts`
- Modify:
  - `webview-3d/src/world/WorldSkin.tsx`
  - `webview-3d/src/scene/Scene.tsx`
  - `webview-3d/src/App.tsx`

**Interfaces:**

```ts
// mood.ts
export type MoodSetting = 'golden' | 'dusk' | 'auto';
export function targetMood(setting: MoodSetting, allIdleForSec: number): 'golden' | 'dusk'; // auto: dusk after 20 s of no active agent, golden as soon as one is active
export function stepMix(current: number, target: 0 | 1, dt: number, durationSec = 4): number; // smoothstep-eased, monotonic, reaches target in durationSec (Review Focus 3)
// director.ts
export interface DirectorEvent {
  at: number;
  kind: 'approval' | 'delegate' | 'done' | 'join';
  agentId: number;
}
export function nextShot(events: DirectorEvent[], now: number, current: Shot | null): Shot; // priority approval > delegate > done > join; min hold 4 s; returns 'wide' after 8 s idle
```

**Requirements:**

- **Mood:** `mood.ts` drives `uLightmapMix`, the sun intensity (to 0 at dusk), practical intensities (higher at dusk) and a slight exposure change. It is persisted per viewer (`localStorage`, try/catch).
- **Atmosphere:** shafts only in the golden mood and when the quality profile allows. Motes are instanced, at most 400. Water is a small plane with a normal-scroll shader. Palm fronds sway in the vertex shader.
- **Focus:** clicking an agent glides the camera target and the tilt-shift focus to it with a critically-damped spring. Escape or a click on empty floor returns to the default pose.
- **Director mode:** on by default in demo mode, off in live mode, with a HUD toggle. It glides between shots chosen by `nextShot`.

**Tests:**

- mood: auto switching thresholds; `stepMix` monotonic, eased, reaching its target in about 4 s, with no step greater than 0.05 at dt=1/60
- director: priority, min hold, idle → wide

- [ ] TDD and implement. Commit: `feat(3d): golden/dusk mood, atmosphere, focus glide and director mode`

---

### Task 8: Verification, frames, performance, art-direction review

**Files:**

- Modify:
  - `webview-3d/e2e/demo.spec.ts`: add skinned-world assertions
- Create:
  - `webview-3d/e2e/frames.spec.ts` (tagged, run on demand): renders the six look-dev frames
  - `webview-3d/scripts/perf.mjs`
  - `docs/superpowers/m1/README.md`: the results page with frames, numbers and how to run
- Remove:
  - the spike page (`webview-3d/spike.html`, `src/spike/`, `vite.spike.config.ts`). `spikes/` stays as history.

**Requirements:**

- **e2e:**
  - the hall GLB loads (a debug probe reports `world.loaded === true`)
  - at least 3 figures render
  - the approval lamp's on-screen pixel hue is cobalt (hue 210–242°, saturation > 0.35) after post (Review Focus 5)
  - zero console errors
  - all M0 assertions kept (bubbles, dots, board panel)
- **Frames (spike §4 list):**
  1. golden wide
  2. dusk wide
  3. an alcove A/B (idle vs approval)
  4. the gobo signature shot with shafts and motes
  5. the material close-up of stucco, brick and Kufic
  6. UI: bubbles and the in-world board

  Save them to `docs/superpowers/m1/img/frame-*.jpg`.

- **Perf:** `perf.mjs` reports the median and p95 frame time at 1440×900 for high and balanced tiers. Record the numbers in the README against the budgets.
- **Art-direction review (OPUS reviewer):**
  - Reads the six frames against spec §5/§6 and the Rendering techniques block.
  - Returns ranked findings (composition, light, material, colour discipline, legibility of the grammar, historical fit).
  - Findings of severity "would embarrass us in front of a client" go to the fix wave.

- [ ] Implement, run, record. Commit: `test(3d): M1 verification, look-dev frames, perf numbers, results page`

---

## Done when

- Every task passes its review.
- The final whole-branch review (opus) is clean or its fixes are applied.
- Tests, typecheck, build and e2e are all green, and upstream suites are unchanged.
- `docs/superpowers/m1/README.md` shows the six frames and the perf numbers within budget.
- `docs/superpowers/arabic-strings.md` lists every Arabic string for Yousef.
- The branch is merged to local `main`.
