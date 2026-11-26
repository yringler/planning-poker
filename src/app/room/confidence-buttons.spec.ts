// Click path of every confidence-check button: template binding → handler → RoomService.
// `wa-button` is not registered in jsdom, so these elements are plain unknown elements: a
// click always reaches Angular's (click) binding. Whether a real wa-button lets the click
// through is decided by its `disabled` attribute (WaButton.handleClick stops the event when
// disabled), so the tests assert that attribute.
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeProvider, fakeProviderFactory } from '../../testing/fake-provider';
import { createRoomServiceStub, type RoomServiceStub } from '../../testing/room-service-stub';
import type { CheckOutcome } from '../shared/confidence-protocol';
import { RoomService, Y_PROVIDER_FACTORY } from '../services/room.service';
import { ActionBarComponent } from './action-bar/action-bar';
import { ConfidenceCheckComponent } from './confidence-check/confidence-check';
import { RoomComponent } from './room';

const T0 = 1_700_000_000_000;
const ROUTE = {
  provide: ActivatedRoute,
  useValue: { snapshot: { paramMap: convertToParamMap({ code: 'ABC123' }) } },
};

function buttons(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('wa-button'));
}

function button(root: HTMLElement, label: string): HTMLElement {
  const found = buttons(root).find((b) => b.textContent?.replace(/\s+/g, ' ').trim() === label);
  if (!found) throw new Error(`no wa-button "${label}"`);
  return found;
}

const labels = (root: HTMLElement) =>
  buttons(root).map((b) => b.textContent?.replace(/\s+/g, ' ').trim());

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('pp-name', 'Ann');
  localStorage.setItem('pp-peer-id', 'me');
  vi.spyOn(RoomComponent.prototype as unknown as { fireConfetti(): void }, 'fireConfetti')
    .mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

describe('with a RoomService stub', () => {
  let stub: RoomServiceStub;

  beforeEach(() => {
    stub = createRoomServiceStub();
    stub.mode.set('confidence');
    TestBed.configureTestingModule({
      providers: [{ provide: RoomService, useValue: stub }, ROUTE],
    });
    // The Timer is covered by its own spec; keep it out of these templates
    TestBed.overrideComponent(ConfidenceCheckComponent, { set: { imports: [] } });
  });

  function render<T>(cmp: new () => T): ComponentFixture<T> {
    const fixture = TestBed.createComponent(cmp);
    fixture.detectChanges();
    return fixture;
  }

  describe('action bar', () => {
    it.each([
      ['setup', 'Start check', 'startCheck'],
      ['checking', 'Cancel check', 'cancelCheck'],
      ['confident', 'Next item', 'nextItem'],
      ['paused', 'Restart check', 'startCheck'],
      ['paused', 'Skip item', 'skipItem'],
    ] as const)('CLICK-AB-01: %s: "%s" calls %s', (phase, label, method) => {
      stub.storyName.set('Item A');
      stub.checkPhase.set(phase);
      const el = render(ActionBarComponent).nativeElement as HTMLElement;
      const b = button(el, label);
      expect(b.hasAttribute('disabled')).toBe(false);
      b.click();
      expect(stub[method]).toHaveBeenCalledTimes(1);
    });

    it('CLICK-AB-02: Start check is disabled until the item has a name', () => {
      stub.storyName.set('  ');
      const fixture = render(ActionBarComponent);
      const el = fixture.nativeElement as HTMLElement;
      expect(button(el, 'Start check').hasAttribute('disabled')).toBe(true);
      stub.storyName.set('Item A');
      fixture.detectChanges();
      expect(button(el, 'Start check').hasAttribute('disabled')).toBe(false);
    });

    it.each(['setup', 'checking', 'confident', 'paused'] as const)(
      'CLICK-AB-03: %s: request buttons are disabled while disconnected',
      (phase) => {
        stub.storyName.set('Item A');
        stub.checkPhase.set(phase);
        stub.connected.set(false);
        const el = render(ActionBarComponent).nativeElement as HTMLElement;
        const requestButtons = buttons(el).filter((b) => !b.textContent?.includes('Observ'));
        expect(requestButtons.length).toBeGreaterThan(0);
        for (const b of requestButtons) expect(b.hasAttribute('disabled')).toBe(true);
      },
    );
  });

  describe('confidence toggle', () => {
    beforeEach(() => stub.checkPhase.set('checking'));

    it('CLICK-CC-01: Confident and Not confident call setConfident', () => {
      const el = render(ConfidenceCheckComponent).nativeElement as HTMLElement;
      button(el, 'Confident').click();
      expect(stub.setConfident).toHaveBeenLastCalledWith(true);
      button(el, 'Not confident').click();
      expect(stub.setConfident).toHaveBeenLastCalledWith(false);
    });

    it('CLICK-CC-02: the pressed state follows amConfident', () => {
      const fixture = render(ConfidenceCheckComponent);
      const el = fixture.nativeElement as HTMLElement;
      expect(button(el, 'Confident').getAttribute('aria-pressed')).toBe('false');
      expect(button(el, 'Not confident').getAttribute('aria-pressed')).toBe('true');
      stub.amConfident.set(true);
      fixture.detectChanges();
      expect(button(el, 'Confident').getAttribute('aria-pressed')).toBe('true');
      expect(button(el, 'Confident').getAttribute('appearance')).toBe('filled');
    });

    it('CLICK-CC-03: disabled while disconnected, hidden for observers', () => {
      stub.connected.set(false);
      const fixture = render(ConfidenceCheckComponent);
      const el = fixture.nativeElement as HTMLElement;
      expect(button(el, 'Confident').hasAttribute('disabled')).toBe(true);
      expect(button(el, 'Not confident').hasAttribute('disabled')).toBe(true);
      stub.isObserver.set(true);
      fixture.detectChanges();
      expect(labels(el)).toEqual([]);
    });

    it('CLICK-CC-04: no toggle outside a running check', () => {
      stub.checkOutcome.set({
        result: 'paused',
        at: T0,
        notConfident: {},
        confident: [],
      } satisfies CheckOutcome);
      stub.checkPhase.set('paused');
      const el = render(ConfidenceCheckComponent).nativeElement as HTMLElement;
      expect(labels(el)).not.toContain('Confident');
    });
  });

  describe('mode switch', () => {
    beforeEach(() => TestBed.overrideComponent(RoomComponent, { set: { imports: [] } }));

    it('CLICK-MODE-01: "Confidence check" asks for confidence mode', () => {
      stub.mode.set('points');
      const el = render(RoomComponent).nativeElement as HTMLElement;
      button(el, 'Confidence check').click();
      expect(stub.setMode).toHaveBeenCalledWith('confidence');
    });

    it('CLICK-MODE-02: disabled while checking or disconnected', () => {
      stub.checkPhase.set('checking');
      const fixture = render(RoomComponent);
      const el = fixture.nativeElement as HTMLElement;
      expect(button(el, 'Point voting').hasAttribute('disabled')).toBe(true);
      stub.checkPhase.set('setup');
      stub.connected.set(false);
      fixture.detectChanges();
      expect(button(el, 'Point voting').hasAttribute('disabled')).toBe(true);
    });
  });
});

