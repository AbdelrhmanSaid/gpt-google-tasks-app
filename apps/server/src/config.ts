import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

const localOrigin = 'http://127.0.0.1:3001';
const serverDirectory = new URL('../', import.meta.url);

export interface GoogleConfig {
  baseURL: string;
  secret: string;
  clientId: string;
  clientSecret: string;
  allowedEmails: Set<string>;
  databasePath: string;
}

export function loadLocalEnvironment(): void {
  try {
    process.loadEnvFile(new URL('.env', serverDirectory));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error('Could not load the server environment file.');
    }
  }
}

export function readGoogleConfig(
  env: NodeJS.ProcessEnv = process.env,
): GoogleConfig | undefined {
  if (env.NODE_ENV === 'production' && env.TASKS_MODE !== 'google') {
    throw new Error('Production requires TASKS_MODE=google.');
  }

  if (env.TASKS_MODE !== 'google') {
    if (env.TASKS_MODE && env.TASKS_MODE !== 'demo') {
      throw new Error('TASKS_MODE must be demo or google.');
    }

    return undefined;
  }

  const result = z
    .object({
      BETTER_AUTH_URL: z.string().refine((value) => {
        if (env.NODE_ENV !== 'production') {
          return value === localOrigin;
        }

        try {
          const url = new URL(value);

          return url.protocol === 'https:' && url.origin === value;
        } catch {
          return false;
        }
      }),
      BETTER_AUTH_SECRET: z.string().min(32),
      GOOGLE_CLIENT_ID: z.string().endsWith('.apps.googleusercontent.com'),
      GOOGLE_CLIENT_SECRET: z.string().min(1),
      PILOT_ALLOWED_EMAILS: z.string().min(1),
      AUTH_DATABASE_PATH: z.string().min(1).default('./data/auth.sqlite'),
    })
    .safeParse(env);

  if (!result.success) {
    // Report field names only; validation errors must never print secret values.
    const fields = [
      ...new Set(result.error.issues.map((issue) => issue.path[0])),
    ];

    throw new Error(
      `Invalid Google configuration: ${fields.join(', ')}. Use an HTTPS origin in production or ${localOrigin} locally.`,
    );
  }

  const values = result.data;
  const emails = values.PILOT_ALLOWED_EMAILS.split(',').map((value) =>
    value.trim().toLowerCase(),
  );

  if (emails.some((email) => !z.email().safeParse(email).success)) {
    throw new Error(
      'PILOT_ALLOWED_EMAILS must contain valid comma-separated email addresses.',
    );
  }

  return {
    baseURL: values.BETTER_AUTH_URL,
    secret: values.BETTER_AUTH_SECRET,
    clientId: values.GOOGLE_CLIENT_ID,
    clientSecret: values.GOOGLE_CLIENT_SECRET,
    allowedEmails: new Set(emails),
    databasePath: resolve(
      fileURLToPath(serverDirectory),
      values.AUTH_DATABASE_PATH,
    ),
  };
}
