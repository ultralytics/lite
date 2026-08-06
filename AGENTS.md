# AGENTS.md

Lite is a local-only desktop workspace for Claude Code, Codex, and shell sessions. It uses Tauri 2, Rust, React 19,
TypeScript, Tailwind CSS 4, and shadcn's Nova style with Base UI. `CLAUDE.md` is a symlink to this file.

## Principles

Less is more. Use **Delete > Replace > Add**, solve behavior at its owner, search and reuse before adding, and keep
every change as small as the complete product behavior permits.

- Lite must remain quiet: no indexing, file watchers, telemetry, cloud service, or idle background work.
- Provider CLIs own their own sign-in. Never read, copy, or proxy their credential stores.
- A key the user hands to Lite is Lite's to keep: owner-only in the app data folder, handed to a session through
  the provider's environment variable, never written into provider configuration.
- Read files and Git state only on explicit user interaction. Bound file and terminal memory.
- Keep platform behavior in Rust and the interface platform-neutral so macOS, Windows, and Linux share one codebase.
- Lazy-load terminal and file-rendering dependencies. Measure startup bundle changes before accepting new UI libraries.

Never push to `main` or force push. Work in a feature worktree, open a PR, wait for automated review and formatting,
address every finding, and hand off only after a cold full-diff review on the live head.

## Commands

```bash
bun install
bun run check
bun run build
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
bun run tauri dev
bun run tauri build
```

## Architecture

- `src/App.tsx` owns persisted tabs and session lifecycle.
- `src/terminal.tsx` owns the active xterm instance; `src/output-store.ts` bounds buffered output for inactive tabs.
- `src/inspector.tsx` owns the lazy file browser, Git status, and provider usage surface.
- `src/code-preview.tsx` owns syntax-highlighted source and rendered Markdown previews.
- `src-tauri/src/lib.rs` owns PTYs, provider process launch/resume, file access, Git commands, and usage adapters.

Use the generated components in `src/components/ui/` instead of local lookalikes. Keep provider-specific behavior behind
the existing Rust commands and keep the React contract camel-cased through Serde.
