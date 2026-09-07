import { useEffect, useState } from 'react';
import { useApp } from '@modelcontextprotocol/ext-apps/react';
import type { Task, TaskSnapshot } from '@tasks/shared';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TaskResults } from '@/tasks/TaskResults';

import { readTaskResult } from './taskResult';

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
        arguments: {
          demoSessionId: snapshot.demoSessionId,
          taskIds: snapshot.tasks.map((task) => task.id),
        },
      });

      setSnapshot(readTaskResult(result));
      setLoadError(false);
      setNotice('Tasks refreshed.');
    } catch {
      setNotice(
        'Could not refresh. Ask ChatGPT to search again; the demo session may have expired.',
      );
    } finally {
      setRefreshing(false);
    }
  }

  async function updateTask(updated: Task): Promise<void> {
    const previous = snapshot?.tasks.find((task) => task.id === updated.id);

    if (!app || !isConnected || !snapshot || !previous) {
      throw new Error('The task connection is not ready.');
    }

    const completionChanged = previous.status !== updated.status;
    const result = await app.callServerTool({
      name: completionChanged ? 'set_task_completed' : 'update_task',
      arguments: {
        demoSessionId: snapshot.demoSessionId,
        taskId: updated.id,
        expectedRevision: previous.revision,
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

    setSnapshot((current) => {
      if (!current || current.demoSessionId !== saved.demoSessionId) {
        return current;
      }

      return {
        ...current,
        tasks: current.tasks.map(
          (task) => saved.tasks.find((item) => item.id === task.id) ?? task,
        ),
      };
    });

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
        <Badge variant="secondary">Sample data · Google is not connected</Badge>
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
