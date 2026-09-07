import { useState } from 'react';

import type { Task } from '@tasks/shared';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

import { sampleTasks } from './preview/sampleTasks';
import { TaskResults } from './tasks/TaskResults';
import type { ResultsState } from './tasks/TaskResults';

type Scenario = 'multiple' | 'single' | 'empty' | 'loading' | 'error';

const scenarios: { id: Scenario; label: string; prompt: string }[] = [
  { id: 'multiple', label: 'Multiple tasks', prompt: 'Find my website tasks' },
  {
    id: 'single',
    label: 'Single task',
    prompt: 'Show the homepage review task',
  },
  {
    id: 'empty',
    label: 'No matches',
    prompt: 'Find tasks about the office move',
  },
  { id: 'loading', label: 'Loading', prompt: 'Find my website tasks' },
  { id: 'error', label: 'Load error', prompt: 'Find my website tasks' },
];

export function App() {
  const [scenario, setScenario] = useState<Scenario>('multiple');
  const [tasks, setTasks] = useState(sampleTasks);
  const [failUpdates, setFailUpdates] = useState(false);
  const [notice, setNotice] = useState('');
  const currentScenario = scenarios.find((item) => item.id === scenario)!;
  const state: ResultsState =
    scenario === 'loading' || scenario === 'error' ? scenario : 'ready';
  let visibleTasks = tasks;

  if (scenario === 'empty') {
    visibleTasks = [];
  }

  if (scenario === 'single') {
    visibleTasks = tasks.slice(0, 1);
  }

  async function updateTask(updated: Task) {
    // Latency belongs to the preview adapter, not the reusable task cards.
    await new Promise((resolve) => setTimeout(resolve, 450));

    if (failUpdates) {
      throw new Error('Simulated update failure');
    }

    setTasks((existing) =>
      existing.map((task) =>
        task.id === updated.id && task.listId === updated.listId
          ? updated
          : task,
      ),
    );
    setNotice(`Saved “${updated.title}”.`);
  }

  return (
    <main className="mx-auto my-7 max-w-185 px-4 sm:my-16 sm:px-6">
      <header className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold tracking-widest text-muted-foreground">
          TASK CARDS / PREVIEW
        </span>
        <Badge variant="secondary">Sample data</Badge>
      </header>
      <h1 className="mt-7 mb-1.5 text-3xl font-semibold tracking-tight sm:text-4xl">
        A little less on your mind.
      </h1>
      <p className="text-sm text-muted-foreground">
        Your tasks, right where the conversation happens.
      </p>

      <nav
        className="mt-7 mb-10 flex flex-wrap gap-1.5"
        aria-label="Preview scenarios"
      >
        {scenarios.map((item) => (
          <Button
            variant={scenario === item.id ? 'secondary' : 'ghost'}
            size="sm"
            key={item.id}
            type="button"
            aria-pressed={scenario === item.id}
            onClick={() => {
              setScenario(item.id);
              setNotice('');
            }}
          >
            {item.label}
          </Button>
        ))}
      </nav>

      <div>
        <p className="mb-6 ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-sm bg-message px-4 py-3 text-sm">
          {currentScenario.prompt}
        </p>
        <TaskResults
          key={scenario}
          tasks={visibleTasks}
          state={state}
          onUpdate={updateTask}
          onRetry={() => setScenario('multiple')}
        />
        <p className="sr-only" role="status">
          {notice}
        </p>
      </div>

      <footer className="mt-7 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <Checkbox
            id="simulate-failed-updates"
            checked={failUpdates}
            onCheckedChange={(checked) => setFailUpdates(checked === true)}
          />
          <Label htmlFor="simulate-failed-updates">
            Simulate failed updates
          </Label>
        </div>
        <p className="my-3">
          Local preview only. Changes reset on reload; no Google account is
          connected.
        </p>
      </footer>
    </main>
  );
}
