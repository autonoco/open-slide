import { describe, expect, it } from 'vitest';
import { createViteConfig } from './config.ts';

describe('createViteConfig', () => {
  it('pre-bundles the linked core package before the dev server starts', async () => {
    const config = await createViteConfig({ userCwd: process.cwd(), config: {} });

    expect(config.optimizeDeps?.include).toContain('@open-slide/core');
  });
});
