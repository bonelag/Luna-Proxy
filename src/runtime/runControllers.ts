import type { WorkerClient } from './workerClient';

interface RunController {
  runId: string;
  abortController: AbortController;
  workerClient?: WorkerClient;
  workerRunId?: string;
}

const controllers = new Map<string, RunController>();

export function registerRunController(runId: string, controller: RunController): void {
  controllers.set(runId, controller);
}

export function unregisterRunController(runId: string): void {
  controllers.delete(runId);
}

export async function abortRun(
  runId: string,
  reason?: string,
): Promise<boolean> {
  const ctrl = controllers.get(runId);
  if (!ctrl) return false;
  try {
    ctrl.abortController.abort(reason || 'Run cancelled');
    if (ctrl.workerClient && ctrl.workerRunId) {
      ctrl.workerClient.cancelRun(ctrl.workerRunId).catch(() => {});
    }
    return true;
  } finally {
    controllers.delete(runId);
  }
}

export function getRunController(runId: string): RunController | undefined {
  return controllers.get(runId);
}
