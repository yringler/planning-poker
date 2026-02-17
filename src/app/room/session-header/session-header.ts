import { Component, computed, inject } from '@angular/core';
import { RoomService } from '../../services/room.service';

@Component({
  selector: 'app-session-header',
  template: `
    <div class="header">
      <div class="left">
        <h1>Planning Poker</h1>
        <span class="session-code" (click)="copyLink()" title="Click to copy link">
          # Session: {{ roomCode() }}
          <span class="copied" [class.show]="showCopied">Copied!</span>
        </span>
      </div>
      <div class="right">
        <span class="participant-count" title="Connected participants">
          <span class="icon">&#128101;</span> {{ room.players().length }}
        </span>
      </div>
    </div>
  `,
  styles: `
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
    }

    h1 {
      font-size: 1.75rem;
      font-weight: 700;
      color: #1e293b;
      margin: 0;
    }

    .session-code {
      display: inline-block;
      color: #64748b;
      font-size: 0.9rem;
      cursor: pointer;
      position: relative;
      margin-top: 0.25rem;
    }

    .session-code:hover {
      color: #2563eb;
    }

    .copied {
      position: absolute;
      left: 100%;
      margin-left: 0.5rem;
      background: #1e293b;
      color: #fff;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      white-space: nowrap;
      opacity: 0;
      transition: opacity 0.2s;
    }

    .copied.show {
      opacity: 1;
    }

    .participant-count {
      font-size: 1.1rem;
      color: #64748b;
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }

    .icon {
      font-size: 1.25rem;
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
