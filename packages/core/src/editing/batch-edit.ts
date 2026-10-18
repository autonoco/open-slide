import { parseSource } from './babel-walk.ts';
import {
  applySplices,
  type EditOp,
  findElementForEdit,
  planEdit,
  type Splice,
} from './edit-ops.ts';

export type BatchEdit = {
  line?: number;
  column?: number;
  ops?: EditOp[];
  dependsOn?: number;
};
export type BatchEditResult = { ok: boolean; error?: string };

type TrackedEdit = {
  offset: number | null;
  textProp?: string;
  ops: EditOp[];
  dependsOn?: number;
  error?: string;
};

function rebaseOffset(offset: number, splices: Splice[], target: number): number | null {
  let shift = 0;
  for (const splice of splices) {
    if (offset < splice.from) break;
    if (offset >= splice.to) {
      shift += splice.text.length - (splice.to - splice.from);
    } else if (offset === splice.from && offset === target) {
      return offset + shift;
    } else {
      return null;
    }
  }
  return offset + shift;
}

export function applyEditBatch(
  source: string,
  edits: BatchEdit[],
): { source: string; results: BatchEditResult[] } {
  const ast = parseSource(source);
  type Target = { offset: number; textProp?: string; scopedCallSite?: boolean };
  const targets = new Map<number, Target>();
  const textTargets = new Map<string, Target>();
  const scopedTargets = new Map<string, Map<number, Target>>();
  const tracked: TrackedEdit[] = edits.map((edit, index) => {
    if (
      !edit ||
      !Number.isInteger(edit.line) ||
      (edit.line ?? 0) < 1 ||
      !Number.isInteger(edit.column ?? 0) ||
      (edit.column ?? 0) < 0 ||
      !Array.isArray(edit.ops) ||
      (edit.dependsOn !== undefined &&
        (!Number.isInteger(edit.dependsOn) || edit.dependsOn < 0 || edit.dependsOn >= index))
    ) {
      return { offset: null, ops: [], error: 'invalid edit' };
    }
    if (!edit.ops.length) return { offset: null, ops: [], dependsOn: edit.dependsOn };
    if (!ast) return { offset: null, ops: edit.ops, error: 'could not parse source' };
    const scopedText = edit.ops.find((op) => op.kind === 'set-text');
    const scopeKey =
      scopedText?.kind === 'set-text' ? JSON.stringify(scopedText.sourceScopes ?? []) : '[]';
    const location = `${edit.line}:${edit.column ?? 0}:${scopeKey}:`;
    const textOp = edit.ops.find((op) => 'prevText' in op && op.prevText !== undefined);
    const prevText = textOp && 'prevText' in textOp ? textOp.prevText : undefined;
    const sharedKey = `${edit.line}:${edit.column ?? 0}:${prevText}`;
    const associations = scopedText ? undefined : scopedTargets.get(sharedKey);
    if (edit.dependsOn === undefined && associations && associations.size > 1) {
      return {
        offset: null,
        ops: edit.ops,
        error: 'multiple scoped targets match the current value',
      };
    }
    const associated =
      (edit.dependsOn === undefined ? undefined : targets.get(edit.dependsOn)) ??
      associations?.values().next().value ??
      (prevText === undefined ? undefined : textTargets.get(`${location}${prevText}`));
    if (associated?.scopedCallSite && edit.ops.some((op) => op.kind !== 'set-text')) {
      return {
        offset: null,
        ops: edit.ops,
        error: 'cannot apply formatting to a scoped component call site',
      };
    }
    const resolved = associated
      ? null
      : findElementForEdit(ast, edit.line ?? 0, edit.column ?? 0, edit.ops);
    const offset = associated?.offset ?? resolved?.element.start ?? null;
    const textProp = associated?.textProp ?? resolved?.textProp;
    if (offset !== null) {
      const target = {
        offset,
        textProp,
        scopedCallSite: associated?.scopedCallSite ?? resolved?.scopedCallSite,
      };
      targets.set(index, target);
      for (const op of edit.ops) {
        if (op.kind !== 'set-text') continue;
        textTargets.set(`${location}${op.value}`, target);
        if (op.sourceScopes?.length) {
          if (op.prevText !== undefined) {
            scopedTargets.get(`${edit.line}:${edit.column ?? 0}:${op.prevText}`)?.delete(offset);
          }
          const key = `${edit.line}:${edit.column ?? 0}:${op.value}`;
          const matches = scopedTargets.get(key) ?? new Map<number, Target>();
          matches.set(offset, target);
          scopedTargets.set(key, matches);
        }
      }
    }
    return {
      offset,
      textProp,
      ops: edit.ops,
      dependsOn: edit.dependsOn,
      ...(offset === null ? { error: 'no JSX element at location' } : {}),
    };
  });
  let next = source;
  const results: BatchEditResult[] = [];
  for (const edit of tracked) {
    if (edit.dependsOn !== undefined && !results[edit.dependsOn]?.ok) {
      results.push({ ok: false, error: 'an earlier edit for this text failed' });
      continue;
    }
    if (edit.error) {
      results.push({ ok: false, error: edit.error });
      continue;
    }
    if (!edit.ops.length) {
      results.push({ ok: true });
      continue;
    }
    if (edit.offset === null) {
      results.push({ ok: false, error: 'target was removed by an earlier edit' });
      continue;
    }
    const before = next.slice(0, edit.offset);
    const line = before.split('\n').length;
    const column = edit.offset - before.lastIndexOf('\n') - 1;
    const plan = planEdit(next, line, column, edit.ops, true, edit.textProp);
    if (!plan.ok) {
      results.push({ ok: false, error: plan.error });
      continue;
    }
    const result = plan.splices.length
      ? applySplices(next, plan.splices)
      : { ok: true as const, source: next };
    if (!result.ok) {
      results.push({ ok: false, error: result.error });
      continue;
    }
    const target = edit.offset;
    const splices = [...plan.splices].sort((a, b) => a.from - b.from || a.to - b.to);
    for (const pending of tracked) {
      if (pending.offset !== null) pending.offset = rebaseOffset(pending.offset, splices, target);
    }
    next = result.source;
    results.push({ ok: true });
  }
  return { source: next, results };
}
