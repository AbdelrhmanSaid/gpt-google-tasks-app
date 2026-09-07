import express from 'express';
import type { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { toNodeHandler } from 'better-auth/node';

import { createMcpServer } from './mcp.js';
import { DemoStore } from './tasks/demoStore.js';
import { previewOrigin, type GoogleAuth } from './auth/google.js';
import { createGoogleMcpServer } from './google/mcp.js';

async function handleMcpRequest(
  req: Request,
  res: Response,
  server: McpServer,
): Promise<void> {
  // Each request owns its transport. No protocol session is shared between users.
  const transport = new StreamableHTTPServerTransport({
    enableJsonResponse: true,
  });

  res.on('close', () => {
    void server.close().catch(() => {
      console.error('Failed to close the MCP connection.');
    });
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch {
    console.error('MCP request failed.');

    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32603, message: 'Internal server error' },
      });
    }
  }
}

export function createApp(google?: GoogleAuth): express.Express {
  const app = express();
  const store = new DemoStore();

  app.disable('x-powered-by');

  if (google) {
    const authHandler = toNodeHandler(google.auth);
    const allowedAuthRoutes = new Set([
      'POST /sign-in/social',
      'GET /callback/google',
      'POST /sign-out',
      'GET /error',
    ]);

    // Keep token APIs server-only. Better Auth must receive the raw request body.
    app.use('/api/auth', (req, res) => {
      if (!allowedAuthRoutes.has(`${req.method} ${req.path}`)) {
        res.status(404).json({ error: 'Not found' });
        return;
      }

      return authHandler(req, res);
    });
  }

  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'google-tasks' });
  });

  app.post('/mcp', (req, res) => {
    if (google) {
      res.status(401).json({
        error:
          'Hosted MCP OAuth is not configured. Use the local Google preview.',
      });
      return;
    }

    return handleMcpRequest(req, res, createMcpServer(store));
  });

  if (google) {
    app.get('/api/google/connection', async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      const user = await google.getUser(req.headers);

      res.json({
        authenticated: Boolean(user),
        user: user ? { name: user.name, email: user.email } : null,
      });
    });

    app.post('/api/google/mcp', async (req, res) => {
      // This cookie-authenticated endpoint exists only for local development.
      // ChatGPT will use a separate bearer-token OAuth boundary on /mcp.
      if (req.get('origin') !== previewOrigin) {
        res.status(403).json({ error: 'Untrusted request origin' });
        return;
      }

      const user = await google.getUser(req.headers);

      if (!user) {
        res
          .status(401)
          .json({ error: 'Sign in with an allowed Google account.' });
        return;
      }

      return handleMcpRequest(
        req,
        res,
        createGoogleMcpServer(google.tasksForUser(user.id)),
      );
    });
  }

  // This stateless scaffold does not keep an SSE stream or support session deletion.
  app.all('/mcp', (_req, res) => {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
  });

  app.use(
    (
      _error: unknown,
      _req: Request,
      res: Response,
      _next: express.NextFunction,
    ) => {
      res
        .status(500)
        .json({ error: 'The server could not complete the request.' });
    },
  );

  return app;
}
