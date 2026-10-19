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
    await fs.mkdir(path.join(project, 'slides/jsx-target'));
    await fs.writeFile(
      path.join(project, 'slides/jsx-target/index.jsx'),
      'export default [() => <div><h1>JSX headline</h1></div>];',
    );
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

  test('saves twice without waiting for publication or reloading the editor', async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let saved = await readSlideSource('edit-target', project);
    let revision = 0;
    let finishPublication: () => void = () => {};
    const publication = new Promise<void>((resolve) => {
      finishPublication = resolve;
    });
    await page.route('**/__host/files?*', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: { content: saved, revision: String(revision) } });
        return;
      }
      expect(route.request().headers()['if-match']).toBe(`"${revision}"`);
      saved = route.request().postData() ?? '';
      revision++;
      await route.fulfill({ json: { saved: true, changed: true, revision: String(revision) } });
    });
    await page.route('**/__host/publication/*', async (route) => {
      await publication;
      await route.fulfill({
        contentType: 'application/x-ndjson',
        body: '{"type":"workflow_completed"}\n',
      });
    });
    await page.goto(`${baseUrl}/s/edit-target?edit=1`);
    const headline = page.locator('main[data-inspector-root] h1');
    await expect(headline).toBeVisible({ timeout: 30_000 });
    let navigations = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations++;
    });
    await headline.click();
    const input = page.locator('aside[data-inspector-ui]').getByPlaceholder('Element text');
    await input.fill('First saved heading');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved. Publishing update…')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Saving', exact: true })).toHaveCount(0);
    await input.fill('Second saved heading');
    await expect(page.getByText('1 unsaved change', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => revision).toBe(2);
    expect(saved).toContain('Second saved heading');
    await expect(page.getByRole('button', { name: 'Saving', exact: true })).toHaveCount(0);
    await input.fill('Unsaved next edit');
    finishPublication();
    await expect(page.getByText('Saved. Publishing finished.')).toBeVisible();
    await expect(headline).toHaveText('Unsaved next edit');
    expect(navigations).toBe(0);
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(headline).toHaveText('Second saved heading');
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
  test('uses the discovered JSX file and reports an empty conflict response', async ({ page }) => {
    let saved = '';
    await page.route('**/__host/files?*', async (route) => {
      expect(new URL(route.request().url()).searchParams.get('path')).toBe(
        'slides/jsx-target/index.jsx',
      );
      if (route.request().method() === 'GET') {
        await route.fulfill({
          json: {
            content: await fs.readFile(path.join(project, 'slides/jsx-target/index.jsx'), 'utf8'),
            revision: 'a'.repeat(40),
          },
        });
      } else {
        saved = route.request().postData() ?? '';
        await route.fulfill({ status: 409, body: '' });
      }
    });
    await page.goto(`${baseUrl}/s/jsx-target?edit=1`);
    const headline = page.locator('main[data-inspector-root] h1');
    await expect(headline).toHaveAttribute('data-slide-loc', /\d+:\d+/);
    await headline.click();
    await page
      .locator('aside[data-inspector-ui]')
      .getByPlaceholder('Element text')
      .fill('Edited JSX');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText(/This slide changed. Reload before editing/)).toBeVisible();
    expect(saved).toContain('Edited JSX');
  });
});
