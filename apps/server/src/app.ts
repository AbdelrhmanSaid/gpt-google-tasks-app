import { fileURLToPath } from 'node:url';

import express from 'express';
import type { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { toNodeHandler } from 'better-auth/node';

import { createMcpServer } from './mcp.js';
import { DemoStore } from './tasks/demoStore.js';
import {
  allowsLocalPreview,
  previewOrigin,
  trustedOrigins,
  type GoogleAuth,
} from './auth/google.js';
import { createGoogleMcpServer } from './google/mcp.js';
import { mcpScope } from './auth/oauth.js';

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
      'GET /oauth2/authorize',
      'POST /oauth2/token',
      'POST /oauth2/revoke',
      'POST /oauth2/introspect',
      'POST /oauth2/consent',
      'POST /oauth2/continue',
      'POST /oauth2/public-client-prelogin',
    ]);

    // Keep token APIs server-only. Better Auth must receive the raw request body.
    app.use('/api/auth', async (req, res) => {
      if (!allowedAuthRoutes.has(`${req.method} ${req.path}`)) {
        res.status(404).json({ error: 'Not found' });
        return;
      }

      if (
        ['/oauth2/consent', '/oauth2/continue'].includes(req.path) &&
        !(await google.getUser(req.headers))
      ) {
        res
          .status(401)
          .json({ error: 'Sign in with an allowed pilot account.' });
        return;
      }

      return authHandler(req, res);
    });

    app.get(
      [
        '/.well-known/oauth-authorization-server',
        '/.well-known/oauth-authorization-server/api/auth',
      ],
      async (_req, res) => {
        res.json(await google.auth.api.getOAuthServerConfig());
      },
    );

    app.get(
      [
        '/.well-known/oauth-protected-resource',
        '/.well-known/oauth-protected-resource/mcp',
      ],
      (_req, res) => {
        res.json({
          resource: `${google.config.baseURL}/mcp`,
          authorization_servers: [`${google.config.baseURL}/api/auth`],
          scopes_supported: [mcpScope, 'offline_access'],
          bearer_methods_supported: ['header'],
        });
      },
    );

    const uiDirectory = fileURLToPath(
      new URL('../../ui/dist/', import.meta.url),
    );
    app.use('/assets', express.static(`${uiDirectory}/assets`));

    app.get(['/connect.html', '/consent.html'], (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      );
      res.sendFile(`${uiDirectory}${req.path}`);
    });
  }

  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'google-tasks' });
  });

  app.post('/mcp', async (req, res) => {
    if (google) {
      const user = await google.getBearerUser(req.get('authorization'));

      if (!user) {
        res.setHeader(
          'WWW-Authenticate',
          `Bearer resource_metadata="${google.config.baseURL}/.well-known/oauth-protected-resource/mcp", scope="${mcpScope}"`,
        );
        res
          .status(401)
          .json({ error: 'A valid app access token is required.' });
        return;
      }

      return handleMcpRequest(
        req,
        res,
        createGoogleMcpServer(google.tasksForUser(user.id)),
      );
    }

    return handleMcpRequest(req, res, createMcpServer(store));
  });

  if (google) {
    app.post('/api/google/disconnect', async (req, res) => {
      if (!trustedOrigins(google.config).includes(req.get('origin') ?? '')) {
        res.status(403).json({ error: 'Untrusted request origin' });
        return;
      }

      const user = await google.getUser(req.headers);

      if (!user) {
        res.status(401).json({ error: 'Sign in before disconnecting.' });
        return;
      }

      res.setHeader('Cache-Control', 'no-store');
      res.json(await google.disconnect(user.id));
    });

    app.get('/api/google/connection', async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      const user = await google.getUser(req.headers);

      res.json({
        authenticated: Boolean(user),
        user: user ? { name: user.name, email: user.email } : null,
      });
    });

    app.post('/api/google/mcp', async (req, res) => {
      if (!allowsLocalPreview(google.config)) {
        res.sendStatus(404);
        return;
      }

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
