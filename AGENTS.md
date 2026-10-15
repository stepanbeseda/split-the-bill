# Agent guide

split-the-bill is operated by a coding agent (Claude Code, Codex, …). The app never calls an AI model;
**you** read receipt photos and turn them into validated JSON.

## Adding a bill from a receipt

Follow [`.claude/skills/new-bill/SKILL.md`](.claude/skills/new-bill/SKILL.md) step by step – it is the single source
of truth for both Claude Code and Codex. Short version:

1. Ask for the receipt photo, the people, who paid, the paid total (with tip), payment details and the page language.
2. Write `bills/<slug>.json` (`npm run new-slug`, `npm run iban` help).
3. `npm run validate -- bills/<slug>.json` must pass – items have to add up to the receipt total to the cent.
4. `npm run check`, then deploy (README → Deploy).
5. Ask about anything unreadable instead of guessing.

## Working on the code

- `src/core/` – pure logic (split maths, validation, payment QR payloads). Keep it framework-free and covered by `tests/*.test.ts`.
- `src/server/handler.ts` – the whole API; platform adapters are thin (`netlify/functions/state.mts`, `api/state.ts`).
- `src/web/` – the page, no framework. All user-facing text lives in `src/web/i18n.ts` (English + Czech).
- Run `npm run check` before committing and `npm run test:e2e` for UI changes.
- Never commit files from `bills/` other than `demo.json`.
