import {
  HOLDEM_RANK_LABEL,
  RANK_LABEL,
  type Card,
  type LogEvent,
  type SeatAction,
  type SystemNotice,
} from 'shared';
import { CodeBoss } from './chrome/BossScreens';
import { VSCodeChrome } from './chrome/VSCodeChrome';
import { SUIT_TONE, labelCards } from './casino';
import type { TextTable } from './text';
import type { CardFace, Skin } from './types';

/**
 * 花色 → 副檔名。四種副檔名在編輯器裡本來就有四種顏色，
 * 玩家照樣一眼分得出花色，旁人看到的只是一排檔案。
 */
const SUIT_EXT = { S: '.ts', H: '.tsx', D: '.js', C: '.json' } as const;

/** 點數直接當檔名，J/Q/K/A 小寫後仍然好認。 */
const fileName = (card: Card) => RANK_LABEL[card.rank].toLowerCase();

function face(card: Card): CardFace {
  return {
    main: fileName(card),
    sub: SUIT_EXT[card.suit],
    tone: SUIT_TONE[card.suit],
    label: `${fileName(card)}${SUIT_EXT[card.suit]}`,
  };
}

const cards = (ids: string[]) => labelCards(ids, (card) => face(card).label);

const rank = (value: number | undefined) => HOLDEM_RANK_LABEL[value ?? 0] ?? '?';

const COMBO: Skin['combo'] = {
  single: 'scalar',
  pair: 'tuple2',
  triple: 'tuple3',
  straight: 'range',
  flush: 'union',
  fullHouse: 'compound',
  fourOfAKind: 'quad',
  straightFlush: 'rangeUnion',
  dragon: 'fullRange',
};

const CATEGORY: Skin['holdemCategory'] = {
  highCard: 'none',
  onePair: 'pair',
  twoPair: 'pair2',
  threeOfAKind: 'tuple3',
  straight: 'range',
  flush: 'union',
  fullHouse: 'compound',
  fourOfAKind: 'quad',
  straightFlush: 'rangeUnion',
};

const STREET: Skin['street'] = {
  preflop: 'init',
  flop: 'build',
  turn: 'test',
  river: 'lint',
  showdown: 'commit',
};

function describeCategory(category: keyof typeof CATEGORY, tiebreak: readonly number[]): string {
  const [first, second] = tiebreak;
  if (category === 'twoPair' || category === 'fullHouse') {
    return `${CATEGORY[category]}(${rank(first)},${rank(second)})`;
  }
  return `${CATEGORY[category]}(${rank(first)})`;
}

function action(a: SeatAction): string {
  const max = a.allIn ? ' max' : '';
  switch (a.kind) {
    case 'sb':
      return `base ${a.amount}`;
    case 'bb':
      return `base ${a.amount}`;
    case 'fold':
      return 'dropped';
    case 'check':
      return 'held';
    case 'call':
      return `matched ${a.amount}${max}`;
    case 'bet':
      return `staged ${a.to ?? a.amount}${max}`;
    case 'raise':
      return `bumped to ${a.to ?? a.amount}${max}`;
    case 'leave':
      return 'detached';
  }
}

function formatLog(event: LogEvent): string {
  switch (event.t) {
    case 'bigTwoStart':
      return `task started · ${event.players} members`;
    case 'lead':
      return `${event.player} owns the entry file`;
    case 'play':
      return `${event.player} committed ${COMBO[event.combo]} — ${cards(event.cards)}`;
    case 'pass':
      return `${event.player} skipped`;
    case 'finished':
      return `${event.player} finished — #${event.rank}`;
    case 'bigTwoOver':
      return `task complete: ${event.ranking.map((n, i) => `#${i + 1} ${n}`).join(', ')}`;
    case 'rebuy':
      return `${event.player} quota refilled to ${event.amount}`;
    case 'holdemStart':
      return `run #${event.handNo} started · base ${event.smallBlind}/${event.bigBlind}`;
    case 'button':
      return `${event.player} is HEAD`;
    case 'bet':
      return `${event.player} ${action(event.action)}`;
    case 'street':
      return `${STREET[event.street]}  ${cards(event.board)}`;
    case 'board':
      return `shared  ${cards(event.board)}`;
    case 'showdown':
      return `${event.player}: ${describeCategory(event.category, event.tiebreak)}${
        event.won > 0 ? ` +${event.won}` : ''
      }`;
    case 'uncontested':
      return `${event.player} +${event.won} (others dropped)`;
    case 'timeout':
      return `${event.player} timed out — auto ${
        event.auto === 'pass' ? 'skip' : event.auto === 'check' ? 'hold' : 'drop'
      }`;
    case 'timeoutPlay':
      return `${event.player} timed out — auto commit ${COMBO[event.combo]} ${cards(event.cards)}`;
  }
}

