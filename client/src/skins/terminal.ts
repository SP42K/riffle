import {
  HOLDEM_RANK_LABEL,
  RANK_LABEL,
  SNAKE_ITEM_CONFIG,
  type Card,
  type LogEvent,
  type MonopolyEstateId,
  type SeatAction,
  type SnakeItemKind,
  type SystemNotice,
} from 'shared';
import { SUIT_TONE, labelCards } from './casino';
import {
  TERMINAL_CARD,
  TERMINAL_END,
  TERMINAL_GROUP,
  TERMINAL_OPTION,
  TERMINAL_PHASE,
  TERMINAL_TILE,
  terminalHouses,
} from './monopolyVocab';
import { ShellBoss } from './chrome/BossScreens';
import { TerminalChrome } from './chrome/TerminalChrome';
import type { TextTable } from './text';
import type { CardFace, Skin } from './types';

/** 花色 → 單一小寫字母。整排看起來像一串短雜湊或測試代號。 */
const SUIT_TAG = { S: 's', H: 'h', D: 'd', C: 'c' } as const;

const token = (card: Card) => RANK_LABEL[card.rank].toLowerCase();

function face(card: Card): CardFace {
  return {
    main: token(card),
    sub: SUIT_TAG[card.suit],
    tone: SUIT_TONE[card.suit],
    label: `${token(card)}${SUIT_TAG[card.suit]}`,
  };
}

const cards = (ids: string[]) => labelCards(ids, (card) => face(card).label);

const rank = (value: number | undefined) => HOLDEM_RANK_LABEL[value ?? 0] ?? '?';

const COMBO: Skin['combo'] = {
  single: '1x',
  pair: '2x',
  triple: '3x',
  straight: 'seq',
  flush: 'grp',
  fullHouse: '3+2',
  fourOfAKind: '4x',
  straightFlush: 'seq+grp',
  dragon: 'seq13',
};

const CATEGORY: Skin['holdemCategory'] = {
  highCard: 'hi',
  onePair: 'p1',
  twoPair: 'p2',
  threeOfAKind: '3x',
  straight: 'seq',
  flush: 'grp',
  fullHouse: '3+2',
  fourOfAKind: '4x',
  straightFlush: 'seq+grp',
};

const ITEM_LABEL: Record<SnakeItemKind, string> = {
  speed: 'nice -20',
  reverse: 'sed s/left/right/',
  shield: 'chmod 444',
  bullet: 'kill -9',
  magnet: 'rsync --pull',
};

const STREET: Skin['street'] = {
  preflop: 'step 0',
  flop: 'step 1',
  turn: 'step 2',
  river: 'step 3',
  showdown: 'done',
};

function describeCategory(category: keyof typeof CATEGORY, tiebreak: readonly number[]): string {
  const [first, second] = tiebreak;
  if (category === 'twoPair' || category === 'fullHouse') {
    return `${CATEGORY[category]}:${rank(first)}${rank(second)}`;
  }
  return `${CATEGORY[category]}:${rank(first)}`;
}

function action(a: SeatAction): string {
  const max = a.allIn ? ' [max]' : '';
  switch (a.kind) {
    case 'sb':
    case 'bb':
      return `init ${a.amount}`;
    case 'fold':
      return 'abort';
    case 'check':
      return 'wait';
    case 'call':
      return `sync ${a.amount}${max}`;
    case 'bet':
      return `push ${a.to ?? a.amount}${max}`;
    case 'raise':
      return `push ${a.to ?? a.amount}${max}`;
    case 'leave':
      return 'exit';
  }
}

const TERMINAL_CASH = {
  salary: 'cycle credit',
  parking: 'reclaimed pool',
  card: 'rand()',
  players: 'peer transfer',
} as const;

const TERMINAL_FREED = {
  bail: 'paid',
  card: 'sudo token',
  doubles: 'retry ok',
  served: 'timeout',
} as const;

