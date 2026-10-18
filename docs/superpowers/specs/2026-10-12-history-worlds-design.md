# J. Servo agent worlds: design spec

**Status:** draft for Yousef's review · **Date:** 2026-10-12 · **Working title:** Diwan (see §9)
**Builds on:** `docs/architecture-notes.md` (code map with file:line evidence)

## 1. What we're making and why

A J. Servo edition of Pixel Agents (MIT). It shows your Claude Code agents and their subagents working live in a small set of beautifully rebuilt **historical places of knowledge**, rendered in 3D in the browser.

It has two jobs:

- **Showcase.** It impresses clients and proves J. Servo's agentic-AI craft. A demo runs on jservo.com with no real session behind it.
- **Client tool.** J. Servo installs it for clients who run agent teams, with their own branding.

**Success means:**

1. A client watching for five seconds can tell who is working, what kind of work it is, and who needs their approval.
2. Real activity from any Claude Code session on the machine appears within about a second.
3. Yousef signs off that it looks far beyond the current pixel look. Look-development frames come before the full build (see §5).
4. It holds at least 50 fps on an M-series Mac at high quality, and at least 30 fps on a mid-range laptop at balanced quality. When nothing is moving, it uses almost no graphics power.

## 2. Decisions already made

| Decision        | Choice                                                                                                                                                             | Why                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Base            | Pixel Agents, MIT, upstream commit `d1e007a`                                                                                                                       | It already solves Claude Code detection: hooks plus transcripts, subagents, permissions                                     |
| Rendering       | three.js through React Three Fiber, with drei and postprocessing                                                                                                   | Their interface is already React 19 + Vite, so R3F slots in                                                                 |
| Worlds          | A history collection of five, with the House of Wisdom as the hero                                                                                                 | Original, culturally strong for GCC clients, inspired by Assassin's Creed's approach without its IP                         |
| What's kept     | Their server, detection, state engine (`OfficeState`), message wiring and floor-plan logic                                                                         | All renderer-neutral (architecture notes §2)                                                                                |
| What's replaced | All drawing: renderer, sprites, overlays, game loop                                                                                                                | The pixel look is what we're leaving behind                                                                                 |
| Repo            | Our repo with an `upstream` remote. A new `webview-3d/` sits beside their `webview-ui/` and imports its engine. Upstream files we touch are listed in `PATCHES.md` | Upstream detection fixes keep merging in cleanly                                                                            |
| Visibility      | Private until the ship milestone, public at launch                                                                                                                 | Unfinished work isn't public. A GitHub "fork" of a public repo can't be private, so it's a plain repo with `upstream` added |
| Coexistence     | Share the installed hook and `~/.pixel-agents` registry; our settings use their own namespace (`jservo`)                                                           | One set of hooks, no clashes (architecture notes §4)                                                                        |
| Demo hosting    | Static build on Vercel, embedded in jservo.com by iframe                                                                                                           | Same pattern as J. Servo Studio                                                                                             |
| 2D pixel view   | Not offered in our edition                                                                                                                                         | Keeps the product focused; upstream still has it                                                                            |

## 3. Out of scope for this version

