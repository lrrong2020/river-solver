import { createSolver } from './engine/solver.js';

let active;

function checkpoint(run, reason) {
  const metrics = run.solver.evaluate();
  run.nextCheck = metrics.iterations + Math.min(100, Math.max(4, Math.ceil(metrics.iterations / 2)));
  const finalReason = reason || (metrics.exploitabilityPct <= run.target ? 'target' :
    metrics.iterations >= run.maxIterations ? 'limit' : null);
  run.finished = Boolean(finalReason);
  self.postMessage({
    type: run.finished ? 'done' : 'progress', runId: run.id, ...metrics,
    elapsedMs: performance.now() - run.started, ...(finalReason ? { reason: finalReason } : {}),
  });
}

function step(run) {
  if (run !== active || run.finished) return;
  try {
    const deadline = performance.now() + 20;
    do {
      run.solver.iterate();
      if (run.solver.iterations >= run.nextCheck || run.solver.iterations >= run.maxIterations) {
        checkpoint(run);
      }
    } while (!run.finished && performance.now() < deadline);
    if (!run.finished) setTimeout(() => step(run), 0);
  } catch (error) {
    run.finished = true;
    self.postMessage({ type: 'error', runId: run.id, message: error.message });
  }
}

self.onmessage = ({ data }) => {
  const { type, runId, requestId } = data;
  try {
    if (type === 'start') {
      active = null;
      const { target = 0.5, maxIterations = 5000 } = data;
      if (!Number.isFinite(target) || target < 0) throw new Error('Enter a nonnegative exploitability target.');
      if (!Number.isSafeInteger(maxIterations) || maxIterations < 1) throw new Error('Enter a positive iteration limit.');
      const started = performance.now();
      active = { id: runId, solver: createSolver(data.spot), started, target, maxIterations, nextCheck: 1 };
      step(active);
    } else if (active && runId === active.id) {
      if (type === 'stop' && !active.finished) checkpoint(active, 'stopped');
      if (type === 'inspect') {
        self.postMessage({
          type: 'inspection', runId, requestId, nodeId: data.nodeId,
          result: active.solver.inspect(data.nodeId),
        });
      }
    }
  } catch (error) {
    self.postMessage({ type: 'error', runId, requestId, message: error.message });
  }
};