/** 交易的一邊：幾個路徑加多少額度。 */
function terminalSide(tiles: readonly MonopolyEstateId[], cash: number): string {
  const parts: string[] = tiles.map((id) => TERMINAL_TILE[id]);
  if (cash > 0) parts.push(`${cash}u`);
  return parts.length > 0 ? parts.join(' ') : '(none)';
}

function formatLog(event: LogEvent): string {
  switch (event.t) {
    case 'bigTwoStart':
      return `$ run --workers ${event.players}`;
    case 'lead':
      return `${event.player} holds the first slot`;
    case 'play':
      return `${event.player} push ${COMBO[event.combo]} ${cards(event.cards)}`;
    case 'pass':
      return `${event.player} skip`;
    case 'finished':
      return `${event.player} done (#${event.rank})`;
    case 'bigTwoOver':
      return `exit 0 — ${event.ranking.map((n, i) => `#${i + 1} ${n}`).join(' ')}`;
    case 'rebuy':
      return `${event.player} quota=${event.amount}`;
    case 'holdemStart':
      return `$ job ${event.handNo} --base ${event.smallBlind}/${event.bigBlind}`;
    case 'button':
      return `${event.player} head`;
    case 'bet':
      return `${event.player} ${action(event.action)}`;
    case 'street':
      return `${STREET[event.street]}  ${cards(event.board)}`;
    case 'board':
      return `pool  ${cards(event.board)}`;
    case 'showdown':
      return `${event.player} ${describeCategory(event.category, event.tiebreak)}${
        event.won > 0 ? ` +${event.won}` : ''
      }`;
    case 'uncontested':
      return `${event.player} +${event.won} (others aborted)`;
    case 'timeout':
      return `${event.player} timeout — auto ${
        event.auto === 'pass' ? 'skip' : event.auto === 'check' ? 'wait' : 'abort'
      }`;
    case 'timeoutPlay':
      return `${event.player} timeout — auto push ${COMBO[event.combo]} ${cards(event.cards)}`;
    case 'monopolyStart':
      return `$ mount --users ${event.players} --quota ${event.startCash}`;
    case 'move':
      return `${event.player} seek ${event.dice[0]}+${event.dice[1]} → ${TERMINAL_TILE[event.tile]}`;
    case 'buy':
      return `${event.player} alloc ${TERMINAL_TILE[event.tile]} (${event.price}u)`;
    case 'rent':
      return `${event.player} → ${event.owner} ${event.amount}u (${TERMINAL_TILE[event.tile]})`;
    case 'tax':
      return `${event.player} ${TERMINAL_TILE[event.tile]} −${event.amount}u`;
    case 'monopolyCash':
      return `${event.player} ${event.amount >= 0 ? '+' : '−'}${Math.abs(event.amount)}u (${
        TERMINAL_CASH[event.source]
      })`;
    case 'auctionStart':
      return `${TERMINAL_TILE[event.tile]} released — bidding open`;
    case 'bid':
      return `${event.player} bid ${event.amount}u`;
    case 'auctionEnd':
      return event.player
        ? `${event.player} won ${TERMINAL_TILE[event.tile]} at ${event.amount}u`
        : `${TERMINAL_TILE[event.tile]} — no bids`;
    case 'build':
      return event.sold
        ? `${event.player} truncate ${TERMINAL_TILE[event.tile]} → lvl ${event.houses}`
        : `${event.player} extend ${TERMINAL_TILE[event.tile]} → lvl ${event.houses}`;
    case 'mortgage':
      return event.redeem
        ? `${event.player} swap in ${TERMINAL_TILE[event.tile]} (−${event.amount}u)`
        : `${event.player} swap out ${TERMINAL_TILE[event.tile]} (+${event.amount}u)`;
    case 'drawCard':
      return `${event.player} rand() → ${TERMINAL_CARD[event.card]}`;
    case 'jailed':
      return `${event.player} held in var/lock`;
    case 'freed':
      return `${event.player} released (${TERMINAL_FREED[event.how]})`;
    case 'trade':
      return `chown ${event.from}:${event.to} — ${terminalSide(event.give, event.giveCash)} ⇄ ${terminalSide(event.want, event.wantCash)}`;
    case 'bankrupt':
      return event.creditor
        ? `${event.player} oom — reassigned to ${event.creditor}`
        : `${event.player} oom — freed to system`;
    case 'monopolyOver':
      return `umount (${TERMINAL_END[event.reason]}) — ${event.ranking
        .map((n, i) => `#${i + 1} ${n}`)
        .join(' ')}`;
    case 'timeoutMonopoly':
      return `${event.player} timeout in ${TERMINAL_PHASE[event.phase]} — auto`;
    case 'snakeStart':
      return `$ watch --members ${event.players}`;
    case 'snakeRespawn':
      return `${event.player} segfault — auto-restart`;
    case 'snakeDeath':
      return `${event.player} segfault (no retries left)`;
    case 'snakeFoodEaten':
      return `${event.player} consumed a token`;
    case 'snakeMineEaten':
      return `${event.player} caught their own trap — bonus`;
    case 'snakeItemUsed':
      return `${event.player} ran \`${ITEM_LABEL[event.item]}\``;
    case 'snakeDashCharging':
      return `${event.player} winding up \`dash\``;
    case 'snakeCut':
      return `${event.attacker} truncated ${event.victim}'s buffer`;
    case 'snakeOver':
      return `watch exited — ${event.ranking.map((n, i) => `#${i + 1} ${n}`).join(' ')}`;
    case 'minesweeperStart':
      return `probe started — ${event.players} users`;
    case 'minesweeperReveal':
      return `${event.player} probe (${event.r + 1},${event.c + 1}) — ${event.points > 0 ? 'ok (+1)' : 'err (-1)'}`;
    case 'minesweeperFlag':
      return `${event.player} set flag (${event.r + 1},${event.c + 1}) — ${event.flagged ? 'on' : 'off'}`;
    case 'minesweeperOver':
      return `probe done — ${event.ranking.map((n, i) => `#${i + 1} ${n}`).join(' ')}`;
    case 'timeoutMinesweeper':
      return `${event.player} timeout — auto probe`;
    case 'dndStart':
      return `dungeon party active — ${event.players} members`;
    case 'dndMove':
      return `${event.player} move ${event.dir}`;
    case 'dndAttack':
      return event.damage < 0
        ? `heal ${event.player} -> ${event.target} (+${-event.damage} hp)`
        : `${event.player} attack ${event.target} (roll ${event.roll}) — ${event.hit ? `HIT (${event.damage} dmg)` : 'MISS'}`;
    case 'dndMonsterTurn':
      return `monsters executing AI routines...`;
    case 'dndOver':
      return `dungeon session ended — ${event.won ? 'SUCCESS' : 'FAILED'}`;
    case 'timeoutDnd':
      return `${event.player} timeout — auto action`;
    case 'dndLevelUp':
      return `level ${event.level} loaded — party healed 50%`;
    case 'dndTrap':
      return `trap ${event.player} (-${event.damage} HP)`;
    case 'dndMessage':
      return event.message;
  }
}

