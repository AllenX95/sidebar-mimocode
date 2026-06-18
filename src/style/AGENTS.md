# CSS Style Guide

CSS modules under `src/style/` are bundled into root `styles.css` by `npm run build:css`.

## Conventions

- Prefix plugin-owned selectors and variables with `sidebar-mimocode-`.
- Prefer BEM-lite names: `.sidebar-mimocode-{block}-{element}` and `--{modifier}`.
- Shared Obsidian selectors and generic state classes may remain unprefixed.
- Use Obsidian theme tokens such as `--background-*`, `--text-*`, and `--interactive-*`.
- Avoid `!important` unless an Obsidian host rule cannot otherwise be overridden.
- Register every new module in `src/style/index.css` or it will not enter the build.

## Structure

- `base/`: variables, container, visibility, animations.
- `components/`: chat layout, messages, tool calls, tabs, history, status.
- `features/`: context, images, diff, plan/approval, inline edit, commands.
- `toolbar/`: model, reasoning, permission, and context controls.
- `modals/`: instruction and capability-gated modal styles.
- `settings/`: settings tabs, provider pickers, agents, and environment sections.
