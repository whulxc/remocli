import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_COMPOSER_ATTACHMENT_LIMIT,
  attachmentIdentity,
  buildComposerSubmissionText,
  mergeComposerAttachments,
} from '../src/shared/composer-attachments.js';

test('attachmentIdentity prefers attachment path', () => {
  assert.equal(
    attachmentIdentity({
      path: '/tmp/demo.png',
      url: '/api/artifacts/demo.png',
      name: 'demo.png',
    }),
    '/tmp/demo.png',
  );
});

test('mergeComposerAttachments keeps newest first and de-duplicates by path', () => {
  const merged = mergeComposerAttachments(
    [
      { path: '/tmp/older.png', name: 'older.png' },
      { path: '/tmp/shared.png', name: 'shared-older.png' },
    ],
    [
      { path: '/tmp/newer.png', name: 'newer.png' },
      { path: '/tmp/shared.png', name: 'shared-newer.png' },
    ],
  );

  assert.deepEqual(
    merged.map((item) => item.path),
    ['/tmp/newer.png', '/tmp/shared.png', '/tmp/older.png'],
  );
  assert.equal(merged[1].name, 'shared-newer.png');
});

test('mergeComposerAttachments enforces the default limit', () => {
  const attachments = Array.from({ length: DEFAULT_COMPOSER_ATTACHMENT_LIMIT + 2 }, (_, index) => ({
    path: `/tmp/${index}.png`,
    name: `${index}.png`,
  }));
  const merged = mergeComposerAttachments([], attachments);
  assert.equal(merged.length, DEFAULT_COMPOSER_ATTACHMENT_LIMIT);
  assert.deepEqual(
    merged.map((item) => item.path),
    attachments.slice(0, DEFAULT_COMPOSER_ATTACHMENT_LIMIT).map((item) => item.path),
  );
});

test('buildComposerSubmissionText sends image paths above the typed request', () => {
  const text = buildComposerSubmissionText('Describe the main contents of the image', [
    { path: '/tmp/demo-a.png' },
    { path: '/tmp/demo-b.png' },
  ]);

  assert.equal(
    text,
    ['/tmp/demo-a.png', '/tmp/demo-b.png', 'Describe the main contents of the image'].join('\n'),
  );
});

test('buildComposerSubmissionText supports attachment-only sends', () => {
  assert.equal(
    buildComposerSubmissionText('', [{ path: '/tmp/demo-a.png' }]),
    '/tmp/demo-a.png',
  );
});
