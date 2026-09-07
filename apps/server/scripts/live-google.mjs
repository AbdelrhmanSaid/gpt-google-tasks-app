import assert from 'node:assert/strict';

import { symmetricDecrypt } from 'better-auth/crypto';

import { createGoogleAuth } from '../dist/auth/google.js';
import { loadLocalEnvironment, readGoogleConfig } from '../dist/config.js';

// Explicit, operator-run check. Never runs in CI or through a public endpoint.
// Only modifies an existing, uniquely named integration test task; it leaves it completed.
const [email, listTitle, taskTitle] = process.argv.slice(2);

if (
  !email ||
  !listTitle ||
  !taskTitle?.startsWith('ChatGPT integration test')
) {
  throw new Error(
    'Pass the pilot email, exact list title, and a task title starting with "ChatGPT integration test".',
  );
}

loadLocalEnvironment();

const config = readGoogleConfig();
assert.ok(
  config?.allowedEmails.has(email.toLowerCase()),
  'Expected an allowed pilot email.',
);
const google = createGoogleAuth(config);

try {
  const user = google.database
    .prepare('SELECT id FROM user WHERE email = ?')
    .get(email);
  assert.ok(user, 'Sign in through the browser first.');
  const account = google.database
    .prepare(
      'SELECT accessToken, refreshToken FROM account WHERE userId = ? AND providerId = ?',
    )
    .get(user.id, 'google');

  for (const stored of [account?.accessToken, account?.refreshToken]) {
    assert.ok(stored, 'Offline credentials must be present.');
    assert.notEqual(
      await symmetricDecrypt({ key: config.secret, data: stored }),
      stored,
      'Credentials must be encrypted at rest.',
    );
  }

  const client = google.tasksForUser(user.id);
  const lists = (await client.listTaskLists()).lists.filter(
    (list) => list.title === listTitle,
  );
  assert.equal(
    lists.length,
    1,
    'Expected one exact list on the first list page.',
  );
  const matches = [];
  let pageToken;

  do {
    const page = await client.search(
      lists[0].id,
      taskTitle,
      undefined,
      pageToken,
    );
    matches.push(...page.tasks.filter((task) => task.title === taskTitle));
    pageToken = page.nextPageToken ?? undefined;
  } while (pageToken);

  assert.equal(
    matches.length,
    1,
    'Expected exactly one pre-created integration test task.',
  );
  let task = matches[0];
  const oldEtag = task.etag;
  task = (
    await client.update(task, task.etag, {
      notes: 'Integration checks passed.',
      scheduledDate: '2026-09-08',
    })
  ).tasks[0];
  assert.equal(task.scheduledDate, '2026-09-08');

  await assert.rejects(
    client.update(task, oldEtag, { notes: 'Stale edit must be rejected.' }),
    (error) => error.code === 'conflict',
  );

  task = (
    await client.update(task, task.etag, { notes: null, scheduledDate: null })
  ).tasks[0];
  assert.equal(task.notes, undefined);
  assert.equal(task.scheduledDate, undefined);

  task = (await client.setCompleted(task, task.etag, true)).tasks[0];
  assert.equal(task.status, 'completed');
  task = (await client.setCompleted(task, task.etag, false)).tasks[0];
  assert.equal(task.status, 'needsAction');
  task = (await client.setCompleted(task, task.etag, true)).tasks[0];
  assert.equal((await client.getTasks([task])).tasks[0].status, 'completed');

  console.log(
    'Live Google checks passed: encrypted credentials, persisted login, search, edits, dates, clearing fields, ETag conflict rejection, complete/reopen. Test task left completed.',
  );
} finally {
  google.database.close();
}
