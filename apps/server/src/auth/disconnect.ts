import type { DatabaseSync } from 'node:sqlite';

import { symmetricDecrypt } from 'better-auth/crypto';

import type { GoogleConfig } from '../config.js';

export async function disconnectGoogle(
  database: DatabaseSync,
  config: GoogleConfig,
  userId: string,
  fetcher: typeof fetch = fetch,
): Promise<{ googleRevoked: boolean }> {
  const account = database
    .prepare(
      'SELECT refreshToken, accessToken FROM account WHERE userId = ? AND providerId = ?',
    )
    .get(userId, 'google');
  const encryptedToken = account?.refreshToken ?? account?.accessToken;

  // Remove the identity as well as its grants. Reconnecting gets a new identity,
  // so an old in-flight authorization can never attach to the new connection.
  database.exec('BEGIN IMMEDIATE');

  try {
    database
      .prepare('DELETE FROM oauthAccessToken WHERE userId = ?')
      .run(userId);
    database
      .prepare('DELETE FROM oauthRefreshToken WHERE userId = ?')
      .run(userId);
    database.prepare('DELETE FROM oauthConsent WHERE userId = ?').run(userId);
    database
      .prepare(
        "DELETE FROM verification WHERE CASE WHEN json_valid(value) THEN json_extract(value, '$.userId') = ? ELSE 0 END",
      )
      .run(userId);
    database.prepare('DELETE FROM session WHERE userId = ?').run(userId);
    database.prepare('DELETE FROM account WHERE userId = ?').run(userId);
    database.prepare('DELETE FROM user WHERE id = ?').run(userId);
    database.exec('COMMIT');
  } catch {
    database.exec('ROLLBACK');
    throw new Error('Could not remove this connection. Please try again.');
  }

  if (typeof encryptedToken !== 'string') {
    return { googleRevoked: true };
  }

  try {
    const token = await symmetricDecrypt({
      key: config.secret,
      data: encryptedToken,
    });
    const response = await fetcher('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });

    // A failed Google request must never restore local access.
    return { googleRevoked: response.ok };
  } catch {
    return { googleRevoked: false };
  }
}
