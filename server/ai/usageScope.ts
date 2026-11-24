// The per-call usage scope providers report into. Kept free of database
// imports so providers stay importable from pure unit tests.
import { AsyncLocalStorage } from "node:async_hooks";

export interface Usage {
  model?: string;
  input?: number | null;
  output?: number | null;
}

export const usageScope = new AsyncLocalStorage<Usage & { called?: boolean }>();

/** Called by a provider right after an API call returned. */
export function reportUsage(u: Usage) {
  const s = usageScope.getStore();
  if (!s) return;
  s.called = true;
  if (u.model) s.model = u.model;
  if (u.input != null) s.input = (s.input || 0) + u.input;
  if (u.output != null) s.output = (s.output || 0) + u.output;
}

/** Called by a provider just before it sends a request (so failures are counted). */
export function markCalled(model?: string) {
  const s = usageScope.getStore();
  if (!s) return;
  s.called = true;
  if (model) s.model = model;
}
