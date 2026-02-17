import { Component, computed, inject } from '@angular/core';
import { RoomService } from '../../services/room.service';

@Component({
  selector: 'app-card-grid',
  template: `
    <div class="card-grid" [class.disabled]="room.phase() === 'revealed'">
      @for (card of cards; track card) {
        <button
          class="card"
          [class.selected]="selectedCard() === card"
          [disabled]="room.phase() === 'revealed'"
          (click)="selectCard(card)"
        >
          {{ card }}
        </button>
      }
    </div>
  `,
  styles: `
    .card-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
      gap: 0.75rem;
      margin-bottom: 1.5rem;
    }

    .card-grid.disabled {
      opacity: 0.5;
      pointer-events: none;
    }

    .card {
      padding: 1rem 0.5rem;
      border: 2px solid #e2e8f0;
      border-radius: 12px;
      background: #f8fafc;
      font-size: 1.25rem;
      font-weight: 600;
      color: #334155;
      cursor: pointer;
      transition: all 0.15s;
    }

    .card:hover:not(:disabled) {
      border-color: #93c5fd;
      background: #eff6ff;
    }

    .card.selected {
      border-color: #2563eb;
      background: #dbeafe;
      color: #1d4ed8;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
    }
  `,
})
export class CardGridComponent {
  readonly room = inject(RoomService);
  readonly cards = ['0', '1', '2', '3', '5', '8', '13', '21', '34', '55', '89', '?'];

  readonly selectedCard = computed(() => {
    return this.room.votes()[this.room.myPeerId()] ?? null;
  });

  selectCard(card: string): void {
    if (this.selectedCard() === card) {
      this.room.clearVote();
    } else {
      this.room.vote(card);
    }
  }
}
