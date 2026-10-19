import type { TextEditStep } from '../../lib/inspector/text-edit-timeline';
import type { SelectedTarget } from './inspector-provider';

type TextDomSnapshot = { html: string; whiteSpaces: string[] };

export type AssetAttrOp = { assetPath: string; previewUrl: string };
export type Sequenced<T> = T & { seq: number };
export type StyleOp = { value: string | null; prevText?: string };

export type Bucket = {
  line: number;
  column: number;
  styleOps: Map<string, Sequenced<StyleOp>>;
  // Text edits are scoped per DOM instance: a reused component renders
  // the same JSX `<h2>{title}</h2>` at multiple call sites with the same
  // `data-slide-loc`, but each call site's prop literal is independent.
  // Style/attr ops stay shared because they edit the JSX definition.
  textEdits: Map<string, TextEditStep[]>;
  textTargets: Map<string, SelectedTarget & { pageIndex: number }>;
  attrOps: Map<string, Sequenced<AssetAttrOp>>;
  // Pre-edit snapshot of the DOM, captured the first time we touch
  // each style key / text / attribute. Used by `cancelEdits` to revert.
  origStyle: Map<string, string>;
  origTexts: Map<string /* instanceId */, { value: string }>;
  origHtmls: Map<string /* instanceId */, TextDomSnapshot>;
  origAttrs: Map<string, string | null>;
};

export function createBucket(line: number, column: number): Bucket {
  return {
    line,
    column,
    styleOps: new Map(),
    textEdits: new Map(),
    textTargets: new Map(),
    attrOps: new Map(),
    origStyle: new Map(),
    origTexts: new Map(),
    origHtmls: new Map(),
    origAttrs: new Map(),
  };
}

export function snapshotBuckets(buckets: Map<string, Bucket>): Map<string, Bucket> {
  return new Map(
    Array.from(buckets, ([key, bucket]) => [
      key,
      {
        ...bucket,
        styleOps: new Map(bucket.styleOps),
        attrOps: new Map(bucket.attrOps),
        textEdits: new Map(Array.from(bucket.textEdits, ([id, steps]) => [id, [...steps]])),
        textTargets: new Map(bucket.textTargets),
        origStyle: new Map(bucket.origStyle),
        origAttrs: new Map(bucket.origAttrs),
        origTexts: new Map(bucket.origTexts),
        origHtmls: new Map(bucket.origHtmls),
      },
    ]),
  );
}

export function completeStyle(bucket: Bucket, key: string, op: Sequenced<StyleOp>) {
  if (bucket.styleOps.get(key)?.seq === op.seq) {
    bucket.styleOps.delete(key);
    bucket.origStyle.delete(key);
  } else if (bucket.styleOps.has(key)) {
    bucket.origStyle.set(key, op.value ?? '');
  }
}

export function completeAsset(bucket: Bucket, attr: string, op: Sequenced<AssetAttrOp>) {
  if (bucket.attrOps.get(attr)?.seq === op.seq) {
    bucket.attrOps.delete(attr);
    bucket.origAttrs.delete(attr);
  } else if (bucket.attrOps.has(attr)) {
    bucket.origAttrs.set(attr, op.previewUrl);
  }
}
