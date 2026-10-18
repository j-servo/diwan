# M0 → M1 carry-over

Generated from the M0 SDD ledger at the close of M0 (2026-10-12). It lists everything M1 inherits: deferred review findings, design notes and the controller's rulings. Git history holds the rest.

## Rulings made during M0

- - Ruling: the controller executes Task 1 itself (repo setup + file transcription), then gatekeeper review as usual — it needs Yousef for the installs mid-task, and an implementer can't ask him — costs if wrong: one task without an independent implementer (the review still gates it).
- - Ruling: Tasks 2, 3 and 4 run as parallel implementers in the same tree, without committing; the controller commits each task's files separately before its review — Yousef explicitly asked for parallel work, the files are disjoint and the plan sequences them that way. This overrides the skill's "never parallel" — costs if wrong: an occasional typecheck noise from a neighbour's half-written file, or redoing one commit.
- - Ruling: implementers and per-task gatekeeper reviews run on Sonnet; the final whole-branch gatekeeper runs on Opus — this is Yousef's model-tier policy (builds/reviews on Sonnet, judgment on Opus) and it outranks the skill's cheapest-tier default — costs if wrong: slightly higher token use than Haiku for the transcription-heavy tasks.
- - Ruling: work on branch `m0-greybox` in the main checkout instead of a separate worktree — a worktree would need a second `npm install`, which auto mode blocks — costs if wrong: none beyond branch hygiene; `main` stays at upstream.
- Task 3: Ruling: the seat test asserted seat tiles are in OfficeState.walkableTiles, but upstream blocks every chair tile (seats unblock only for their owner via withOwnSeatUnblocked) — decided: assert each seat has an orthogonal neighbour in the single connected walkable area (plan text amended); rejected backgroundTiles:1 on hw_seat because it would change upstream seating/walking semantics — costs if wrong: a seat boxed in diagonally-only would pass; low risk with this plan
- Task 2: Ruling: fresh characters have contextTokens 0 with a nonzero default window, so contextRatio gave 0 and every new agent/subagent would show an empty gauge — decided: contextRatio returns null when contextTokens <= 0 (upstream treats zero usage as "no news"; subagents get no gauge), test expectation stays null, plus a new assertion for the zero case (plan text amended) — costs if wrong: an agent at genuinely 0 tokens shows no gauge, which is indistinguishable in practice
- Final review: Ruling: one fix wave covers C1, I1, I2, I3, I4, I6 + minors 1,2,3,4,9 — full list and per-item rulings in final-fix-wave.md — costs if wrong: a larger single diff to re-review
- Final review: Ruling: I4 (lit workstation) is implemented, not waived — spec §4 grammar element + M0 exit criterion — costs if wrong: ~60 lines of grey-box code M1 restyles anyway
- Final review: Ruling: I5 (live check of all eight elements with real sessions) is Yousef's manual check after the wave (spec §11); the fake-session e2e moves to M1 — costs if wrong: M0 live coverage rests on one human check
- Final review: Ruling: minors 5, 6, 7 and D1–D3 carry to M1, minor 8 to M2 — they need installs, teams or architecture work outside M0 — costs if wrong: none for an internal grey box
- Final: parked — background-subagent approval path (server sends only subagentToolPermission, subagentWatch.ts:204-210): HUD needsYou excludes it (M3 ruling) and the board's pendingApproval isn't cleared by subagent messages (I2 ruling) — Ruling: real, carried to M1 — count a subagent permission when its parent has none, and add subagentToolDone/subagentClear to the clearing set — costs if wrong: a background subagent's approval request is under-signalled in M0 (its bubble still shows on the sub-character)

## Deferred findings

