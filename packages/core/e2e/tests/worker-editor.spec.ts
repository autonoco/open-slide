import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  prepareScratchProject,
  readSlideSource,
  runCli,
  startCliServer,
  stopServer,
  waitForHttpOk,
} from './helpers';

test.describe('published Worker editor', () => {
  const baseUrl = 'http://127.0.0.1:43123';
  let project: string;
  let preview: ChildProcess;
  const previousHosted = process.env.VITE_BUTTONS_HOSTED;
  const previousWorker = process.env.VITE_BUTTONS_WORKER_EDITOR;

  test.beforeAll(async () => {
    test.setTimeout(300_000);
    process.env.VITE_BUTTONS_HOSTED = 'true';
    process.env.VITE_BUTTONS_WORKER_EDITOR = 'true';
    project = prepareScratchProject('worker-editor');
    const result = await runCli(['build'], project);
    expect(result.code, result.stderr).toBe(0);
    preview = startCliServer(['preview', '--host', '127.0.0.1', '--port', '43123'], project);
    await waitForHttpOk(`${baseUrl}/`);
  });
  test.afterAll(async () => {
    if (previousHosted === undefined) delete process.env.VITE_BUTTONS_HOSTED;
    else process.env.VITE_BUTTONS_HOSTED = previousHosted;
    if (previousWorker === undefined) delete process.env.VITE_BUTTONS_WORKER_EDITOR;
    else process.env.VITE_BUTTONS_WORKER_EDITOR = previousWorker;
    if (preview) await stopServer(preview);
  });

  test('saves through the Worker API and reloads the completed publication', async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let saved = '';
    await page.route('**/__host/files?*', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          json: {
            content: await readSlideSource('edit-target', project),
            revision: 'a'.repeat(40),
          },
        });
        return;
      }
      expect(route.request().headers()['if-match']).toBe(`"${'a'.repeat(40)}"`);
      saved = route.request().postData() ?? '';
      await fs.writeFile(path.join(project, 'slides/edit-target/index.tsx'), saved);
      const result = await runCli(['build'], project);
      expect(result.code, result.stderr).toBe(0);
      await route.fulfill({ json: { saved: true, changed: true, revision: 'b'.repeat(40) } });
    });
    await page.route('**/__host/publication/*', (route) =>
      route.fulfill({
        contentType: 'application/x-ndjson',
        body: '{"type":"workflow_completed"}\n',
      }),
    );
    await page.goto(`${baseUrl}/s/edit-target?edit=1`);
    const headline = page
      .locator('main[data-inspector-root]')
      .getByText('Editable headline', { exact: true });
    await expect(headline).toBeVisible({ timeout: 30_000 });
    await expect(headline).toHaveAttribute('data-slide-loc', /\d+:\d+/);
    await headline.click();
    await page
      .locator('aside[data-inspector-ui]')
      .getByPlaceholder('Element text')
      .fill('Editable headline from Worker');
    await page
      .locator('aside[data-inspector-ui]')
      .getByRole('button', { name: 'Italic', exact: true })
      .click();
    const published = page.waitForResponse((response) =>
      response.url().includes('/__host/publication/'),
    );
    const navigated = page.waitForEvent('framenavigated', (frame) => frame === page.mainFrame());
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await published;
    await navigated;
    expect(saved).toContain('Editable headline from Worker');
    await expect(
      page
        .locator('main[data-inspector-root]')
        .getByText('Editable headline from Worker', { exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('main[data-inspector-root] h1')).toHaveCSS('font-style', 'italic');
    expect(saved).toContain('fontStyle');
    expect(errors).toEqual([]);
  });

  test('does not write when the published source is stale', async ({ page }) => {
    let writes = 0;
    await page.route('**/__host/files?*', async (route) => {
      if (route.request().method() !== 'GET') writes++;
      await route.fulfill({
        json: {
          content: `${await readSlideSource('edit-target', project)}\n// newer edit`,
          revision: 'c'.repeat(40),
        },
      });
    });
    await page.goto(`${baseUrl}/s/edit-target?edit=1`);
    const headline = page.locator('main[data-inspector-root] h1');
    await expect(headline).toBeVisible({ timeout: 30_000 });
    await headline.click();
    await page
      .locator('aside[data-inspector-ui]')
      .getByPlaceholder('Element text')
      .fill('Stale overwrite');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText(/This slide changed. Reload before editing/)).toBeVisible();
    expect(writes).toBe(0);
  });
});
