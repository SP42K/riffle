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
Domain vocabulary: 單張/對子/三條/順子/同花/葫蘆/鐵支/同花順/一條龍 map to the `ComboType` union in
`shared/src/types.ts`, and `COMBO_LABEL` is the single translation table. Texas hold'em has its
own vocabulary (高牌/一對/兩對/三條/順子/同花/葫蘆/鐵支/同花順 → `HoldemCategory`, with
`HOLDEM_CATEGORY_LABEL` in `shared/src/holdem.ts`) — note 三條/順子/同花/葫蘆/鐵支/同花順 are
shared words but **different rankings** between the two games. Monopoly's vocabulary is in
`shared/src/monopoly.ts` (地產/色組/抵押/贖回/蓋房/拆房/拍賣/交易/償債/破產, plus
`MONOPOLY_TILE_LABEL` for the 40 tiles and `MONOPOLY_CARD_LABEL` for the 32 機會／命運 cards).

## Architecture

Three workspaces. `shared` is consumed as **raw TypeScript source**, not a build artifact:
`shared/package.json` points `main`/`exports` at `./src/index.ts`, the client resolves it via a
Vite alias to `../shared/src/index.ts`, and both tsconfigs map the `shared` path. Nothing compiles
`shared` — there is no build step for it, and adding one would be a regression.

**The rule engine is shared on purpose.** `shared/src/combos.ts` (`identifyCombo` / `canBeat` /
`smallestLegalPlay` / `findLegalPlays`) is the only place Big Two legality lives; `shared/src/holdem.ts`
(`evaluateFive` / `bestHand` / `compareHoldemHands` / `legalActions`) is the only place hold'em hand
strength and bet legality live. `shared/src/monopoly.ts` holds the 40-tile board, the rent/mortgage/
build arithmetic (`rentOf` / `ownsFullGroup` / `buildBlock` / `sellBlock` / `netWorthOf` /
`liquidValueOf`) and the two card decks. The server calls them for authoritative validation
(`gameEngine.playCards`, `holdemEngine.applyBet`, `monopolyEngine.applyMonopolyAction`); the client
calls the *same functions* in `client/src/pages/BigTwoTable.tsx`, `HoldemTable.tsx` and
`components/MonopolyBoard.tsx` to enable/disable buttons and build hints.
Never reimplement a rule on one side — the two would drift.

**Which affordances are legal is a server answer, not a client one.** Hold'em ships
`HoldemGameView.myActions` and Monopoly ships `MonopolyGameView.myActions` (16 flags plus four
per-tile lists: `buildable` / `sellable` / `mortgageable` / `unmortgageable`), both computed
per-viewer in `buildRoomView`. `MonopolyTable.tsx` renders **only** the buttons whose flag is true
and never re-derives legality — with ~16 heterogeneous, situational actions, recomputing on the
client would mean keeping a second copy of the rules in sync.

**Big Two rules are five independent toggles**, not a ruleset name. `BigTwoRules` is a flat
`Record<BigTwoRuleKey, boolean>` picked per-toggle at room creation and fixed for the room's life:

| key | when on |
|---|---|
| `cuts` | 鐵支/同花順/一條龍 are 「切」 and beat anything regardless of size, ordered by `CUT_ORDER` (一條龍 > 同花順 > 鐵支) |
| `dragon` | 一條龍 (13 cards, 3 through 2) is a combo |
| `flush` | 同花 is a combo |
| `matchFiveCardType` | a five-card follow must repeat the leader's `ComboType` (順子 only follows 順子) |
| `passLocksTrick` | PASS removes you from the trick until it ends |

`TAIWAN_BIG_TWO_RULES` (everything but `flush`) is `DEFAULT_BIG_TWO_RULES`; `CLASSIC_BIG_TWO_RULES`
is its mirror image. They are **presentation only** — `bigTwoPresetOf` matches a flag set back to
`'taiwan' | 'classic' | 'custom'` for the lobby/room tag, and nothing in the engine ever asks which
preset is in play. Any mix is legal and must work: the first four toggles live in `combos.ts` behind
a `rules` argument on `identifyCombo` / `canBeat` / `beatFailure` / `findLegalPlays` (all defaulting
to `DEFAULT_BIG_TWO_RULES`), the fifth in `gameEngine.advanceTurn` — with `passLocksTrick`,
`commitPlay` does **not** clear `passedSeats`, so `advanceTurnLockedPass` skips passed seats and only
clears when the trick ends. Never re-collapse these into a ruleset check (`rules === 'taiwan'`);
branch on the individual flag.

