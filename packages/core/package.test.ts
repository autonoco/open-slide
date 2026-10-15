import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('ships the browser editor transforms in the published package', () => {
  const [packed] = JSON.parse(
    execFileSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], {
      cwd: fileURLToPath(new URL('.', import.meta.url)),
      encoding: 'utf8',
      timeout: 30_000,
    }),
  ) as Array<{ files: Array<{ path: string }> }>;
  expect(packed.files.map((file) => file.path)).toEqual(
    expect.arrayContaining([
      'src/app/lib/inspector/worker-editor.ts',
      'src/editing/batch-edit.ts',
      'src/editing/babel-walk.ts',
      'src/editing/edit-ops.ts',
      'src/app/lib/text-diff.ts',
    ]),
  );
}, 30_000);
