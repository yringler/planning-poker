import { Injectable, signal, computed, DestroyRef, inject } from '@angular/core';
import * as Y from 'yjs';
import YPartyKitProvider from 'y-partykit/provider';
import { environment } from '../../environments/environment';

export interface Player {
  name: string;
  peerId: string;
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
  readonly hostId = signal('');
  readonly votes = signal<Record<string, string>>({});
  readonly players = signal<Player[]>([]);
  readonly history = signal<HistoryEntry[]>([]);
  readonly myPeerId = signal('');
  readonly connected = signal(false);

  readonly isHost = computed(() => this.myPeerId() === this.hostId());

  readonly resolvedHistory = computed(() => {
    const currentPlayers = this.players();
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
      if (!sessionMap.has('hostId')) {
        sessionMap.set('hostId', peerId);
      }
    });

    // Observe session map
    const syncSession = () => {
      this.storyName.set((sessionMap.get('storyName') as string) ?? '');
      this.phase.set((sessionMap.get('phase') as 'voting' | 'revealed') ?? 'voting');
      this.hostId.set((sessionMap.get('hostId') as string) ?? '');
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
          playerList.push({ name: state['name'] as string, peerId: state['peerId'] as string });
        }
      });
      this.players.set(playerList);
      this.electHost(playerList);
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
    this.players.set([]);
    this.votes.set({});
    this.history.set([]);
    this.phase.set('voting');
    this.storyName.set('');
    this.hostId.set('');
  }

  vote(value: string): void {
    this.doc?.getMap('votes').set(this.myPeerId(), value);
  }

  clearVote(): void {
    this.doc?.getMap('votes').delete(this.myPeerId());
  }

  revealVotes(): void {
    this.doc?.getMap('session').set('phase', 'revealed');
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
    const historyArray = this.doc.getArray<HistoryEntry>('history');

    // Build player name map from current awareness
    const playerNames: Record<string, string> = {};
    this.players().forEach(p => {
      playerNames[p.peerId] = p.name;
    });

    const currentVotes: Record<string, string> = {};
    votesMap.forEach((val, key) => {
      currentVotes[key] = val as string;
    });

    this.doc.transact(() => {
      // Save to history
      historyArray.insert(0, [{
        story: (sessionMap.get('storyName') as string) || '',
        timestamp: Date.now(),
        votes: currentVotes,
        players: playerNames,
      }]);

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

  private electHost(playerList: Player[]): void {
    if (!this.doc || playerList.length === 0) return;
    const sessionMap = this.doc.getMap('session');
    const currentHostId = sessionMap.get('hostId') as string | undefined;

    // Check if current host is still connected
    const hostConnected = playerList.some(p => p.peerId === currentHostId);
    if (!hostConnected) {
      // Elect the peer with the lowest peerId
      const sorted = [...playerList].sort((a, b) => a.peerId.localeCompare(b.peerId));
      sessionMap.set('hostId', sorted[0].peerId);
    }
  }
}
