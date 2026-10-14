# Markdown Converter

macOS menu-bar app. Launching from Applications shows the editor; closing its window keeps the menu-bar icon available. Documents always stop at an editable preview. Saving is explicit.

## Development

Use Node 22.12+ and pnpm 11.20.0:

```sh
pnpm install
pnpm prepare:composio
pnpm start -- --show
```

The renderer now supports **React, TypeScript, Tailwind CSS 4, and shadcn/ui**. Vite compiles the renderer to a local IIFE plus CSS in `renderer-ui/`; Electron loads those files without a web server. Native file handling, worker conversion and account operations remain in Electron. No account credentials are exposed to React.

- `components/ui/`: reusable shadcn components and the supplied `integrations-02.tsx` card design. Keeping this folder and the aliases in `components.json` lets future shadcn components resolve their Button, Badge and utility imports consistently.
- `frontend/`: editor, Connections screen and typed preload API.
- `styles.css`: Tailwind import, theme tokens and desktop layout styles.
- `lib/utils.ts`: shadcn `cn()` class merging helper.
- `components/ui/demo.tsx`: standalone sample integration cards; the app supplies actual destinations and account status instead of sample services.

The existing Electron project was integrated manually rather than replaced by a new scaffold, following [shadcn's existing-project setup](https://ui.shadcn.com/docs/installation/manual) and [Tailwind's Vite setup](https://tailwindcss.com/docs/installation/using-vite). No context provider is required for Button, Badge or Integrations. To add other shadcn components:

```sh
pnpm dlx shadcn@latest add <component>
```

The setup is already included. To recreate it in another plain Electron project, install React/ReactDOM, TypeScript and React types, Vite, Tailwind and `@tailwindcss/vite`, then run `pnpm dlx shadcn@latest init` with TypeScript, CSS variables and `@/components/ui` aliases. Use a relative, locally bundled renderer for Electron's `file:` URL. The card dependencies are `lucide-react`, `class-variance-authority`, `@radix-ui/react-slot`, `clsx` and `tailwind-merge`.

Icons ship locally using Lucide. The application does not fetch third-party favicons or stock images. UI adapts to the minimum 640px window and scrolls at short heights; connection details expand within each card. Native dialogs retain Escape, focus and keyboard behavior.

## Composio sign-in

Each person signs into their own Composio account. No shared backend or developer credential is shipped. The bundled CLI is pinned and verified by `scripts/prepare-composio.js`.

Piped/non-interactive CLI login prints instructions and exits without opening a browser. The app therefore requests `login --no-wait --no-skill-install --yes`, validates and opens the returned Composio HTTPS URL with Electron, and runs `login --poll --no-skill-install --yes` to finish the cached session. The UI shows progress and supports reopening the browser, copying the link, cancellation and retry. The helper's per-user cache remains isolated from developer login data. Login links are transient, never logged or saved in preferences.

Drive and Notion connections use browser authorization. Choose an account and destination in its card. Obsidian, iCloud, Dropbox and custom folder destinations use local folders and need no Composio sign-in.

## Checks and builds

```sh
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm qa
pnpm build
pnpm build:x64
```

`pnpm start`, `pnpm test:e2e`, and `pnpm build` compile the renderer automatically. `pnpm build:ui` compiles it independently. Automated tests never create cloud documents. End-to-end tests require permission to launch Electron; browser sign-in must also be verified on the installed app.

Build signing and notarization are separate release checks. A ZIP produced without a Developer ID identity is a local test build, not a notarized release for colleagues.
