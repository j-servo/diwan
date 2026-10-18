# J. Servo 3D edition: architecture notes

Research input for the spec, not the spec itself. Sources read: Pixel Agents at commit `d1e007a` (v1.4.1, cloned to the session scratchpad as `pa-src/`), and Hermes3D at `beb7629` (`~/Desktop/Hermes3D`). Paths below are relative to `pa-src/` unless marked `H3D:`.

**Bottom line.** The agent "brain" in Pixel Agents is cleanly separated from the drawing code. We can keep their server, their detection, and their front-end state engine, and replace only the renderer with React Three Fiber (R3F). Five swappable worlds fit as "skins" over one shared engine. The hardest part is art, not plumbing.

---

## 1. The seam

### Messages the 3D front end must handle

All messages are generated from `core/asyncapi.yaml` (`core/src/messages.ts:1-8`). The `ServerMessage` union is `messages.ts:10-41`.

| Group            | Messages (`messages.ts` line)                                                                                                                                        | What the 3D view does with it                                                           |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Agent lifecycle  | `agentCreated` 73, `agentClosed` 82, `existingAgents` 92, `agentSelected` 87                                                                                         | Spawn or remove an avatar; restore seats                                                |
| Activity         | `agentStatus` 106 (active/waiting, `awaitingInput`), `agentToolStart` 115 (`toolName`, `status` text, `runInBackground`), `agentToolDone` 126, `agentToolsClear` 132 | Drive work animations and tool props                                                    |
| Permission       | `agentToolPermission` 137, `agentToolPermissionClear` 142, `subagentToolPermission` 168                                                                              | Show and clear the "needs you" signal                                                   |
| Subagents        | `subagentToolStart` 147, `subagentToolDone` 155, `subagentClear` 162                                                                                                 | Spawn a child avatar, then return or despawn it                                         |
| Teams / context  | `agentTeamInfo` 174, `agentContextUsage` 184 (`contextTokens`, `maxContextTokens`)                                                                                   | Group teammates; fill a context gauge                                                   |
| Capabilities     | `providerCapabilities` 67 (`readingTools`, `subagentToolNames`)                                                                                                      | Classify tools as read or write                                                         |
| Settings / hooks | `settingsLoaded` 266, `hooksStatus` 280, `hooksConsentRequest` 286                                                                                                   | HUD only                                                                                |
| 2D assets        | `layoutLoaded` 191, `furnitureAssetsLoaded` 197, `characterSpritesLoaded` 226, floor/wall/carpet/pet sprites 237-262                                                 | Mostly ignored. `layoutLoaded` and the furniture catalog still feed seat logic (see §2) |

`ClientMessage` (`messages.ts:43-65`) is what the UI sends back: `webviewReady`, `setHooksEnabled`, `setWatchAllSessions`, `saveAgentSeats`, and so on.

### How the browser receives messages

- `webview-ui/src/transport/index.ts:7-42` picks a transport. In a browser, it opens a WebSocket to `ws(s)://<same host>/ws`, adding `?token=` from the page URL (lines 18-22). The token is what allows the hooks toggle.
- `transport/webSocketTransport.ts` reconnects with exponential backoff (138-149) and queues outgoing messages until connected (92-99).
- It also exposes `deliver(msg)` (113-115). This injects a message as if the server had sent it, and it's the natural entry point for a demo player.

### Can browserMock drive a scripted demo?

Not as it stands, but a demo player is small, new code.

- `main.tsx:12-15` loads `browserMock` only in Vite dev mode, and it is removed from production builds.
- `browserMock.ts` (`dispatchMockMessages`, ~230-263) only sends assets, layout and settings. It sends **no agent events**.
- **Proposal:** a `DemoTransport` that implements `MessageTransport` (`transport/types.ts`). It replays a timeline of `ServerMessage`s on a loop, chosen with `?demo=` or a build flag.
  - Timelines can be hand-written, or recorded by logging the WebSocket stream from a real session and replaying it. That gives authentic pacing.
  - The result is a static build that needs no server, so it can go on Vercel and be iframed into Divi, the same pattern as J. Servo Studio.
  - `server/manual-hook-events.http` has sample events to seed timelines.

