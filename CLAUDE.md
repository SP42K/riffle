# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install            # npm workspaces: shared / server / client
npm run dev            # concurrently: server (tsx watch, :3001) + vite dev (:5173)
npm test               # vitest run — shared/src/**/*.test.ts + server/src/**/*.test.ts
npm run test:watch
npm run typecheck      # tsc -p shared && tsc -p server && tsc -p client (all noEmit)
npm run build          # vite build → client/dist
npm run serve          # build, then one process on 0.0.0.0:80 serving API + client/dist

npm start -w server -- --port 8080 --host 127.0.0.1   # CLI flags beat env vars (PORT/HOST)
npm run dev -w client -- --port 80                    # vite's own flags
```

The server binds `0.0.0.0` by default and prints its LAN addresses on boot. It serves
`client/dist` whenever that directory exists — there is no `NODE_ENV` switch. Both dev servers
listen on all interfaces, so LAN play works without extra flags.

Run one test file / one case:

```bash
npx vitest run shared/src/combos.test.ts
npx vitest run -t "順子邊界"        # test names are in Chinese, matching the rule vocabulary
```

There is no linter configured. `npm run typecheck` is the gate — `strict` plus
`noUncheckedIndexedAccess` are on, so indexed access needs `!` or a guard (the existing
code uses `!` liberally after a length/sort invariant).

## Language conventions

The product, all UI copy, code comments, log lines, and test names are Traditional Chinese;
identifiers are English. Match this — new comments and user-facing strings in Chinese.
Domain vocabulary: 單張/對子/三條/順子/同花/葫蘆/鐵支/同花順 map to the `ComboType` union in
`shared/src/types.ts`, and `COMBO_LABEL` is the single translation table. Texas hold'em has its
own vocabulary (高牌/一對/兩對/三條/順子/同花/葫蘆/鐵支/同花順 → `HoldemCategory`, with
`HOLDEM_CATEGORY_LABEL` in `shared/src/holdem.ts`) — note 三條/順子/同花/葫蘆/鐵支/同花順 are
shared words but **different rankings** between the two games.

## Architecture

Three workspaces. `shared` is consumed as **raw TypeScript source**, not a build artifact:
`shared/package.json` points `main`/`exports` at `./src/index.ts`, the client resolves it via a
Vite alias to `../shared/src/index.ts`, and both tsconfigs map the `shared` path. Nothing compiles
`shared` — there is no build step for it, and adding one would be a regression.

**The rule engine is shared on purpose.** `shared/src/combos.ts` (`identifyCombo` / `canBeat` /
`smallestLegalPlay` / `findLegalPlays`) is the only place Big Two legality lives; `shared/src/holdem.ts`
(`evaluateFive` / `bestHand` / `compareHoldemHands` / `legalActions`) is the only place hold'em hand
strength and bet legality live. The server calls them for authoritative validation
(`gameEngine.playCards`, `holdemEngine.applyBet`); the client calls the *same functions* in
`client/src/pages/BigTwoTable.tsx` and `HoldemTable.tsx` to enable/disable buttons and build hints.
Never reimplement a rule on one side — the two would drift.

**Two games, one room layer.** A room picks its `gameType` (`'bigTwo' | 'holdem'`) at creation and
never changes it. `SEAT_LIMITS` gives per-game seat counts (Big Two 2–4, hold'em 2–9). The pieces
that differ are exactly three: the engine, the `GameView` union member, and the client table
component. Everything else — sessions, reconnect grace, chat, lobby, per-viewer snapshots, turn
timers — is shared and must stay game-agnostic.

Rank encoding is load-bearing: 2 is `Rank === 15`, so `J-Q-K-A-2` is naturally consecutive and
`A-2-3-4-5` naturally is not, and `cardValue = rank * 4 + SUIT_ORDER[suit]` gives a total order
usable for both sorting and comparison. **Do not "fix" this for hold'em** — `holdem.ts` maps it
locally (`holdemRank`: 15 → 2) so the wheel straight and ace-high ordering work without touching
the Big Two encoding that `createDeck`/`RANK_LABEL`/`cardValue` all depend on. Card `id`s
(`'D3'`, `'SA'`, `'H2'`) are what travels over the wire; hands are always kept sorted ascending,
which several call sites rely on (e.g. `hands.get(p)[0]` is the player's smallest card in `dealGame`).

### Server layering

- `server/src/gameEngine.ts` (Big Two) and `server/src/holdemEngine.ts` (hold'em) — pure, no I/O,
  no sockets. Both operate on a `Seats` array (`Array<PlayerId | null>`, index = turn order,
  `null` = vacated) plus their own state, mutate in place, and return a discriminated `{ ok }`
  result with an error code that has a Chinese message table (`PLAY_ERROR_MESSAGE` /
  `BET_ERROR_MESSAGE`). Both states satisfy `TurnBased` (`server/src/turnBased.ts`) —
  `turnSeat`/`turnDeadline`/`over` — which is why the timer and status code needs no branching.
  This is the layer under unit test.
- `server/src/rooms.ts` — room/member bookkeeping and **snapshot building**. `buildRoomView`
  is per-viewer: a player gets only `hand` (Big Two hand or hold'em hole cards), a spectator gets
  `allHands` (god view) and no `hand`. `Room.game` is a `{ type, state }` union; `Room.chips` is
  the hold'em stack table and lives at room level because it survives across hands.
- `server/src/handlers.ts` — the `GameServer` class: all socket wiring, timers, broadcasts,
  and input sanitizing (`cleanText`). Everything lives in memory; there is no persistence.

State sync is snapshot-push only: after any mutation the server recomputes and emits a full
`room:state` to each member individually (`broadcastRoom` loops members rather than using a
socket.io room, precisely because payloads differ per viewer). The client never does optimistic
updates — it renders whatever the last snapshot said.

### Identity, reconnect, and timers

`playerId` is a UUID in **`sessionStorage`** (nickname in `localStorage`). That is deliberate:
F5 keeps the same player and reattaches to the seat and hand, while a new tab is a genuinely
separate player — this is how you test multiplayer locally. A second `session:hello` with the same
`playerId` disconnects the older socket.

`GameServer` keeps three maps: `sessions` (socket.id → session), `playerRoom` (playerId → roomId,
survives disconnect so reattach works), and `rooms`. On disconnect the member is only marked
offline; the seat and hand are held for `DISCONNECT_GRACE_MS` (30s) before `dropFromRoom`.

Turn timing has two clocks: `TURN_MS` (45s) normally, but `scheduleTurn` shortens the deadline to
`DISCONNECTED_TURN_MS` (3s) when the current player is offline so the table doesn't stall, and
`reattach` restores a full turn on return. Expiry calls the engine's auto-act: Big Two PASSes if
possible, otherwise (holding the lead, where passing is illegal) plays `smallestLegalPlay`;
hold'em checks if free, otherwise folds. `room.turnTimer` must be cleared and rescheduled through
`scheduleTurn` after every state change — `afterGameAction` bundles the
checkGameOver → broadcastRoom → broadcastLobby → scheduleTurn → scheduleNextHand sequence.

Hold'em is a **continuous in-room cash game**: the host starts the first hand, then `room.handTimer`
(`HOLDEM_SHOWDOWN_MS`, kept separate from `turnTimer` because `scheduleTurn` clears that one) deals
the next hand automatically, rotating the button. Busted players are topped back up to
`HOLDEM_START_CHIPS` at the start of a hand, so `game:over` is Big Two-only.

Leaving mid-game vacates the seat (`seats[i] = null`) rather than compacting the array, so seat
indices stay stable; `activeSeats`/`nextActiveSeat` skip holes. Switching from player to spectator
during a live game is treated as forfeiting. Host leaving transfers host to the next seated player;
an empty room is deleted.

### Client

`client/src/state/GameProvider.tsx` owns the socket and every piece of server state; pages read it
through `useGame()`. `run(action)` is the standard wrapper for ack-based emits — it surfaces the
server's error message as a toast, so handlers should not write their own try/catch. `emitWithAck`
in `net/socket.ts` promisifies socket.io acks, rejecting with `error.message`.

`App.tsx` routes on state, not URLs: no nickname → gate, `room !== null` → `Room`, else `Lobby`.
`pages/Room.tsx` is a two-line dispatcher on `room.gameType`. `pages/RoomShell.tsx` owns everything
game-agnostic (header, seat row, log, spectator/chat aside, footer slot); `BigTwoTable.tsx` and
`HoldemTable.tsx` supply the table centre and the controls. Put shared chrome in `RoomShell`, not in
either table. The dev server proxies `/socket.io` (including ws) to `:3001`.

## Adding a rule or event

- New Big Two combo type → `ComboType` + `COMBO_LABEL` + `FIVE_CARD_ORDER` in `types.ts`, detection
  in `identifyCombo`, ordering in `compareCombo`, then tests in `shared/src/combos.test.ts`.
  Both the server validator and the client button pick it up for free.
- New socket event → add to `ClientToServerEvents` / `ServerToClientEvents` in `types.ts` first;
  both ends are typed off those interfaces, so the compiler will point at every site to update.
- New game mode → add to `GameType` / `GAME_TYPE_LABEL` / `SEAT_LIMITS`, add a `GameView` union
  member, a pure engine satisfying `TurnBased`, a branch in `buildRoomView` and in the four
  dispatch points in `handlers.ts` (create / start / action / autoAct), and a client table
  component under `RoomShell`.
