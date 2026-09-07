import { useEffect, useState } from 'react';
import { useApp } from '@modelcontextprotocol/ext-apps/react';
import type { Task, TaskSnapshot } from '@tasks/shared';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TaskResults } from '@/tasks/TaskResults';

import { mergeTaskResult, readTaskResult, taskSelection } from './taskResult';

export function Widget() {
  const [snapshot, setSnapshot] = useState<TaskSnapshot | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState('');
  const { app, isConnected, error } = useApp({
    appInfo: { name: 'Google Tasks cards', version: '0.1.0' },
    capabilities: {},
    onAppCreated(connectedApp) {
      connectedApp.ontoolresult = (result) => {
        try {
          setSnapshot(readTaskResult(result));
          setLoadError(false);
        } catch {
          setLoadError(true);
        }
      };

      connectedApp.ontoolcancelled = () => setLoadError(true);
    },
  });

  useEffect(() => {
    if (
      !app ||
      !isConnected ||
      !snapshot ||
      !app.getHostCapabilities()?.updateModelContext
    ) {
      return;
    }

    // Context updates do not trigger a new assistant turn. Keep all visible tasks,
    // because each update replaces the host's previous context for this widget.
    void app
      .updateModelContext({ structuredContent: { ...snapshot } })
      .catch(() => {
        setNotice(
          'Cards are current, but chat context could not be updated. Ask ChatGPT to search again if needed.',
        );
      });
  }, [app, isConnected, snapshot]);

  async function refreshTasks() {
    if (!app || !snapshot) {
      return;
    }

    setRefreshing(true);
    setNotice('');

    try {
      const result = await app.callServerTool({
        name: 'get_tasks',
        arguments: taskSelection(snapshot),
      });

      setSnapshot(readTaskResult(result));
      setLoadError(false);
      setNotice('Tasks refreshed.');
    } catch {
      setNotice(
        'Could not refresh. Check your connection and ask ChatGPT to search again.',
      );
    } finally {
      setRefreshing(false);
    }
  }

  async function updateTask(updated: Task): Promise<void> {
    const previous = snapshot?.tasks.find(
      (task) => task.id === updated.id && task.listId === updated.listId,
    );

    if (!app || !isConnected || !snapshot || !previous) {
      throw new Error('The task connection is not ready.');
    }

    const completionChanged = previous.status !== updated.status;
    const result = await app.callServerTool({
      name: completionChanged ? 'set_task_completed' : 'update_task',
      arguments: {
        ...(snapshot.sampleData && 'revision' in previous
          ? {
              demoSessionId: snapshot.demoSessionId,
              taskId: previous.id,
              expectedRevision: previous.revision,
            }
          : {
              id: previous.id,
              listId: previous.listId,
              expectedEtag: 'etag' in previous ? previous.etag : undefined,
            }),
        ...(completionChanged
          ? { completed: updated.status === 'completed' }
          : {
              title: updated.title,
              notes: updated.notes ?? null,
              scheduledDate: updated.scheduledDate ?? null,
            }),
      },
    });
    const saved = readTaskResult(result);

    setSnapshot((current) => mergeTaskResult(current, saved));

    setNotice('Task saved.');
  }

  if (error || (loadError && !snapshot)) {
    return (
      <p role="alert" className="p-4 text-sm">
        Could not load these cards. Ask ChatGPT to search and show the tasks
        again.
      </p>
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <Badge variant="secondary">
          {snapshot?.sampleData === false
            ? 'Google Tasks'
            : 'Sample data · Google is not connected'}
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          disabled={!snapshot || refreshing}
          onClick={() => void refreshTasks()}
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>
      <TaskResults
        tasks={snapshot?.tasks ?? []}
        state={
          loadError ? 'error' : snapshot && isConnected ? 'ready' : 'loading'
        }
        onUpdate={updateTask}
        onRetry={() => void refreshTasks()}
      />
      <p role="status" className="mt-3 text-xs text-muted-foreground">
        {notice}
      </p>
    </main>
  );
}
