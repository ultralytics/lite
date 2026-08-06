<a href="https://www.ultralytics.com/"><img src="https://raw.githubusercontent.com/ultralytics/assets/main/logo/Ultralytics_Logotype_Original.svg" width="320" alt="Ultralytics logo"></a>

# ⚡ Ultralytics Lite

[![Ultralytics Actions](https://github.com/ultralytics/lite/actions/workflows/format.yml/badge.svg)](https://github.com/ultralytics/lite/actions/workflows/format.yml)
[![CI](https://github.com/ultralytics/lite/actions/workflows/ci.yml/badge.svg)](https://github.com/ultralytics/lite/actions/workflows/ci.yml)

[![Ultralytics Discord](https://img.shields.io/discord/1089800235347353640?logo=discord&logoColor=white&label=Discord&color=blue)](https://discord.com/invite/ultralytics)
[![Ultralytics Forums](https://img.shields.io/discourse/users?server=https%3A%2F%2Fcommunity.ultralytics.com&logo=discourse&label=Forums&color=blue)](https://community.ultralytics.com/)
[![Ultralytics Reddit](https://img.shields.io/reddit/subreddit-subscribers/ultralytics?style=flat&logo=reddit&logoColor=white&label=Reddit&color=blue)](https://reddit.com/r/ultralytics)

Lite is a fast, local workspace for [Claude Code](https://code.claude.com/docs/en/overview), [Codex](https://developers.openai.com/codex/cli), [Kimi Code](https://www.kimi.com/code), and your shell. Keep agent sessions, files, and Git context together without repository indexing, telemetry, or a cloud service.

<div align="center">
  <br>
  <a href="https://github.com/ultralytics/lite/releases/latest"><img src="https://github.com/ultralytics/lite/blob/eeb99328e396cbb55508a7d34fce96f6cf0e86f1/lite-product-full.png?raw=true" width="100%" alt="Ultralytics Lite desktop app"></a>
  <br>
</div>

## ✨ Features

- Run Claude Code, Codex, Kimi Code, and shell sessions side by side
- Run Codex against DeepSeek when your Codex configuration provides that model
- Resume session tabs automatically after closing Lite or restarting your computer
- Authenticate once with each provider and reuse its existing local credentials
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

1. Download `Lite_0.0.2_darwin_aarch64.dmg` for an Apple silicon Mac.
2. Open the disk image and drag **Lite** into **Applications**.
3. Open Lite from **Applications**. If macOS blocks this first unsigned release, open **System Settings → Privacy & Security**, select **Open Anyway** for Lite, then confirm.

### Windows

1. Download `Lite_0.0.2_windows_x64-setup.exe`.
2. Run the installer, then open **Lite** from the Start menu.
3. If Microsoft Defender SmartScreen appears for this early unsigned release, select **More info → Run anyway**.

### Linux

Download the portable `Lite_0.0.2_linux_amd64.AppImage`.

```bash
# AppImage
chmod +x Lite_0.0.2_linux_amd64.AppImage
./Lite_0.0.2_linux_amd64.AppImage
```

After installing 0.0.2, open the Lite menu in the top bar and choose **Check for updates** to install signed updates and restart Lite. Lite never checks for updates in the background.

## 🚀 First Run

Install the provider CLIs you want to use:

- [Claude Code](https://code.claude.com/docs/en/setup)
- [Codex](https://developers.openai.com/codex/cli)
- [Kimi Code](https://www.kimi.com/code/docs/en/kimi-code-cli/guides/getting-started.html) — Windows also needs Git for Windows

Open each provider in Lite and complete its normal sign-in once. Every CLI keeps credentials in its own local store, so later Lite sessions reuse the same authentication. Lite never copies or stores those tokens. The new-session dialog tells you when a CLI is missing and links to its setup guide.

**Codex · DeepSeek** runs the Codex harness against DeepSeek instead of OpenAI. Configure the DeepSeek provider in your own [Codex configuration](https://api-docs.deepseek.com/quick_start/agent_integrations/codex) — a `deepseek.config.toml` profile in `$CODEX_HOME` is cleanest:

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
bun run tauri build # Native installer for the current operating system
```

The frontend uses React, shadcn/ui Nova with Base UI, Tailwind CSS, Biome, and `tsgo`. Tauri and Rust own local persistence, terminals, Git, files, and provider processes.

## 💡 Contribute

Bug reports and focused feature proposals are welcome in [GitHub Issues](https://github.com/ultralytics/lite/issues). Please keep Lite's core rule in mind: the simplest complete solution wins.

[![Ultralytics open-source contributors](https://raw.githubusercontent.com/ultralytics/assets/main/im/image-contributors.png)](https://github.com/ultralytics/lite/graphs/contributors)

## 📄 License

Lite is available under the [AGPL-3.0 License](LICENSE). For commercial licensing, contact [Ultralytics Licensing](https://www.ultralytics.com/license).

<br>
<div align="center">
  <a href="https://github.com/ultralytics"><img src="https://raw.githubusercontent.com/ultralytics/assets/main/social/logo-social-github.png" width="3%" alt="Ultralytics GitHub"></a>
  <img src="https://raw.githubusercontent.com/ultralytics/assets/main/social/logo-transparent.png" width="3%" alt="space">
  <a href="https://www.linkedin.com/company/ultralytics/"><img src="https://raw.githubusercontent.com/ultralytics/assets/main/social/logo-social-linkedin.png" width="3%" alt="Ultralytics LinkedIn"></a>
  <img src="https://raw.githubusercontent.com/ultralytics/assets/main/social/logo-transparent.png" width="3%" alt="space">
  <a href="https://twitter.com/ultralytics"><img src="https://raw.githubusercontent.com/ultralytics/assets/main/social/logo-social-twitter.png" width="3%" alt="Ultralytics Twitter"></a>
  <img src="https://raw.githubusercontent.com/ultralytics/assets/main/social/logo-transparent.png" width="3%" alt="space">
  <a href="https://www.youtube.com/ultralytics"><img src="https://raw.githubusercontent.com/ultralytics/assets/main/social/logo-social-youtube.png" width="3%" alt="Ultralytics YouTube"></a>
  <img src="https://raw.githubusercontent.com/ultralytics/assets/main/social/logo-transparent.png" width="3%" alt="space">
  <a href="https://discord.com/invite/ultralytics"><img src="https://raw.githubusercontent.com/ultralytics/assets/main/social/logo-social-discord.png" width="3%" alt="Ultralytics Discord"></a>
</div>
