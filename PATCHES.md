# Upstream files we change

Base: `pixel-agents-hq/pixel-agents` at `d1e007a`. Every upstream file this repo modifies is listed here. Keep the list current so upstream merges stay easy.

| File                | Change                                                                                                                                  | Why                                                                                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`      | Added `"webview-3d"` to `workspaces`                                                                                                    | Builds our 3D front end on the shared React and dependency tree                                                                                                        |
| `package-lock.json` | Workspace entries for `webview-3d`, plus lockfile churn from npm 11 / Node 24 (`libc` constraints and some `"dev": true` flags dropped) | On every upstream merge take upstream's lockfile, then run `npm install` to re-add the workspace. Regenerate under Node 22 (upstream `.nvmrc`) before publishing (M2). |
