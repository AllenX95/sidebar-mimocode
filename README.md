# Sidebar MiMo-Code

[English](#english) | [中文](#中文)

## English

Sidebar MiMo-Code embeds the [MiMo-Code](https://github.com/XiaomiMiMo/MiMo-Code) CLI agent in an Obsidian sidebar. The active vault becomes the agent working directory, so MiMo-Code can read, write, search, and run approved commands against your vault content.

### Features

- Sidebar chat with streaming responses, cancellation, resume, and native MiMo-Code history reload
- Native Build and Plan modes with custom MiMo-Code permission rules
- Inline editing with a diff preview
- Image attachments, instruction mode (`#`), slash commands, skills, and custom subagents
- Multiple chat tabs and automatic conversation titles
- Local-first Obsidian plugin workflow backed by MiMo-Code native runtime behavior

Forking and in-app MCP management are not currently supported. MCP server mentions are therefore not exposed in MiMo-Code chats.

### Requirements

- Obsidian Desktop 1.7.2 or newer
- MiMo-Code CLI 0.1.1 (`npm install -g @mimo-ai/cli`)
- API credentials configured for the model provider used by MiMo-Code

### Installation

#### GitHub release

1. Download `main.js`, `manifest.json`, and `styles.css` from the release.
2. Create `<your-vault>/.obsidian/plugins/sidebar-mimocode/`.
3. Copy the three files into that directory.
4. Enable **Sidebar MiMo-Code** under Obsidian -> Settings -> Community plugins.

#### From source

```bash
git clone https://github.com/AllenX95/sidebar-mimocode.git
cd sidebar-mimocode
npm ci
npm run build
```

Copy `main.js`, `manifest.json`, and `styles.css` to `<your-vault>/.obsidian/plugins/sidebar-mimocode/`.

### Configuration

1. Run MiMo-Code once and configure its model provider credentials.
2. Open Obsidian -> Settings -> Sidebar MiMo-Code.
3. Enable MiMo-Code and confirm the detected `mimo` executable.

Custom permission rules can be added under **Settings -> Sidebar MiMo-Code -> MiMo-Code -> Permissions**. They use MiMo-Code's native permission format; later matching patterns take precedence:

```json
{
  "bash": {
    "*": "ask",
    "git status*": "allow"
  },
  "edit": "ask"
}
```

Custom subagents created by the plugin are stored under `.mimocode/agent/`. MiMo-Code data is read from its platform data directory, or from `MIMOCODE_DB` when configured.

### Development

```bash
npm ci
npm run typecheck
npm run lint
npm run test
npm run build
```

Set `OBSIDIAN_VAULT` in `.env.local` to copy development builds to `.obsidian/plugins/sidebar-mimocode/`.

### License

MIT.

## 中文

Sidebar MiMo-Code 是一个 Obsidian 桌面端插件，用于在侧边栏中嵌入 [MiMo-Code](https://github.com/XiaomiMiMo/MiMo-Code) CLI Agent。当前打开的 vault 会作为 Agent 的工作目录，因此 MiMo-Code 可以在授权后读取、写入、搜索 vault 内容，并执行命令。

### 功能

- 侧边栏聊天，支持流式输出、取消、恢复，以及 MiMo-Code 原生历史记录重载
- 原生 Build / Plan 模式，并支持自定义 MiMo-Code 权限规则
- 行内编辑，并提供 diff 预览
- 图片附件、指令模式（`#`）、斜杠命令、技能和自定义子 Agent
- 多聊天标签页和自动会话标题
- 基于 MiMo-Code 原生运行时行为的本地优先 Obsidian 插件工作流

当前暂不支持 fork 和插件内 MCP 管理，因此 MiMo-Code 聊天中不会暴露 MCP server mention。

### 环境要求

- Obsidian Desktop 1.7.2 或更高版本
- MiMo-Code CLI 0.1.1（`npm install -g @mimo-ai/cli`）
- 已为 MiMo-Code 使用的模型供应商配置好 API 凭据

### 安装

#### 通过 GitHub Release 安装

1. 从 release 页面下载 `main.js`、`manifest.json` 和 `styles.css`。
2. 创建 `<你的-vault>/.obsidian/plugins/sidebar-mimocode/`。
3. 将上述三个文件复制到该目录。
4. 在 Obsidian -> Settings -> Community plugins 中启用 **Sidebar MiMo-Code**。

#### 从源码构建

```bash
git clone https://github.com/AllenX95/sidebar-mimocode.git
cd sidebar-mimocode
npm ci
npm run build
```

构建完成后，将 `main.js`、`manifest.json` 和 `styles.css` 复制到 `<你的-vault>/.obsidian/plugins/sidebar-mimocode/`。

### 配置

1. 先运行一次 MiMo-Code，并完成模型供应商凭据配置。
2. 打开 Obsidian -> Settings -> Sidebar MiMo-Code。
3. 启用 MiMo-Code，并确认插件检测到正确的 `mimo` 可执行文件。

可以在 **Settings -> Sidebar MiMo-Code -> MiMo-Code -> Permissions** 中添加自定义权限规则。规则使用 MiMo-Code 原生权限格式；越靠后的匹配规则优先级越高：

```json
{
  "bash": {
    "*": "ask",
    "git status*": "allow"
  },
  "edit": "ask"
}
```

插件创建的自定义子 Agent 会存储在 `.mimocode/agent/`。MiMo-Code 数据会从平台默认数据目录读取；如果配置了 `MIMOCODE_DB`，则会从该路径读取。

### 开发

```bash
npm ci
npm run typecheck
npm run lint
npm run test
npm run build
```

在 `.env.local` 中设置 `OBSIDIAN_VAULT` 后，开发构建会复制到对应 vault 的 `.obsidian/plugins/sidebar-mimocode/`。

### 许可证

MIT.
