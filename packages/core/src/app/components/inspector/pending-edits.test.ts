import { describe, expect, it } from 'vitest';
import { completeAsset, completeStyle, createBucket, snapshotBuckets } from './pending-edits';

describe('edits made during a save', () => {
  it('retains only submitted previews and keeps newer same-key operations pending', async () => {
    const bucket = createBucket(1, 2);
    const style = { seq: 1, value: 'red' };
    const asset = { seq: 2, assetPath: '/saved.png', previewUrl: '/saved.png' };
    const text = { seq: 3, op: { kind: 'set-text' as const, prevText: 'Old', value: 'Saved' } };
    bucket.styleOps.set('color', style);
    bucket.origStyle.set('color', 'black');
    bucket.attrOps.set('src', asset);
    bucket.origAttrs.set('src', '/old.png');
    bucket.textEdits.set('instance', [text]);
    const buckets = new Map([['1:2', bucket]]);
    let finish!: () => void;
    const response = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const save = async () => {
      const submitted = snapshotBuckets(buckets);
      await response;
      completeStyle(bucket, 'color', style);
      completeAsset(bucket, 'src', asset);
      return submitted;
    };
    const saving = save();
    const newerStyle = { seq: 4, value: 'blue' };
    const newerAsset = { seq: 5, assetPath: '/new.png', previewUrl: '/new.png' };
    bucket.styleOps.set('color', newerStyle);
    bucket.attrOps.set('src', newerAsset);
    bucket.textEdits
      .get('instance')
      ?.push({ seq: 6, op: { kind: 'set-text', prevText: 'Saved', value: 'Pending' } });
    buckets.set('3:4', createBucket(3, 4));
    finish();
    const submitted = await saving;
    expect([...submitted.keys()]).toEqual(['1:2']);
    expect(submitted.get('1:2')?.styleOps.get('color')).toEqual(style);
    expect(submitted.get('1:2')?.attrOps.get('src')).toEqual(asset);
    expect(submitted.get('1:2')?.textEdits.get('instance')).toEqual([text]);
    expect(bucket.styleOps.get('color')).toEqual(newerStyle);
    expect(bucket.attrOps.get('src')).toEqual(newerAsset);
    expect(bucket.origStyle.get('color')).toBe('red');
    expect(bucket.origAttrs.get('src')).toBe('/saved.png');
    completeStyle(bucket, 'color', newerStyle);
    completeAsset(bucket, 'src', newerAsset);
    expect(bucket.styleOps.size).toBe(0);
    expect(bucket.attrOps.size).toBe(0);
    expect(bucket.origStyle.size).toBe(0);
    expect(bucket.origAttrs.size).toBe(0);
    expect(submitted.get('1:2')?.styleOps.get('color')).toEqual(style);
  });

  it('uses the saved removal as the baseline for a newer style operation', () => {
    const bucket = createBucket(1, 2);
    bucket.styleOps.set('color', { seq: 2, value: 'blue' });
    bucket.origStyle.set('color', 'red');
    completeStyle(bucket, 'color', { seq: 1, value: null });
    expect(bucket.origStyle.get('color')).toBe('');
    expect(bucket.styleOps.get('color')?.seq).toBe(2);
  });
});
