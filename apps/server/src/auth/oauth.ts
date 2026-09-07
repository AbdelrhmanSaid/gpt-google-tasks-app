import {
  getOAuthProviderApi,
  oauthProvider,
} from '@better-auth/oauth-provider';
import type { OAuthOptions } from '@better-auth/oauth-provider';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { z } from 'zod';

import type { GoogleConfig } from '../config.js';

export const mcpScope = 'tasks:manage';

export function createOAuthPlugins(config: GoogleConfig) {
  const resource = `${config.baseURL}/mcp`;
  const options: OAuthOptions<string[]> = {
    loginPage: `${config.baseURL}/connect.html`,
    consentPage: `${config.baseURL}/consent.html`,
    scopes: [mcpScope, 'offline_access'],
    grantTypes: ['authorization_code', 'refresh_token'],
    disableJwtPlugin: true,
    storeTokens: 'hashed',
    accessTokenExpiresIn: 3600,
    refreshTokenExpiresIn: 30 * 24 * 60 * 60,
    allowDynamicClientRegistration: false,
    allowUnauthenticatedClientRegistration: false,
    allowPublicClientPrelogin: true,
    // Registrations belong to the service, not the operator's Google connection.
    clientReference: () => 'pilot-managed-clients',
    resources: [
      { identifier: resource, allowedScopes: [mcpScope, 'offline_access'] },
    ],
    clientRegistrationDefaultResources: [resource],
  };

  return [
    oauthProvider(options),
    {
      id: 'tasks-token-validation',
      endpoints: {
        // Called only inside the server. The HTTP route allowlist never exposes this API.
        verifyMcpToken: createAuthEndpoint(
          '/tasks/verify-token',
          {
            method: 'POST',
            body: z.object({ token: z.string().min(1).max(8192) }),
            metadata: { SERVER_ONLY: true },
          },
          async (ctx) => {
            const provider = getOAuthProviderApi(ctx, options);
            const claims = await provider.requireActiveAccessToken(
              ctx.body.token,
            );
            const audience = Array.isArray(claims.aud)
              ? claims.aud
              : [claims.aud];

            if (
              claims.iss !== `${config.baseURL}/api/auth` ||
              !audience.includes(resource) ||
              typeof claims.sub !== 'string' ||
              typeof claims.exp !== 'number' ||
              claims.exp <= Date.now() / 1000 ||
              claims.cnf
            ) {
              throw new APIError('UNAUTHORIZED', {
                message: 'Invalid access token.',
              });
            }

            if (
              typeof claims.scope !== 'string' ||
              !claims.scope.split(' ').includes(mcpScope)
            ) {
              throw new APIError('FORBIDDEN', {
                message: 'Insufficient scope.',
              });
            }

            return { userId: claims.sub };
          },
        ),
      },
    },
  ] as const;
}
