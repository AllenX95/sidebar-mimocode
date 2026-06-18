import * as fs from 'node:fs';
import * as path from 'node:path';

import manifest from '../../manifest.json';
import packageJson from '../../package.json';
import versions from '../../versions.json';

describe('release metadata', () => {
  const previousBrand = ['clau', 'dian'].join('');
  const previousInstructionFile = ['CLA', 'UDE.md'].join('');

  it('uses one product identity and matching Obsidian compatibility metadata', () => {
    expect(packageJson.name).toBe('sidebar-mimocode');
    expect(manifest.id).toBe('sidebar-mimocode');
    expect(manifest.name).toBe('Sidebar MiMo-Code');
    expect(versions[manifest.version as keyof typeof versions]).toBe(manifest.minAppVersion);
  });

  it('copies development builds to the release plugin ID directory', () => {
    const buildConfig = fs.readFileSync(path.resolve('esbuild.config.mjs'), 'utf8');
    expect(buildConfig).toContain("'.obsidian', 'plugins', 'sidebar-mimocode'");
    expect(buildConfig).not.toContain(`'.obsidian', 'plugins', '${previousBrand}'`);
  });

  it('does not retain the previous product name in source paths or text', () => {
    const files = collectProjectFiles([
      'docs',
      'scripts',
      'src',
      'tests',
      'AGENTS.md',
      'README.md',
      'bun.lock',
      'eslint.config.mjs',
    ]);

    for (const filePath of files) {
      expect(filePath.toLowerCase()).not.toContain(previousBrand);
      expect(fs.readFileSync(filePath, 'utf8').toLowerCase()).not.toContain(previousBrand);
    }
  });

  it('uses AGENTS.md instead of the Claude Code compatibility fallback', () => {
    const files = collectProjectFiles(['.github', 'docs', 'src', 'AGENTS.md']);

    expect(fs.existsSync(path.resolve('AGENTS.md'))).toBe(true);
    for (const filePath of files) {
      expect(path.basename(filePath)).not.toBe(previousInstructionFile);
      expect(fs.readFileSync(filePath, 'utf8')).not.toContain(previousInstructionFile);
    }
  });

  it('stores plugin-owned data under the current plugin namespace', () => {
    const storagePaths = fs.readFileSync(
      path.resolve('src/core/bootstrap/StoragePaths.ts'),
      'utf8',
    );

    expect(storagePaths).toContain("'.sidebar-mimocode'");
    expect(storagePaths).toContain('sidebar-mimocode-settings.json');
    expect(storagePaths).not.toContain('.claude/');
  });

  it('uses OpenCode-native project paths in MiMo-facing settings copy', () => {
    const files = collectProjectFiles([
      'src/i18n',
      'src/providers/mimo/ui',
    ]);

    for (const filePath of files) {
      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).not.toContain('.claude/');
      expect(content).not.toContain('claudeSafeMode');
      expect(content).not.toContain('codexSafeMode');
    }
  });
});

function collectProjectFiles(entries: string[]): string[] {
  const files: string[] = [];

  const visit = (entryPath: string): void => {
    const resolvedPath = path.resolve(entryPath);
    if (!fs.existsSync(resolvedPath)) {
      return;
    }

    const stat = fs.statSync(resolvedPath);
    if (stat.isFile()) {
      files.push(resolvedPath);
      return;
    }

    for (const child of fs.readdirSync(resolvedPath)) {
      visit(path.join(resolvedPath, child));
    }
  };

  for (const entry of entries) {
    visit(entry);
  }
  return files;
}
