import {
  createMimoAgentPersistenceKey,
  MimoAgentStorage,
} from '@/providers/mimo/storage/MimoAgentStorage';

function agentMarkdown(description: string): string {
  return `---\nname: reviewer\ndescription: ${description}\nmode: subagent\n---\nReview code.`;
}

describe('MimoAgentStorage', () => {
  it('loads official paths with singular taking precedence over legacy duplicates', async () => {
    const files: Record<string, string> = {
      '.mimo/agent/reviewer.md': agentMarkdown('legacy'),
      '.mimocode/agents/reviewer.md': agentMarkdown('official plural'),
      '.mimocode/agent/reviewer.md': agentMarkdown('official singular'),
    };
    const storage = new MimoAgentStorage({
      delete: jest.fn(),
      ensureFolder: jest.fn(),
      exists: jest.fn(async filePath => filePath in files),
      listFilesRecursive: jest.fn(async root => Object.keys(files).filter(file => file.startsWith(`${root}/`))),
      read: jest.fn(async filePath => files[filePath]),
      write: jest.fn(),
    });

    const agents = await storage.loadAll();

    expect(agents).toHaveLength(1);
    expect(agents[0].description).toBe('official singular');
    expect(agents[0].persistenceKey).toContain(encodeURIComponent('.mimocode/agent/reviewer.md'));
  });

  it('migrates an edited legacy agent into the official singular directory', async () => {
    const write = jest.fn();
    const remove = jest.fn();
    const storage = new MimoAgentStorage({
      delete: remove,
      ensureFolder: jest.fn(),
      exists: jest.fn(async () => true),
      listFilesRecursive: jest.fn(async () => []),
      read: jest.fn(),
      write,
    });
    const previous = {
      name: 'reviewer',
      description: 'legacy',
      prompt: 'Review code.',
      persistenceKey: createMimoAgentPersistenceKey({ filePath: '.mimo/agent/reviewer.md' }),
    };

    await storage.save({ ...previous, description: 'updated' }, previous);

    expect(write).toHaveBeenCalledWith('.mimocode/agent/reviewer.md', expect.any(String));
    expect(remove).toHaveBeenCalledWith('.mimo/agent/reviewer.md');
  });
});
