# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, etc.) when working with code in this repository. CLAUDE.md is a symlink to this file.

Ultralytics Lite (AGPL-3.0) is a local-only desktop workspace for Claude Code, Codex, Kimi Code, and shell sessions. It keeps agent sessions, files, and Git context in one window without repository indexing, telemetry, or a cloud service. It is built with Tauri 2, Rust, React 19, TypeScript, Tailwind CSS 4, and shadcn's Nova style with Base UI.

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

## Commands

```bash
bun install
bun run check  # Biome lint and native TypeScript check
bun run format # Biome write
bun run build  # type check and production bundle
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
bun run tauri dev   # run the desktop app against the dev server
bun run tauri build # native installer for the current operating system
```

## Architecture

- `src/App.tsx` owns persisted tabs, session lifecycle, the top bar, and app-wide shortcuts.
- `src/terminal.tsx` owns the active xterm instance and its theme; `src/output-store.ts` bounds buffered output for inactive tabs.
- `src/inspector.tsx` owns the lazy file browser, Git status, and provider usage surface.
- `src/code-preview.tsx` owns syntax-highlighted source and rendered Markdown previews.
- `src/new-session-dialog.tsx` owns harness and provider choice, availability, and the project folder.
- `src/settings-dialog.tsx` owns API keys and provider sign-in.
- `src-tauri/src/lib.rs` owns PTYs, provider process launch/resume, session id discovery, file access, Git commands, credential storage, and usage adapters.

A harness runs a session and a model provider bills it: Claude Code, Codex, Kimi Code, and the shell are harnesses; OpenAI and DeepSeek are providers on the Codex harness. Keep provider-specific behavior behind the existing Rust commands.
