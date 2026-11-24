---
owner: roy-elia
status: active
last_updated: 2026-11-24
source_of_truth: local
tags: [index]
---
# docs index

Purpose: shared, durable context for dictation-overlay. Read this before placing or finding a file.

There are no other files under `docs/` yet. The long-form document is the root README.

| File | Summary (one line) | Read when | Owner |
|---|---|---|---|
| `README.md` | Pillars, build, packaging and signing, how focus, ducking and the permission guide work, caveats (root, outside `docs/`) | Any change to the app or its build | roy-elia |

## Where does X go
| I am producing | Put it in | Owning skill | Tracked |
|---|---|---|---|
| Main-process code | `src/main` | manual | Yes |
| Renderer page or script | `src/renderer` | manual | Yes |
| Preload bridge or shared IPC definitions | `src/preload`, `src/shared` | manual | Yes |
| Static assets (sounds, images) | `src/assets` | manual | Yes |
| Native Node add-on (C/C++/Obj-C) | `native/<addon>` | manual | Yes |
| Swift permission-guide helper | `permission-guide` | manual | Yes |
| Build, sign or icon script | `scripts` | manual | Yes |
| Packaging resources (icon, entitlements) | `build` | manual | Yes |
| A decision and its reasoning | `docs/decisions/YYYY-MM-DD-<topic>.md` (created on first use) | manual | Yes |
| Session handoff | `state/dictation-overlay/HANDOFF.md` (created on first use) | session-handoff | Yes |
| Exploratory draft | `output/` | any | No |
| Scratch or pulled copy of an external page | `temp/` | any | No |

## Sources of truth
| Content | System of record | Role of this repo | Link recorded in |
|---|---|---|---|
| Code, docs, decisions | This repository | Owner record | none |
| Released builds and update feed | GitHub Releases on roy-elia/dictation-overlay | Source only | none |
| Tickets and bugs | GitHub Issues on dictation-overlay | Link only | Pull request description |

## Rules for this folder
- Every Markdown file here starts with front matter (`templates/front-matter.md` in ai-standards).
- Summaries come before raw sources; raw files go in a `sources/` folder beside their summary.
