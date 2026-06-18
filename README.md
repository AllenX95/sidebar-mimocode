# Obsidian MiMo

An Obsidian plugin that embeds [MiMo-Code](https://github.com/XiaomiMiMo/MiMo-Code) CLI Agent in your vault. Your vault becomes the agent's working directory — file read/write, search, bash, and multi-step workflows all work out of the box.

Based on [Claudian](https://github.com/yishentu/claudian) by Yishen Tu (MIT License).

## Features & Usage

Open the chat sidebar from the ribbon icon or command palette. Select text and use the hotkey for inline edit. Everything works like your familiar MiMo-Code agent — talk to the agent, and it reads, writes, edits, and searches files in your vault.

**Inline Edit** — Select text or start at the cursor position + hotkey to edit directly in notes with word-level diff preview.

**Slash Commands & Skills** — Type `/` or `$` for reusable prompt templates or Skills from user- and vault-level scopes.

**`@mention`** - Type `@` to mention anything you want the agent to work with, vault files, subagents, MCP servers, or files in external directories.

**Plan Mode** — Toggle via `Shift+Tab`. The agent explores and designs before implementing, then presents a plan for approval.

**Instruction Mode (`#`)** — Refined custom instructions added from the chat input.

**MCP Servers** — Connect external tools via Model Context Protocol (stdio, SSE, HTTP).

**Multi-Tab & Conversations** — Multiple chat tabs, conversation history, fork, resume, and compact.

## Requirements

- [MiMo-Code CLI](https://github.com/XiaomiMiMo/MiMo-Code) installed
- MiMo-Code configured with API keys for your preferred LLM provider
- Obsidian v1.7.2+
- Desktop only (macOS, Linux, Windows)

## Installation

### From GitHub Release

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release
2. Create a folder called `obsidian-mimo` in your vault's plugins folder:
   ```
   <your-vault>/.obsidian/plugins/obsidian-mimo/
   ```
3. Place the downloaded files in that folder
4. Enable the plugin in Obsidian → Settings → Community plugins

### From Source

```bash
git clone https://github.com/AllenX95/obsidian-mimo.git
cd obsidian-mimo
npm install
npm run build
```

Copy `main.js`, `manifest.json`, and `styles.css` to your vault's plugins folder.

## Configuration

1. Install MiMo-Code CLI: `npm install -g @mimo-ai/cli`
2. Configure MiMo-Code with your API keys (see [MiMo-Code documentation](https://github.com/XiaomiMiMo/MiMo-Code))
3. Open Obsidian → Settings → Obsidian MiMo → Enable the plugin
4. The plugin will auto-detect the `mimo` binary

## Development

```bash
npm install
npm run dev
```

This will watch for changes and copy the built files to your Obsidian vault plugin folder.

## License

MIT License - See [LICENSE](LICENSE) for details.

Based on [Claudian](https://github.com/yishentu/claudian) by Yishen Tu.
