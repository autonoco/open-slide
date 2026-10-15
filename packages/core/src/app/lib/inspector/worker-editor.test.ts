import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { saveWorkerEdits } from './worker-editor';

const source = 'export default [() => <h1>Original</h1>];';
vi.mock('virtual:open-slide/config', () => ({ default: { slidesDir: 'slides' } }));
vi.mock('virtual:open-slide/slides', () => ({
  slideSources: {
    deck: {
      file: 'index.tsx',
      hash: createHash('sha256').update('export default [() => <h1>Original</h1>];').digest('hex'),
    },
  },
}));
afterEach(() => {
  vi.unstubAllGlobals();
});
it('keeps a mixed valid/invalid batch unsaved instead of reloading away pending edits', async () => {
  const fetcher = vi.fn(async () => Response.json({ content: source, revision: 'a'.repeat(40) }));
  vi.stubGlobal('fetch', fetcher);
  await expect(
    saveWorkerEdits('deck', [
      { line: 1, column: source.indexOf('<h1'), ops: [{ kind: 'set-text', value: 'Updated' }] },
      { line: 999, column: 0, ops: [{ kind: 'set-text', value: 'Invalid target' }] },
    ]),
  ).rejects.toThrow('No edits saved');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