function notice(n: SystemNotice): string {
  switch (n.t) {
    case 'created':
      return `${n.player} created the session`;
    case 'joined':
      return `${n.player} joined as a member`;
    case 'spectating':
      return `${n.player} joined read-only`;
    case 'left':
      return `${n.player} left the session`;
    case 'disconnected':
      return `${n.player} disconnected`;
  }
}

const TEXT: TextTable = {
  'gate.title': 'Workspace',
  'gate.titleAccent': 'v2.4',
  'gate.subtitle': 'Sign in to sync settings and open shared sessions.',
  'gate.nicknamePlaceholder': 'Display name',
  'gate.submit': 'Continue',

  'toast.failed': 'Request failed',

  'lobby.nicknameLabel': 'User',
  'lobby.rename': 'Update',
  'lobby.connected': 'Connected',
  'lobby.connecting': 'Connecting…',
  'lobby.createTitle': 'New session',
  'lobby.roomNamePlaceholder': '{name} / session',
  'lobby.gameTypeLabel': 'Pipeline',
  'lobby.rulesLabel': 'Ruleset',
  'lobby.rulesOptionsLabel': 'Flags',
  'lobby.maxPlayersLabel': 'Members',
  'lobby.seatOption': '{n} members',
  'lobby.create': 'Create',
  'lobby.codeTitle': 'Open by ID',
  'lobby.codePlaceholder': 'e.g. K7QM',
  'lobby.join': 'Open',
  'lobby.listTitle': 'Sessions ({n})',
  'lobby.empty': 'No active sessions.',
  'lobby.host': 'owner {name}',
  'lobby.playerCount': '{n}/{max} members',
  'lobby.spectatorCount': '{n} watching',
  'lobby.started': 'Already running',
  'lobby.full': 'No free slots',
  'lobby.spectate': 'Watch',
  'lobby.status.waiting': 'idle',
  'lobby.status.playing': 'running',
  'lobby.status.finished': 'done',

  'room.code': 'ID #{id}',
  'room.spectating': 'read-only',
  'room.sitDown': 'Join as member',
  'room.toSpectator': 'Switch to read-only',
  'room.leave': 'Close session',
  'room.emptySeat': 'empty',
  'room.godView': 'All buffers',
  'room.turnTag': 'active',
  'room.spectators': 'Watching ({n})',
  'room.chatTitle': 'Comments',
  'room.turnPrefix': 'Assigned to',
  'room.turnMine': 'Assigned to you',

  'chat.lobbyTitle': 'Discussion',
  'chat.empty': 'No comments yet.',
  'chat.placeholder': 'Leave a comment…',
  'chat.send': 'Send',

  'seat.you': 'you',
  'seat.host': 'owner',
  'seat.offline': 'offline',
  'seat.button': 'HEAD',
  'seat.sb': 'lo',
  'seat.bb': 'hi',
  'seat.pass': 'skip',
  'seat.ready': 'ready',
  'seat.notReady': 'idle',
  'seat.rank': '{medal} #{n}',
  'seat.chips': '{n} pts',
  'seat.sitOut': 'inactive',
  'seat.allIn': 'MAX',
  'seat.bet': 'staged {n}',
  'seat.left': '(left)',

  'card.backTitle': '{n} files',

  'start.ready': 'Ready',
  'start.cancelReady': 'Unready',
  'start.startBigTwo': 'Run task',
  'start.startHoldem': 'Start run',
  'start.needPlayers': 'Needs {min}+ members, all ready',

  'bigTwo.idleTitle': 'Waiting for the owner to run the task',
  'bigTwo.idleHint': '{n}/{max} members, {min} required',
  'bigTwo.lastPlay': '{name} · {combo}',
  'bigTwo.freeLead': 'open — any change set',
  'bigTwo.mustIncludeOpening': ' · must include the entry file',
  'bigTwo.resultTitle': 'Task complete',
  'bigTwo.playAgain': 'Run again',
  'bigTwo.waitHost': 'Waiting for the owner',
  'bigTwo.play': 'Commit',
  'bigTwo.pass': 'Skip',
  'bigTwo.suggest': 'Suggest',
  'bigTwo.cannotPass': 'You hold the lead — cannot skip',
  'bigTwo.sortRank': 'Sort: by name',
  'bigTwo.sortSuit': 'Sort: by type',
  'bigTwo.suitOrder': 'priority',
  'bigTwo.handEmpty': 'No files left',
  'bigTwo.waitingDeal': 'Waiting for assignment',
  'hint.notPlaying': 'Press Ready, then the owner starts',
  'hint.waitOthers': 'Waiting for other members',
  'hint.selectToFollow': 'Select {n} files',
  'hint.selectCards': 'Select files to commit',
  'hint.invalidCombo': 'Not a valid change set',
  'hint.mustIncludeOpening': 'First commit must include the entry file',
  'hint.mustPlayN': 'Must select {n} files',
  'hint.mustMatchCombo': 'This round only accepts {combo}',
  'hint.noFlush': 'sameSuit is off in this run',
  'hint.cannotBeat': '{combo} does not supersede the last commit',
  'hint.canPlay': 'Ready: {combo}',
  'hint.canCut': 'Override: {combo}',

  'holdem.idleTitle': 'Waiting for the owner to start the run',
  'holdem.idleHint': '{n}/{max} members, {min} required',
  'holdem.handNo': 'run #{n}',
  'holdem.blinds': 'base {sb}/{bb}',
  'holdem.pot': 'budget {n}',
  'holdem.mainPot': 'main {n}',
  'holdem.sidePot': 'split {i} · {n}',
  'holdem.currentBet': 'current {n}',
  'holdem.showdownTitle': 'Run #{n} finished',
  'holdem.nextHandSoon': 'Next run starts automatically',
  'holdem.fold': 'Drop',
  'holdem.check': 'Hold',
  'holdem.call': 'Match {n}',
  'holdem.raiseTo': 'Bump to {n}',
  'holdem.allIn': 'Max',
  'holdem.raiseAmountLabel': 'amount',
  'holdem.raiseToLabel': 'bump to',
  'holdem.myCommitted': 'staged {n}',
  'holdem.strength': 'current: {hand}',
  'holdem.noCards': 'Not assigned this run',
  'holdemHint.notStarted': 'Press Ready, then the owner starts',
  'holdemHint.handOver': 'Run finished — next one starts automatically',
  'holdemHint.waitStart': 'Waiting to start',
  'holdemHint.waitOthers': 'Waiting for other members',
  'holdemHint.notInHand': 'You are not part of this run',
  'holdemHint.canCheck': 'You can hold, or bump to {n}+',
  'holdemHint.mustCall': 'Match {n} to stay in',
  'holdemHint.yourTurn': 'Your turn',
};

