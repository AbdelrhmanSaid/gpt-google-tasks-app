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
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { readTaskResult, taskSelection } from '@/widget/taskResult';

interface PreviewConnection {
  client: Client;
  demoSessionId?: string;
  resourceHtml: string;
}

// Development-only host: exercise the built iframe and real MCP transport.
// ChatGPT supplies this host layer in the deployed app.
export function IntegrationPreview({ google = false }: { google?: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const bridge = useRef<AppBridge | null>(null);
  const [connection, setConnection] = useState<PreviewConnection | null>(null);
  const [query, setQuery] = useState(google ? '' : 'website');
  const [lists, setLists] = useState<{ id: string; title: string }[]>([]);
  const [listId, setListId] = useState('');
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
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
        new URL(google ? '/api/google/mcp' : '/mcp', window.location.origin),
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

      let demoSessionId: string | undefined;

      if (google) {
        const availableLists: { id: string; title: string }[] = [];
        let pageToken: string | null = null;

        do {
          const result = CallToolResultSchema.parse(
            await client.callTool({
              name: 'list_task_lists',
              arguments: pageToken ? { pageToken } : {},
            }),
          );

          if (result.isError) {
            throw new Error(
              'Google Tasks access failed. Reconnect and grant Tasks access.',
            );
          }

          const page = z
            .object({
              lists: z.array(z.object({ id: z.string(), title: z.string() })),
              nextPageToken: z.string().nullable(),
            })
            .parse(result.structuredContent);
          availableLists.push(...page.lists);
          pageToken = page.nextPageToken;
        } while (pageToken && !disposed);

        if (!disposed) {
          setLists(availableLists);
          setListId(availableLists[0]?.id ?? '');
        }
      } else {
        const result = await client.callTool({
          name: 'start_demo',
          arguments: {},
        });
        const sample = readTaskResult(CallToolResultSchema.parse(result));

        if (!sample.sampleData) {
          throw new Error('Expected a demo session.');
        }

        demoSessionId = sample.demoSessionId;
      }

      if (!disposed) {
        setConnection({
          client,
          ...(demoSessionId ? { demoSessionId } : {}),
          resourceHtml: content.text,
        });
        setMessage(
          `Connected. Search or create ${google ? 'a Google' : 'a sample'} task to open the widget.`,
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
  }, [google]);

  async function showTasks(result: CallToolResult) {
    const iframe = frame.current;
    const targetWindow = iframe?.contentWindow;

    if (!connection || !iframe || !targetWindow) {
      throw new Error('Preview is not ready.');
    }

    const snapshot = readTaskResult(result);
    const args = taskSelection(snapshot);
    setNextPageToken(snapshot.sampleData ? null : snapshot.nextPageToken);
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

  async function runAction(action: 'search' | 'create', pageToken?: string) {
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
            ...(google
              ? { listId, ...(pageToken ? { pageToken } : {}) }
              : { demoSessionId: connection.demoSessionId }),
            ...(action === 'search' ? { query } : { title }),
          },
        },
        CallToolResultSchema,
      );

      await showTasks(CallToolResultSchema.parse(result));
      setMessage(
        `Widget connected through MCP. Card changes are saved ${google ? 'in your Google account' : 'on the sample server'}.`,
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
      {google && (
        <div className="space-y-2">
          <Label htmlFor="task-list">Task list</Label>
          <select
            id="task-list"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            value={listId}
            disabled={busy}
            onChange={(event) => {
              setListId(event.target.value);
              setNextPageToken(null);
            }}
          >
            {lists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.title}
              </option>
            ))}
          </select>
        </div>
      )}
      <form
        className="flex items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void runAction('search');
        }}
      >
        <div className="flex-1 space-y-2">
          <Label htmlFor="query">
            Search {google ? 'Google' : 'sample'} tasks
          </Label>
          <Input
            id="query"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setNextPageToken(null);
            }}
          />
        </div>
        <Button disabled={busy || (google && !listId)}>Search</Button>
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
        <Button disabled={busy || !title.trim() || (google && !listId)}>
          Create
        </Button>
      </form>
      <p role="status" className="text-sm text-muted-foreground">
        {message}
      </p>
      {nextPageToken && (
        <div className="flex items-center gap-3 text-sm">
          <span>
            More tasks remain in this list. Search the next page for additional
            matches.
          </span>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void runAction('search', nextPageToken)}
          >
            Next page
          </Button>
        </div>
      )}
      <iframe
        ref={frame}
        title="Task cards widget"
        sandbox="allow-scripts allow-forms"
        className="min-h-52 w-full border-0"
      />
    </main>
  );
}
