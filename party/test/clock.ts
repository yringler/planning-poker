import { vi } from 'vitest';

export const T0 = 1_700_000_000_000;
export const D = 60_000;

type Uuid = `${string}-${string}-${string}-${string}-${string}`;
let n = 0;

/** Makes crypto.randomUUID return uuid-1, uuid-2, ... (restored after each test). */
export function resetUuids(): void {
  n = 0;
  vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => `uuid-${++n}` as Uuid);
}

/** Drains queued microtasks and the awaits chained on them. */
export const flush = (): Promise<void> => new Promise<void>((r) => setImmediate(r));