- Chatting with or steering agents from inside the world
- Other AI tools (Codex, Gemini, Cursor)
- The VS Code extension
- A layout editor for users (we may use upstream's 2D editor internally to author floor plans)
- Anything from Ubisoft: the Assassin's Creed name, the Animus look, insignia, hooded assassins, game art or music
- "Claude" in the product name or logo, or wording that implies endorsement by Anthropic or Pixel Agents

## 4. The agent grammar (shared by every world)

Every world must show the same eight things. The engine supplies the state; each world supplies the visuals.

| What the client sees                                      | Engine source                                |
| --------------------------------------------------------- | -------------------------------------------- |
| A workstation per seat, lit when its agent is active      | `Seat`, `isActive`                           |
| The kind of work: read, write, run, search, web, delegate | `currentTool`, grouped by tool name          |
| A prop or animation for that kind of work                 | `agentToolStart.toolName`                    |
| A subagent arriving, working, and leaving                 | `isSubagent`, `parentAgentId`, spawn/despawn |
| "Needs your approval"                                     | `bubbleType === 'permission'`                |
| "Done, waiting for you"                                   | `bubbleType === 'waiting'`                   |
| Idle agents wandering to a rest area                      | IDLE/WALK states, walkable tiles             |
| How full the agent's context is                           | `contextTokens / maxContextTokens`           |

Every agent also gets a floating label with its project name and current activity. Clicking an agent glides the camera to it.

**Speech bubbles and the busy indicator** (added 2026-10-12):

- Each agent has a modern speech bubble over its head: frosted glass, soft shadow and a small tail.
- While an agent works, the bubble shows its current activity followed by an animated three-dot "typing" indicator.
- The bubble changes tone:
  - cobalt-glaze accent (`#2f5bea` family) and a gentle pulse for "Needs your approval". Cobalt-on-white tin-glaze is a 9th-century Basra innovation, so it is period-true, and it is a hue nothing else in the scene glows with. Yousef chose it on 2026-10-12 so the fountain can keep its turquoise water (the fountain was later replaced by an armillary sphere, also at Yousef's request on 2026-10-12; see §6).
  - calm white for "Done, waiting for you"
  - hidden when the agent is idle, leaving just the name
- Each world restyles the bubble to fit, for example with a parchment texture and a calligraphic border in the House of Wisdom.

**Message board** (added 2026-10-12):

- A live feed of notable events: an agent joins, sends out a subagent, needs approval, gets approval, finishes, waits for you, or leaves. Routine reads and edits are left out.
- It appears in two places:
  - as an in-world board, e.g. a notice wall in the House of Wisdom (switched off for now at Yousef's request on 2026-10-15, as too small to read: `world.board` is optional, null for the House of Wisdom)
  - as an on-screen panel listing the latest entries
- In M1 the wording takes on each world's voice, e.g. "The scholar of ledger-api requests your seal".

**Rendering techniques** (Yousef, 2026-10-12, revised the same day after a second opinion; applied from M1 on):

- **Camera:** perspective with a narrow 22° lens, pulled back. A tilt-shift depth of field is always on, except on low-end devices: sharp across the hall, soft at the near and far edges. Clicking an agent glides the focus to it. A director mode for the website demo moves between events.
- **Mood:** golden hour by default. It cross-fades to a lantern-lit dusk when the whole team is idle, and a toggle switches manually. There is no live sun, because two baked lighting setups keep the miniature look rich at a fraction of the cost.
- **Baked materials, live accents.** Architectural surfaces (Samarra bevelled stucco, baked brick, star-pattern floors, Kufic bands) are NOT computed live per pixel. Instead:
  - patterns are generated precisely in code
  - a script turns them into height, normal and colour maps on trim sheets
  - **Blender 5.2 runs headless** (Cycles on the M5 GPU via Metal) to bake lightmaps and ambient occlusion for both moods
  - everything ships as compressed KTX2 textures
- **Custom GLSL shaders** (`onBeforeCompile` extensions of the standard material) are kept for what moves: lamp flicker, the cobalt approval glow, the ink-dissolve spawn and despawn, fabric and palm sway. The courtyard's armillary sphere turns its named nodes on the engine clock (it replaced the fountain's water shader at Yousef's request on 2026-10-12).
- **Signature shot:** sunlight through the pierced stucco window grilles. It is a SpotLight with a projected pattern texture (a gobo, `spotLight.map`): exact and nearly free. It gets the polish budget.
- **Atmosphere:** light shafts as additive cone meshes with scrolling noise, not raymarched volumetrics, plus faint dust motes. Both are dropped on mobile.
- **Post-processing budget:**
  - tone mapping and a warm grade
  - soft bloom on emissive surfaces only
  - tilt-shift
  - screen-space AO only where AO isn't baked
- **gltf-transform 4.5 CLI** (`@gltf-transform/cli`, current 4.5.1) is the last step of the asset pipeline. Every GLB is optimised (Meshopt geometry, KTX2 textures, pruned and deduplicated) by an `assets:optimize` script and loaded with the matching decoders.
- **`backdrop-filter`** frosted glass covers every 2D surface over the scene: speech bubbles, HUD, message-board panel. M0 already uses it. Each surface needs a solid fallback colour where `backdrop-filter` isn't supported.
- **Colour discipline:** agents' robe trims are saturated and clearly apart from the stone, brass and cedar tones. Cobalt glaze is reserved for "needs you": no other element, trim or tool-kind colour sits within 25° of its hue. Turquoise stays free; the armillary globe's sea is a near-black verdigris ink, never navy.

**Detail is the product.** Yousef's standard: the craft in each world's build decides whether this succeeds. Bubbles, the board, props and transitions all get the same care as the architecture, and all are part of the M1 look-development frames.

## 5. Art direction

**Concept: a living miniature.** Each world looks like an exquisite museum diorama that has come alive:

- architecture rendered with real, researched detail
- warm, natural light with soft shadows
- a gentle depth of field
- figures that are stylised, not photoreal

The references are the feel of Tiny Glade, Monument Valley and Sky, not a AAA game.

**Why not realism:** photoreal people fall into the uncanny valley, are expensive, and are near impossible to keep consistent across five worlds. Stylised work looks premium and ages well.

**Figures:** elegant, simplified people in period-appropriate clothing, with one shared body and set of animations across all worlds. Each world restyles their clothing colours and materials. Faces are simplified, not cartoonish.

**Historical honesty:** each world gets a research pass before it's modelled. That means real architecture of the period and no anachronisms; for example, no Ottoman-era lattice screens in 9th-century Baghdad.

**How we validate the look:** M1 starts with **look-development frames**, a few still renders of the hero world at its intended quality. Yousef approves them before the full world is built.

## 6. The hero world: Baghdad, House of Wisdom (9th century, Abbasid)

**Setting:**

- A courtyard hall in Abbasid style: brick arcades with pointed arches, carved stucco ornament in the Samarra style, a central courtyard with a monumental armillary sphere and date palms, and reading alcoves around it. (The courtyard fountain was replaced by the armillary sphere at Yousef's request on 2026-10-12: geocentric, its polar axis at Baghdad's latitude, its cage, sun and moon turning.)
- Tall shelves of codices and scrolls, oil lamps and carpets, and scholars at low writing desks.
- Three of the four north chambers are themed rooms (Yousef, 2026-10-15), west to east: a chemistry lab after Jabir ibn Hayyan and al-Razi, a cartographer's room after al-Khwarizmi's Surat al-Ard and al-Ma'mun's world map, and a biology lab after Hunayn ibn Ishaq, Dioscorides and al-Jahiz. Their wall papers, maps and drawings are generated in code, with no text and no pseudo-script; seas are sea-green, never blue. The date palms stand still like pillars; only their fronds move a little in the wind.
- Late-afternoon light falling through pierced window screens and casting patterned shadows.
- The architecture and geometric ornament are generated in code (precise, licence-free; the same approach worked for an earlier geometry study), then baked into textures and lightmaps in headless Blender (see Rendering techniques).
- Inscription bands use Kufic script with wisdom sayings or "Bayt al-Hikma", not Qur'anic verses: scripture as decoration in a commercial tech demo could land badly with clients. Yousef verifies the Arabic before it ships.
- Windows are pierced stucco or stone grilles. No turned-wood lattice screens, which are a later Mamluk and Ottoman style.

**The grammar in this world:**

| Grammar             | In the House of Wisdom                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| Workstation         | A scholar's alcove with a low desk and lectern; its lamp lights when the agent is active           |
| Read                | Reading a codex, pages turning                                                                     |
| Write / edit        | Writing with a reed pen; the fresh ink glows faintly                                               |
| Run (commands)      | Working a brass astrolabe                                                                          |
| Search              | Scanning a rack of scrolls                                                                         |
| Web                 | A letter or messenger arrives from afar                                                            |
| Delegate / subagent | An apprentice comes out of the stacks, works beside the scholar, then returns into the stacks      |
| Needs approval      | The lamp above the alcove glows cobalt glaze and pulses, and the label reads "Needs your approval" |
| Done, waiting       | The scholar sets down the pen and looks up; the lamp turns a soft white                            |
| Idle                | Walks out to the courtyard armillary sphere and looks up at it, or stands under the palms          |
| Context gauge       | A candle on the desk that burns down as context fills, with the exact figure in the label          |

## 7. The other four worlds (later milestones, same grammar)

| World                            | Setting          | Signature touches                                                               |
| -------------------------------- | ---------------- | ------------------------------------------------------------------------------- |
| Alexandria: the Great Library    | Ptolemaic Egypt  | Scroll stacks; the Pharos lighthouse fire as the approval signal                |
| Florence: a Renaissance workshop | 15th century     | A master and apprentices as agent and subagents; drafting tables and inventions |
| Athens: the Academy              | Classical Greece | Philosophers under the colonnade; agent teams conferring                        |
| Kyoto: a temple scriptorium      | 16th century     | Calligraphy, paper lanterns, raked gravel; the calmest world                    |

Alternate: **Constantinople**, a scriptorium near the Grand Bazaar.

Each world's detailed grammar table is written in its own short spec when its turn comes.

## 8. How it fits together

- **Live mode:** `pixel-agents`-compatible server (our build) → WebSocket → `useExtensionMessages` → `OfficeState` → R3F scene. The scene reads characters every frame and draws them in the active world.
- **Demo mode:** a `DemoTransport` replays a scripted timeline of the same messages on a loop, so there's no server. The timeline is recorded from a real session, cleaned of anything private, and trimmed to about two to three minutes covering all eight grammar elements.
- **Worlds** implement one `WorldSkin` interface: floor plan, environment, workstation, props, signals, spawn effects and camera (architecture notes §5). Each world's code downloads only when it's shown.
- **Floor plans** use the existing tile grid for seats and walking; each world places its models on top of it. Every world needs enough seats for at least 8 agents plus subagents, and an overflow area.
- **Branding:** a `jservo.config.json` sets the world, the brand name, logo and colours, and quality. In demo mode, URL parameters can override it. The logo appears as a HUD badge and once inside the world, for example as a banner in the House of Wisdom.
- **Performance:** redraw only while something moves; slow redraw when all agents are idle; stop when the tab is hidden. Quality tiers (low, balanced, high) step down automatically on slower machines. Repeated objects are drawn in batches.

**Assets:**

- **Generated, then baked:** architecture and ornament are generated in code and baked in headless Blender into KTX2 trim sheets and lightmaps.
- **Free CC0 sources** (Kenney, Quaternius incl. its Universal Animation Library, KayKit, Poly Haven) for generic props, the base animated body and the base clips (idle, walk, sit, gestures), with each pack's licence checked before use. Props (reed pen, codex, astrolabe) attach to the hand bones, and procedural layers (breathing, head turns toward events, robe sway) add the small life.
- **No Mixamo files in the repo:** Adobe allows using its clips inside a product but not redistributing the raw files, and this repo and package go public.
- **Figures** in period clothing are the hardest item. If CC0 can't reach the bar, see the open decision in §9.

## 9. Open decisions for Yousef

1. **Name.** Working title: **Diwan**. In the Abbasid state, the _dīwān_ was the bureau where the empire's administrative work got done: literally "the office", in the language of our hero world. Plain `diwan` is taken on npm (an abandoned 0.0.1); `jservo-diwan` is free, and `@jservo/diwan` needs a free npm organisation.
2. **The look.** Approve "living miniature" as the direction now; the frames at the start of M1 confirm it.
3. **Asset budget.** We go procedural and CC0 first. If the figures don't reach the bar, the options cost money: a paid AI 3D-model tool subscription, or a freelance 3D artist for the figure set. Your call when we get there.

## 10. Milestones

| Milestone          | Delivers                                                                                                                                                       | Done when                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **M0: grey box**   | Repo set up; `webview-3d` scaffolded; the engine driving plain shapes in 3D; live WebSocket and `DemoTransport` both working                                   | All eight grammar elements visible with real sessions and with the demo timeline |
| **M1: hero world** | Look-dev frames, then the House of Wisdom: environment, lighting, figures and animations, props, labels, HUD, quality tiers, on-demand redraw, branding config | Yousef signs off the look; performance targets met                               |
| **M2: ship**       | CLI that serves our interface, `jservo` namespace and coexistence guards, npm publish, Vercel demo, jservo.com embed, repo made public                         | One-command install works on a clean Mac; demo is live on jservo.com             |
| **M3**             | Alexandria and Florence, plus a world switcher                                                                                                                 | Same grammar checks pass in each world                                           |
| **M4**             | Athens and Kyoto, client branding presets, docs                                                                                                                | Five worlds shipped                                                              |

## 11. Testing

- **Upstream suites run unchanged** on every upstream merge: server hooks, transcript parser, runtime, and the front-end engine tests. That way a merge can't silently break detection.
- **New unit tests (vitest):**
  - mapping from engine state to visual state for every grammar element
  - demo timeline playback
  - each world's floor plan gives enough seats and one connected walkable area
- **New browser tests (Playwright):**
  - per world: it loads, logs no console errors, and the canvas isn't blank
  - per world: a screenshot comparison at a fixed point in the demo timeline
  - one end-to-end test with upstream's fake Claude session, proving a real session appears in 3D
- **Manual check per milestone:** Yousef watches it live with his own sessions running.

## 12. Risks

| Risk                                       | Mitigation                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Art quality across five worlds             | One hero world to a high standard first; look-dev frames before the full build             |
| Figure consistency and licences            | One shared body and animation set; licence check per asset pack; the budget decision in §9 |
| Upstream changes break our build           | Thin adapter layer, `PATCHES.md`, upstream tests on every merge                            |
| Shared hook with an installed pixel-agents | Pin the upstream version; hide or guard the hooks off-switch when another server is live   |
| Graphics load when left running all day    | Redraw on demand, quality tiers, pause when hidden                                         |
| Seat capacity with many sessions           | Each floor plan holds 8+ agents plus an overflow area                                      |
| Trademark wording                          | No Ubisoft marks, no "Claude" in the name, credits that name Pixel Agents as the MIT base  |
