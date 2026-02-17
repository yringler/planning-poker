import { Component, computed, inject } from '@angular/core';
import { RoomService } from '../../services/room.service';

@Component({
  selector: 'app-participants-list',
  template: `
    <div class="section">
      <h2>Participants</h2>
      <div class="grid">
        @for (player of room.players(); track player.peerId) {
          <div class="participant" [class.me]="player.peerId === room.myPeerId()" [class.host]="player.peerId === room.hostId()">
            <span class="name">
              @if (player.peerId === room.hostId()) {
                <span class="crown" title="Host">&#128081;</span>
              }
              {{ player.name }}
            </span>
            <span class="status" [class]="statusClass(player.peerId)">
              {{ statusText(player.peerId) }}
            </span>
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    h2 {
      font-size: 1rem;
      font-weight: 600;
      color: #475569;
      margin: 0 0 0.75rem;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 0.5rem;
      margin-bottom: 1.5rem;
    }

    .participant {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.75rem 1rem;
      background: #fff;
      border-radius: 8px;
      border: 1px solid #e2e8f0;
    }

    .participant.me {
      border-color: #93c5fd;
      background: #f0f7ff;
    }

    .name {
      font-weight: 500;
      color: #1e293b;
    }

    .crown {
      font-size: 0.9rem;
      margin-right: 0.25rem;
    }

    .status {
      font-size: 0.85rem;
    }

    .status.waiting {
      color: #94a3b8;
      font-style: italic;
    }

    .status.voted {
      color: #16a34a;
      font-weight: 500;
    }

    .status.revealed {
      color: #2563eb;
      font-weight: 700;
      font-size: 1.1rem;
    }
  `,
})
export class ParticipantsListComponent {
  readonly room = inject(RoomService);

  statusText(peerId: string): string {
    const votes = this.room.votes();
    const phase = this.room.phase();

    if (phase === 'revealed') {
      return votes[peerId] ?? 'No vote';
    }
    return votes[peerId] != null ? 'Voted \u2713' : 'Waiting...';
  }

  statusClass(peerId: string): string {
    const votes = this.room.votes();
    const phase = this.room.phase();

    if (phase === 'revealed') return 'revealed';
    return votes[peerId] != null ? 'voted' : 'waiting';
  }
}
