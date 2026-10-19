import config from 'virtual:open-slide/config';
import { slideSources } from 'virtual:open-slide/slides';
import { toast } from 'sonner';
import type { Edit, EditResult } from './use-editor';

async function publicationComplete(revision: string, signal: AbortSignal) {
  const response = await fetch(`/__host/publication/${revision}`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(16 * 60_000)]),
  });
  if (!response.ok || !response.body) throw new Error('Publication progress is unavailable.');
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error('Publication has not been confirmed.');
      buffer += value;
      let end = buffer.indexOf('\n');
      while (end >= 0) {
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        end = buffer.indexOf('\n');
        if (!line) continue;
        let event: { type: string };
        try {
          event = JSON.parse(line);
          if (!event || typeof event.type !== 'string')
            throw new Error('Invalid publication event');
        } catch (cause) {
          throw new Error('Publication progress is unavailable.', {
            cause,
          });
        }
        if (event.type === 'workflow_completed') return;
        if (event.type === 'workflow_errored' || event.type === 'workflow_terminated')
          throw new Error('Publishing failed.');
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch (error) {
      console.warn('Publication stream cleanup failed', error);
    }
    reader.releaseLock();
  }
}

type SavedSession = { original: string; content: string; edits: Edit[] };
const sessions = new Map<string, SavedSession>();
const publications = new Map<string, { revision: string; controller: AbortController }>();
const saving = new Set<string>();

function trackPublication(slideId: string, revision: string, error?: string) {
  publications.get(slideId)?.controller.abort();
  const controller = new AbortController();
  publications.set(slideId, { revision, controller });
  const id = `publication:${slideId}`;
  if (error) {
    toast.error('Saved. Publishing could not start.', {
      id,
      description: error,
      duration: Infinity,
    });
    return;
  }
  toast.loading('Saved. Publishing update…', { id });
  void publicationComplete(revision, controller.signal).then(
    () => {
      if (publications.get(slideId)?.controller === controller)
        toast.success('Saved. Publishing finished.', { id, duration: 4000 });
    },
    (cause: unknown) => {
      if (publications.get(slideId)?.controller === controller)
        toast.error('Saved. Publication is not confirmed.', {
          id,
          description: cause instanceof Error ? cause.message : String(cause),
          duration: Infinity,
        });
    },
  );
}

export async function saveWorkerEdits(slideId: string, edits: Edit[]): Promise<EditResult[]> {
  if (saving.has(slideId)) throw new Error('A save is already in progress.');
  saving.add(slideId);
  try {
    return await save(slideId, edits);
  } finally {
    saving.delete(slideId);
  }
}

async function save(slideId: string, edits: Edit[]): Promise<EditResult[]> {
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
  const session = sessions.get(slideId);
  if (session ? current.content !== session.content : hash !== entry.hash)
    throw new Error('This slide changed. Reload before editing.');
  const { applyEditBatch } = await import('../../../editing/batch-edit');
  const previous = session?.edits ?? [];
  const combined = [
    ...previous,
    ...edits.map((edit) => ({
      ...edit,
      ...(edit.dependsOn === undefined ? {} : { dependsOn: edit.dependsOn + previous.length }),
    })),
  ];
  const original = session?.original ?? current.content;
  const result = applyEditBatch(original, combined);
  const results = result.results.slice(previous.length);
  const failed = result.results.find((item) => !item.ok);
  if (failed) throw new Error(`No edits saved: ${failed.error ?? 'invalid edit'}`);
  if (result.source === current.content) return results;
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
    saved?: boolean;
  };
  if ((!saved.ok && outcome.saved !== true) || !outcome.revision)
    throw new Error(outcome.error ?? 'Could not save this edit.');
  sessions.set(slideId, { original, content: result.source, edits: combined });
  if (outcome.changed !== false) trackPublication(slideId, outcome.revision, outcome.error);
  return results;
}
