// Minimal in-process job runner for long-running work (AI capture processing).
// Job state lives in the domain tables (e.g. captures.status), so unfinished
// work is recovered at boot by re-enqueueing. Phase 3 swaps this for a durable
// Postgres-backed queue behind the same enqueue() interface.

type Handler = (id: string) => Promise<void>;

interface Queue {
  name: string;
  handler: Handler;
  concurrency: number;
  running: number;
  pending: string[];
  inFlight: Set<string>;
}

const queues = new Map<string, Queue>();
const idleWaiters: Array<() => void> = [];

export function registerQueue(name: string, handler: Handler, concurrency = 2) {
  queues.set(name, { name, handler, concurrency, running: 0, pending: [], inFlight: new Set() });
}

export function enqueue(name: string, id: string) {
  const q = queues.get(name);
  if (!q) throw new Error(`Unknown queue ${name}`);
  if (q.inFlight.has(id) || q.pending.includes(id)) return;
  q.pending.push(id);
  setImmediate(() => pump(q));
}

function pump(q: Queue) {
  while (q.running < q.concurrency && q.pending.length > 0) {
    const id = q.pending.shift()!;
    q.running++;
    q.inFlight.add(id);
    q.handler(id)
      .catch((e) => console.error(`[Jobs] ${q.name} ${id} crashed:`, e))
      .finally(() => {
        q.running--;
        q.inFlight.delete(id);
        pump(q);
        if (isIdle()) idleWaiters.splice(0).forEach((r) => r());
      });
  }
}

export function isIdle(): boolean {
  for (const q of queues.values()) if (q.running > 0 || q.pending.length > 0) return false;
  return true;
}

/** Resolves when every queue is drained (used by tests). */
export function waitForIdle(): Promise<void> {
  return isIdle() ? Promise.resolve() : new Promise((r) => idleWaiters.push(r));
}
