import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateSlidesModule } from './open-slide-plugin.ts';

async function withSlidesRoot<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'open-slide-test-'));
  try {
    return await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function writeSlide(root: string, id: string): Promise<string> {
  await fs.mkdir(path.join(root, id), { recursive: true });
  const entry = path.join(root, id, 'index.tsx');
  await fs.writeFile(
    entry,
    `export const meta = { title: '${id}' };\nexport default [];\n`,
    'utf8',
  );
  return entry;
}

describe('generateSlidesModule', () => {
  it('keeps slides whose id is ASCII-safe and reports none ignored', async () => {
    await withSlidesRoot(async (root) => {
      const files = [await writeSlide(root, 'cover'), await writeSlide(root, 'intro_2')].sort();

      const { code, ignored } = await generateSlidesModule(files, root, false);

      expect(ignored).toEqual([]);
      expect(code).toContain('export const slideIds = ["cover","intro_2"];');
    });
  });

  it('excludes folders whose id is not ASCII-safe and reports them as ignored', async () => {
    await withSlidesRoot(async (root) => {
      const files = [await writeSlide(root, 'cover'), await writeSlide(root, '推薦系統')].sort();

      const { code, ignored } = await generateSlidesModule(files, root, false);

      expect(ignored).toEqual(['推薦系統']);
      expect(code).toContain('export const slideIds = ["cover"];');
      expect(code).not.toContain('推薦系統');
    });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});
it('hashes the exact source in Worker builds and fails rather than publishing a missing slide', async () => {
  vi.stubEnv('VITE_BUTTONS_WORKER_EDITOR', 'true');
  await withSlidesRoot(async (root) => {
    const entry = await writeSlide(root, 'cover');
    const hash = createHash('sha256')
      .update(await fs.readFile(entry))
      .digest('hex');
    expect((await generateSlidesModule([entry], root, false)).code).toContain(hash);
    await fs.unlink(entry);
    await expect(generateSlidesModule([entry], root, false)).rejects.toThrow();
    await expect(generateSlidesModule([entry], root, true)).resolves.toBeDefined();
  });
});