function notice(n: SystemNotice): string {
  switch (n.t) {
    case 'created':
      return `${n.player} created the job`;
    case 'joined':
      return `${n.player} attached`;
    case 'spectating':
      return `${n.player} tailing`;
    case 'left':
      return `${n.player} detached`;
    case 'disconnected':
      return `${n.player} lost connection`;
    case 'snakeItem': {
      const config = SNAKE_ITEM_CONFIG[n.item];
      return config.activationDelayMs > 0
        ? `! ${n.player} ran \`${ITEM_LABEL[n.item]}\` — landing in ${Math.ceil(config.activationDelayMs / 1000)}s`
        : `! ${n.player} ran \`${ITEM_LABEL[n.item]}\``;
    }
    case 'snakeDash':
      return `! ${n.player} winding up \`dash\` — watch your buffer`;
  }
}

const TEXT: TextTable = {
  'gate.title': 'shell',
  'gate.titleAccent': '1.9',
  'gate.subtitle': 'Set a display name to attach to the job queue. Modes: batch, stream, volume.',
  'gate.nicknamePlaceholder': 'name',
  'gate.submit': 'attach',

  'toast.failed': 'command failed',

  'lobby.nicknameLabel': 'user',
  'lobby.rename': 'set',
  'lobby.connected': 'connected',
  'lobby.connecting': 'connecting…',
  'lobby.createTitle': 'new job',
  'lobby.roomNamePlaceholder': '{name}-job',
  'lobby.gameTypeLabel': 'mode',
  'lobby.rulesLabel': 'ruleset',
  'lobby.rulesOptionsLabel': 'flags',
  'lobby.maxPlayersLabel': 'workers',
  'lobby.seatOption': '{n} workers',
  'lobby.create': 'create',
  'lobby.codeTitle': 'attach by id',
  'lobby.codePlaceholder': 'e.g. K7QM',
  'lobby.join': 'attach',
  'lobby.listTitle': 'jobs ({n})',
  'lobby.empty': 'no jobs queued.',
  'lobby.host': 'owner {name}',
  'lobby.playerCount': '{n}/{max} workers',
  'lobby.spectatorCount': '{n} tailing',
  'lobby.started': 'already running',
  'lobby.full': 'no free workers',
  'lobby.spectate': 'tail',
  'lobby.status.waiting': 'queued',
  'lobby.status.playing': 'running',
  'lobby.status.finished': 'exited',

  'room.code': 'id {id}',
  'room.spectating': 'tail -f',
  'room.sitDown': 'attach as worker',
  'room.toSpectator': 'detach to tail',
  'room.leave': 'kill job',
  'room.emptySeat': '—',
  'room.godView': 'dump all',
  'room.turnTag': 'active',
  'room.spectators': 'tailing ({n})',
  'room.chatTitle': 'notes',
  'room.turnPrefix': 'waiting on',
  'room.turnMine': 'waiting on you',

  'chat.lobbyTitle': 'notes',
  'chat.empty': 'no output.',
  'chat.placeholder': 'echo …',
  'chat.send': 'run',

  'seat.you': 'you',
  'seat.host': 'owner',
  'seat.offline': 'lost',
  'seat.button': 'head',
  'seat.sb': 'lo',
  'seat.bb': 'hi',
  'seat.pass': 'skip',
  'seat.ready': 'ready',
  'seat.notReady': 'idle',
  'seat.rank': '{medal} #{n}',
  'seat.chips': '{n}u',
  'seat.sitOut': 'paused',
  'seat.allIn': 'MAX',
  'seat.bet': '+{n}',
  'seat.left': '(gone)',

  'card.backTitle': '{n} left',

  'start.ready': 'ready',
  'start.cancelReady': 'unready',
  'start.startBigTwo': 'run',
  'start.startHoldem': 'run',
  'start.startMonopoly': 'mount',
  'start.startSnake': 'watch',
  'start.startDownstairs': 'descend',
  'start.needPlayers': 'needs {min}+ workers, all ready',

  'bigTwo.idleTitle': 'waiting for owner to run',
  'bigTwo.idleHint': '{n}/{max} workers, {min} required',
  'bigTwo.lastPlay': '{name} · {combo}',
  'bigTwo.freeLead': 'open — any batch',
  'bigTwo.mustIncludeOpening': ' · must include the first item',
  'bigTwo.resultTitle': 'exit 0',
  'bigTwo.playAgain': 'run again',
  'bigTwo.waitHost': 'waiting for owner',
  'bigTwo.play': 'push',
  'bigTwo.pass': 'skip',
  'bigTwo.suggest': 'hint',
  'bigTwo.cannotPass': 'you hold the lead — cannot skip',
  'bigTwo.sortRank': 'sort: name',
  'bigTwo.sortSuit': 'sort: type',
  'bigTwo.suitOrder': 'tag order',
  'bigTwo.handEmpty': 'queue empty',
  'bigTwo.waitingDeal': 'waiting for input',
  'hint.notPlaying': 'press ready, owner starts',
  'hint.waitOthers': 'waiting on other workers',
  'hint.selectToFollow': 'select {n} items',
  'hint.selectCards': 'select items to push',
  'hint.invalidCombo': 'invalid batch',
  'hint.mustIncludeOpening': 'first push must include the first item',
  'hint.mustPlayN': 'must select {n} items',
  'hint.mustMatchCombo': 'this round accepts {combo} only',
  'hint.noFlush': '--suit is off: grp not allowed',
  'hint.cannotBeat': '{combo} does not supersede',
  'hint.canPlay': 'ok: {combo}',
  'hint.canCut': 'override: {combo}',

  'holdem.idleTitle': 'waiting for owner to start',
  'holdem.idleHint': '{n}/{max} workers, {min} required',
  'holdem.handNo': 'job {n}',
  'holdem.blinds': 'base {sb}/{bb}',
  'holdem.pot': 'pool {n}',
  'holdem.mainPot': 'main {n}',
  'holdem.sidePot': 'split {i} {n}',
  'holdem.currentBet': 'level {n}',
  'holdem.showdownTitle': 'job {n} exited',
  'holdem.nextHandSoon': 'next job starts automatically',
  'holdem.fold': 'abort',
  'holdem.check': 'wait',
  'holdem.call': 'sync {n}',
  'holdem.raiseTo': 'push {n}',
  'holdem.allIn': 'max',
  'holdem.raiseAmountLabel': 'amount',
  'holdem.raiseToLabel': 'push to',
  'holdem.myCommitted': 'sent {n}',
  'holdem.strength': 'now: {hand}',
  'holdem.noCards': 'not scheduled this job',
  'holdemHint.notStarted': 'press ready, owner starts',
  'holdemHint.handOver': 'job exited — next starts automatically',
  'holdemHint.waitStart': 'waiting to start',
  'holdemHint.waitOthers': 'waiting on other workers',
  'holdemHint.notInHand': 'not scheduled this job',
  'holdemHint.canCheck': 'wait, or push {n}+',
  'holdemHint.mustCall': 'sync {n} to continue',
  'holdemHint.yourTurn': 'your turn',

  'monopoly.idleTitle': 'waiting for owner to mount',
  'monopoly.idleHint': '{n}/{max} users, {min} required',
  'monopoly.round': 'cycle {n}',
  'monopoly.phase': 'state: {phase}',
  'monopoly.dice': 'seek {a} + {b} = {n}',
  'monopoly.noDice': 'no seek yet',
  'monopoly.activePlayer': '{name} has the lock',
  'monopoly.cash': 'quota {n}',
  'monopoly.netWorth': 'usage {n}',
  'monopoly.parkingPot': 'reclaimed {n}',
  'monopoly.supply': 'free: {houses} inodes / {hotels} volumes',
  'monopoly.jailTag': 'held',
  'monopoly.jailTurns': 'held {n} cycles',
  'monopoly.jailCards': 'sudo tokens {n}',
  'monopoly.bankruptTag': 'oom',
  'monopoly.boardTitle': 'ls -l',
  'monopoly.here': 'cwd',
  'monopoly.mine': 'owned',
  'monopoly.ownerless': 'free',
  'monopoly.mortgagedTag': 'swapped out',
  'monopoly.price': '{n}u',
  'monopoly.rent': 'fee {n}',
  'monopoly.roll': 'seek',
  'monopoly.buy': 'alloc ({n}u)',
  'monopoly.decline': 'skip',
  'monopoly.bid': 'bid',
  'monopoly.bidAmountLabel': 'amount',
  'monopoly.passBid': 'drop out',
  'monopoly.auctionTitle': 'bidding: {tile}',
  'monopoly.auctionHigh': 'high {n} ({name})',
  'monopoly.auctionNoBid': 'no bids yet',
  'monopoly.payBail': 'pay ({n}u)',
  'monopoly.useJailCard': 'use sudo token',
  'monopoly.rollForDoubles': 'retry seek',
  'monopoly.build': 'extend',
  'monopoly.sellHouse': 'truncate',
  'monopoly.mortgage': 'swap out',
  'monopoly.unmortgage': 'swap in',
  'monopoly.endTurn': 'release lock',
  'monopoly.offerTrade': 'chown',
  'monopoly.cancelTrade': 'cancel',
  'monopoly.declareBankrupt': 'kill -9 self',
  'monopoly.debtTitle': 'owes {name} {n}u',
  'monopoly.debtToBank': 'owes system {n}u',
  'monopoly.debtShortfall': 'short {n}u, can free at most {max}u',
  'monopoly.tradeTitle': '{name} proposes a chown',
  'monopoly.tradeGive': 'gives',
  'monopoly.tradeWant': 'wants',
  'monopoly.tradeAccept': 'accept',
  'monopoly.tradeReject': 'reject',
  'monopoly.tradeTarget': 'target user',
  'monopoly.tradeCashLabel': 'quota delta',
  'monopoly.tradeNothing': '(no paths)',
  'monopoly.resultTitle': 'umount',
  'monopoly.resultReason': 'reason: {reason}',
  'monopoly.playAgain': 'mount again',
  'monopoly.waitHost': 'waiting for owner',
  'monopoly.myEstates': 'my paths ({n})',
  'monopoly.noEstates': 'no paths owned',
  'monopolyHint.notPlaying': 'press ready, owner mounts',
  'monopolyHint.waitOthers': 'waiting on other users',
  'monopolyHint.yourTurn': 'your turn',
  'monopolyHint.spectating': 'read-only',

  'snake.idleTitle': 'waiting for owner to start the watch',
  'snake.idleHint': '{n}/{max} workers, {min} required',
  'snake.startingIn': 'boot in {n}s',
  'snake.controlsHint': 'arrow keys to move — hit a wall or any buffer and you burn a retry',
  'snake.yourColor': 'your color',
  'snake.lives': 'retries {n}',
  'snake.respawning': 'restarting',
  'snake.livesUnlimited': 'retries ∞',
  'snake.optWraparound': 'wrap edges',
  'snake.optUnlimitedLives': 'infinite retries',
  'snake.optTimeLimit': 'infinite-retries timeout (s)',
  'snake.optHeadOnCollision': 'head-on collision',
  'snake.optHeadBounce': 'bounce back',
  'snake.optHeadClash': 'both crash',
  'snake.optCutting': 'branch truncate (dash key)',
  'snake.optLargeMap': 'large volume (4x)',
  'snake.optItems': 'enable modules',
  'snake.itemSpeed': 'nice -20',
  'snake.itemReverse': 'sed s/left/right/',
  'snake.itemShield': 'chmod 444',
  'snake.itemBullet': 'kill -9',
  'snake.itemMagnet': 'rsync --pull',
  'snake.useItemHint': 'space runs module slot 0',
  'snake.dashHint': 'x key: dash-truncate (0.5s windup, 15s cooldown)',
  'snake.dashCharging': 'winding up',
  'snake.dashActive': 'dashing',
  'snake.dashCooldown': 'cooling down',
  'snake.dashReady': 'ready',
  'snake.score': '{n} lines',
  'snake.bodyLen': 'len {n}',
  'snake.alive': 'running',
  'snake.dead': 'segfault',
  'snake.resultTitle': 'watch exited',
  'snake.playAgain': 'watch again',
  'snake.waitHost': 'waiting for owner',
  'downstairs.health': 'retries {n}',
  'downstairs.depth': 'depth {n}',
  'downstairs.eliminated': 'exit 1',

  'lobby.noDisguise': 'tty',
  'lobby.noDisguiseHint': 'renders a framebuffer — will not look like a shell',

  // 踩地雷
  'start.startMinesweeper': 'mount probe',
  'minesweeper.idleTitle': 'waiting to probe',
  'minesweeper.idleHint': '{n}/{max} users, {min} required',
  'minesweeper.score': 'ok {n}',
  'minesweeper.finalScore': 'total {n}',
  'minesweeper.remainingMines': 'mines remaining: {n}',
  'minesweeper.playAgain': 'probe again',
  'minesweeper.waitHost': 'waiting for owner',
  'minesweeperHint.notPlaying': 'press ready, owner mounts',
  'minesweeperHint.waitOthers': 'scanning memory...',
  'minesweeperHint.yourTurn': 'your turn to scan',
  'minesweeperHint.spectating': 'read-only',

  // 龍與地下城 (D&D)
  'start.startDnd': 'exec dungeon',
  'dnd.idleTitle': 'waiting to dungeon',
  'dnd.idleHint': '{n}/{max} users, {min} required',
  'dnd.hp': 'HP {hp}/{maxHp}',
  'dnd.alive': 'ALIVE',
  'dnd.dead': 'DEAD',
  'dnd.playAgain': 'exec again',
  'dnd.waitHost': 'waiting for owner',
  'dndHint.notPlaying': 'press ready, owner mounts',
  'dndHint.waitOthers': 'waiting on other adventurers',
  'dndHint.yourTurn': 'your turn to act',
  'dndHint.spectating': 'read-only',
  'dnd.logTitle': 'tail -f dungeon.log',
};

