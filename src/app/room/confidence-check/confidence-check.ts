import { Component, computed, inject, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CHECK_DURATION_MS, RoomService } from '../../services/room.service';
import { TimerComponent } from '../timer/timer';
import { parseTicketUrl } from './ticket-url';

/** Item setup + main panel for confidence-check mode. Actions live in the action bar. */
@Component({
  selector: 'app-confidence-check',
  imports: [TimerComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="wa-stack wa-gap-s">
      @if (phase() === 'setup') {
        <div class="item-inputs">
          <wa-input
            placeholder="Item name"
            [value]="room.storyName()"
            (input)="room.updateStoryName($any($event.target).value)"
          >
            <wa-icon slot="start" name="book"></wa-icon>
          </wa-input>
          <wa-input
            placeholder="Ticket URL (optional)"
            type="url"
            [value]="room.itemUrl()"
            (input)="room.updateItemUrl($any($event.target).value)"
          >
            <wa-icon slot="start" name="link"></wa-icon>
          </wa-input>
        </div>
      } @else {
        <div class="item-title">
          <wa-icon name="book"></wa-icon>
          <span>{{ room.storyName() || 'Untitled' }}</span>
        </div>
      }

      @if (room.itemUrl().trim(); as url) {
        @if (ticket(); as t) {
          <div>
            <wa-button
              size="small"
              variant="brand"
              appearance="outlined"
              pill
              [attr.href]="t.href"
              target="_blank"
              rel="noopener noreferrer"
            >
              <wa-icon slot="start" name="arrow-up-right-from-square"></wa-icon>
              Open ticket ({{ t.host }})
            </wa-button>
          </div>
        } @else if (phase() !== 'setup') {
          <span class="plain-url">{{ url }}</span>
        }
      }

      @switch (phase()) {
        @case ('setup') {
          <wa-card appearance="filled" class="panel">
            <p class="panel-text">
              @if (room.storyName().trim()) {
                Ready. Anyone can start the check.
              } @else {
                Add the item, then start the check.
              }
            </p>
            @if (room.skipNotice()) {
              <wa-callout variant="neutral" size="small" class="notice">
                <wa-icon slot="icon" name="forward"></wa-icon>
                {{ room.skipNotice() }}
              </wa-callout>
            }
          </wa-card>
        }

        @case ('checking') {
          <wa-card appearance="filled" class="panel">
            <div class="wa-stack wa-gap-m">
              <!-- No live tally: a running count leads the witness. The server ends the check
                   early (with confetti) only once everyone is confident. -->
              <app-timer [endTime]="endTime()" [maxSeconds]="maxSeconds" />
              <wa-callout variant="neutral" size="small">
                <wa-icon slot="icon" name="eye-slash"></wa-icon>
                @if (total() > 1) {
                  Answers stay hidden. If everyone is confident, the check ends early. If anyone is
                  still not confident at 0:00, their names are shown.
                } @else {
                  If you're still not confident at 0:00, the check pauses for discussion.
                }
              </wa-callout>
              @if (canToggle()) {
                <div class="wa-stack wa-gap-2xs">
                  <div class="toggle" role="group" aria-label="Your confidence">
                    <wa-button
                      size="large"
                      variant="neutral"
                      [attr.appearance]="room.amConfident() ? 'outlined' : 'filled'"
                      [attr.aria-pressed]="!room.amConfident()"
                      [attr.disabled]="room.connected() ? null : ''"
                      (click)="room.setConfident(false)"
                    >
                      Not confident
                    </wa-button>
                    <wa-button
                      size="large"
                      variant="success"
                      [attr.appearance]="room.amConfident() ? 'filled' : 'outlined'"
                      [attr.aria-pressed]="room.amConfident()"
                      [attr.disabled]="room.connected() ? null : ''"
                      (click)="room.setConfident(true)"
                    >
                      <wa-icon slot="start" name="circle-check"></wa-icon>
                      Confident
                    </wa-button>
                  </div>
                  @if (!room.connected()) {
                    <span class="hint">
                      Reconnecting… your answer can't be changed until then.
                    </span>
                  } @else if (room.joinedMidCheck() && !room.amConfident()) {
                    <span class="hint">You joined mid-check. Pick an answer.</span>
                  }
                </div>
              }
            </div>
          </wa-card>
        }

        @case ('confident') {
          <wa-card appearance="filled-outlined" class="panel success">
            <div class="panel-top">
              <span class="banner success-text">
                <wa-icon name="circle-check"></wa-icon>
                Everyone is confident ({{ outcomeConfident() }} / {{ outcomeConfident() }})
              </span>
              <app-timer
                [endTime]="endTime()"
                [stoppedAt]="stoppedAt()"
                [maxSeconds]="maxSeconds"
              />
            </div>
            <p class="panel-text">Confident! Set up the next item when you're ready.</p>
          </wa-card>
        }

        @case ('paused') {
          <wa-card appearance="filled-outlined" class="panel warning">
            <div class="wa-stack wa-gap-s">
              <div class="panel-top">
                <span class="banner warning-text">
                  <wa-icon name="comments"></wa-icon>
                  Paused for discussion
                </span>
                <span class="count warning-text">
                  {{ notConfident().length }} / {{ outcomeTotal() }} not confident
                </span>
              </div>
              @if (notConfident().length > 0) {
                <span class="panel-text">
                  <wa-icon name="eye"></wa-icon> Names are now visible:
                </span>
                <div class="wa-cluster wa-gap-xs" data-testid="not-confident-names">
                  @for (p of notConfident(); track p.peerId) {
                    <span class="chip">
                      <wa-avatar
                        [initials]="initials(p.name)"
                        shape="rounded"
                        style="--size: 1.5rem"
                      ></wa-avatar>
                      {{ p.name }}
                    </span>
                  }
                  <span class="panel-text">
                    {{ notConfident().length === 1 ? 'is' : 'are' }} not confident
                  </span>
                </div>
              }
              @if (iWasNotConfident()) {
                <strong>You're not confident. Tell the team why.</strong>
              }
              <p class="panel-text">Discuss, then restart the check when the team is ready.</p>
            </div>
          </wa-card>
        }
      }
    </div>
  `,
  styles: `
    .item-inputs {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: var(--wa-space-s);
    }

    .item-title {
      display: flex;
      align-items: center;
      gap: var(--wa-space-xs);
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--wa-color-neutral-on-default);
    }

    .plain-url {
      font-size: 0.85rem;
      word-break: break-all;
    }

    .panel {
      --spacing: var(--wa-space-m) var(--wa-space-l);
    }

    .panel.success {
      background-color: var(--wa-color-success-fill-quiet);
      border-color: var(--wa-color-success-border-normal);
    }

    .panel.warning {
      background-color: var(--wa-color-warning-fill-quiet);
      border-color: var(--wa-color-warning-border-normal);
    }

    .panel-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: var(--wa-space-s);
    }

    /* The reused timer brings its own card; flatten it inside this panel */
    app-timer ::ng-deep wa-card {
      --spacing: 0;
      border: none;
      background: transparent;
      box-shadow: none;
    }

    .count {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--wa-color-brand-fill-loud);
    }

    .banner {
      display: flex;
      align-items: center;
      gap: var(--wa-space-xs);
      font-size: 1.15rem;
      font-weight: 700;
    }

    .success-text {
      color: var(--wa-color-success-on-quiet);
    }

    .warning-text {
      color: var(--wa-color-warning-on-quiet);
    }

    .panel-text {
      margin: 0;
      color: var(--wa-color-neutral-on-quiet);
    }

    .notice {
      margin-top: var(--wa-space-s);
    }

    .toggle {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--wa-space-xs);
    }

    .hint {
      font-size: 0.85rem;
      color: var(--wa-color-neutral-on-quiet);
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: var(--wa-space-2xs);
      padding: var(--wa-space-3xs) var(--wa-space-s) var(--wa-space-3xs) var(--wa-space-3xs);
      border-radius: var(--wa-border-radius-pill);
      background: var(--wa-color-surface-raised);
      border: 1px solid var(--wa-color-warning-border-loud);
      font-weight: 600;
      color: var(--wa-color-neutral-on-default);
    }
  `,
})
export class ConfidenceCheckComponent {
  readonly room = inject(RoomService);

  readonly phase = this.room.checkPhase;
  readonly total = computed(() => this.room.checkPlayers().length);
  readonly maxSeconds = CHECK_DURATION_MS / 1000;
  /** Server-stamped deadline converted to this client's clock. */
  readonly endTime = computed(() => {
    const startedAt = this.room.checkStartedAt();
    return startedAt == null ? null : startedAt + CHECK_DURATION_MS - this.room.serverOffset();
  });
  readonly stoppedAt = computed(() => {
    const at = this.room.checkOutcome()?.at;
    return at == null ? null : at - this.room.serverOffset();
  });
  readonly ticket = computed(() => parseTicketUrl(this.room.itemUrl()));
  readonly canToggle = computed(() => !this.room.isObserver());

  readonly notConfident = computed(() => {
    const outcome = this.room.checkOutcome();
    if (!outcome) return [];
    return Object.entries(outcome.notConfident).map(([peerId, name]) => ({ peerId, name }));
  });
  readonly outcomeConfident = computed(() => this.room.checkOutcome()?.confident.length ?? 0);
  readonly outcomeTotal = computed(() => this.outcomeConfident() + this.notConfident().length);
  readonly iWasNotConfident = computed(
    () => !!this.room.checkOutcome()?.notConfident[this.room.myPeerId()],
  );

  initials(name: string): string {
    return name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }
}
