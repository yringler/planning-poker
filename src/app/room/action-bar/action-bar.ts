import { Component, computed, inject } from '@angular/core';
import { RoomService } from '../../services/room.service';

@Component({
  selector: 'app-action-bar',
  template: `
    <div class="action-bar">
      @if (room.phase() === 'revealed') {
        <div class="result">
          <span class="average">{{ averageText() }}</span>
        </div>
        <button class="btn primary" (click)="room.newRound()">New Round</button>
      } @else {
        <span class="status-text">{{ statusMessage() }}</span>
        <div class="host-actions">
          <button class="btn primary" [disabled]="voteCount() === 0" (click)="room.revealVotes()">
            Reveal Votes
          </button>
          <button class="btn secondary" (click)="room.resetRound()">Reset</button>
        </div>
      }
    </div>
  `,
  styles: `
    .action-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1rem 1.25rem;
      background: #f8fafc;
      border-radius: 12px;
      border: 1px solid #e2e8f0;
      margin-bottom: 1.5rem;
      flex-wrap: wrap;
      gap: 0.75rem;
    }

    .status-text {
      color: #64748b;
      font-size: 0.95rem;
    }

    .result {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .average {
      font-size: 1.25rem;
      font-weight: 700;
      color: #2563eb;
    }

    .host-actions {
      display: flex;
      gap: 0.5rem;
    }

    .btn {
      padding: 0.6rem 1.25rem;
      border: none;
      border-radius: 8px;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s, opacity 0.2s;
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn.primary {
      background: #2563eb;
      color: #fff;
    }

    .btn.primary:hover:not(:disabled) {
      background: #1d4ed8;
    }

    .btn.secondary {
      background: #e2e8f0;
      color: #475569;
    }

    .btn.secondary:hover {
      background: #cbd5e1;
    }
  `,
})
export class ActionBarComponent {
  readonly room = inject(RoomService);

  readonly voteCount = computed(() => Object.keys(this.room.votes()).length);

  readonly allVoted = computed(() => {
    const players = this.room.players();
    const votes = this.room.votes();
    return players.length > 0 && players.every(p => votes[p.peerId] != null);
  });

  readonly statusMessage = computed(() => {
    if (this.allVoted()) {
      return 'All votes in! Waiting for host to reveal...';
    }
    return `Waiting for votes... (${this.voteCount()}/${this.room.players().length})`;
  });

  readonly averageText = computed(() => {
    const votes = this.room.votes();
    const numericVotes = Object.values(votes)
      .map(v => parseFloat(v))
      .filter(v => !isNaN(v));
    if (numericVotes.length === 0) return 'No numeric votes';
    const avg = numericVotes.reduce((a, b) => a + b, 0) / numericVotes.length;
    return `Avg: ${avg % 1 === 0 ? avg.toString() : avg.toFixed(1)}`;
  });
}
