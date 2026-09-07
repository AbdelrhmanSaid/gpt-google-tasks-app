import { useEffect, useState } from 'react';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { DisconnectGoogle } from './DisconnectGoogle';

const connectionSchema = z.object({
  authenticated: z.boolean(),
  user: z.object({ name: z.string(), email: z.string() }).nullable(),
});
const query = window.location.search.slice(1);
const params = new URLSearchParams(query);
const clientId = params.get('client_id');
const consenting = window.location.pathname === '/consent.html';

export function OAuthPage() {
  const [connection, setConnection] = useState<z.infer<
    typeof connectionSchema
  > | null>(null);
  const [clientName, setClientName] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Checking your connection…');

  useEffect(() => {
    let disposed = false;

    async function load() {
      const response = await fetch('/api/google/connection');

      if (!response.ok) {
        throw new Error('Connection unavailable.');
      }

      const current = connectionSchema.parse(await response.json());
      let name = '';

      if (clientId) {
        // The provider checks the signed authorization query before returning client details.
        const clientResponse = await fetch(
          '/api/auth/oauth2/public-client-prelogin',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id: clientId, oauth_query: query }),
          },
        );

        if (!clientResponse.ok) {
          throw new Error(
            'The authorization request expired or is invalid. Start the connection again.',
          );
        }

        name = z
          .object({ client_name: z.string() })
          .parse(await clientResponse.json()).client_name;
      }

      if (!disposed) {
        setConnection(current);
        setClientName(name);
        setReady(true);
        setMessage(
          current.authenticated
            ? 'Connected to Google.'
            : 'Sign in with your pilot Google account.',
        );
      }
    }

    void load().catch((error: unknown) => {
      if (!disposed) {
        setMessage(
          error instanceof Error
            ? error.message
            : 'Could not load the connection.',
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
          callbackURL: `${window.location.origin}/connect.html`,
          ...(clientId ? { oauth_query: query } : {}),
        }),
      });

      if (!response.ok) {
        throw new Error('Could not start sign-in.');
      }

      const { url } = z.object({ url: z.url() }).parse(await response.json());

      if (new URL(url).origin !== 'https://accounts.google.com') {
        throw new Error('Unexpected sign-in destination.');
      }

      window.location.assign(url);
    } catch {
      setMessage('Could not start Google sign-in. Start the connection again.');
      setBusy(false);
    }
  }

  async function consent(accept: boolean) {
    setBusy(true);

    try {
      const response = await fetch('/api/auth/oauth2/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accept, oauth_query: query }),
      });

      if (!response.ok) {
        throw new Error('Authorization failed.');
      }

      const { url } = z.object({ url: z.url() }).parse(await response.json());
      const destination = new URL(url);
      const callback = new URL(
        params.get('redirect_uri') ?? window.location.origin,
      );
      const isCallback =
        destination.origin === callback.origin &&
        destination.pathname === callback.pathname;
      const isLocalStep =
        destination.origin === window.location.origin &&
        ['/connect.html', '/consent.html'].includes(destination.pathname);

      if (!isCallback && !isLocalStep) {
        throw new Error('Unexpected redirect destination.');
      }

      window.location.assign(url);
    } catch {
      setMessage('Authorization could not finish. Start the connection again.');
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-lg space-y-5 px-6 py-12">
      <h1 className="text-2xl font-semibold">
        {consenting
          ? `Allow ${clientName || 'this client'} to use your tasks?`
          : 'Connect Google Tasks'}
      </h1>
      <p role="status" className="text-sm text-muted-foreground">
        {message}
      </p>
      {connection?.user && <p className="text-sm">{connection.user.email}</p>}
      {ready && consenting && connection?.authenticated && (
        <section className="space-y-4 rounded-xl border p-5">
          <p className="text-sm">
            This allows {clientName} to search, create, edit, complete, and
            reopen tasks in your Google account.
          </p>
          {params.get('scope')?.split(' ').includes('offline_access') && (
            <p className="text-sm text-muted-foreground">
              Access can continue after you close this page. You can disconnect
              at any time.
            </p>
          )}
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => void consent(true)}>
              Allow access
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void consent(false)}
            >
              Cancel
            </Button>
          </div>
        </section>
      )}
      {ready && (!consenting || !connection?.authenticated) && (
        <Button disabled={busy} onClick={() => void signIn()}>
          {connection?.authenticated
            ? 'Continue with Google'
            : 'Sign in with Google'}
        </Button>
      )}
      {ready && connection?.authenticated && !clientId && (
        <DisconnectGoogle
          onDisconnected={(text) => {
            setConnection({ authenticated: false, user: null });
            setMessage(text);
          }}
        />
      )}
      <a
        className="text-sm underline"
        href="https://myaccount.google.com/connections"
        target="_blank"
        rel="noreferrer"
      >
        Google Account connections
      </a>
    </main>
  );
}
