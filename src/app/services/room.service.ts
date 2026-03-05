import { Injectable, signal, computed, DestroyRef, inject } from '@angular/core';
import * as Y from 'yjs';
import YPartyKitProvider from 'y-partykit/provider';
import { environment } from '../../environments/environment';

export interface Player {
  name: string;
  peerId: string;
  observer?: boolean;
}

export interface HistoryEntry {
  story: string;
  timestamp: number;
  votes: Record<string, string>;
  players: Record<string, string>;
}

@Injectable({ providedIn: 'root' })
export class RoomService {
  private doc: Y.Doc | null = null;
  private provider: YPartyKitProvider | null = null;
  private destroyRef = inject(DestroyRef);

  readonly storyName = signal('');
  readonly phase = signal<'voting' | 'revealed'>('voting');
  readonly votes = signal<Record<string, string>>({});
  private readonly players = signal<Player[]>([]);
  readonly uniquePlayers = computed(() => {
    const votes = this.votes();
    const seen = new Map<string, Player>();
    for (const p of this.players()) {
      const existing = seen.get(p.name);
      // Prefer the entry that has voted; otherwise last one wins
      if (!existing || (!votes[existing.peerId] && votes[p.peerId])) {
        seen.set(p.name, p);
      }
    }
    return Array.from(seen.values());
  });
  private readonly history = signal<HistoryEntry[]>([]);
  readonly myPeerId = signal('');
  readonly connected = signal(false);
  readonly isObserver = signal(false);

  readonly resolvedHistory = computed(() => {
    const currentPlayers = this.uniquePlayers();
    const history = this.history();

    const onlineNameCount = new Map<string, number>();
    for (const p of currentPlayers) {
      onlineNameCount.set(p.name, (onlineNameCount.get(p.name) ?? 0) + 1);
    }

    return history.map(entry => {
      const resolvedPlayers: Record<string, string> = { ...entry.players };

      for (const peerId of Object.keys(entry.votes)) {
        if (resolvedPlayers[peerId]) continue;

        for (const p of currentPlayers) {
          if (onlineNameCount.get(p.name) !== 1) continue;
          if (p.peerId !== peerId) continue;

          const oldEntry = Object.entries(entry.players).find(([, n]) => n === p.name);
          if (!oldEntry) continue;

          const [oldPeerId] = oldEntry;
          const oldPeerOnline = currentPlayers.some(cp => cp.peerId === oldPeerId);
          if (oldPeerOnline) continue;

          resolvedPlayers[peerId] = p.name;
          break;
        }
      }

      return { ...entry, players: resolvedPlayers };
    });
  });

  connect(roomCode: string, playerName: string): void {
    this.disconnect();

    this.doc = new Y.Doc();
    const peerId = this.doc.clientID.toString();
    this.myPeerId.set(peerId);

    this.provider = new YPartyKitProvider(environment.partyKitHost, `planning-poker-${roomCode}`, this.doc);

    // Set awareness
    this.provider.awareness.setLocalState({ name: playerName, peerId });

    const sessionMap = this.doc.getMap('session');
    const votesMap = this.doc.getMap('votes');
    const historyArray = this.doc.getArray<HistoryEntry>('history');

    // Initialize session if empty
    this.doc.transact(() => {
      if (!sessionMap.has('phase')) {
        sessionMap.set('phase', 'voting');
      }
      if (!sessionMap.has('storyName')) {
        sessionMap.set('storyName', '');
      }
    });

    // Observe session map
    const syncSession = () => {
      this.storyName.set((sessionMap.get('storyName') as string) ?? '');
      this.phase.set((sessionMap.get('phase') as 'voting' | 'revealed') ?? 'voting');
    };
    sessionMap.observe(syncSession);
    syncSession();

    // Observe votes
    const syncVotes = () => {
      const v: Record<string, string> = {};
      votesMap.forEach((val, key) => {
        v[key] = val as string;
      });
      this.votes.set(v);
    };
    votesMap.observe(syncVotes);
    syncVotes();

    // Observe history
    const syncHistory = () => {
      this.history.set(historyArray.toArray());
    };
    historyArray.observe(syncHistory);
    syncHistory();

    // Observe awareness for players
    const syncPlayers = () => {
      const states = this.provider!.awareness.getStates();
      const playerList: Player[] = [];
      states.forEach((state: Record<string, unknown>) => {
        if (state?.['name'] && state?.['peerId']) {
          playerList.push({
            name: state['name'] as string,
            peerId: state['peerId'] as string,
            observer: !!state['observer'],
          });
        }
      });
      this.players.set(playerList);
    };
    this.provider.awareness.on('change', syncPlayers);
    syncPlayers();

    this.connected.set(true);

    this.destroyRef.onDestroy(() => this.disconnect());
  }

