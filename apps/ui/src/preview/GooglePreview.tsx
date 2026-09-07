import { useEffect, useState } from 'react';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { IntegrationPreview } from './IntegrationPreview';

const connectionSchema = z.object({
  authenticated: z.boolean(),
  user: z.object({ name: z.string(), email: z.string() }).nullable(),
});

export function GooglePreview() {
  const [connection, setConnection] = useState<z.infer<
    typeof connectionSchema
  > | null>(null);
  const [message, setMessage] = useState('Checking your connection…');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let disposed = false;

    async function checkConnection() {
      const response = await fetch('/api/google/connection');

      if (!response.ok) {
        throw new Error(
          'Google mode is not ready. Check the local server configuration.',
        );
      }

      const current = connectionSchema.parse(await response.json());

      if (!disposed) {
        setConnection(current);
        setMessage(
          current.authenticated
            ? 'Connected to your account.'
            : 'Connect Google to test your own tasks.',
        );
      }
    }

    void checkConnection().catch(() => {
      if (!disposed) {
        setMessage(
          'Google mode is not ready. Check the local server configuration.',
        );
      }
    });

    return () => {
      disposed = true;
    };
  }, []);

  async function signIn() {
    setBusy(true);

    try {
      const response = await fetch('/api/auth/sign-in/social', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          callbackURL: `${window.location.origin}/google.html`,
          errorCallbackURL: `${window.location.origin}/google.html?connection=failed`,
        }),
      });

      if (!response.ok) {
        throw new Error('Sign-in failed.');
      }

      const result = z.object({ url: z.url() }).parse(await response.json());
      const url = new URL(result.url);

      if (url.origin !== 'https://accounts.google.com') {
        throw new Error('Unexpected sign-in destination.');
      }

      window.location.assign(url.href);
    } catch {
      setMessage('Could not start Google sign-in. Please try again.');
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);

    try {
      const response = await fetch('/api/auth/sign-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });

      if (!response.ok) {
        throw new Error('Sign-out failed.');
      }

      window.location.reload();
    } catch {
      setMessage('Could not sign out. Please try again.');
      setBusy(false);
    }
  }

  return (
    <>
      <header className="mx-auto max-w-3xl space-y-3 px-6 pt-6">
        <h1 className="text-xl font-semibold">
          Google connection · local test
        </h1>
        {connection?.user && <p className="text-sm">{connection.user.email}</p>}
        <p className="text-sm text-muted-foreground" role="status">
          {message}
        </p>
        {window.location.search.includes('connection=failed') && (
          <p role="alert" className="text-sm text-destructive">
            Sign-in did not finish. Use an allowed pilot account and grant Tasks
            access.
          </p>
        )}
        <div className="flex gap-2">
          <Button disabled={busy || !connection} onClick={() => void signIn()}>
            {connection?.authenticated ? 'Reconnect Google' : 'Connect Google'}
          </Button>
          {connection?.authenticated && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void signOut()}
            >
              Sign out
            </Button>
          )}
        </div>
      </header>
      {connection?.authenticated && <IntegrationPreview google />}
    </>
  );
}
