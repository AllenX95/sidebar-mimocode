# Sidebar MiMo-Code

Sidebar MiMo-Code embeds the [MiMo-Code](https://github.com/XiaomiMiMo/MiMo-Code) CLI agent in an Obsidian sidebar. The active vault is the agent working directory, so MiMo-Code can read, write, search, and run approved commands against vault content.

## Features

- Sidebar chat with streaming, cancellation, resume, and native MiMo-Code history reload
- Safe, YOLO, and Plan modes
- Inline editing with a diff preview
- Image attachments, instruction mode (`#`), slash commands, skills, and custom subagents
- Multiple chat tabs and automatic conversation titles

Forking and in-app MCP management are not currently supported. MCP server mentions are therefore not exposed in MiMo-Code chats.

## Requirements

- Obsidian Desktop 1.7.2 or newer
- MiMo-Code CLI 0.1.1 (`npm install -g @mimo-ai/cli`)
- API credentials configured for the model provider used by MiMo-Code

## Installation

### GitHub release

1. Download `main.js`, `manifest.json`, and `styles.css` from the release.
2. Create `<your-vault>/.obsidian/plugins/sidebar-mimocode/`.
3. Copy the three files into that directory.
4. Enable **Sidebar MiMo-Code** under Obsidian → Settings → Community plugins.

### From source

```bash
git clone https://github.com/AllenX95/sidebar-mimocode.git
cd sidebar-mimocode
npm ci
npm run build
```

Copy `main.js`, `manifest.json`, and `styles.css` to `<your-vault>/.obsidian/plugins/sidebar-mimocode/`.

## Configuration

1. Run MiMo-Code once and configure its model provider credentials.
2. Open Obsidian → Settings → Sidebar MiMo-Code.
3. Enable MiMo-Code and confirm the detected `mimo` executable.

Custom subagents created by the plugin are stored under `.mimocode/agent/`. MiMo-Code data is read from its platform data directory, or from `MIMOCODE_DB` when configured.

## Development

```bash
npm ci
npm run typecheck
npm run lint
npm run test
npm run build
```

Set `OBSIDIAN_VAULT` in `.env.local` to copy development builds to `.obsidian/plugins/sidebar-mimocode/`.

## License

MIT.