const ERRORS: Skin['errors'] = {
  BAD_SESSION: 'not attached',
  ALREADY_IN_ROOM: 'already attached to a job',
  NO_ROOM: 'no such job',
  IN_PROGRESS: 'already running — you can tail',
  ROOM_FULL: 'no free workers — you can tail',
  NOT_HOST: 'only the owner can run this',
  NOT_READY: 'not enough workers ready',
  WRONG_GAME: 'wrong mode for this command',
  BAD_ACTION: 'unknown command',
  GAME_NOT_RUNNING: 'nothing running',
  SPECTATOR: 'read-only — cannot push',
  NOT_YOUR_TURN: 'not your turn',
  NOT_IN_HAND: 'those items are not in your queue',
  INVALID_COMBO: 'invalid batch',
  CANNOT_BEAT: 'does not supersede',
  MUST_MATCH_COMBO: 'this round accepts one batch shape only',
  MUST_INCLUDE_OPENING: 'must include the first item',
  CANNOT_PASS_ON_LEAD: 'you hold the lead — cannot skip',
  ALREADY_FOLDED: 'already aborted',
  CANNOT_CHECK: 'cannot wait — level is open',
  CANNOT_CALL: 'nothing to sync',
  CANNOT_RAISE: 'cannot push',
  RAISE_TOO_SMALL: 'push too small',
  NOT_ENOUGH_CHIPS: 'quota exceeded',
  BAD_AMOUNT: 'bad amount',

  // 大富翁。漏一條的話 GameProvider.run 會退回伺服器的中文訊息，偽裝就破了
  WRONG_PHASE: 'not valid in this state',
  BANKRUPT: 'your process was killed',
  NOT_ENOUGH_CASH: 'quota exceeded',
  NOT_FOR_SALE: 'this path cannot be allocated',
  BAD_TILE: 'no such path',
  NOT_OWNER: 'you do not own this path',
  NOT_FULL_SET: 'you need the whole mount before extending',
  BUILD_UNEVEN: 'extend evenly — start with the smallest',
  HOUSE_LIMIT: 'already at volume size',
  NO_HOUSES: 'nothing to truncate here',
  HAS_HOUSES: 'truncate the rest of the mount first',
  MORTGAGED: 'already swapped out',
  NOT_MORTGAGED: 'not swapped out',
  MORTGAGED_IN_GROUP: 'a path in this mount is still swapped out',
  NO_HOUSE_SUPPLY: 'no free inodes left',
  NO_HOTEL_SUPPLY: 'no free volumes left',
  BID_TOO_LOW: 'bid must beat the current high',
  BID_TOO_HIGH: 'bid exceeds your quota',
  NOT_IN_JAIL: 'you are not held',
  NO_JAIL_CARD: 'no sudo token',
  TRADES_DISABLED: 'chown is disabled on this job',
  BAD_TRADE: 'invalid chown request',
  CAN_STILL_PAY: 'you can still pay — cannot kill yourself',
  INVALID_CELL: 'invalid cell coordinates',
  CELL_REVEALED: 'this block is already scanned',
  CELL_FLAGGED: 'block is flagged — unflag first',
  CANNOT_FLAG_REVEALED: 'cannot flag a scanned block',
  INVALID_CHORD: 'flag count mismatch — nothing to expand',
  CELL_OCCUPIED: 'cell already occupied',
  TARGET_OUT_OF_RANGE: 'target out of range',
  TARGET_NOT_FOUND: 'no such target',
  ALREADY_MOVED: 'already moved this turn — pick an action',
  SKILL_ON_COOLDOWN: 'still on cooldown',
  NOT_BOSS_TURN: 'not the root pass right now',
  MONSTER_NOT_FOUND: 'no such process',
  MONSTER_ALREADY_ACTED: 'process already ran this pass',
  MONSTER_ALREADY_MOVED: 'process already moved this pass — exec only',
  MONSTER_RESTRAINED: 'process pinned to its slot for a few passes — exec only',
  PLAYER_RESTRAINED: 'you are pinned to your slot for a few passes — exec only',
  TARGET_INVULNERABLE: 'target shielded by replicas — kill the replicas first',
};