- Task 1: minor (deferred): `e2e` script relies on root-hoisted @playwright/test (config arrives in Task 8)
- Task 1: minor (deferred): tsconfig types "node" relies on root-hoisted @types/node
- Task 1: minor (deferred): tsconfig include "vite" was empty until Task 4 (now populated — moot)
- Task 4: minor (deferred): DemoTransport.playLoop overwrites the timers array; steps with at > durationMs would escape dispose() (timeline test enforces at < durationMs)
- Task 4: minor (deferred): DemoTransport.emit has no per-handler try/catch
- Task 4: minor (deferred): late webviewReady mid-loop re-sends setup only, not existing agents (StrictMode-at-start is fine)
- Task 4: minor (deferred): createLiveTransport, the proxyReqWs handler and the plugin resolveId have no unit tests (covered by e2e/live check)
- Task 2: minor (deferred): gaugeColor band edges (0.6, 0.85) untested
- Task 2: minor (deferred): visualSignature bucketing can flip across a rounding boundary (inherent)
- Task 2: minor (deferred): inline hex colours in gaugeColor — upstream's no-inline-colors lint applies to webview-ui only; decide a constants home in M1
- Task 2: minor (deferred, plan-mandated): bubbleContent ignores pose/isSubagent
- Task 3: minor (deferred): no assertion that cushions face their desk (facingDir) — add in M1 when models depend on it
- Task 3: minor (deferred): installWorldCatalog is last-write-wins; the M3 world switcher must re-install on every switch
- Task 3: minor (deferred): unknown ?world= id falls back silently (consider console.warn)
- Task 3: minor (deferred): 4-direction delta list duplicated in worlds.test.ts
- Task 5: minor (deferred): timeline test checks presence, not pairing (permission↔clear per id, sub-tool start↔done, unique sub-tool ids, messages only to open agents, same-instant ordering)
- Task 5: minor (deferred): 34–40 s tail is idle for all agents — showcase pacing for the M2 recorded timeline
- Task 6: minor (deferred, plan-mandated): HUD setCounts every 500 ms re-renders even when unchanged; per-frame toVisualState/visualSignature allocations; always-mounted name-tag Html per avatar
- Task 7: minor (deferred, plan-mandated): unbounded "delegated: <task>" text can overflow the board and panel — clamp in M1
- Task 7: minor (deferred, plan-mandated): duplicate guard is text-only (two real "X finished" collapse; same-named folders alias)
- Task 7: minor (deferred): untested branches — subagentToolPermission, name removal after agentClosed, non-waiting agentStatus
- Task 7: minor (deferred): .board-panel sits over the canvas (pointer events) — M1 HUD layout
- Task 7: minor (deferred): e2e '.world-board contains joined' depends on a join being among the 5 newest — joins recur every loop (~10.5 s at 4×), so the 20 s poll catches one; low flake risk
- Final: parked — background-subagent approval path (server sends only subagentToolPermission, subagentWatch.ts:204-210): HUD needsYou excludes it (M3 ruling) and the board's pendingApproval isn't cleared by subagent messages (I2 ruling) — Ruling: real, carried to M1 — count a subagent permission when its parent has none, and add subagentToolDone/subagentClear to the clearing set — costs if wrong: a background subagent's approval request is under-signalled in M0 (its bubble still shows on the sub-character)
- Final: out-of-scope noted for M1 — I3 reload loop if a server accepts then drops immediately; board vs bubble briefly disagree on agentToolDone; vite --host LAN non-browser read-only watch (same as upstream)

## M1 design notes

- Task 6: M1 design note: south wall occludes south-alcove agents from the default camera — needs diorama cutaway (lower/fade walls nearest the camera)
- Task 6: M1 design note: subagent spawns adjacent to its parent, so their bubbles overlap — needs bubble stacking/offset
- Task 6: M1 design note: bubble text small at default zoom — tune distanceFactor / camera framing
- Final review: verdict "Yes with fixes" — C1 critical (plan-mandated: dev /ws proxy stripped Origin unconditionally → any website could reach the pixel-agents server), I1–I6 important, 10 minors, D1–D3 M1 design notes
- D1 (final review): decouple the engine clock from the render loop so `frameloop="demand"` works; DemoTransport should run on that clock (also fixes hidden-tab timing structurally).
- D2 (final review): render the in-world notice wall in-scene (drei Text or a CanvasTexture), not a DOM Html overlay: occlusion, lighting and DoF.
- D3 (final review): code-split per world; upstream's 2D renderer and sprite modules ride along with useExtensionMessages.
- Not in M0: fake-session e2e with upstream mock-claude (spec §11); vitest mergeConfig with the redirect plugin; declare @playwright/test and pngjs in webview-3d; type-check e2e/. M2: ship LICENSE, NOTICE and third-party notices with the static build.
