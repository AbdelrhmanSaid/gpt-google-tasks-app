import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const child = spawn(process.execPath, ['dist/index.js'], {
  cwd: new URL('../', import.meta.url),
  env: { ...process.env, PORT: '3099' },
  stdio: ['ignore', 'pipe', 'inherit'],
  windowsHide: true,
});

const exited = once(child, 'exit');
const client = new Client({ name: 'scaffold-smoke', version: '0.1.0' });

try {
  await Promise.race([
    once(child.stdout, 'data'),
    exited.then(() => {
      throw new Error('Server exited before startup');
    }),
    new Promise((_, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Server startup timed out')),
        10000,
      );

      timeout.unref();
    }),
  ]);

  const health = await fetch('http://127.0.0.1:3099/health');

  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, 'ok');

  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://127.0.0.1:3099/mcp')),
  );

  const { tools } = await client.listTools();

  assert.deepEqual(
    tools.map(({ name }) => name),
    [
      'get_app_status',
      'start_demo',
      'search_tasks',
      'get_tasks',
      'create_task',
      'update_task',
      'set_task_completed',
      'render_tasks',
    ],
  );

  const result = await client.callTool({
    name: 'get_app_status',
    arguments: {},
  });

  assert.deepEqual(result.structuredContent, {
    ready: true,
    googleConnected: false,
  });

  await checkTaskFlow(client, tools);

  console.log(
    'Passed: health, discovery, resource HTML, search, create, edit, complete/reopen, validation, conflicts, and session isolation.',
  );
} finally {
  await client.close();
  child.kill();
  await exited;
}

async function checkTaskFlow(client, tools) {
  async function call(name, args) {
    const result = await client.callTool({ name, arguments: args });

    assert.notEqual(result.isError, true, JSON.stringify(result.content));

    return result.structuredContent;
  }

  const first = await call('start_demo', {});
  const second = await call('start_demo', {});
  const session = { demoSessionId: first.demoSessionId };

  assert.notEqual(first.demoSessionId, second.demoSessionId);
  assert.equal(first.sampleData, true);
  assert.equal(first.tasks.length, 3);

  const matches = await call('search_tasks', {
    ...session,
    query: 'WEBSITE',
    status: 'needsAction',
  });
  assert.equal(matches.tasks.length, 2);
  assert.equal(
    (await call('search_tasks', { ...session, query: 'no matching phrase' }))
      .tasks.length,
    0,
  );

  const created = await call('create_task', {
    ...session,
    title: '  Integration task  ',
    notes: 'Test notes',
    scheduledDate: '2028-02-29',
  });
  const task = created.tasks[0];
  assert.equal(task.title, 'Integration task');
  assert.equal(task.status, 'needsAction');

  const selection = { ...session, taskIds: [task.id] };
  const edit = { ...session, taskId: task.id, expectedRevision: 1 };
  const updated = await call('update_task', {
    ...edit,
    title: 'Renamed task',
    notes: null,
    scheduledDate: null,
  });
  assert.equal(updated.tasks[0].title, 'Renamed task');
  assert.equal(updated.tasks[0].notes, undefined);
  assert.equal(updated.tasks[0].scheduledDate, undefined);

  const conflict = await client.callTool({
    name: 'update_task',
    arguments: { ...edit, title: 'Stale edit' },
  });
  assert.equal(conflict.isError, true);
  assert.equal(
    (await call('get_tasks', selection)).tasks[0].title,
    'Renamed task',
  );

  const completed = await call('set_task_completed', {
    ...edit,
    expectedRevision: 2,
    completed: true,
  });
  assert.equal(completed.tasks[0].status, 'completed');
  const reopened = await call('set_task_completed', {
    ...edit,
    expectedRevision: 3,
    completed: false,
  });
  assert.equal(reopened.tasks[0].status, 'needsAction');

  const otherSession = await call('search_tasks', {
    demoSessionId: second.demoSessionId,
    query: '',
  });
  assert.deepEqual(otherSession.tasks, second.tasks);
  const crossSession = await client.callTool({
    name: 'get_tasks',
    arguments: { demoSessionId: second.demoSessionId, taskIds: [task.id] },
  });
  assert.equal(crossSession.isError, true);

  for (const invalidFields of [
    { title: ' ' },
    { scheduledDate: '2026-02-30' },
    { scheduledDate: '2026-09-08T00:00:00Z' },
  ]) {
    const invalid = await client.callTool({
      name: 'update_task',
      arguments: { ...edit, expectedRevision: 4, ...invalidFields },
    });
    assert.equal(invalid.isError, true);
  }

  const rendered = await call('render_tasks', selection);
  assert.deepEqual(rendered.tasks, reopened.tasks);
  assert.deepEqual(
    (await call('render_tasks', { ...session, taskIds: [] })).tasks,
    [],
  );

  const renderTool = tools.find((tool) => tool.name === 'render_tasks');
  const uri = renderTool._meta.ui.resourceUri;
  const { contents } = await client.readResource({ uri });
  assert.equal(contents[0].mimeType, 'text/html;profile=mcp-app');
  assert.match(contents[0].text, /<script/);
  assert.match(contents[0].text, /<style/);
  assert.doesNotMatch(
    contents[0].text,
    /<script[^>]+src=|<link[^>]+rel="stylesheet"/,
  );
  assert.equal(
    tools.find((tool) => tool.name === 'search_tasks').annotations.readOnlyHint,
    true,
  );
  assert.equal(
    tools.find((tool) => tool.name === 'create_task').annotations.readOnlyHint,
    false,
  );
}