`beatFailure` exists so both ends can tell 「牌型不對」 from 「壓不過」 without duplicating the check:
the server maps it to `MUST_MATCH_COMBO` vs `CANNOT_BEAT`, the client to two different hints.
`Room.bigTwoRules` is the source of truth; `normalizeBigTwoRules` in `rooms.ts` sanitizes the wire
value key-by-key (only booleans pass, anything missing falls back to the default), it reaches the
engine via `dealGame` and the client via `RoomView.bigTwoRules` / `RoomSummary.bigTwoRules` (both
`null` for hold'em).

**Three games, one room layer.** A room picks its `gameType` (`'bigTwo' | 'holdem' | 'monopoly'`)
at creation and never changes it. `SEAT_LIMITS` gives per-game seat counts (Big Two 2–4,
hold'em 2–9, Monopoly 2–6). The pieces that differ are exactly three: the engine, the `GameView`
union member, and the client table component. Everything else — sessions, reconnect grace, chat,
lobby, per-viewer snapshots, turn timers — is shared and must stay game-agnostic.

**Monopoly's per-room settings are `MonopolyOptions`** — like `BigTwoRules` it is picked at room
creation and fixed for the room's life, but unlike it the values are not all booleans, so
`MONOPOLY_OPTION_SPEC` carries each key's kind (`flag` | `number`, with min/max/step). That one
table drives both `normalizeMonopolyOptions` in `rooms.ts` and the lobby fieldset, so a new option
costs nothing at either site. Three end conditions (`lastStanding` / `roundLimit` /
`targetNetWorth`) arm independently and the first to fire wins; `normalizeMonopolyOptions` forces
`lastStanding` on when all three are off, otherwise a room could never end. There is no preset
concept — do not add one.

**`turnSeat` means "which seat must send input right now", not "whose turn it is".** Big Two and
hold'em make those the same thing; Monopoly does not — during an auction it points at the current
bidder, during a trade at the offer's recipient, during `debt` at the debtor. Whose Monopoly turn
it is lives in `MonopolyState.activeSeat`, which the room layer never sees. This is what lets
`scheduleTurn` / `gameContext` / `reattach` stay game-agnostic, and it works because auctions and
trades are **sequential** — at any instant exactly one seat owes input. Never introduce a
multi-seat pending state; it would force `gameContext` to resolve N players and `scheduleTurn` to
run N timers.

Because `turnDeadline` is written exclusively by the engines, per-phase clocks are free:
`MONOPOLY_PHASE_MS` gives `roll`/`jail`/`debt`/`manage` 45s but `buy`/`auction` 20s and `trade`
30s, with no handler involvement. **`autoActMonopoly` must never leave `(phase, turnSeat, over)`
all three unchanged** — that is what stops a room stalling, and `monopolyEngine.test.ts` has an
`it.each(PHASES)` test guarding it. The `debt` timeout therefore liquidates all the way down or
declares bankruptcy in a single call rather than mortgaging one property and re-asking.

Rank encoding is load-bearing: 2 is `Rank === 15`, so `J-Q-K-A-2` is naturally consecutive and
`A-2-3-4-5` naturally is not, and `cardValue = rank * 4 + SUIT_ORDER[suit]` gives a total order
usable for both sorting and comparison. **Do not "fix" this for hold'em** — `holdem.ts` maps it
locally (`holdemRank`: 15 → 2) so the wheel straight and ace-high ordering work without touching
the Big Two encoding that `createDeck`/`RANK_LABEL`/`cardValue` all depend on. Card `id`s
(`'D3'`, `'SA'`, `'H2'`) are what travels over the wire; hands are always kept sorted ascending,
which several call sites rely on (e.g. `hands.get(p)[0]` is the player's smallest card in `dealGame`).

### Server layering

- `server/src/gameEngine.ts` (Big Two), `server/src/holdemEngine.ts` (hold'em) and
  `server/src/monopolyEngine.ts` — pure, no I/O, no sockets. All three operate on a `Seats` array
  (`Array<PlayerId | null>`, index = turn order, `null` = vacated) plus their own state, mutate in
  place, and return a discriminated `{ ok }` result with an error code that has a Chinese message
  table (`PLAY_ERROR_MESSAGE` / `BET_ERROR_MESSAGE` / `MONOPOLY_ERROR_MESSAGE`). All three states
  satisfy `TurnBased` (`server/src/turnBased.ts`) — `turnSeat`/`turnDeadline`/`over` — which is why
  the timer and status code needs no branching. This is the layer under unit test.
  `turnBased.ts` also exports `assertNeverGame`, the exhaustiveness tail every game-type `switch`
  in `rooms.ts` and `handlers.ts` ends with; use it instead of a ternary or an `if/else`, or a
  fourth game will be silently treated as Big Two.
- `server/src/rooms.ts` — room/member bookkeeping and **snapshot building**. `buildRoomView`
  is per-viewer: a player gets only `hand` (Big Two hand or hold'em hole cards), a spectator gets
  `allHands` (god view) and no `hand`. Monopoly has no hidden cards, so `handOf` returns `null` for
  it and `allHands` stays `null` rather than becoming an empty object — the spectator god-view
  panel keys off that. `Room.game` is a `{ type, state }` union; `Room.chips` is the hold'em stack
  table and lives at room level because it survives across hands (Monopoly cash lives in
  `MonopolyState`, **not** in `chips`).
  `monopolyLogOf(room, event)` translates the engine's `MonopolyEvent`s into `LogEvent`s with
  nicknames attached; it exists because one Monopoly action can produce several log lines
  (roll → move → pass GO → pay rent → bankrupt), unlike the other two games.
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
`HOLDEM_START_CHIPS` at the start of a hand, so `game:over` is Big Two and Monopoly only —
`scheduleNextHand` positively locks on `'holdem'` and must stay that way. Monopoly has a real
ending with a ranking, so it goes through `emitRanking` like Big Two does.

Leaving mid-game vacates the seat (`seats[i] = null`) rather than compacting the array, so seat
indices stay stable; `activeSeats`/`nextActiveSeat` skip holes. Switching from player to spectator
during a live game is treated as forfeiting. Host leaving transfers host to the next seated player;
an empty room is deleted.

### Client

`client/src/state/GameProvider.tsx` owns the socket and every piece of server state; pages read it
through `useGame()`. `run(action)` is the standard wrapper for ack-based emits — it surfaces the
error as a toast, so handlers should not write their own try/catch. `emitWithAck` in
`net/socket.ts` promisifies socket.io acks, rejecting with an `AckError` that carries the server's
`code`; `run` looks that code up in the active skin's table and only falls back to the server's
Chinese message when the skin has no entry.

`App.tsx` routes on state, not URLs: no nickname → gate, `room !== null` → `Room`, else `Lobby`.
`pages/Room.tsx` is a `switch` on `room.gameType` — keep it a `switch`, not a ternary, so a fourth
game fails to compile instead of silently rendering the Big Two table. `pages/RoomShell.tsx` owns
everything game-agnostic (header, seat row, log, spectator/chat aside, footer slot);
`BigTwoTable.tsx`, `HoldemTable.tsx` and `MonopolyTable.tsx` supply the table centre and the
controls. Put shared chrome in `RoomShell`, not in a table. `components/Seat.tsx` takes an explicit
`gameType` prop and switches on it — it used to sniff `chips !== undefined`, which breaks the
moment a second game has money. The dev server proxies `/socket.io` (including ws) to `:3001`.

Monopoly's board is a **list, one row per tile** (`components/MonopolyBoard.tsx`), not a square
ring. That is a disguise requirement, not a layout preference: a 40-row list is the only shape the
VS Code skin can read as a file tree and the terminal skin as `ls -l` output. Group colour rides on
`data-tone` (`'a'`–`'j'` via `GROUP_TONE` in `casino.ts`) — a **separate** scale from `CardFace.tone`,
whose `'a'`–`'d'` come from the four suits and are consumed by `PlayingCard.tsx` and a dozen CSS
rules. Do not merge them.

### 隱匿模式（skins）

The product is played at work, so **no user-facing string is hard-coded in a component**. Every
label, card face, log line and error goes through the active skin (`client/src/skins/`):

- `text.ts` holds `CASINO_TEXT` and derives `TextKey` from it — every other skin's `text` must
  cover the same keys, so a missing translation is a compile error. `t('key', { n })` fills
  `{name}` templates.
- `casino.ts` (the original 牌桌 look), `vscode.ts` and `terminal.ts` each implement `Skin`
  (`skins/types.ts`): text table, `combo`/`gameType`/`street`/`holdemCategory`/`monopolyTile`/
  `monopolyGroup`/`monopolyOption`/`monopolyCard`/`monopolyPhase`/`monopolyEnd` label maps that
  shadow the `shared` ones, `card()` → `CardFace`, `action()`, `describeHand()`, `monopolyHouses()`,
  `formatLog()`, `notice()`, plus a `Chrome` wrapper and a `Boss` full-screen cover.
  The two disguise skins' Monopoly vocabulary (40 tiles + 32 cards + groups/options/phases each)
  lives in `skins/monopolyVocab.ts` — those two files were long enough already.
- **`Skin['errors']` is `Partial<Record<string, string>>`, so nothing forces coverage** and `run`
  falls back to the server's Chinese message. That is a live disguise break: whenever you add an
  engine error code, add it to `vscode.ts` and `terminal.ts` by hand. All 38 current codes are
  covered; keep it that way.
- `skins.css` restyles by `[data-skin='…']` only; `styles.css` stays the casino baseline. Card
  colour comes from `CardFace.tone` (`a`/`b`/`c`/`d` = ♠/♥/♦/♣ — deliberately neutral class names).
  Anything Chinese living in CSS (e.g. `.table__result li::before`) needs an override there too.
- `state/SkinProvider.tsx` owns prefs (`localStorage` `ws.prefs`), the skin-cycle hotkey, the
  boss key and blur/mouse-leave auto-hide, and swaps `document.title` + favicon. Hiding sets
  `visibility:hidden` on `.app-root` — it never unmounts, so the socket and game state stay live.
  `state/skinContext.ts` holds the context/hook so `SkinProvider` and `pages/SkinSettings.tsx`
  don't import each other.

Because of this, **the server never sends prose**. `RoomView.log` is `LogEvent[]`, system chat
messages carry a structured `notice`, and `HoldemSeatInfo.lastAction` is a `SeatAction` — all
three are unions in `shared/src/types.ts` and the sentence is built client-side by the skin. Adding
a `pushLog` call means adding a `LogEvent` variant and a case in all three `formatLog`s.
Storage keys are neutral on purpose (`ws.sid` / `ws.user` / `ws.prefs`, migrated from the old
`bigtwo:` ones) — nicknames, room names and chat text are the only things the disguise can't cover.

## Adding a rule or event

- New Big Two combo type → `ComboType` + `COMBO_LABEL` + `FIVE_CARD_ORDER` in `types.ts`, detection
  in `identifyCombo`, ordering in `compareCombo`, then tests in `shared/src/combos.test.ts`, and a
  label in each skin's `combo` map. Both the server validator and the client button pick it up for
  free. If it is optional, gate it on a `rules` flag and add it to `CUT_ORDER` / `sizesToTry`
  instead of `FIVE_CARD_ORDER` when it is a 「切」 or not five cards.
- New Big Two rule toggle → add the key to the `BigTwoRules` interface + `BIG_TWO_RULE_KEYS` +
  `BIG_TWO_RULE_LABEL`, set it in **both** `TAIWAN_BIG_TWO_RULES` and `CLASSIC_BIG_TWO_RULES`, branch
  on it in `combos.ts` / `gameEngine.ts`, and add a label to each skin's `bigTwoRule` map.
  `normalizeBigTwoRules` and the Lobby checkbox row are driven by `BIG_TWO_RULE_KEYS`, so they pick
  it up for free. Add a mixed-toggle test — the point of the split is that any combination works.
- New user-facing string → add the key to `CASINO_TEXT` first; the compiler then demands it from
  `vscode.ts` and `terminal.ts`. Never put the literal in the component.
- New socket event → add to `ClientToServerEvents` / `ServerToClientEvents` in `types.ts` first;
  both ends are typed off those interfaces, so the compiler will point at every site to update.
- New Monopoly action → add a member to the `MonopolyAction` union + `MONOPOLY_ACTION_KINDS`, a
  case in `parseMonopolyAction` (`handlers.ts`) and in `applyMonopolyAction`, a flag in
  `MonopolyActions` + `NO_MONOPOLY_ACTIONS`, then a button in `MonopolyTable.tsx` and a text key.
  There is **one** socket event (`game:monopoly`) carrying the whole union — do not add a second
  event; the union is what makes a malformed action a compile error at the call site.
- New Monopoly option → add the key to `MonopolyOptions` + `MONOPOLY_OPTION_KEYS` +
  `MONOPOLY_OPTION_LABEL` + `MONOPOLY_OPTION_SPEC` + `DEFAULT_MONOPOLY_OPTIONS`, branch on it in
  the engine, and add a label to each skin's `monopolyOption` map. `normalizeMonopolyOptions` and
  the Lobby fieldset are spec-driven, so they pick it up for free.
- New game mode → add to `GameType` / `GAME_TYPE_LABEL` / `SEAT_LIMITS`, add a `GameView` union
  member, a pure engine satisfying `TurnBased`, a branch in `buildRoomView` and in the four
  dispatch points in `handlers.ts` (create / start / action / autoAct), and a client table
  component under `RoomShell` — plus its `LogEvent` variants and skin vocabulary. The compiler
  catches most of it; the ones it **cannot** catch are the game-type dispatches, which is why
  `normalizeGameType` reads `GAME_TYPES` and every other dispatch is a `switch` ending in
  `assertNeverGame`. Never reintroduce a ternary there.
