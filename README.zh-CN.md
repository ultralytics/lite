<a href="https://www.ultralytics.com"><img src="https://raw.githubusercontent.com/ultralytics/assets/main/logo/Ultralytics_Logotype_Original.svg" width="320" alt="Ultralytics logo"></a>

[English](README.md) | [简体中文](README.zh-CN.md)

# ⚡ Ultralytics Lite

[![Ultralytics Actions](https://github.com/ultralytics/lite/actions/workflows/format.yml/badge.svg)](https://github.com/ultralytics/lite/actions/workflows/format.yml)
[![CI](https://github.com/ultralytics/lite/actions/workflows/ci.yml/badge.svg)](https://github.com/ultralytics/lite/actions/workflows/ci.yml)

[![Ultralytics Discord](https://img.shields.io/discord/1089800235347353640?logo=discord&logoColor=white&label=Discord&color=blue)](https://discord.com/invite/ultralytics)
[![Ultralytics Forums](https://img.shields.io/discourse/users?server=https%3A%2F%2Fcommunity.ultralytics.com&logo=discourse&label=Forums&color=blue)](https://community.ultralytics.com)
[![Ultralytics Reddit](https://img.shields.io/reddit/subreddit-subscribers/ultralytics?style=flat&logo=reddit&logoColor=white&label=Reddit&color=blue)](https://reddit.com/r/ultralytics)

Lite 是一个快速的本地工作区，支持 [Claude Code](https://code.claude.com/docs/en/overview)、基于 OpenAI、[DeepSeek](https://api-docs.deepseek.com/quick_start/agent_integrations/codex) 或 [OpenRouter](https://openrouter.ai/docs/cookbook/coding-agents/codex-cli) 的 [Codex](https://learn.chatgpt.com/docs/codex/cli)、[Gemini CLI](https://google-gemini.github.io/gemini-cli/)、[Kimi Code](https://www.kimi.com/code)、[Qwen Code](https://qwenlm.github.io/qwen-code-docs/en/) 以及你的 shell。它把 agent 会话、文件和 Git 上下文放在一起，同时不做仓库索引、不采集遥测数据，也不依赖任何云服务。

<div align="center">
  <br>
  <a href="https://github.com/ultralytics/lite/releases/latest"><img src="https://github.com/user-attachments/assets/eb526bdc-85f8-4dce-888a-8ed68743a3e4" width="100%" alt="Ultralytics Lite 桌面应用"></a>
  <br>
</div>

## ✨ 功能

- 并排运行 Claude Code、Codex、Gemini CLI、Kimi Code、Qwen Code 和 shell 会话
- 通过 Codex 使用 DeepSeek V4 Flash、Pro 或 OpenRouter，而无需更改默认的 Codex provider
- 重启或关闭后有八秒钟可以撤销，之后 Lite 才会停止终端
- 关闭 Lite 或重启电脑后，会话标签自动恢复
- 每个 provider 只需登录一次，之后复用其已有的本地凭据
- 也可以在 Lite 中为每个 provider 保存 API key，完全跳过登录流程
- 按需浏览带语言图标的文件树，并在编辑器中查找、替换与多光标编辑
- 在源码旁安全地预览渲染后的 Markdown
- 查看当前 Git 分支、worktree 和已更改文件
- 查看 Claude 或 Codex 上报的单会话上下文与用量
- 在 Lite 内安装带签名的更新
- 在浅色与深色主题之间切换，终端和代码预览一同跟随
- 在设置中随意重新绑定键盘快捷键

Lite 刻意保持安静：空闲就是空闲。它不索引你的仓库、不监视每个文件、不读取 provider 令牌，也不发送遥测数据。

## 📦 安装

从 [最新 GitHub Release](https://github.com/ultralytics/lite/releases/latest) 下载 Lite。所有发行包由同一份源码为 macOS、Windows 和 Linux 构建。

### macOS

1. 在 Apple 芯片 Mac 上下载文件名以 `_darwin_aarch64.dmg` 结尾的资源。
2. 打开磁盘映像，把 **Lite** 拖入 **Applications**。
3. 从 **Applications** 打开 Lite。如果 macOS 拦截了这个未签名的应用，打开 **系统设置 → 隐私与安全性**，把 **允许以下来源的应用程序** 设为 **App Store 与已知开发者**，为 Lite 选择 **仍要打开**，然后确认。

<div align="center">
  <img src="https://github.com/user-attachments/assets/a7d3a991-91f2-4d9b-ba57-a8d80bbc37f5" width="70%" alt="在 macOS 系统设置中允许打开 Lite">
</div>

### Windows

1. 下载文件名以 `_windows_x64-setup.exe` 结尾的资源。
2. 运行安装程序，然后从开始菜单打开 **Lite**。
3. 如果 Microsoft Defender SmartScreen 对这个未签名的应用弹出提示，选择 **更多信息 → 仍要运行**。

### Linux

下载文件名以 `_linux_amd64.AppImage` 结尾的便携版资源。

```bash
# AppImage
chmod +x Lite_*_linux_amd64.AppImage
./Lite_*_linux_amd64.AppImage
```

安装 Lite 之后，点击顶栏的齿轮打开 **设置**，在“关于”中选择 **Check for Updates**，即可安装带签名的更新并重启 Lite。Lite 从不在后台检查更新。

## 🚀 首次运行

安装你需要使用的 provider CLI：

- [Claude Code](https://code.claude.com/docs/en/setup)
- [Codex](https://learn.chatgpt.com/docs/codex/cli)
- [Kimi Code](https://www.kimi.com/code/docs/en/kimi-code-cli/guides/getting-started.html) —— Windows 还需要安装 Git for Windows

在 Lite 中打开每个 provider 并完成一次常规登录。每个 CLI 都把凭据保存在自己的本地存储中，因此之后的 Lite 会话会复用同一份认证信息。Lite 从不读取或复制这些存储。当某个 CLI 缺失时，新建会话对话框会提示你，并给出对应的安装指引。

如果你更愿意使用 API key，打开 **设置 › API Keys**，为每个 provider 粘贴一个 key。Lite 会把它们保存在自己数据目录下仅属主可读的文件中——与 Codex 和 Kimi 保存自身凭据的方式一致——并通过该 CLI 本来就会读取的环境变量（`ANTHROPIC_API_KEY`、`OPENAI_API_KEY`、`DEEPSEEK_API_KEY`、`OPENROUTER_API_KEY`、`GEMINI_API_KEY` 或 `MOONSHOT_API_KEY`）把 key 传给会话。Qwen Code 自行负责其区域 provider 与认证设置。不会写入任何 provider 配置文件；删除 key 会在下次启动时生效；应用更新也不会丢失该文件，因为更新程序替换的是应用包而不是你的数据。

<div align="center">
  <img src="https://github.com/user-attachments/assets/d3ccbfcf-bf4c-498a-8f7f-f0a134a90e92" width="100%" alt="在 Lite 中保存 provider API key">
</div>

**Codex · DeepSeek** 使用 Codex 作为 harness，通过 OpenAI Responses API 运行 DeepSeek V4 Flash 或 Pro。在 Lite 中保存 DeepSeek key 即可——Lite 只会为该次启动定义这个 provider。如果你想自己配置，请使用你自己的 [Codex 配置](https://api-docs.deepseek.com/quick_start/agent_integrations/codex)；在 `$CODEX_HOME` 中放一个 `deepseek.config.toml` profile 最为干净：

```toml
model = "deepseek-v4-flash" # 或使用能力最强的 "deepseek-v4-pro"
model_provider = "deepseek"

[model_providers.deepseek]
name = "deepseek"
base_url = "https://api.deepseek.com/"
wire_api = "responses"
experimental_bearer_token = "<你的 DeepSeek API key>"
```

请不要写入 `preferred_auth_method` 和 `forced_login_method`。Codex 会全局应用这两项，一旦设置，下次运行时你会被登出 ChatGPT。Lite 只在每次启动时选择 DeepSeek provider，因此你的默认 Codex provider 和已有的 OpenAI 会话都不受影响，Lite 也不会读取或保存 DeepSeek key。

选择一个项目文件夹，创建会话，然后开始工作。Lite 只保存恢复标签所需的本地元数据；provider 的对话历史仍归 provider CLI 所有。

## 🛠️ 开发

安装 [Bun](https://bun.sh/)、[Rust](https://www.rust-lang.org/tools/install) 以及对应平台的 [Tauri 前置依赖](https://v2.tauri.app/start/prerequisites/)，然后运行：

```bash
git clone https://github.com/ultralytics/lite
cd lite
bun install
bun run tauri dev
```

常用检查：

```bash
bun run check       # Biome 与原生 TypeScript 检查
bun run local       # 可直接双击运行、带红色图标的 Lite Dev 应用包
bun run tauri build # 为当前操作系统构建原生安装包
```

前端使用 React、shadcn/ui Nova（基于 Base UI）、Tailwind CSS、Biome 和 `tsgo`。Tauri 与 Rust 负责本地持久化、终端、Git、文件以及 provider 进程。

## 💡 贡献

欢迎在 [GitHub Issues](https://github.com/ultralytics/lite/issues) 提交 bug 报告和聚焦的功能建议。请记住 Lite 的核心原则：最简单且完整的方案胜出。

[![Ultralytics open-source contributors](https://raw.githubusercontent.com/ultralytics/assets/main/im/image-contributors.png)](https://github.com/ultralytics/lite/graphs/contributors)

## 📄 许可证

Lite 基于 [AGPL-3.0 许可证](LICENSE) 提供。如需商业许可，请联系 [Ultralytics Licensing](https://www.ultralytics.com/license)。

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
