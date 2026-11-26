// Pure derivations behind RoomService's computed signals (kept free of Angular/Yjs so they
// can be tested as plain functions).
import type { CheckOutcome, CheckPhase, HistoryEntry } from '../shared/confidence-protocol';

export interface Player {
  name: string;
  peerId: string;
  observer?: boolean;
  /** True for a player who left the room but whose vote is kept for this round. */
  offline?: boolean;
}

/** peerIds confident in `round` (values from older rounds are ignored). */
export function confidentIdsForRound(raw: Record<string, unknown>, round: number): Set<string> {
  return new Set(Object.keys(raw).filter((id) => raw[id] === round));
}

/** Point voting: deduped by name, keeping departed voters until the round is cleared. */
export function pointPlayers(
  online: Player[],
  votes: Record<string, string>,
  names: Record<string, string>,
): Player[] {
  const onlineIds = new Set(online.map((p) => p.peerId));
  // Players who voted and then left: keep them (and their vote) until the round is cleared
  const departed: Player[] = Object.keys(votes)
    .filter((peerId) => !onlineIds.has(peerId))
    .map((peerId) => ({ name: names[peerId] ?? 'Unknown', peerId, offline: true }));

  const seen = new Map<string, Player>();
  for (const p of [...online, ...departed]) {
    const existing = seen.get(p.name);
    // Prefer the entry that has voted; otherwise the first (online before departed) wins
    if (!existing || (!votes[existing.peerId] && votes[p.peerId])) {
      seen.set(p.name, p);
    }
  }
  return Array.from(seen.values());
}

/**
 * Confidence check: deduped by peerId (same as the server's count), so two people with the
 * same name both count. In a pause, revealed not-confident players who left stay listed.
 */
export function confidencePlayers(
  online: Player[],
  names: Record<string, string>,
  phase: CheckPhase,
  outcome: CheckOutcome | null,
): Player[] {
  const byPeer = new Map<string, Player>();
  for (const p of online) {
    const existing = byPeer.get(p.peerId);
    // Several tabs of one browser: observer in any tab wins (matches the server)
    byPeer.set(p.peerId, existing ? { ...existing, observer: existing.observer || p.observer } : p);
  }
  if (phase === 'paused' && outcome) {
    for (const [peerId, name] of Object.entries(outcome.notConfident)) {
      if (!byPeer.has(peerId)) {
        byPeer.set(peerId, { name: names[peerId] ?? name, peerId, offline: true });
      }
    }
  }
  return Array.from(byPeer.values());
}

/**
 * Fills in missing voter names in history entries. `currentPlayers` are the online players
 * (already deduped by name, as `pointPlayers` does).
 */
export function resolveHistory(
  history: HistoryEntry[],
  currentPlayers: Player[],
  names: Record<string, string>,
): HistoryEntry[] {
  const onlineNameCount = new Map<string, number>();
  for (const p of currentPlayers) {
    onlineNameCount.set(p.name, (onlineNameCount.get(p.name) ?? 0) + 1);
  }

  return history.map((entry) => {
    const resolvedPlayers: Record<string, string> = { ...entry.players };

    for (const peerId of Object.keys(entry.votes)) {
      if (resolvedPlayers[peerId]) continue;
      if (names[peerId]) {
        resolvedPlayers[peerId] = names[peerId];
        continue;
      }

      for (const p of currentPlayers) {
        if (onlineNameCount.get(p.name) !== 1) continue;
        if (p.peerId !== peerId) continue;

        const oldEntry = Object.entries(entry.players).find(([, n]) => n === p.name);
        if (oldEntry) {
          // Don't give the name to a second voter while its original owner is online
          const [oldPeerId] = oldEntry;
          const oldPeerOnline = currentPlayers.some((cp) => cp.peerId === oldPeerId);
          if (oldPeerOnline) continue;
        }

        resolvedPlayers[peerId] = p.name;
        break;
      }
    }

    return { ...entry, players: resolvedPlayers };
  });
}
