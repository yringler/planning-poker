import { Component, computed, inject, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { RoomService } from '../../services/room.service';

@Component({
  selector: 'app-session-header',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="wa-flank">
      <div class="wa-stack wa-gap-3xs">
        <h1>Planning Poker</h1>
        <wa-tooltip content="Click to copy link">
          <wa-button class="session-code-btn" appearance="plain" size="small" (click)="copyLink()">
            <wa-icon slot="start" name="link"></wa-icon>
            Session: {{ roomCode() }}
            @if (showCopied) {
              <wa-badge slot="end" variant="success" appearance="filled" pill>Copied!</wa-badge>
            }
          </wa-button>
        </wa-tooltip>
      </div>
      <div slot="end" class="wa-cluster wa-gap-xs" style="align-items: center">
        <wa-icon name="users"></wa-icon>
        <span class="player-count">{{ room.players().length }}</span>
      </div>
    </div>
  `,
  styles: `
    h1 {
      font-size: 1.75rem;
      font-weight: 700;
      margin: 0;
      color: var(--wa-color-brand-fill-loud);
    }

    .session-code-btn {
      color: var(--wa-color-neutral-on-quiet);
    }

    .session-code-btn:hover {
      color: var(--wa-color-brand-fill-loud);
    }

    .player-count {
      font-size: 1rem;
      font-weight: 600;
      color: var(--wa-color-neutral-on-quiet);
    }
  `,
})
export class SessionHeaderComponent {
  room = inject(RoomService);
  showCopied = false;

  roomCode = computed(() => {
    const url = window.location.pathname;
    return url.split('/').pop() ?? '';
  });

  copyLink(): void {
    navigator.clipboard.writeText(window.location.href);
    this.showCopied = true;
    setTimeout(() => (this.showCopied = false), 2000);
  }
}
