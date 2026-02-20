import { Component, inject, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { RoomService } from '../../services/room.service';

@Component({
  selector: 'app-participants-list',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div>
      <h2>Participants</h2>
      <div class="wa-grid wa-gap-xs" style="--min-column-size: 200px">
        @for (player of room.players(); track player.peerId) {
          <div
            class="participant"
            [class.me]="player.peerId === room.myPeerId()"
            [class.voted]="statusClass(player.peerId) === 'voted'"
            [class.revealed]="statusClass(player.peerId) === 'revealed'"
          >
            <wa-avatar [initials]="initials(player.name)" shape="rounded" style="--size: 2rem"></wa-avatar>
            <span class="name">{{ player.name }}</span>
            <span class="status-badge">
              @if (statusClass(player.peerId) === 'waiting') {
                <wa-tag variant="neutral" appearance="outlined" size="small">Waiting…</wa-tag>
              } @else if (statusClass(player.peerId) === 'voted') {
                <wa-tag variant="success" appearance="filled" size="small">
                  <wa-icon slot="start" name="check"></wa-icon>
                  Voted
                </wa-tag>
              } @else {
                <wa-tag variant="brand" appearance="filled" size="small" style="font-size: 1rem; font-weight: 700">
                  {{ statusText(player.peerId) }}
                </wa-tag>
              }
            </span>
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    h2 {
      font-size: 0.85rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--wa-color-neutral-on-quiet);
      margin: 0 0 var(--wa-space-s);
    }

    .participant {
      display: flex;
      align-items: center;
      gap: var(--wa-space-s);
      padding: var(--wa-space-s) var(--wa-space-m);
      background: var(--wa-color-surface-raised);
      border-radius: var(--wa-border-radius-m);
      border: 1px solid var(--wa-color-neutral-stroke-quiet);
      transition: border-color 0.15s, background 0.15s;
    }

    .participant.me {
      border-color: var(--wa-color-brand-stroke-loud);
      background: var(--wa-color-brand-fill-quiet);
    }

    .participant.voted {
      border-color: var(--wa-color-success-stroke-loud);
      background: var(--wa-color-success-fill-quiet);
    }

    .participant.revealed {
      border-color: var(--wa-color-brand-stroke-loud);
    }

    .name {
      flex: 1;
      font-weight: 500;
      color: var(--wa-color-neutral-on-default);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
})
export class ParticipantsListComponent {
  readonly room = inject(RoomService);

  initials(name: string): string {
    return name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  statusText(peerId: string): string {
    const votes = this.room.votes();
    const phase = this.room.phase();
    if (phase === 'revealed') {
      return votes[peerId] ?? '–';
    }
    return votes[peerId] != null ? 'Voted ✓' : 'Waiting…';
  }

  statusClass(peerId: string): string {
    const votes = this.room.votes();
    const phase = this.room.phase();
    if (phase === 'revealed') return 'revealed';
    return votes[peerId] != null ? 'voted' : 'waiting';
  }
}
