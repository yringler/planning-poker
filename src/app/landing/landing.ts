import { Component, CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-landing',
  imports: [FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="landing">
      <div class="wa-stack wa-gap-xs" style="align-items: center; margin-bottom: var(--wa-space-l)">
        <h1>Planning Poker</h1>
        <p class="subtitle">Real-time estimation for agile teams</p>
      </div>

      <wa-card style="width: 100%; max-width: 420px">
        <div class="wa-stack wa-gap-m">
          <wa-input
            label="Your Name"
            placeholder="Enter your name"
            [value]="name()"
            (input)="name.set($any($event.target).value)"
            (keydown.enter)="name().trim() && createSession()"
            autofocus
          ></wa-input>

          <wa-button
            variant="brand"
            appearance="filled"
            style="width: 100%"
            [attr.disabled]="!name().trim() ? '' : null"
            (click)="createSession()"
          >
            <wa-icon slot="start" name="plus"></wa-icon>
            Create Session
          </wa-button>

          <wa-divider></wa-divider>

          <div class="wa-cluster wa-gap-s">
            <wa-input
              placeholder="Room code"
              [value]="roomCode()"
              (input)="roomCode.set($any($event.target).value.toUpperCase())"
              (keydown.enter)="joinSession()"
              maxlength="6"
              style="flex: 1; text-transform: uppercase"
            ></wa-input>
            <wa-button
              variant="neutral"
              appearance="outlined"
              [attr.disabled]="!name().trim() || !roomCode().trim() ? '' : null"
              (click)="joinSession()"
            >
              Join
            </wa-button>
          </div>
        </div>
      </wa-card>
    </div>
  `,
  styles: `
    .landing {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: var(--wa-space-2xl);
    }

    h1 {
      font-size: 2.5rem;
      font-weight: 700;
      margin: 0;
      color: var(--wa-color-brand-fill-loud);
    }

    .subtitle {
      color: var(--wa-color-neutral-on-quiet);
      margin: 0;
      font-size: 1.1rem;
    }

    wa-card {
      --spacing: var(--wa-space-xl);
    }
  `,
})
export class LandingComponent {
  name = signal(localStorage.getItem('pp-name') ?? '');
  roomCode = signal('');

  constructor(private router: Router) {}

  createSession(): void {
    this.saveName();
    const code = this.generateCode();
    this.router.navigate(['/room', code]);
  }

  joinSession(): void {
    this.saveName();
    const code = this.roomCode().trim().toUpperCase();
    if (code) {
      this.router.navigate(['/room', code]);
    }
  }

  private saveName(): void {
    const n = this.name().trim();
    localStorage.setItem('pp-name', n);
  }

  private generateCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }
}
