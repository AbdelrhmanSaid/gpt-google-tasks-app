import { useEffect, useRef, useState } from 'react';
import {
  AppBridge,
  PostMessageTransport,
  getToolUiResourceUri,
} from '@modelcontextprotocol/ext-apps/app-bridge';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { readTaskResult } from '@/widget/taskResult';

interface PreviewConnection {
  client: Client;
  demoSessionId: string;
  resourceHtml: string;
}

// Development-only host: exercise the built iframe and real MCP transport.
// ChatGPT supplies this host layer in the deployed app.
export function IntegrationPreview() {
  const frame = useRef<HTMLIFrameElement>(null);
  const bridge = useRef<AppBridge | null>(null);
  const [connection, setConnection] = useState<PreviewConnection | null>(null);
  const [query, setQuery] = useState('website');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('Connecting to the local MCP server…');

  useEffect(() => {
    const client = new Client({
      name: 'Local integration preview',
      version: '0.1.0',
    });
    let disposed = false;

    async function connect() {
      const transport = new StreamableHTTPClientTransport(
        new URL('/mcp', window.location.origin),
      );

      // @ts-expect-error SDK Transport.sessionId omits undefined under exactOptionalPropertyTypes.
      await client.connect(transport);

      const { tools } = await client.listTools();
      const renderTool = tools.find((tool) => tool.name === 'render_tasks');
      const resourceUri = renderTool && getToolUiResourceUri(renderTool);

      if (!resourceUri) {
        throw new Error('Task UI resource was not advertised.');
      }

      const resource = await client.readResource({ uri: resourceUri });
      const content = resource.contents[0];

      if (!content || !('text' in content)) {
        throw new Error('Task UI resource did not contain HTML.');
      }

      const result = await client.callTool({
        name: 'start_demo',
        arguments: {},
      });
      const sample = readTaskResult(CallToolResultSchema.parse(result));

      if (!disposed) {
        setConnection({
          client,
          demoSessionId: sample.demoSessionId,
          resourceHtml: content.text,
        });
        setMessage(
          'Connected. Search or create a sample task to open the widget.',
        );
        setBusy(false);
      }
    }

    void connect().catch((error: unknown) => {
      if (!disposed) {
        setMessage(
          error instanceof Error ? error.message : 'Could not connect.',
        );
      }
    });

    return () => {
      disposed = true;
      void bridge.current?.close();
      void client.close();
    };
  }, []);

  async function showTasks(result: CallToolResult) {
    const iframe = frame.current;
    const targetWindow = iframe?.contentWindow;

    if (!connection || !iframe || !targetWindow) {
      throw new Error('Preview is not ready.');
    }

    const snapshot = readTaskResult(result);
    const args = {
      demoSessionId: connection.demoSessionId,
      taskIds: snapshot.tasks.map((task) => task.id),
    };
    const rendered = await connection.client.callTool(
      { name: 'render_tasks', arguments: args },
      CallToolResultSchema,
    );

    await bridge.current?.close();

    const nextBridge = new AppBridge(
      connection.client,
      { name: 'Local preview host', version: '0.1.0' },
      { serverTools: {}, updateModelContext: {} },
    );
    bridge.current = nextBridge;

    nextBridge.onupdatemodelcontext = async () => {
      setMessage(
        'Widget connected. The host received the latest task context.',
      );

      return {};
    };

    nextBridge.onsizechange = ({ height }) => {
      if (height) {
        iframe.style.height = `${height}px`;
      }
    };

    // Register the host listener before loading the app, so its handshake cannot be lost.
    await nextBridge.connect(
      new PostMessageTransport(targetWindow, targetWindow),
    );

    const ready = new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error('Widget connection timed out.')),
        10000,
      );

      nextBridge.oninitialized = () => {
        window.clearTimeout(timeout);

        void (async () => {
          await nextBridge.sendToolInput({ arguments: args });
          await nextBridge.sendToolResult(CallToolResultSchema.parse(rendered));
          resolve();
        })().catch(reject);
      };
    });

    iframe.srcdoc = connection.resourceHtml;
    await ready;
  }

  async function runAction(action: 'search' | 'create') {
    if (!connection) {
      return;
    }

    setBusy(true);
    setMessage('Calling MCP tools…');

    try {
      const result = await connection.client.callTool(
        {
          name: action === 'search' ? 'search_tasks' : 'create_task',
          arguments: {
            demoSessionId: connection.demoSessionId,
            ...(action === 'search' ? { query } : { title }),
          },
        },
        CallToolResultSchema,
      );

      await showTasks(CallToolResultSchema.parse(result));
      setMessage(
        'Widget connected through MCP. Card changes are saved on the sample server.',
      );

      if (action === 'create') {
        setTitle('');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl space-y-5 p-6">
      <h1 className="text-xl font-semibold">MCP integration preview</h1>
      <p className="text-sm text-muted-foreground">
        Development controls simulate the conversation. The frame below loads
        the exact HTML resource served to ChatGPT.
      </p>
      <form
        className="flex items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void runAction('search');
        }}
      >
        <div className="flex-1 space-y-2">
          <Label htmlFor="query">Search sample tasks</Label>
          <Input
            id="query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <Button disabled={busy}>Search</Button>
      </form>
      <form
        className="flex items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void runAction('create');
        }}
      >
        <div className="flex-1 space-y-2">
          <Label htmlFor="new-title">New task title</Label>
          <Input
            id="new-title"
            value={title}
            maxLength={1024}
            required
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <Button disabled={busy || !title.trim()}>Create</Button>
      </form>
      <p role="status" className="text-sm text-muted-foreground">
        {message}
      </p>
      <iframe
        ref={frame}
        title="Task cards widget"
        sandbox="allow-scripts allow-forms"
        className="min-h-52 w-full border-0"
      />
    </main>
  );
}
