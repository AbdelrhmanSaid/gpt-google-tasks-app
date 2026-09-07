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
    ['get_app_status'],
  );

  const result = await client.callTool({
    name: 'get_app_status',
    arguments: {},
  });

  assert.deepEqual(result.structuredContent, {
    ready: true,
    googleConnected: false,
  });

  console.log(
    'Passed: HTTP health, MCP initialization, tool discovery, and tool call.',
  );
} finally {
  await client.close();
  child.kill();
  await exited;
}
