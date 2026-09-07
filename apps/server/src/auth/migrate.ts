import { getMigrations } from 'better-auth/db/migration';

import { loadLocalEnvironment, readGoogleConfig } from '../config.js';
import { createGoogleAuth } from './google.js';

loadLocalEnvironment();

const config = readGoogleConfig();

if (!config) {
  throw new Error(
    'Set TASKS_MODE=google before migrating the authentication database.',
  );
}

const { auth, database } = createGoogleAuth(config);

try {
  const migrations = await getMigrations(auth.options);
  await migrations.runMigrations();
  console.log('Authentication database is up to date.');
} finally {
  database.close();
}
