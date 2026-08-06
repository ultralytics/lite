<a href="https://www.ultralytics.com/"><img src="https://raw.githubusercontent.com/ultralytics/assets/main/logo/Ultralytics_Logotype_Original.svg" width="320" alt="Ultralytics logo"></a>

# ⚡ Ultralytics Lite

[![Ultralytics Actions](https://github.com/ultralytics/lite/actions/workflows/format.yml/badge.svg)](https://github.com/ultralytics/lite/actions/workflows/format.yml)
[![CI](https://github.com/ultralytics/lite/actions/workflows/ci.yml/badge.svg)](https://github.com/ultralytics/lite/actions/workflows/ci.yml)

[![Ultralytics Discord](https://img.shields.io/discord/1089800235347353640?logo=discord&logoColor=white&label=Discord&color=blue)](https://discord.com/invite/ultralytics)
[![Ultralytics Forums](https://img.shields.io/discourse/users?server=https%3A%2F%2Fcommunity.ultralytics.com&logo=discourse&label=Forums&color=blue)](https://community.ultralytics.com/)
[![Ultralytics Reddit](https://img.shields.io/reddit/subreddit-subscribers/ultralytics?style=flat&logo=reddit&logoColor=white&label=Reddit&color=blue)](https://reddit.com/r/ultralytics)

Lite is a fast, local workspace for [Claude Code](https://code.claude.com/docs/en/overview), [Codex](https://developers.openai.com/codex/cli), and your shell. Keep agent sessions, files, and Git context together without repository indexing, telemetry, or a cloud service.

<div align="center">
  <br>
  <a href="https://github.com/ultralytics/lite/releases/latest"><img src="https://github.com/ultralytics/lite/blob/eeb99328e396cbb55508a7d34fce96f6cf0e86f1/lite-product-full.png?raw=true" width="100%" alt="Ultralytics Lite desktop app"></a>
  <br>
</div>

## ✨ Features

- Run Claude Code, Codex, and shell sessions side by side
- Resume session tabs after closing Lite or restarting your computer
- Authenticate once with each provider and reuse its existing local credentials
- Browse files on demand with syntax highlighting for popular languages
- Preview rendered Markdown safely alongside source files
- See the active Git branch, worktree, and changed files
- Inspect per-session context and provider usage reported by Claude or Codex
- Switch between light and dark themes

Lite is intentionally quiet: idle means idle. It does not index your repository, watch every file, read provider tokens, or send telemetry.

## 📦 Install

Download Lite from the [latest GitHub Release](https://github.com/ultralytics/lite/releases/latest). Release assets are built from the same source for macOS, Windows, and Linux.

### macOS

1. Download `Lite_0.0.1_darwin_aarch64.dmg` for Apple silicon or `Lite_0.0.1_darwin_x64.dmg` for an Intel Mac.
2. Open the disk image and drag **Lite** into **Applications**.
3. Open Lite from **Applications**. If macOS blocks this first unsigned release, open **System Settings → Privacy & Security**, select **Open Anyway** for Lite, then confirm.

### Windows

1. Download `Lite_0.0.1_windows_x64-setup.exe` (or the `.msi` asset if you prefer Windows Installer).
2. Run the installer, then open **Lite** from the Start menu.
3. If Microsoft Defender SmartScreen appears for this early unsigned release, select **More info → Run anyway**.

### Linux

Download `Lite_0.0.1_linux_amd64.AppImage` for a portable app, `Lite_0.0.1_linux_amd64.deb` for Debian or Ubuntu, or the `.rpm` asset for Fedora-compatible distributions.

```bash
# AppImage
chmod +x Lite_0.0.1_linux_amd64.AppImage
./Lite_0.0.1_linux_amd64.AppImage

# Debian or Ubuntu
sudo apt install ./Lite_0.0.1_linux_amd64.deb

# Fedora
sudo dnf install ./Lite_0.0.1_linux_x86_64.rpm
```

## 🚀 First Run

Install the provider CLIs you want to use:

- [Claude Code](https://code.claude.com/docs/en/setup)
- [Codex](https://developers.openai.com/codex/cli)

Open each provider in Lite and complete its normal sign-in once. Claude Code and Codex keep credentials in their standard local stores, so every later Lite session reuses the same authentication. Lite never copies or stores those tokens.

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