---

## 2. What to keep and what to replace

| Module                                                                                                                                                      | Lines         | Tied to Canvas 2D?                                                                                                                                                                                              | Verdict                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `office/engine/officeState.ts` (class at 54)                                                                                                                | 1193          | **No.** Its imports (1-44) never touch the renderer. Its only sprite dependency is `getLoadedCharacterCount()`, which falls back to `PALETTE_COUNT` when no sprites are loaded (`sprites/spriteData.ts:50-52`). | **Keep, use without a canvas.** Its API is already renderer-neutral: `addAgent` 425, `addSubagent` 690, `setAgentActive` 791, `setAgentTool` 874, `showPermissionBubble` 881, `showWaitingBubble` 897, `setAgentContext` 1082, `update(dt)` 1089, `getCharacters()` 1165 |
| `office/engine/characters.ts`                                                                                                                               | 342           | Only `getCharacterSprite` (320) is drawing-specific; the rest is the IDLE/WALK/TYPE state machine plus pathing                                                                                                  | Keep. Ignore `getCharacterSprite`                                                                                                                                                                                                                                        |
| `office/engine/seatPlacement.ts`, `existingAgents.ts`, `layout/tileMap.ts` (pathfinding)                                                                    | 56 / 83 / 105 | No                                                                                                                                                                                                              | Keep                                                                                                                                                                                                                                                                     |
| `office/engine/gameLoop.ts`                                                                                                                                 | 36            | **Yes.** `getContext('2d')` at line 10                                                                                                                                                                          | Replace with R3F `useFrame((_, dt) => os.update(dt))`                                                                                                                                                                                                                    |
| `office/engine/renderer.ts`, `components/OfficeCanvas.tsx`, `sprites/*`, `colorize.ts`, `floorTiles.ts`, `wallTiles.ts`, `matrixEffect.ts`, `projection.ts` | ~2,700        | Yes                                                                                                                                                                                                             | Replace                                                                                                                                                                                                                                                                  |
| `components/ToolOverlay.tsx`                                                                                                                                | 304           | DOM labels placed through 2D `projection.ts`                                                                                                                                                                    | Replace with drei `<Html>` anchored to each avatar                                                                                                                                                                                                                       |
| `hooks/useExtensionMessages.ts`                                                                                                                             | 803           | No. It maps messages to `OfficeState` calls (188-744) plus React state                                                                                                                                          | **Keep.** Asset branches (603, 714) become harmless no-ops                                                                                                                                                                                                               |
| `layout/layoutSerializer.ts`                                                                                                                                | 387           | Mixed. `layoutToSeats` (165) and `layoutToTileMap` (14) are pure logic. `layoutToFurnitureInstances` (27) is drawing code                                                                                       | Keep the logic. Seats depend on catalog entries (`isDesk`, `category: 'chairs'`, footprint)                                                                                                                                                                              |
| `layout/furnitureCatalog.ts`                                                                                                                                | 398           | `buildDynamicCatalog` (71) **requires a sprite per asset** (72, 78)                                                                                                                                             | Small shim: feed a logical catalog with 1×1 placeholder sprites, or a 3-line patch                                                                                                                                                                                       |
| Editor: `useEditorActions.ts`, `editor/*`                                                                                                                   | ~2,300        | 2D only                                                                                                                                                                                                         | Leave out of v1. It's still useful as an **internal tool for authoring world floor plans**, because a world's plan is just an `OfficeLayout`                                                                                                                             |

**Data model facts.** `OfficeLayout` is at `types.ts:148`, `Character` at 168, and `Seat` at 47.

