import { afterEach, beforeEach, vi } from 'vitest';
import { resetUuids, T0 } from './clock';

beforeEach(() => {
  // Don't fake queueMicrotask / setImmediate: queueEvaluate relies on microtasks, flush() on setImmediate
  vi.useFakeTimers({
    now: T0,
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
  resetUuids();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});
