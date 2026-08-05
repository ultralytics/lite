# Lite

Lite is a fast, local workspace for Claude Code, Codex, and your shell. Keep multiple sessions together with the files
and Git state that belong to them—without turning your computer into an indexing service.

## Product principles

- **Effortless:** Install, choose a folder, and start an agent. No account or setup wizard.
- **Quiet:** Idle means idle. No repository indexing, background file watchers, telemetry, or cloud service.
- **Local:** Commands run on your machine using your existing agent installations and credentials.
- **Focused:** Sessions, a lazy file browser, a read-only file viewer, and essential Git context.
- **Small:** Every feature must justify its interface, dependency, CPU, memory, and documentation cost.

Lite targets macOS, Windows, and Linux with a shared Tauri, Rust, and React codebase.

## MVP

- Keep Claude Code, Codex, and ordinary shell sessions in one resizable workspace.
- Resume dormant tabs after an app or system restart. A new Codex tab becomes resumable after its first prompt. Lite
  records only local session metadata; each provider stores its own conversation history.
- Reuse the normal Claude Code and Codex login. Authenticate in the provider CLI once and every later Lite session uses
  that provider's existing local credentials—Lite never reads or stores tokens.
- Browse folders on demand, preview popular source languages with syntax highlighting, and render Markdown safely.
- See the current Git branch, worktree, and changed files without repository indexing.
- Inspect per-session context when Claude reports it and provider-wide limits reported by Claude or Codex.

## Development

Install [Rust](https://www.rust-lang.org/tools/install), the platform-specific
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), and pnpm, then run:

```bash
pnpm install
pnpm tauri dev
```

Build an installer with `pnpm tauri build`.

Lite currently validates the macOS experience first while CI compiles installers on macOS, Windows, and Linux.
