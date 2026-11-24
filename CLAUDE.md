<!-- ai-standard: v2026-11-23 (roy-elia/ai-standards) -->
# Working in this repository

The working rules live in `AGENTS.md`, imported here so Claude Code, Codex and other tools read one copy:

@AGENTS.md

Claude-specific notes:
- Folder-level rules go in a `CLAUDE.md` inside that folder (Claude Code does not load folder `AGENTS.md` files when a root `CLAUDE.md` exists).
- Hooks are in `.claude/settings.json`; a hook block is reported, never worked around.
- Personal preferences go in `CLAUDE.local.md` (ignored by Git).
