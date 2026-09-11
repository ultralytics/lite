# AGENTS.md

Repository guidance for coding agents. `CLAUDE.md` is a symlink to this file.

## Core Principles (CRITICAL)

**Less is more. The simplest solution is the best solution.** The action hierarchy for every change: **Delete > Replace > Add**.

1. **Solve at the owner**: Put behavior in the code path that owns or observes it. For fixes, never guard a symptom with a staleness check, initialization flag, skip-first-call branch, or `try/except` around broken logic; relocate the trigger and delete the wrong path. For features, extend the existing owner rather than creating a parallel abstraction.
2. **Search and reuse first**: Search the whole repository before creating a feature, component, helper, workflow, or utility. Reuse or adapt what exists, consolidate in-scope duplication in the shared owner, and delete duplicate paths. Three similar lines beat a helper nobody else calls.
3. **Delete and modify existing code before creating new code**: Bugfixes are net-negative by default unless deletion and relocation are demonstrably impossible. A new file must first prove it cannot fit cleanly in an existing owner.
4. **Keep scope minimal**: Implement only the simplest complete solution. Avoid impossible-state handling, speculative flags, compatibility shims, policy scaffolding, and unrelated cleanup. Tests are out of scope by default — rely on existing coverage and focused validation; only an uncovered, high-risk regression path justifies minimal new test code.
5. **Ship zero-regression, production-ready changes**: Understand what you remove instead of retaining broken code as insurance. Remove unused imports, functions, types, files, and comments; run relevant cleanup checks; and thoroughly debug and validate the changed owner. Do not break existing features or workflows unless the PR intentionally removes them with evidence.

**Review gate:** for every addition, the reviewer decides whether deleting or changing existing code would have fixed the problem instead — if it would, that is a blocking finding. A missing or thin PR description is never itself a finding.

NEVER push to `main`. NEVER force push. Always start work in a new git worktree (`git worktree add`) on a feature branch and open a PR — never edit the primary checkout directly, it may hold in-flight work.

Repo-specific rules that sharpen these principles here:

- **Stay quiet**: no indexing, file watchers, telemetry, cloud service, or idle background work. Read files, Git state, and provider usage only on explicit user interaction, and bound file and terminal memory.
- **Providers own their sign-in**: never read, copy, or proxy a CLI's credential store. A key the user hands to Lite is Lite's to keep — owner-only in the app data folder, handed to a session through the provider's environment variable, never written into provider configuration.
- **Launch through the user's PATH**: a launched app inherits a bare PATH and the PATH given to a child does not locate the program, so resolve provider CLIs against the login shell's PATH and run them by full path.
- **Platform behavior lives in Rust** and the interface stays platform-neutral, so macOS, Windows, and Linux share one codebase.
- **Use the generated components in `src/components/ui/`** rather than local lookalikes, and verify their Tailwind variants against the attributes Base UI actually emits — `data-orientation` is not `data-vertical`, and a wrong variant fails silently and reads as a styling mistake.
- **Lazy-load terminal and file-rendering dependencies**, and measure startup bundle changes before accepting new UI libraries.
- **Keep the React contract camel-cased through Serde**, and remember every `Option` field arrives as `null` rather than as a missing key.

## PR Workflow

After opening a PR:

1. Wait for the automated PR review and auto-format commit from Ultralytics Actions (`format.yml`), then pull and address every finding.
2. Review the full diff in-session against the Core Principles, performance, and the review gate above, then batch the fixes into one commit and push. After each round of bot or human commits, pull and resume the same reviewer on `<last-reviewed-sha>..HEAD` plus anything that delta could have invalidated. Repeat until the local head matches the live head.
3. Hand off or merge only on a clean final pass: one cold full-diff review returning LGTM with no findings, on a head that is still live at merge time.
4. Never fight other commits: Ultralytics Actions pushes auto-format and header commits, and multiple users may work on the same PR. `git pull --rebase` before pushing; never reset or revert commits you did not author.
5. After the PR merges, clean up: remove local worktrees and branches for it, then `git checkout main && git pull`.

## Commands and validation

```bash
bun install
bun run tauri dev
bun run check
bun test
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
bun run tauri build --debug --no-bundle
```

Use the Bun version in `package.json`, stable Rust, and Tauri's platform prerequisites. `bun install` applies the xterm patch before tests. `bun run local` builds a separate Lite Dev app with separate data. CI builds on macOS, Windows, and Linux; verify all affected platform branches. Terminal/UI changes also need desktop validation with background sessions and alternate screens.

## Where to look

- Session launch and resume → `src/App.tsx` and `spawn_session`/`session_arguments` in `src-tauri/src/lib.rs`.
- Harness and provider registration → `src/types.ts`, `src/provider-auth.tsx`, `src/brand-icons.tsx`, and the native launch/auth/SSH matches in `src-tauri/src/lib.rs`.
- Terminal rendering → `src/terminal.tsx`; output/status → `src/output-store.ts`; files/Git → `src/inspector.tsx`.
- Native commands and platform behavior → `src-tauri/src/`.
- Shared UI primitives → `src/components/ui/`.
- Terminal regression coverage → `tests/terminal-resize.test.ts`.
- Dependency patch → `patches/`.
- Build and checks → `package.json`, `.github/workflows/ci.yml`.

## Pitfalls

- **The xterm patch is load-bearing.** `patches/@xterm%2Fxterm@6.0.0.patch` changes `Viewport.ts`/`Buffer.ts` sources _and_ the built `lib/xterm.mjs`, and switches the package `main` to the ESM build so `bun test` can import it. `@xterm/xterm` is pinned exactly to `6.0.0` for that reason; bumping it means regenerating the patch (`bun patch`) and re-running `tests/terminal-resize.test.ts`. `bun install` must have run before `bun test`.
- **Output is a channel, not an event.** Session bytes arrive through the `Channel` passed to `spawn_session`. A page reload (or any later `spawn_session` for an id whose PTY is still alive) reattaches to the running PTY instead of respawning, and `launch()` returns early when `runs.current` already holds the session. Do not route terminal bytes through `emit`.
- **Private OSC 6973 must stay in sync** between the Rust emitters (`capture_claude_status`, the rebuild command) and the `METADATA` regex in `output-store.ts`; the "output activity" test in `tests/github-items.test.ts` pins the parsing.
- **Codex identity depends on the title.** `CODEX_NOTIFICATION_ARGS` sets `tui.terminal_title=["session-id","thread"]`; `receiveOutput` recognizes the `<hex-id> | <name>` shape and calls `record_codex_session`. Removing or reordering those args breaks resume.
- **`write_text_file` checks before it replaces.** It refuses when the bytes on disk differ from `original` (a check, not a lock: another writer can still land between check and write); the editor must send the contents it last loaded or last saved successfully (`FilesPanel` does). The same rule holds over SSH (`cmp -s`).

Register new Tauri commands in `generate_handler!`, keep heavy work in `spawn_blocking`, and match the Serde payload to its TypeScript interface. Check both local and SSH launch paths when adding a harness or provider.
