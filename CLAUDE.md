# Planning Poker - Claude Code Guide

## Project Overview

Real-time planning poker app built with Angular 21 + PartyServer on Cloudflare Workers (WebSocket) + Yjs (CRDT sync).

## Key Commands

```bash
npm run dev          # Run Angular dev server + local Worker (`wrangler dev`, port 8787) concurrently
npm run build        # Production build
npm test             # Angular unit tests (Vitest + jsdom) + party/ server tests
npm run preview      # Production build served by `wrangler dev` on :8787 (app + Durable Object)
npm run deploy       # Test, build, `wrangler deploy` (normally done by Workers Builds on push to main)
```

## Architecture

- **Frontend**: Angular 21, standalone components, signals, zoneless change detection
- **Real-time**: PartyServer/Durable Objects (WebSocket) + Yjs (conflict-free data sync)
- **Persistence**: localStorage for user name (`pp-name`), Yjs snapshot in each room's Durable Object storage

## Key Files

| File | Purpose |
|------|---------|
| `src/app/app.routes.ts` | Routes: `/` → Landing, `/room/:code` → Room |
| `src/app/landing/landing.ts` | Home screen (create/join session) |
| `src/app/room/room.ts` | Room view + name prompt for direct link visitors |
| `src/app/services/room.service.ts` | Core state: Yjs doc, y-partyserver provider, signals |
| `party/server.ts` | Worker + `PlanningPoker` Durable Object (`YServer` from y-partyserver) |
| `wrangler.jsonc` | Single Worker: serves the Angular build as static assets + `/parties/*` → Durable Object |
| `src/environments/` | Party host: `localhost:8787` in dev, same origin (`location.host`) in prod |

## Room Code Format

6-character alphanumeric (A-Z, 0-9), uppercase. Room name: `planning-poker-{code}` (party `planning-poker`).

## State Management

All room state lives in `RoomService` via Yjs maps:
- `session` map: `phase` (`voting` | `revealed`), `storyName`, `hostId`
- `votes` map: `peerId → vote value`
- `history` array: past rounds

Yjs awareness tracks connected players with name + peerId.

## Anonymity

Confidence-check answers only need to be hidden in the UI (no names, counts or other tells
until the round ends). The `confidence` Yjs map is synced to every client, so devtools can see
it; that's fine. We don't need real anonymity, so keep it simple and don't route answers through
the server to hide them.

## Coding Conventions

- Angular standalone components with inline templates and styles
- Signals for reactive state (`signal()`, `computed()`)
- `@if` / `@for` control flow syntax (Angular 17+), not `*ngIf` / `*ngFor`
- Prettier: `printWidth: 100`, `singleQuote: true`
- Specs live next to the code (`*.spec.ts`); party tests run via `party/vitest.config.ts`
- Run `npm run format` (Prettier) before committing
