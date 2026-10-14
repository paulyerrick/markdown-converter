# Markdown Converter

Electron menu-bar app for macOS. Use pnpm for dependencies and scripts.

The renderer uses React/TypeScript in `frontend/`, shared shadcn components in
`components/ui/`, and Tailwind in `styles.css`. Vite builds `renderer-ui/` before
start, tests, and packaging; keep its output self-contained for Electron's file URL.
`pnpm typecheck` and `pnpm test:ui` check the typed renderer and its interactions.

- `pnpm qa`: converter/destination/connection tests plus real Electron UI smoke tests.
- `pnpm start -- --show`: show the development app.
- `pnpm prepare:composio`: download the pinned, checksum-verified Composio bundle for the host architecture.
- `pnpm build`: package a macOS DMG for the host architecture.
- `pnpm build:x64`: package for Intel Macs.

Keep conversion work in `conversion-worker.js`; main-process parsing blocks macOS event handling. Conversion must always stop at the editable preview, with saving initiated explicitly.

Composio is bundled through `scripts/prepare-composio.js` and `extraResources`. Each person signs into their own Composio account in a browser. The app uses its own per-user `COMPOSIO_CACHE_DIR`; never package or copy developer login data, API keys, or the contents of `~/.composio`. No shared backend is required. Parse Composio's `storedInFile` result envelopes before consuming tool output.

Non-interactive Composio login only prints a URL. Preserve stdout, explicitly open
the validated Composio HTTPS link, and run `login --poll` to complete authorization.
Keep login links transient, provide visible failure/retry/cancel states, and pass
`--no-skill-install` on both login commands.

Cloud writes in automated tests use fake responses. Do not create test documents in users' accounts without authorization. Live read-only connection/picker checks are useful in addition to tests. Keep arbitrary document content out of subprocess arguments; use stdin or temporary files.

Do not reintroduce automatic Save As or blur-to-hide behavior. The macOS app signature and notarization are separate release checks; a successful build alone does not establish notarization.
