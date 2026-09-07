import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3001);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const httpServer = createApp().listen(port, '127.0.0.1', () => {
  console.log(`Tasks MCP server: http://127.0.0.1:${port}/mcp`);
});

httpServer.on('error', (error) => {
  console.error('Unable to start the Tasks server:', error.message);
  process.exitCode = 1;
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => httpServer.close());
}
