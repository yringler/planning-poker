# Planning Poker - Claude Code Guide

## Project Overview

Real-time planning poker app built with Angular 21 + PartyKit (WebSocket) + Yjs (CRDT sync).

## Key Commands

```bash
npm run dev          # Run Angular dev server + PartyKit local server concurrently
npm run build        # Production build
npm run deploy:party # Deploy PartyKit server
```

## Architecture

- **Frontend**: Angular 21, standalone components, signals, zoneless change detection
- **Real-time**: PartyKit (WebSocket) + Yjs (conflict-free data sync)
- **Persistence**: localStorage for user name (`pp-name`), PartyKit snapshot for room state

## Key Files

| File | Purpose |
|------|---------|
| `src/app/app.routes.ts` | Routes: `/` → Landing, `/room/:code` → Room |
| `src/app/landing/landing.ts` | Home screen (create/join session) |
| `src/app/room/room.ts` | Room view + name prompt for direct link visitors |
| `src/app/services/room.service.ts` | Core state: Yjs doc, PartyKit provider, signals |
| `party/server.ts` | PartyKit server (minimal, uses y-partykit onConnect) |
| `src/environments/` | PartyKit host config (dev vs prod) |

## Room Code Format

6-character alphanumeric (A-Z, 0-9), uppercase. PartyKit room key: `planning-poker-{code}`.

## State Management

All room state lives in `RoomService` via Yjs maps:
- `session` map: `phase` (`voting` | `revealed`), `storyName`, `hostId`
- `votes` map: `peerId → vote value`
- `history` array: past rounds

Awareness layer (PartyKit) tracks connected players with name + peerId.

## Coding Conventions

- Angular standalone components with inline templates and styles
- Signals for reactive state (`signal()`, `computed()`)
- `@if` / `@for` control flow syntax (Angular 17+), not `*ngIf` / `*ngFor`
- Prettier: `printWidth: 100`, `singleQuote: true`
- No test files currently in project