// The real RoomService over a FakeProvider standing in for the server. Every confidence
// request is a custom message the Worker must handle. The Worker in production predates the
// feature (a bare YServer, see party/server.spec.ts "a Worker from before confidence
// checks"): it never sends `time` and drops the requests, so the buttons did nothing.
describe('with the real RoomService', () => {
  let fixture: ComponentFixture<RoomComponent>;
  let p: FakeProvider;
  let el: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: Y_PROVIDER_FACTORY, useValue: fakeProviderFactory }, ROUTE],
    });
    TestBed.overrideComponent(RoomComponent, { set: { imports: [ActionBarComponent] } });
    fixture = TestBed.createComponent(RoomComponent);
    fixture.detectChanges();
    const provider = FakeProvider.instances.at(-1);
    if (!provider) throw new Error('no provider created');
    p = provider;
    el = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    TestBed.inject(RoomService).disconnect();
    FakeProvider.reset();
  });

  /** Connects; a current Worker sends its clock on connect, before the sync completes. */
  function connect({ serverSendsTime }: { serverSendsTime: boolean }): void {
    p.status('connected');
    if (serverSendsTime) p.custom(JSON.stringify({ type: 'time', now: Date.now() }));
    p.synced(true);
    fixture.detectChanges();
  }

  /** A room another client already put in confidence mode, with a named item. */
  function confidenceRoom(): void {
    p.remote((d) => {
      d.getMap('session').set('mode', 'confidence');
      d.getMap('session').set('storyName', 'Item A');
    });
    fixture.detectChanges();
  }

  const requests = () => p.sendMessage.mock.calls.map(([m]) => m).slice(1);

  it('CLICK-REAL-01: a current Worker: the mode button sends the mode request', () => {
    connect({ serverSendsTime: true });
    const b = button(el, 'Confidence check');
    expect(b.hasAttribute('disabled')).toBe(false);
    expect(el.querySelector('[data-testid="server-outdated"]')).toBeNull();
    b.click();
    expect(requests()).toEqual(['{"type":"mode","mode":"confidence","round":0}']);
  });

  it('CLICK-REAL-02: a current Worker: Start check sends the start request', () => {
    connect({ serverSendsTime: true });
    confidenceRoom();
    const b = button(el, 'Start check');
    expect(b.hasAttribute('disabled')).toBe(false);
    b.click();
    expect(requests()).toEqual(['{"type":"check","action":"start","round":0}']);
  });

  // Reproduces the report: against the deployed Worker the button looked enabled, the click
  // sent a request nobody handles, and nothing changed or explained why.
  it('CLICK-REAL-03: an outdated Worker: the mode button is disabled and says why', () => {
    connect({ serverSendsTime: false });
    expect(button(el, 'Confidence check').hasAttribute('disabled')).toBe(true);
    expect(el.querySelector('[data-testid="server-outdated"]')?.textContent).toContain(
      'server',
    );
  });

  it('CLICK-REAL-04: an outdated Worker: Start check is disabled', () => {
    connect({ serverSendsTime: false });
    confidenceRoom();
    expect(button(el, 'Start check').hasAttribute('disabled')).toBe(true);
  });
});
