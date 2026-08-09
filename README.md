<a href="https://www.ultralytics.com"><img src="https://raw.githubusercontent.com/ultralytics/assets/main/logo/Ultralytics_Logotype_Original.svg" width="320" alt="Ultralytics logo"></a>

[English](README.md) | [简体中文](README.zh-CN.md)

# ⚡ Ultralytics Lite

[![Ultralytics Actions](https://github.com/ultralytics/lite/actions/workflows/format.yml/badge.svg)](https://github.com/ultralytics/lite/actions/workflows/format.yml)
[![CI](https://github.com/ultralytics/lite/actions/workflows/ci.yml/badge.svg)](https://github.com/ultralytics/lite/actions/workflows/ci.yml)

[![Ultralytics Discord](https://img.shields.io/discord/1089800235347353640?logo=discord&logoColor=white&label=Discord&color=blue)](https://discord.com/invite/ultralytics)
[![Ultralytics Forums](https://img.shields.io/discourse/users?server=https%3A%2F%2Fcommunity.ultralytics.com&logo=discourse&label=Forums&color=blue)](https://community.ultralytics.com)
[![Ultralytics Reddit](https://img.shields.io/reddit/subreddit-subscribers/ultralytics?style=flat&logo=reddit&logoColor=white&label=Reddit&color=blue)](https://reddit.com/r/ultralytics)

Lite is a fast, local workspace for [Claude Code](https://code.claude.com/docs/en/overview), [Codex](https://developers.openai.com/codex/cli) on OpenAI, [DeepSeek](https://api-docs.deepseek.com/quick_start/agent_integrations/codex), or [OpenRouter](https://openrouter.ai/docs/cookbook/coding-agents/codex-cli), [Gemini CLI](https://google-gemini.github.io/gemini-cli/), [Kimi Code](https://www.kimi.com/code), [Qwen Code](https://qwenlm.github.io/qwen-code-docs/en/), and your shell. Keep agent sessions, files, and Git context together without repository indexing, telemetry, or a cloud service.

<div align="center">
  <br>
  <a href="https://github.com/ultralytics/lite/releases/latest"><img src="https://github.com/user-attachments/assets/b4664fe2-fd5b-450f-92e1-bdc83cdab468" width="100%" alt="Ultralytics Lite desktop app"></a>
  <br>
</div>

## ✨ Features

- Run Claude Code, Codex, Gemini CLI, Kimi Code, Qwen Code, and shell sessions side by side
- Run Codex against DeepSeek or OpenRouter without changing your default Codex provider
- Resume session tabs automatically after closing Lite or restarting your computer
- Authenticate once with each provider and reuse its existing local credentials
- Or save an API key per provider in Lite and skip the sign-in flows entirely
- Browse files on demand with syntax highlighting for popular languages
- Preview rendered Markdown safely alongside source files
- See the active Git branch, worktree, and changed files
- Inspect per-session context and provider usage reported by Claude or Codex
- Install signed updates from inside Lite
- Switch between light and dark themes, terminal and code preview included

Lite is intentionally quiet: idle means idle. It does not index your repository, watch every file, read provider tokens, or send telemetry.

## 📦 Install

Download Lite from the [latest GitHub Release](https://github.com/ultralytics/lite/releases/latest). Release assets are built from the same source for macOS, Windows, and Linux.

### macOS

1. Download the asset ending in `_darwin_aarch64.dmg` for an Apple silicon Mac.
2. Open the disk image and drag **Lite** into **Applications**.
3. Open Lite from **Applications**. If macOS blocks the unsigned app, open **System Settings → Privacy & Security**, set **Allow applications from** to **App Store & Known Developers**, select **Open Anyway** for Lite, then confirm.

<div align="center">
  <img src="https://github.com/user-attachments/assets/a7d3a991-91f2-4d9b-ba57-a8d80bbc37f5" width="70%" alt="Approving Lite in macOS System Settings">
</div>

### Windows

1. Download the asset ending in `_windows_x64-setup.exe`.
2. Run the installer, then open **Lite** from the Start menu.
3. If Microsoft Defender SmartScreen appears for the unsigned app, select **More info → Run anyway**.

### Linux

Download the portable asset ending in `_linux_amd64.AppImage`.

```bash
# AppImage
chmod +x Lite_*_linux_amd64.AppImage
./Lite_*_linux_amd64.AppImage
```

After installing Lite, open the Lite menu in the top bar and choose **Check for updates** to install signed updates and restart Lite. Lite never checks for updates in the background.

## 🚀 First Run

Install the provider CLIs you want to use:

- [Claude Code](https://code.claude.com/docs/en/setup)
- [Codex](https://developers.openai.com/codex/cli)
- [Gemini CLI](https://google-gemini.github.io/gemini-cli/)
- [Kimi Code](https://www.kimi.com/code/docs/en/kimi-code-cli/guides/getting-started.html) — Windows also needs Git for Windows
- [Qwen Code](https://qwenlm.github.io/qwen-code-docs/en/)

Open each provider in Lite and complete its normal sign-in once. Every CLI keeps credentials in its own local store, so later Lite sessions reuse the same authentication. Lite never reads or copies those stores. The new-session dialog installs a missing CLI for you.

If you would rather use API keys, open **API keys** in the Lite menu and paste one per provider. Lite keeps them in an owner-only file in its own data folder — the same shape Codex and Kimi already use for their credentials — and passes a key to a session through the environment variable that CLI already reads (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, or `MOONSHOT_API_KEY`). Nothing is written into provider configuration, deleting a key takes effect on the next launch, and app updates keep the file since the updater replaces the bundle and not your data.

<div align="center">
  <img src="https://github.com/user-attachments/assets/2955ffef-6003-43d1-a5c0-51c58e2612c9" width="100%" alt="Saving provider API keys in Lite">
</div>

**Codex · DeepSeek** runs the Codex harness against DeepSeek instead of OpenAI. Saving a DeepSeek key in Lite is enough — Lite then defines the provider for that launch only. To configure it yourself instead, use your own [Codex configuration](https://api-docs.deepseek.com/quick_start/agent_integrations/codex); a `deepseek.config.toml` profile in `$CODEX_HOME` is cleanest:

```toml
model = "deepseek-v4-flash"
model_provider = "deepseek"

[model_providers.deepseek]
name = "deepseek"
base_url = "https://api.deepseek.com/"
wire_api = "responses"
experimental_bearer_token = "<your DeepSeek API key>"
```

Leave `preferred_auth_method` and `forced_login_method` out. Codex applies those globally, and setting them signs you out of ChatGPT the next time it runs. Lite selects the DeepSeek provider per launch, so your default Codex provider and existing OpenAI sessions are untouched, and it never reads or stores the DeepSeek key.

**Codex · OpenRouter** works the same way: save an OpenRouter key in Lite or configure an `openrouter` Codex provider, and Lite launches OpenRouter's current OpenAI model route without changing your default Codex setup.

Choose a project folder, create a session, and work. Lite saves only the local metadata needed to restore tabs; provider conversation history remains owned by the provider CLI.

## 🛠️ Development

Install [Bun](https://bun.sh/), [Rust](https://www.rust-lang.org/tools/install), and the platform-specific [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), then run:

```bash
git clone https://github.com/ultralytics/lite
cd lite
bun install
bun run tauri dev
```

Useful checks:

```bash
bun run check       # Biome and native TypeScript checks
bun run local       # Separate Lite Dev app with a red icon and its own app data
bun run tauri build # Native installer for the current operating system
```

Lite Dev follows `origin/main` directly instead of release assets. Its update button fetches main and,
when a newer commit exists, opens a visible shell session that fast-forwards and rebuilds the app.

The frontend uses React, shadcn/ui Nova with Base UI, Tailwind CSS, Biome, and `tsgo`. Tauri and Rust own local persistence, terminals, Git, files, and provider processes.

## 💡 Contribute

Bug reports and focused feature proposals are welcome in [GitHub Issues](https://github.com/ultralytics/lite/issues). Please keep Lite's core rule in mind: the simplest complete solution wins.

[![Ultralytics open-source contributors](https://raw.githubusercontent.com/ultralytics/assets/main/im/image-contributors.png)](https://github.com/ultralytics/lite/graphs/contributors)

## 📄 License

Lite is available under the [AGPL-3.0 License](LICENSE). For commercial licensing, contact [Ultralytics Licensing](https://www.ultralytics.com/license).

<br>
<div align="center">
  <a href="https://github.com/ultralytics"><img src="https://github.com/ultralytics/assets/raw/main/social/logo-social-github.png" width="3%" alt="Ultralytics GitHub"></a>
  <img src="https://github.com/ultralytics/assets/raw/main/social/logo-transparent.png" width="3%" alt="space">
  <a href="https://www.linkedin.com/company/ultralytics/"><img src="https://github.com/ultralytics/assets/raw/main/social/logo-social-linkedin.png" width="3%" alt="Ultralytics LinkedIn"></a>
  <img src="https://github.com/ultralytics/assets/raw/main/social/logo-transparent.png" width="3%" alt="space">
  <a href="https://twitter.com/ultralytics"><img src="https://github.com/ultralytics/assets/raw/main/social/logo-social-twitter.png" width="3%" alt="Ultralytics Twitter"></a>
  <img src="https://github.com/ultralytics/assets/raw/main/social/logo-transparent.png" width="3%" alt="space">
  <a href="https://youtube.com/ultralytics?sub_confirmation=1"><img src="https://github.com/ultralytics/assets/raw/main/social/logo-social-youtube.png" width="3%" alt="Ultralytics YouTube"></a>
  <img src="https://github.com/ultralytics/assets/raw/main/social/logo-transparent.png" width="3%" alt="space">
  <a href="https://www.tiktok.com/@ultralytics"><img src="https://github.com/ultralytics/assets/raw/main/social/logo-social-tiktok.png" width="3%" alt="Ultralytics TikTok"></a>
  <img src="https://github.com/ultralytics/assets/raw/main/social/logo-transparent.png" width="3%" alt="space">
  <a href="https://ultralytics.com/bilibili"><img src="https://github.com/ultralytics/assets/raw/main/social/logo-social-bilibili.png" width="3%" alt="Ultralytics BiliBili"></a>
  <img src="https://github.com/ultralytics/assets/raw/main/social/logo-transparent.png" width="3%" alt="space">
  <a href="https://discord.com/invite/ultralytics"><img src="https://github.com/ultralytics/assets/raw/main/social/logo-social-discord.png" width="3%" alt="Ultralytics Discord"></a>
</div>
