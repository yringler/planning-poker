import { vi } from 'vitest';

/** In-memory stand-in for the parts of DurableObjectStorage the server uses. */
export class FakeStorage {
  data = new Map<string, unknown>();
  alarm: number | null = null;
  get = vi.fn(async (key: string): Promise<unknown> => this.data.get(key));
  put = vi.fn(async (key: string, value: unknown): Promise<void> => {
    this.data.set(key, value);
  });
  delete = vi.fn(async (key: string): Promise<boolean> => this.data.delete(key));
  setAlarm = vi.fn(async (at: number | Date): Promise<void> => {
    this.alarm = +at;
  });
  deleteAlarm = vi.fn(async (): Promise<void> => {
    this.alarm = null;
  });
  getAlarm = vi.fn(async (): Promise<number | null> => this.alarm);
}
