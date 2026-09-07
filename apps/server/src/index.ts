import { createApp } from './app.js';
import { createGoogleAuth } from './auth/google.js';
import { loadLocalEnvironment, readGoogleConfig } from './config.js';

loadLocalEnvironment();

const config = readGoogleConfig();
const google = config ? createGoogleAuth(config) : undefined;

const port = Number(process.env.PORT ?? 3001);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

if (google && port !== 3001) {
  throw new Error(
    'Local Google testing requires PORT=3001 to match the OAuth callback.',
  );
}

const httpServer = createApp(google).listen(port, '127.0.0.1', () => {
  console.log(
    `Tasks server (${google ? 'Google' : 'demo'}): http://127.0.0.1:${port}`,
  );
});

httpServer.on('error', (error) => {
  console.error('Unable to start the Tasks server:', error.message);
  process.exitCode = 1;
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => httpServer.close(() => google?.database.close()));
}