const ERRORS: Skin['errors'] = {
  BAD_SESSION: 'Not signed in',
  ALREADY_IN_ROOM: 'Already in a session',
  NO_ROOM: 'Session not found',
  IN_PROGRESS: 'Already running — you can watch',
  ROOM_FULL: 'No free slots — you can watch',
  NOT_HOST: 'Only the owner can start this',
  NOT_READY: 'Not enough members are ready',
  WRONG_GAME: 'Wrong pipeline for this action',
  BAD_ACTION: 'Unsupported action',
  GAME_NOT_RUNNING: 'Nothing is running',
  SPECTATOR: 'Read-only members cannot commit',
  NOT_YOUR_TURN: 'Not your turn',
  NOT_IN_HAND: 'You do not have those files',
  INVALID_COMBO: 'Not a valid change set',
  CANNOT_BEAT: 'Does not supersede the last commit',
  MUST_MATCH_COMBO: 'This round only accepts the same change set shape',
  MUST_INCLUDE_OPENING: 'Must include the entry file',
  CANNOT_PASS_ON_LEAD: 'You hold the lead — cannot skip',
  ALREADY_FOLDED: 'You already dropped',
  CANNOT_CHECK: 'Cannot hold — there is an open amount',
  CANNOT_CALL: 'Nothing to match',
  CANNOT_RAISE: 'Cannot bump',
  RAISE_TOO_SMALL: 'Bump is too small',
  NOT_ENOUGH_CHIPS: 'Not enough quota',
  BAD_AMOUNT: 'Invalid amount',
};

/** 偽裝成編輯器：牌變成檔案、出牌變成 commit、戰報變成輸出面板。 */
export const vscodeSkin: Skin = {
  id: 'vscode',
  label: 'VS Code',
  docTitle: 'workspace — Visual Studio Code',
  favicon:
    'data:image/svg+xml,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path fill="#3b9ede" d="M23.5 3 12 14.2 6.6 10 4 11.6l4.9 4.4L4 20.4 6.6 22 12 17.8 23.5 29 28 26.8V5.2L23.5 3Zm0 6.4v13.2L16.3 16l7.2-6.6Z"/></svg>',
    ),
  text: TEXT,
  combo: COMBO,
  gameType: { bigTwo: 'batch', holdem: 'stream' },
  bigTwoPreset: { taiwan: 'strict', classic: 'default', custom: 'custom' },
  bigTwoRule: {
    cuts: 'override',
    dragon: 'fullRange',
    flush: 'sameSuit',
    matchFiveCardType: 'sameType',
    passLocksTrick: 'skipUntilReset',
  },
  street: STREET,
  holdemCategory: CATEGORY,
  errors: ERRORS,
  card: face,
  medal: (rank_) => (rank_ <= 3 ? '★' : '·'),
  describeHand: (hand) => describeCategory(hand.category, hand.tiebreak),
  action,
  formatLog,
  notice,
  Chrome: VSCodeChrome,
  Boss: CodeBoss,
};
