import { isFiniteNumber, isRecord } from '../src/app/shared/confidence-protocol';

/** Connection state key holding the awareness clientID the client announced in `hello`. */
export const CLIENT_ID_KEY = 'ppClientId';
/** Connection state key where y-partyserver records the awareness clientIDs a connection owns. */
const AWARENESS_IDS_KEY = '__ypsAwarenessIds';

/** The parts of a partyserver `Connection` that `connectedPlayers` reads. */
export interface ConnectionLike {
  readyState: number;
  state: unknown;
}

/**
 * Connected, non-observer players by peerId (several tabs of one browser count once).
 * Only awareness states owned by an open connection count: the server's awareness never
 * expires states itself, so this keeps a leftover state from blocking the check.
 * Ownership comes from y-partyserver's own record (`__ypsAwarenessIds`) plus the clientID
 * each client announces in `hello`: y-partyserver only records IDs when an awareness update
 * applies, so a reconnect that re-sends an unchanged state leaves its list empty.
 */
export function connectedPlayers(
  connections: Iterable<ConnectionLike>,
  awarenessStates: ReadonlyMap<number, unknown>,
): Map<string, string> {
  const liveIds = new Set<number>();
  for (const conn of connections) {
    if (conn.readyState !== 1 /* OPEN */) continue;
    const state = isRecord(conn.state) ? conn.state : {};
    const ids = state[AWARENESS_IDS_KEY];
    if (Array.isArray(ids)) ids.forEach((id) => typeof id === 'number' && liveIds.add(id));
    const hello = state[CLIENT_ID_KEY];
    if (isFiniteNumber(hello)) liveIds.add(hello);
  }
  const players = new Map<string, string>();
  const observers = new Set<string>();
  awarenessStates.forEach((value, clientId) => {
    if (!liveIds.has(clientId)) return;
    const state = isRecord(value) ? value : {};
    const peerId = state['peerId'];
    const name = state['name'];
    if (typeof peerId !== 'string' || typeof name !== 'string') return;
    if (state['observer']) observers.add(peerId);
    else players.set(peerId, name);
  });
  // A peer observing in any tab doesn't count
  for (const id of observers) players.delete(id);
  return players;
}
