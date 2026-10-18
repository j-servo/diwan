# Diwan (webview-3d)

The 3D, J. Servo edition front end for Pixel Agents. It reuses upstream's engine and message hook unchanged and renders the agents as a 3D scene.

## Prerequisites

- `npm install` at the repo root (one install covers all workspaces).
- For live mode, the `diwan` server (below).

## Live mode: `diwan`

```bash
npm run build:diwan      # from the repo root, once: bundles the server, builds this hall
npm run diwan            # starts the server and opens http://127.0.0.1:3200/
```

`npm link` at the repo root makes it a global `diwan` command. Options: `--port N` (default 3200, always bound to 127.0.0.1), `--no-open` and `--steer` (launch and steer sessions from the hall; see the repo README and "Read-only by design" below). If a Diwan server is already running, `diwan` opens it instead of starting a second one. Ctrl-C stops it.

The hall shows every Claude Code session on the machine. It works without hooks by reading the session transcripts (approval requests show about 7 seconds late). `diwan hooks install` adds hooks for instant events and `diwan hooks uninstall` removes them; `diwan hooks status` shows what is installed. Running the command is the consent: the server itself never touches `~/.claude/settings.json`. State lives in `~/.diwan/`.

Live mode shows real project folder names. The demo (`?demo=1`) is the cleaned showcase, so do not screen-record live mode for clients.

## Live dev

```bash
diwan --no-open                              # the server, in one terminal
npm --workspace webview-3d run dev -- --port 5180
```

Open `http://localhost:5180/`. The dev server proxies `/ws` to the Diwan server on port 3200; set `DIWAN_SERVER_PORT` if yours runs elsewhere.

## Demo (no server)

Add `?demo=1` to the URL. `?demo=1&demoSpeed=N` plays the scripted sessions N times faster (capped at 20).

## Worlds

Two worlds are registered (`src/worlds/registry.ts`): the House of Wisdom (default, baked) and a **House of Life (preview)** scaffold (the same grid in plain shapes, scribes and pupils, no baked assets yet). Pick one with `?world=<id>`, or with the **World** dropdown in the HUD (it replaces the plain world name and shows only when more than one world is registered). The dropdown reloads the page into `?world=<id>` and remembers the choice in `localStorage` when the URL names none; an unknown id falls back to the first world. `frames.spec.ts` takes `DIWAN_WORLD=<id>` (and `DIWAN_FRAMES_OUT=<dir>`), `npm run perf` takes `-- --world <id>`.

Each world defines its own **needs-you signal colour** (`WorldDefinition.signal`): cobalt `#2f5bea` for the House of Wisdom, amethyst `#A21CAF` for the House of Life. The page sets it once (`src/worlds/applyWorld.ts`): the runtime reads `activeSignal()` and the CSS reads `--needs-you` / `--needs-you-ink` on `<html>`, which also carries `data-world="<id>"` for per-world CSS blocks. No saturated colour may sit near a world's signal hue (25 deg for cobalt, 40 deg for amethyst: 255-335 deg forbidden). Tool-kind colours keep at least 40 deg from every world's signal, which is why **Web is lime `#6FD62A`** in every world.

## Click to inspect

The hall answers "what is it doing, and what does it want from me?" without controlling anything.

- **Click a scholar or apprentice**: the camera glides to it and a card opens at the right edge (a bottom sheet on narrow screens; it takes the message board's place while open). Clicking another figure switches cards.
- **The card** shows the persona and session label, the folder, a state line (`Working · 3 min`, `Waiting for you · 40 s`, `Finished its turn · idle 2 min`, `Left the hall`), what it is doing now (the status in bold, the fuller action under it in monospace), the last five finished actions, and its apprentices (click one for its own card: parent, task, tools). While an approval is pending, a cobalt block says what it wants to run and reads `Answer it in your terminal`. Cobalt appears nowhere else on the card.
- **Close**: Esc, clicking empty floor, or the close button. Each releases the camera. A scholar that leaves shows `Left the hall` for 3 s, then the card closes.
- **Hover** a figure: the cursor becomes a pointer and a one-line peek near it shows its title and status. Nothing opens and the camera stays put. The pointer is looked at at most every 50 ms, and not while still; touch has no hover.
- **The HUD's "needs you"** is a button: it opens the scholar whose approval is oldest; each further click moves to the next.
- **Where the text comes from**: `status` stays the short form the bubble uses. `detail` (optional on `agentToolStart` and `subagentToolStart`) is the fuller action, filled by the server: the whole Bash command, the file path (relative to the project folder), the grep/glob pattern and path, the URL or query, the task and first prompt line, or a compact `key: value` summary. It is capped at 400 characters and 6 lines, and obvious secrets (bearer tokens, `sk-` keys, GitHub and Slack tokens, AWS key ids, `password=` style pairs, passwords in URLs) are replaced by `•••` before it leaves the server (`server/src/toolDetail.ts`).
- **Data**: a pure reducer over server messages (`src/inspect/inspectModel.ts`) holds it all client-side; clocks count from the client's own receive times.

## Tests

```bash
npm --workspace webview-3d test        # unit tests
npm --workspace webview-3d run typecheck
npm --workspace webview-3d run build   # typecheck + production build to dist/webview-3d
npm --workspace webview-3d run e2e     # browser smoke tests: the demo build, and live mode through a real diwan server
```

## Read-only by design (and steer mode)

Under plain `diwan` the client sends only `webviewReady` and never forwards a token, so it cannot change settings, layouts, seats or hooks.

Under `diwan --steer` the server puts a fresh per-run 256-bit control token in the page (`<meta name="diwan-steer">`, loopback `Host` only, `no-store`, not frameable). The page reads it, removes the tag, and sends `{type:"steerHello", token}` as its first WebSocket message. A connection earns the control scope only with that token AND a present Origin of exactly `http://127.0.0.1:<port>` or `http://localhost:<port>` (`diwan --steer --dev` also accepts the Vite origin `:5173`; the dev page cannot get the token, so this is for gate testing only). Anything else stays read-only and is closed on any control message. Control messages are WebSocket-only, schema-checked, rate-limited to 20 per second, and only ever target a scholar the hall launched. The client shows Approve/Deny with the whole command above two buttons pinned to the card's foot; Deny holds the focus, Approve stays disabled for 700 ms after each request, and no key approves. WebSearch (exact tool name, query-only input) is the one tool launched scholars run without asking; it is audited as `auto-approve`. A scholar's replies (`steerReply`) are sent to control sockets only. Tests: `server/__tests__/steer/` and `e2e/steer.spec.ts` (a fake runner: no Claude session ever starts).

The dev proxy accepts a `/ws` upgrade only from a loopback host and, when an Origin is present, only the same origin; any other website gets a 404.