/** 偽裝成終端機：等寬字、深色、牌變成短代號。 */
export const terminalSkin: Skin = {
  id: 'terminal',
  label: '終端機',
  docTitle: 'user@host: ~/work',
  favicon:
    'data:image/svg+xml,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="5" fill="#0d0f12"/><path d="M7 9l6 5-6 5" fill="none" stroke="#4ee08a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 21h9" stroke="#4ee08a" stroke-width="2.4" stroke-linecap="round"/></svg>',
    ),
  text: TEXT,
  combo: COMBO,
  gameType: { bigTwo: 'batch', holdem: 'stream', monopoly: 'volume', snake: 'watch', downstairs: 'descent', minesweeper: 'probe', dnd: 'dungeon' },
  bigTwoPreset: { taiwan: 'strict', classic: 'legacy', custom: 'custom' },
  bigTwoRule: {
    cuts: '--cut',
    dragon: '--full',
    flush: '--suit',
    matchFiveCardType: '--same-type',
    passLocksTrick: '--skip',
  },
  street: STREET,
  holdemCategory: CATEGORY,
  monopolyTile: TERMINAL_TILE,
  monopolyGroup: TERMINAL_GROUP,
  monopolyOption: TERMINAL_OPTION,
  monopolyCard: TERMINAL_CARD,
  monopolyPhase: TERMINAL_PHASE,
  monopolyEnd: TERMINAL_END,
  monopolyHouses: terminalHouses,
  errors: ERRORS,
  card: face,
  medal: (rank_) => (rank_ <= 3 ? '*' : '·'),
  describeHand: (hand) => describeCategory(hand.category, hand.tiebreak),
  action,
  formatLog,
  notice,
  Chrome: TerminalChrome,
  Boss: ShellBoss,
};