- Characters carry `x`/`y` in pixels and `TILE_SIZE = 16` (`constants.ts:4`), so the 3D position is `X = x/16, Z = y/16`. `dir` becomes a rotation around the vertical axis.
- `bubbleType` is `'permission' | 'waiting'`; it is the needs-you signal.
- `isSubagent` and `parentAgentId` identify subagents.
- `matrixEffect` is `'spawn' | 'despawn'`, which drives the spawn and return effects.
- `contextTokens` and `maxContextTokens` are set at `officeState.ts:1085-1086`.
- `App.tsx:43-45` owns the single `OfficeState` instance.

---

## 3. Repo strategy

| Option                                                       | How it works                                                                                                                                                                                                                                                                            | Verdict                                                                                                                             |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **A. Git fork plus a new sibling front end (`webview-3d/`)** | Fork on GitHub and keep an `upstream` remote. Add `webview-3d/` (Vite + React 19 + R3F) that **imports** engine, layout and message files straight from `webview-ui/src/...`. Point the CLI's static folder at our build. Keep our changes to `server/` and `core/` to a few constants. | **Recommended.** `git merge upstream/main` brings detection and engine fixes for free. Conflicts stay in a handful of patched lines |
| B. Separate package that depends on `pixel-agents` from npm  | The npm package ships bundled `dist/cli.js` and doesn't expose `core/` or `server/` as a library (`package.json` "files", 34-42)                                                                                                                                                        | Not workable without vendoring the code anyway                                                                                      |
| C. Hard fork that rewrites `webview-ui` in place             | Every upstream front-end change becomes a merge conflict                                                                                                                                                                                                                                | No                                                                                                                                  |

Keep a short `PATCHES.md` listing every upstream file we touch. Run their server and engine tests on every upstream merge (see §6).

**MIT licence duties:**

- Keep `LICENSE` (Copyright (c) 2026 Pablo De Lucca) in the fork and add a NOTICE/credits file: "Based on Pixel Agents (MIT)."
- If we copy Hermes3D code, such as `H3D:src/features/retro-office/core/graphicsQuality.ts` or the post-processing setup in `systems/atmosphere.tsx`, include its notice (Copyright (c) 2026 Luke The Dev) in the credits.
- **Don't copy Hermes3D's 3D models or sky image** (`H3D:public/office-assets/models/furniture/*.glb`, `env/office_env_1k.hdr`). The repo has no licence file for them. The names look like Kenney's free CC0 furniture kit, so download from the original sources instead.
- **Don't reuse** Hermes3D's bundled `src/lib/avatars/vendor/multiavatar.js`; its licence is separate and unchecked.
- **Naming:** don't use "Claude" in the product name or logo, and don't imply endorsement by Pixel Agents.

---

## 4. Running alongside the installed pixel-agents 1.4.1

How it works today:

- The CLI serves the front end from `dist/webview` (`server/src/cli.ts:116-118`).
- Each server registers itself in `~/.pixel-agents/servers/<pid>-<port>.json` (`server/src/server.ts:38-39, 203`), using the folder names in `core/src/constants.ts:12,14`.
- The hook script installed in `~/.claude/settings.json` (`~/.pixel-agents/hooks/claude-hook.js`) reads that folder and **sends each event to every live server** (installed copy: `readRegistry` at 77-105, `Promise.all` at 183).

**Recommendation: share the hook, separate everything else.**

