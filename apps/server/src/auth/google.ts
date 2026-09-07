import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'node:http';

import type { GoogleConfig } from '../config.js';
import { GoogleTasksError } from '../google/errors.js';
import { GoogleTasksClient } from '../google/tasks.js';
import { createOAuthPlugins } from './oauth.js';
import { disconnectGoogle } from './disconnect.js';

export const tasksScope = 'https://www.googleapis.com/auth/tasks';
export const previewOrigin = 'http://127.0.0.1:5173';

export function createGoogleAuth(config: GoogleConfig) {
  mkdirSync(dirname(config.databasePath), { recursive: true });

  const database = new DatabaseSync(config.databasePath);
  database.exec(
    'PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;',
  );

  const auth = betterAuth({
    appName: 'Tasks for ChatGPT',
    baseURL: config.baseURL,
    secret: config.secret,
    database,
    trustedOrigins: [previewOrigin],
    logger: { disabled: true },
    plugins: [...createOAuthPlugins(config)],
    socialProviders: {
      google: {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        scope: [tasksScope],
        accessType: 'offline',
        prompt: 'select_account consent',
      },
    },
    account: {
      encryptOAuthTokens: true,
      storeStateStrategy: 'database',
      storeAccountCookie: false,
      accountLinking: { enabled: false },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (
              !user.emailVerified ||
              !config.allowedEmails.has(user.email.toLowerCase())
            ) {
              throw new APIError('FORBIDDEN', {
                message: 'This account is not in the pilot.',
              });
            }

            return { data: user };
          },
        },
      },
    },
  });

  // Deduplicate simultaneous refreshes for one user without caching plaintext tokens.
  const pendingTokens = new Map<string, Promise<string>>();

  async function getUser(headers: IncomingHttpHeaders) {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(headers),
    });

    if (
      !session?.user.emailVerified ||
      !config.allowedEmails.has(session.user.email.toLowerCase())
    ) {
      return null;
    }

    return session.user;
  }

  async function resolveToken(userId: string): Promise<string> {
    try {
      const context = await auth.$context;
      const accounts = await context.internalAdapter.findAccounts(userId);
      const account = accounts.find((item) => item.providerId === 'google');

      if (
        !account?.refreshToken ||
        !account.scope?.split(/[ ,]+/).includes(tasksScope)
      ) {
        throw new Error('Missing offline Tasks grant.');
      }

      const result = await auth.api.getAccessToken({
        body: { accountId: account.id, userId },
      });

      if (!result.accessToken) {
        throw new Error('No access token.');
      }

      return result.accessToken;
    } catch {
      throw new GoogleTasksError(
        'Reconnect Google and grant Tasks access to continue.',
        'reconnect',
      );
    }
  }

  async function getBearerUser(authorization: string | undefined) {
    if (!authorization?.startsWith('Bearer ')) {
      return null;
    }

    try {
      const { userId } = await auth.api.verifyMcpToken({
        body: { token: authorization.slice(7) },
      });
      const context = await auth.$context;
      const user = await context.internalAdapter.findUserById(userId);

      if (
        !user?.emailVerified ||
        !config.allowedEmails.has(user.email.toLowerCase())
      ) {
        return null;
      }

      return user;
    } catch {
      return null;
    }
  }

  async function disconnect(userId: string) {
    // Finish any token refresh before deleting its account row.
    await pendingTokens.get(userId)?.catch(() => undefined);

    return disconnectGoogle(database, config, userId);
  }

  function tasksForUser(userId: string): GoogleTasksClient {
    return new GoogleTasksClient(() => {
      const pending = pendingTokens.get(userId);

      if (pending) {
        return pending;
      }

      const request = resolveToken(userId).finally(() =>
        pendingTokens.delete(userId),
      );
      pendingTokens.set(userId, request);

      return request;
    });
  }

  return {
    auth,
    database,
    config,
    getUser,
    getBearerUser,
    disconnect,
    tasksForUser,
  };
}

export type GoogleAuth = ReturnType<typeof createGoogleAuth>;
