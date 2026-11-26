import type { CheckState, HistoryEntry } from '../../src/app/shared/confidence-protocol';
import { T0 } from './clock';
import type { Harness, PlayerHandle, SeedValues } from './harness';

export const SETUP_CHECK: CheckState = {
  itemId: 'item-1',
  round: 4,
  startedAt: null,
  outcome: null,
  checks: 0,
  log: [],
};

export const SETUP: SeedValues = { mode: 'confidence', storyName: 'Story A', check: SETUP_CHECK };

export const PAUSED_LOG = [
  { check: 1, notConfident: ['Bob'] },
  { check: 2, notConfident: ['Bob', 'Cy'] },
];

export const PAUSED_CHECK: CheckState = {
  itemId: 'item-1',
  round: 6,
  startedAt: T0 - 120_000,
  outcome: { result: 'paused', at: T0 - 60_000, notConfident: { p2: 'Bob' }, confident: ['p1'] },
  checks: 2,
  log: PAUSED_LOG,
};

export const PAUSED: SeedValues = {
  mode: 'confidence',
  storyName: 'Story A',
  itemUrl: ' https://x.io/1 ',
  check: PAUSED_CHECK,
};

export const CONFIDENT_HISTORY: HistoryEntry = {
  kind: 'confidence',
  id: 'item-1',
  story: 'Story A',
  timestamp: T0 - 70_000,
  votes: {},
  players: {},
  result: 'confident',
  checks: 2,
  attempts: PAUSED_LOG,
};

export const CONFIDENT: SeedValues = {
  ...PAUSED,
  check: {
    ...PAUSED_CHECK,
    outcome: { result: 'confident', at: T0 - 70_000, notConfident: {}, confident: ['p1', 'p2'] },
  },
  history: [CONFIDENT_HISTORY],
};

/** SETUP, players p1/Ann and p2/Bob, then a start at T0: round 5, startedAt T0, checks 1. */
export async function running(h: Harness): Promise<{ p1: PlayerHandle; p2: PlayerHandle }> {
  await h.seed(SETUP);
  const p1 = await h.addPlayer('p1', 'Ann');
  const p2 = await h.addPlayer('p2', 'Bob');
  await h.request(p1.conn, { type: 'check', action: 'start', round: 4 });
  return { p1, p2 };
}

export const start = (round: number) => ({ type: 'check', action: 'start', round });
export const cancel = (round: number) => ({ type: 'check', action: 'cancel', round });
export const skip = (round: number) => ({ type: 'check', action: 'skip', round });
export const next = (round: number) => ({ type: 'check', action: 'next', round });
export const mode = (m: string, round: number) => ({ type: 'mode', mode: m, round });