  disconnect(): void {
    if (this.provider) {
      this.provider.destroy();
      this.provider = null;
    }
    if (this.doc) {
      this.doc.destroy();
      this.doc = null;
    }
    this.connected.set(false);
    this.isObserver.set(false);
    this.players.set([]);
    this.votes.set({});
    this.history.set([]);
    this.phase.set('voting');
    this.storyName.set('');
  }

  toggleObserver(): void {
    if (!this.provider) return;
    const next = !this.isObserver();
    this.isObserver.set(next);
    const current = this.provider.awareness.getLocalState() ?? {};
    this.provider.awareness.setLocalState({ ...current, observer: next });
    if (next) {
      // Remove any existing vote when becoming an observer
      this.doc?.getMap('votes').delete(this.myPeerId());
    }
  }

  vote(value: string): void {
    this.doc?.getMap('votes').set(this.myPeerId(), value);
  }

  clearVote(): void {
    this.doc?.getMap('votes').delete(this.myPeerId());
  }

  revealVotes(): void {
    if (!this.doc) return;
    const sessionMap = this.doc.getMap('session');
    const votesMap = this.doc.getMap('votes');
    const historyArray = this.doc.getArray<HistoryEntry>('history');

    const playerNames: Record<string, string> = {};
    this.uniquePlayers().forEach(p => {
      playerNames[p.peerId] = p.name;
    });

    const currentVotes: Record<string, string> = {};
    votesMap.forEach((val, key) => {
      currentVotes[key] = val as string;
    });

    this.doc.transact(() => {
      historyArray.insert(0, [{
        story: (sessionMap.get('storyName') as string) || '',
        timestamp: Date.now(),
        votes: currentVotes,
        players: playerNames,
      }]);
      sessionMap.set('phase', 'revealed');
    });
  }

  updateHistoryStory(timestamp: number, newStory: string): void {
    if (!this.doc) return;
    const historyArray = this.doc.getArray<HistoryEntry>('history');
    const entries = historyArray.toArray();
    const index = entries.findIndex(e => e.timestamp === timestamp);
    if (index === -1) return;
    const updated = { ...entries[index], story: newStory };
    this.doc.transact(() => {
      historyArray.delete(index, 1);
      historyArray.insert(index, [updated]);
    });
  }

  deleteHistoryEntry(timestamp: number): void {
    if (!this.doc) return;
    const historyArray = this.doc.getArray<HistoryEntry>('history');
    const index = historyArray.toArray().findIndex(e => e.timestamp === timestamp);
    if (index === -1) return;
    this.doc.transact(() => historyArray.delete(index, 1));
  }

  resetRound(): void {
    if (!this.doc) return;
    this.doc.transact(() => {
      const votesMap = this.doc!.getMap('votes');
      const keys = Array.from(votesMap.keys());
      keys.forEach(k => votesMap.delete(k));
      this.doc!.getMap('session').set('phase', 'voting');
    });
  }

  newRound(): void {
    if (!this.doc) return;
    const sessionMap = this.doc.getMap('session');
    const votesMap = this.doc.getMap('votes');

    this.doc.transact(() => {
      // Clear votes
      const keys = Array.from(votesMap.keys());
      keys.forEach(k => votesMap.delete(k));

      // Reset
      sessionMap.set('phase', 'voting');
      sessionMap.set('storyName', '');
    });
  }

  updateStoryName(name: string): void {
    this.doc?.getMap('session').set('storyName', name);
  }


}
