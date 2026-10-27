import { routePartykitRequest } from 'partyserver';
import { YServer } from 'y-partyserver';
import * as Y from 'yjs';

interface Env {
  PlanningPoker: DurableObjectNamespace<PlanningPoker>;
}

const SNAPSHOT_KEY = 'snapshot';

// One Durable Object per room. The Yjs doc lives in memory while clients are
// connected; a full-state snapshot is written to the DO's own storage so the
// room survives everyone leaving (equivalent to y-partykit's `snapshot` mode).
export class PlanningPoker extends YServer<Env> {
  override async onLoad(): Promise<void> {
    const snapshot = await this.ctx.storage.get<Uint8Array>(SNAPSHOT_KEY);
    if (snapshot) {
      Y.applyUpdate(this.document, snapshot);
    }
  }

  override async onSave(): Promise<void> {
    await this.ctx.storage.put(SNAPSHOT_KEY, Y.encodeStateAsUpdate(this.document));
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (
      (await routePartykitRequest(request, env)) ?? new Response('Not Found', { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
