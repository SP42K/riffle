import {
  HOLDEM_RANK_LABEL,
  RANK_LABEL,
  type Card,
  type LogEvent,
  type SeatAction,
  type SystemNotice,
} from 'shared';
import { SUIT_TONE, labelCards } from './casino';
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
  }
}

const TEXT: TextTable = {
  'gate.title': 'shell',
  'gate.titleAccent': '1.9',
  'gate.subtitle': 'Set a display name to attach to the job queue.',
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
  'bigTwo.handEmpty': 'queue empty',
  'bigTwo.waitingDeal': 'waiting for input',
  'hint.notPlaying': 'press ready, owner starts',
  'hint.waitOthers': 'waiting on other workers',
  'hint.selectToFollow': 'select {n} items',
  'hint.selectCards': 'select items to push',
  'hint.invalidCombo': 'invalid batch',
  'hint.mustIncludeOpening': 'first push must include the first item',
  'hint.mustPlayN': 'must select {n} items',
  'hint.cannotBeat': '{combo} does not supersede',
  'hint.canPlay': 'ok: {combo}',

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
  MUST_INCLUDE_OPENING: 'must include the first item',
  CANNOT_PASS_ON_LEAD: 'you hold the lead — cannot skip',
  ALREADY_FOLDED: 'already aborted',
  CANNOT_CHECK: 'cannot wait — level is open',
  CANNOT_CALL: 'nothing to sync',
  CANNOT_RAISE: 'cannot push',
  RAISE_TOO_SMALL: 'push too small',
  NOT_ENOUGH_CHIPS: 'quota exceeded',
  BAD_AMOUNT: 'bad amount',
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
  gameType: { bigTwo: 'batch', holdem: 'stream' },
  street: STREET,
  holdemCategory: CATEGORY,
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
