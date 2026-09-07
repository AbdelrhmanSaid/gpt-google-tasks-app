import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readTaskResult } from '../src/widget/taskResult.ts';

const snapshot = {
  sampleData: false,
  tasks: [
    {
      id: 'test-task',
      listId: 'test-list',
      listTitle: 'Test list',
      title: 'Widget integration test',
      status: 'completed',
      etag: '"revision-1"',
    },
  ],
};

test('accepts the ChatGPT result when a null pagination field is omitted', () => {
  assert.deepEqual(readTaskResult({ structuredContent: snapshot }), {
    ...snapshot,
    nextPageToken: null,
  });
});

test('preserves explicit pagination values', () => {
  for (const nextPageToken of [null, 'next-page']) {
    const structuredContent = { ...snapshot, nextPageToken };

    assert.deepEqual(readTaskResult({ structuredContent }), structuredContent);
  }
});

test('still rejects invalid task data and failed tool calls', () => {
  assert.throws(() =>
    readTaskResult({
      structuredContent: {
        ...snapshot,
        tasks: [{ ...snapshot.tasks[0], etag: undefined }],
      },
    }),
  );

  assert.throws(() =>
    readTaskResult({ isError: true, structuredContent: snapshot }),
  );
});
