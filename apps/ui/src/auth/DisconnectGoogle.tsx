import { useState } from 'react';
import { z } from 'zod';

import { Button } from '@/components/ui/button';

export function DisconnectGoogle({
  onDisconnected,
}: {
  onDisconnected: (message: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function disconnect() {
    setBusy(true);
    setError('');

    try {
      const response = await fetch('/api/google/disconnect', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Disconnect failed.');
      }

      const result = z
        .object({ googleRevoked: z.boolean() })
        .parse(await response.json());
      onDisconnected(
        result.googleRevoked
          ? 'Disconnected. App access and stored credentials have been removed.'
          : 'App access and stored credentials were removed, but Google revocation could not be confirmed. Remove Tasks for ChatGPT from your Google Account connections.',
      );
    } catch {
      setError(
        'Could not confirm disconnection. Refresh the page to check your connection before retrying.',
      );
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {!confirming ? (
        <Button variant="outline" onClick={() => setConfirming(true)}>
          Disconnect Google
        </Button>
      ) : (
        <div className="space-y-3 rounded-lg border p-4">
          <p className="text-sm">
            Disconnect Google and remove this app’s access on all devices? Your
            Google tasks will stay in Google.
          </p>
          <div className="flex gap-2">
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void disconnect()}
            >
              {busy ? 'Disconnecting…' : 'Disconnect'}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
