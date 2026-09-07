import express from 'express';
import type { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { createMcpServer } from './mcp.js';
import { DemoStore } from './tasks/demoStore.js';

async function handleMcpRequest(
  req: Request,
  res: Response,
  store: DemoStore,
): Promise<void> {
  // Each request owns its transport. No protocol session is shared between users.
  // OAuth will still be required before this endpoint can expose personal tasks.
  const server = createMcpServer(store);
  const transport = new StreamableHTTPServerTransport({
    enableJsonResponse: true,
  });

  res.on('close', () => {
    void server.close().catch((error: unknown) => {
      console.error('Failed to close the MCP connection:', error);
    });
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('MCP request failed:', error);

    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32603, message: 'Internal server error' },
      });
    }
  }
}

export function createApp(): express.Express {
  const app = express();
  const store = new DemoStore();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'google-tasks' });
  });

  app.post('/mcp', (req, res) => handleMcpRequest(req, res, store));

  // This stateless scaffold does not keep an SSE stream or support session deletion.
  app.all('/mcp', (_req, res) => {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
  });

  return app;
}