- **Keep** the `.pixel-agents` registry and its protocol (`SERVER_REGISTRY_PROTOCOL_VERSION = 1`). Our server then receives events from the hook that's already installed: one set of hooks, no doubled Node processes per event.
- **Change** the settings namespace from `'standalone'` (set in `cli.ts`; files at `fileStateAdapter.ts:4-8`) to `'jservo'`, so seats and settings don't clash.
- **Don't write** `~/.pixel-agents/layout.json` (`layoutPersistence.ts:18`). Worlds ship their own floor plans.
- **Guard the hooks toggle.** Turning hooks off in our UI calls `uninstallHooks`, which would also cut off pixel-agents. Show a warning or hide the toggle when another registry entry is live.
- **Risk: version skew.** Whichever app installs last overwrites `~/.pixel-agents/hooks/claude-hook.js`. Pin the upstream version we merge, and test our server against the hook script that 1.4.1 installs.
- **For client installs** where pixel-agents isn't present, our CLI installs the same hook through the existing consent flow (`cli.ts` ~150-185). Nothing extra to build.

---

## 5. World-skin architecture

**One engine, many skins.** All five worlds share a common set of behaviours, the "agent grammar". It maps engine state (left) to a visual element each world supplies (right):

| Grammar element               | Engine source                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| Workstation (one per seat)    | `Seat` from `layoutToSeats`; on or off follows `isActive`                          |
| Work type (read vs write/run) | `currentTool` plus `providerCapabilities.readingTools` (`toolUtils.ts:28-40`)      |
| Per-tool activity prop        | `agentToolStart.toolName` grouped into read / edit / run / search / web / delegate |
| Subagent spawn and return     | `isSubagent`, `parentAgentId`, `matrixEffect`                                      |
| Needs-permission signal       | `bubbleType === 'permission'`                                                      |
| Finished / waiting signal     | `bubbleType === 'waiting'` plus `waitingAwaitingInput`                             |
| Idle zone and wandering       | IDLE/WALK states, walkable tiles                                                   |
| Context gauge                 | `contextTokens / maxContextTokens`                                                 |

**Minimal interface each world implements (sketch):**

```ts
interface WorldSkin {
  id: string;
  name: string;
  floorPlan: OfficeLayout; // walkable grid + desks + chairs = seats
  catalog: LogicalCatalogEntry[]; // type → footprint, isDesk, category (no sprites)
  Environment: FC<{ quality: Quality }>; // sky/HDRI, lights, fog, post-FX preset
  Workstation: FC<{ seat: Seat; active: boolean; toolKind: ToolKind | null }>;
  Prop: FC<{ toolKind: ToolKind; agent: Character }>; // per-tool activity prop
  PermissionSignal: FC<{ agent: Character }>;
  SpawnFX: FC<{ phase: 'spawn' | 'despawn'; agent: Character }>;
  camera: { home: Vec3; target: Vec3; bounds: Box3Like };
  avatarMaterial?: (palette: number, hueShift: number) => MaterialProps;
}
```

- One shared rigged `Avatar` with idle, walk, type, read and think animations. Each world can restyle it through `avatarMaterial`.
- Worlds load on demand with dynamic import, so the website embed only downloads the world being shown.

**Grid to 3D.** The floor-plan grid stays the source of truth for pathfinding and seats. Each world positions its models on top of that grid, so it can look freeform while the engine still walks agents on tiles. The 2D editor can author the grids.

**Assets:**

- Format: glTF/GLB loaded with drei `useGLTF`, typed components generated by `gltfjsx`, compressed with `gltf-transform` (Meshopt/Draco, KTX2 textures).
- Free CC0 candidates to verify per pack: Kenney (furniture, space kits), Quaternius (animated characters, the Universal Animation Library), KayKit, Poly Haven (sky images).
- **Characters are the long pole:** one rig with consistent animations across all worlds.

**Worth borrowing from Hermes3D:**

- Quality tiers `low/balanced/ultra` with resolution caps and N8AO/Bloom/SMAA switches (`H3D:core/graphicsQuality.ts`).
- Sky lighting plus the post-processing chain (`H3D:systems/atmosphere.tsx:259-384`).
- Its Canvas settings: ACES tone mapping and an adaptive resolution range (`H3D:RetroOffice3D.tsx:5781-5797`).

