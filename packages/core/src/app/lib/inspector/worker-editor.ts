import config from 'virtual:open-slide/config';
import { slideSources } from 'virtual:open-slide/slides';
import type { Edit, EditResult } from './use-editor';

async function publicationComplete(revision: string) {
  const response = await fetch(`/__host/publication/${revision}`, {
    signal: AbortSignal.timeout(16 * 60_000),
  });
  if (!response.ok || !response.body)
    throw new Error('Your edit is saved, but publication progress is unavailable.');
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error('Your edit is saved, but publication has not been confirmed.');
      buffer += value;
      let end = buffer.indexOf('\n');
      while (end >= 0) {
        const event = JSON.parse(buffer.slice(0, end)) as { type: string };
        buffer = buffer.slice(end + 1);
        if (event.type === 'workflow_completed') return;
        if (event.type === 'workflow_errored' || event.type === 'workflow_terminated')
          throw new Error('Your edit is saved, but publishing failed.');
        end = buffer.indexOf('\n');
      }
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

export async function saveWorkerEdits(slideId: string, edits: Edit[]): Promise<EditResult[]> {
  const entry = slideSources[slideId];
  if (!entry || !/^index\.(tsx|jsx)$/.test(entry.file))
    throw new Error('This slide format does not support published editing.');
  const path = `${config.slidesDir ?? 'slides'}/${slideId}/${entry.file}`;
  const url = `/__host/files?path=${encodeURIComponent(path)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Could not read the saved slide.');
  const current = (await response.json()) as { content: string; revision: string };
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(current.content));
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  if (hash !== entry.hash) throw new Error('This slide changed. Reload before editing.');
  const { applyEditBatch } = await import('../../../editing/batch-edit');
  const result = applyEditBatch(current.content, edits);
  const failed = result.results.find((item) => !item.ok);
  if (failed) throw new Error(`No edits saved: ${failed.error ?? 'invalid edit'}`);
  if (result.source === current.content) return result.results;
  const saved = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'text/plain;charset=UTF-8', 'If-Match': `"${current.revision}"` },
    body: result.source,
  });
  if (saved.status === 409) throw new Error('This slide changed. Reload before editing.');
  const outcome = (await saved.json().catch(() => ({}))) as {
    revision?: string;
    error?: string;
    changed?: boolean;
  };
  if (!saved.ok || !outcome.revision) throw new Error(outcome.error ?? 'Could not save this edit.');
  if (outcome.changed === false) return result.results;
  await publicationComplete(outcome.revision);
  window.location.reload();
  return result.results;
}
