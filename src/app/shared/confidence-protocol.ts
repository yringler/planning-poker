// Shared between the Angular client and the Durable Object (party/server.ts).
// Keep this file free of Angular / browser-only imports.

export type RoomMode = 'points' | 'confidence';

/** Derived state of a confidence check. `setup` = item being prepared, no check running. */
export type CheckPhase = 'setup' | 'checking' | 'confident' | 'paused';

/** Fixed length of a confidence check. */
export const CHECK_DURATION_MS = 60_000;

/** Yjs keys. `session.mode` and `session.check` are written only by the server. */
export const MODE_KEY = 'mode';
export const CHECK_KEY = 'check';
export const ITEM_URL_KEY = 'itemUrl';
/** Y.Map peerId → round number in which that peer marked themselves confident. */
export const CONFIDENCE_MAP = 'confidence';

/** Result of one check round. */
export interface CheckOutcome {
  result: 'confident' | 'paused';
  /** Server time the round ended (freezes the timer display). */
  at: number;
  /** peerId → name of players who were not confident when time ran out. */
  notConfident: Record<string, string>;
  /** peerIds of players who were confident when the round ended. */
  confident: string[];
}

/** One check of the current item that timed out with people not confident. */
export interface CheckAttempt {
  check: number;
  notConfident: string[];
}

/**
 * Everything about the current item's check, stored as ONE replaced value so concurrent
 * changes can't merge key by key into an incoherent state. Only the server writes it.
 */
export interface CheckState {
  /** Stable id of the current item; history entries use it. */
  itemId: string;
  /** Increases on every (re)start across items; confidence values are tagged with it. */
  round: number;
  /** Server time the current round started; null = no check running (setup). */
  startedAt: number | null;
  /** Set when the current round ended. */
  outcome: CheckOutcome | null;
  /** Number of (non-cancelled) checks run for the current item. */
  checks: number;
  /** Checks of the current item that ended paused. */
  log: CheckAttempt[];
}

export type CheckAction = 'start' | 'cancel' | 'skip' | 'next';

/**
 * Client → server requests (sent as y-partyserver custom messages). `round` is the check
 * round the client saw; the server ignores requests for any other round.
 */
export type ClientMessage =
  | { type: 'check'; action: CheckAction; round: number }
  | { type: 'mode'; mode: RoomMode; round: number }
  /** Sent on every (re)connect: this client's awareness clientID, so the server knows it's live. */
  | { type: 'hello'; clientId: number };

/** Server → client messages. `now` lets clients estimate their clock offset. */
export type ServerMessage = { type: 'time'; now: number };

export function checkPhase(mode: RoomMode, check: CheckState | null | undefined): CheckPhase {
  if (mode !== 'confidence' || !check || check.startedAt == null) return 'setup';
  return check.outcome ? check.outcome.result : 'checking';
}

/** One entry of the shared `history` Y.Array (point-voting round or confidence item). */
export interface HistoryEntry {
  story: string;
  timestamp: number;
  votes: Record<string, string>;
  players: Record<string, string>;
  /** Missing = point-voting round. */
  kind?: 'confidence';
  /** Confidence entries: the item id. */
  id?: string;
  url?: string;
  result?: 'confident' | 'skipped';
  /** Number of checks run for the item. */
  checks?: number;
  /** Checks that ended paused, with who wasn't confident. */
  attempts?: CheckAttempt[];
}

/** Validation helpers shared by the server and the client. */
export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
export const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);
const CHECK_ACTIONS: readonly CheckAction[] = ['start', 'cancel', 'skip', 'next'];

/** Parses a client request; returns null for anything malformed. */
export function parseClientMessage(raw: string): ClientMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  if (data['type'] === 'hello') {
    return isFiniteNumber(data['clientId']) ? { type: 'hello', clientId: data['clientId'] } : null;
  }
  if (!isFiniteNumber(data['round'])) return null;
  const round = data['round'];
  if (data['type'] === 'mode') {
    const mode = data['mode'];
    return mode === 'points' || mode === 'confidence' ? { type: 'mode', mode, round } : null;
  }
  if (data['type'] === 'check') {
    const action = CHECK_ACTIONS.find((a) => a === data['action']);
    return action ? { type: 'check', action, round } : null;
  }
  return null;
}

/** Coerces whatever is stored in `session.check` into a valid CheckState. */
export function normaliseCheck(value: unknown): CheckState {
  const v = isRecord(value) ? value : {};
  const outcome = isRecord(v['outcome']) ? v['outcome'] : null;
  const notConfident: Record<string, string> = {};
  if (outcome && isRecord(outcome['notConfident'])) {
    for (const [id, name] of Object.entries(outcome['notConfident'])) {
      if (typeof name === 'string') notConfident[id] = name;
    }
  }
  return {
    itemId: typeof v['itemId'] === 'string' ? v['itemId'] : '',
    round: isFiniteNumber(v['round']) ? v['round'] : 0,
    startedAt: isFiniteNumber(v['startedAt']) ? v['startedAt'] : null,
    outcome:
      outcome && (outcome['result'] === 'confident' || outcome['result'] === 'paused')
        ? {
            result: outcome['result'],
            at: isFiniteNumber(outcome['at']) ? outcome['at'] : 0,
            notConfident,
            confident: Array.isArray(outcome['confident'])
              ? outcome['confident'].filter((id): id is string => typeof id === 'string')
              : [],
          }
        : null,
    checks: isFiniteNumber(v['checks']) ? v['checks'] : 0,
    log: Array.isArray(v['log'])
      ? v['log'].filter(isRecord).map((a) => ({
          check: isFiniteNumber(a['check']) ? a['check'] : 0,
          notConfident: Array.isArray(a['notConfident'])
            ? a['notConfident'].filter((n): n is string => typeof n === 'string')
            : [],
        }))
      : [],
  };
}