**Not worth borrowing:** Hermes3D's 7,872-line `RetroOffice3D.tsx`, which does everything in one file, and its boxy voxel avatars (`H3D:objects/agents.tsx`). Neither is the premium look we're after. Hermes3D also redraws every frame, which we won't do (see §6).

---

## 6. Branding, performance, testing

**Branding:**

- A `jservo.config.json` file, overridable by URL parameters in demo mode: `{ world, brand: { name, logoUrl, primary, accent }, quality, demo }`.
- Brand colours become CSS variables for the HUD and colour slots in each world's materials, such as the emissive accent and the screen glow.
- The logo goes on a HUD badge plus one in-world placement per world (a wall sign, a hologram).

**Performance:**

- Use R3F `frameloop="demand"`. Redraw every frame only while an agent is walking or animating, or the camera is moving. When everyone is idle, drop to a slow redraw rate (about 10-15 fps).
- Pause completely while the tab is hidden.
- Quality tiers, plus drei `<PerformanceMonitor>` to step quality down automatically.
- Instance repeated props (one GPU draw call for many copies).
- Load each world's code separately; three.js adds roughly 600 KB minified.

**Testing:**

- **Unchanged upstream suites:** `server/__tests__` (30 files, covering hooks, the transcript parser and runtime) and `webview-ui/test` (`existingAgents`, `teammateSeating`, `layoutSerializer`). Run them on every upstream merge so a merge can't silently break detection.
- **New unit tests (vitest):**
  - Grammar mapping from `Character` to visual state.
  - `DemoTransport` timeline playback.
  - Each world's floor plan produces at least N seats and a connected walkable area.
- **New Playwright tests:**
  - One smoke test per world: it loads, logs no console errors, and the canvas isn't blank.
  - Screenshot comparison per world, using a fixed random seed and a fixed point in the timeline.
  - One end-to-end test using the upstream fake Claude (`e2e/fixtures/mock-claude*`) to prove a real session shows up in 3D.

---

## 7. Risks, open decisions, milestones

**Risks:**

1. **Art across five worlds is the main cost and quality risk.** Ship one hero world to a high standard before starting world two.
2. **Upstream changes to engine files we import** could break our build on merge. Keep a thin adapter layer and run the upstream tests in CI.
3. **Shared hook and registry with pixel-agents:** version skew, and the uninstall toggle affects both apps (§4).
4. **Character rig and animation consistency** across worlds, and the CC0 licence of each source pack.
5. **Graphics and battery load** when left running all day, and on mobile inside the website iframe. Mitigated by on-demand redraw and quality tiers.
6. **Seat capacity.** With 7+ sessions plus subagents, every world's plan needs enough seats and a sensible overflow area.
7. **Trademark and endorsement wording** ("Claude", "Pixel Agents").

**Open decisions for Yousef:**

- Product name and npm scope.
- The final list of five worlds, and which one is the hero.
- Avatar style: stylised human, or abstract (robot or orb).
- Whether the fork is public from day one or private until M2.
- Whether to keep the 2D pixel view as a fallback toggle. It's cheap, because `webview-ui` stays in the repo.
- Demo hosting: a jservo.com subdomain on Vercel, or embed only.

**Milestones:**

- **M0, grey box:** fork the repo and scaffold `webview-3d`. `OfficeState` plus `useExtensionMessages` drive capsules and boxes in R3F. `DemoTransport` and live WebSocket both work. Every grammar element is visible: spawn, walk to seat, read vs write, permission signal, subagent spawn and return, context gauge.
- **M1, hero world:** environment and lighting, the avatar with its animations, post-processing, quality tiers, on-demand redraw, HUD (agent list, labels), and branding config.
- **M2, ship:** a CLI that serves `webview-3d`, the `jservo` namespace and coexistence guards, npm publish, a Vercel demo build, and the Divi iframe embed.
- **M3:** worlds two and three, a world switcher, and per-world screenshot tests.
- **M4:** worlds four and five, client branding presets, and docs.
