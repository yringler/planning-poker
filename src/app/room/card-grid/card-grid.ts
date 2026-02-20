import { Component, computed, inject, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { RoomService } from '../../services/room.service';

@Component({
  selector: 'app-card-grid',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="card-grid" [class.disabled]="room.phase() === 'revealed'">
      @for (card of cards; track card) {
        <wa-button
          class="poker-card"
          appearance="outlined"
          [attr.variant]="selectedCard() === card ? 'brand' : 'neutral'"
          [attr.data-selected]="selectedCard() === card ? '' : null"
          [attr.disabled]="room.phase() === 'revealed' ? '' : null"
          (click)="selectCard(card)"
        >{{ card }}</wa-button>
      }
    </div>
  `,
  styles: `
    .card-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
      gap: var(--wa-space-s);
    }

    .card-grid.disabled {
      opacity: 0.5;
      pointer-events: none;
    }

    .poker-card {
      aspect-ratio: 2/3;
      font-size: 1.25rem;
      font-weight: 700;
    }

    .poker-card[data-selected] {
      box-shadow: var(--wa-shadow-m);
      transform: translateY(-4px);
    }

    .poker-card::part(base) {
      height: 100%;
      border-radius: var(--wa-border-radius-l);
      border-width: 2px;
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
