import {
  HOLDEM_RANK_LABEL,
  RANK_LABEL,
  type Card,
  type LogEvent,
  type MonopolyEstateId,
  type SeatAction,
  type SystemNotice,
} from 'shared';
import { CodeBoss } from './chrome/BossScreens';
import { VSCodeChrome } from './chrome/VSCodeChrome';
import { SUIT_TONE, labelCards } from './casino';
import {
  VSCODE_CARD,
  VSCODE_END,
  VSCODE_GROUP,
  VSCODE_OPTION,
  VSCODE_PHASE,
  VSCODE_TILE,
  vscodeHouses,
} from './monopolyVocab';
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

const VSCODE_CASH = {
  salary: 'sprint budget',
  parking: 'reclaimed pool',
  card: 'backlog item',
  players: 'between members',
} as const;

const VSCODE_FREED = {
  bail: 'paid',
  card: 'force-push token',
  doubles: 'retry passed',
  served: 'timeout expired',
} as const;

function vscodeSide(tiles: readonly MonopolyEstateId[], cash: number): string {
  const parts: string[] = tiles.map((id) => VSCODE_TILE[id]);
  if (cash > 0) parts.push(`${cash} budget`);
  return parts.length > 0 ? parts.join(' + ') : 'nothing';
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
    case 'monopolyStart':
      return `workspace opened · ${event.players} members · budget ${event.startCash}`;
    case 'move':
      return `${event.player} stepped ${event.dice[0]}+${event.dice[1]} → ${VSCODE_TILE[event.tile]}`;
    case 'buy':
      return `${event.player} claimed ${VSCODE_TILE[event.tile]} for ${event.price}`;
    case 'rent':
      return `${event.player} paid ${event.owner} ${event.amount} for ${VSCODE_TILE[event.tile]}`;
    case 'tax':
      return `${event.player} charged ${event.amount} at ${VSCODE_TILE[event.tile]}`;
    case 'monopolyCash':
      return `${event.player} ${event.amount >= 0 ? '+' : '−'}${Math.abs(event.amount)} (${
        VSCODE_CASH[event.source]
      })`;
    case 'auctionStart':
      return `${VSCODE_TILE[event.tile]} is up for bidding`;
    case 'bid':
      return `${event.player} bid ${event.amount}`;
    case 'auctionEnd':
      return event.player
        ? `${event.player} won ${VSCODE_TILE[event.tile]} at ${event.amount}`
        : `${VSCODE_TILE[event.tile]} got no bids`;
    case 'build':
      return event.sold
        ? `${event.player} reverted ${VSCODE_TILE[event.tile]} to level ${event.houses}`
        : `${event.player} raised ${VSCODE_TILE[event.tile]} to level ${event.houses}`;
    case 'mortgage':
      return event.redeem
        ? `${event.player} restored ${VSCODE_TILE[event.tile]} for ${event.amount}`
        : `${event.player} archived ${VSCODE_TILE[event.tile]} for ${event.amount}`;
    case 'drawCard':
      return `${event.player} — ${VSCODE_CARD[event.card]}`;
    case 'jailed':
      return `${event.player} is blocked`;
    case 'freed':
      return `${event.player} unblocked (${VSCODE_FREED[event.how]})`;
    case 'trade':
      return `${event.from} ⇄ ${event.to}: ${vscodeSide(event.give, event.giveCash)} for ${vscodeSide(event.want, event.wantCash)}`;
    case 'bankrupt':
      return event.creditor
        ? `${event.player} ran out — everything transferred to ${event.creditor}`
        : `${event.player} ran out — everything released`;
    case 'monopolyOver':
      return `workspace closed (${VSCODE_END[event.reason]}): ${event.ranking
        .map((n, i) => `#${i + 1} ${n}`)
        .join(', ')}`;
    case 'timeoutMonopoly':
      return `${event.player} timed out during ${VSCODE_PHASE[event.phase]} — handled automatically`;
    case 'snakeStart':
      return `watch started · ${event.players} members`;
    case 'snakeRespawn':
      return `${event.player} crashed once — restarting`;
    case 'snakeDeath':
      return `${event.player} crashed`;
    case 'snakeMineEaten':
      return `${event.player} claimed their own trap — big bonus`;
    case 'snakeOver':
      return `watch stopped: ${event.ranking.map((n, i) => `#${i + 1} ${n}`).join(', ')}`;
    case 'minesweeperStart':
      return `debugger started · ${event.players} members`;
    case 'minesweeperReveal':
      return `${event.player} inspected (${event.r + 1}, ${event.c + 1}) — ${event.points > 0 ? 'clean (+1)' : 'exception (-1)'}`;
    case 'minesweeperFlag':
      return `${event.player} toggled breakpoint at (${event.r + 1}, ${event.c + 1}) — ${event.flagged ? 'enabled' : 'disabled'}`;
    case 'minesweeperOver':
      return `debugging finished: ${event.ranking.map((n, i) => `#${i + 1} ${n}`).join(', ')}`;
    case 'timeoutMinesweeper':
      return `${event.player} timed out — auto inspect dispatched`;
    case 'dndStart':
      return `dungeon instance started · ${event.players} party members`;
    case 'dndMove':
      return `${event.player} shifted position ${event.dir}`;
    case 'dndAttack':
      return event.damage < 0
        ? `[HEAL] ${event.player} executed recovery on ${event.target} (+${-event.damage} hp)`
        : `${event.player} executed attack on ${event.target} (Roll: ${event.roll}) — ${event.hit ? `HIT! (${event.damage} dmg)` : 'MISS'}`;
    case 'dndMonsterTurn':
      return `goblins turn executing...`;
    case 'dndOver':
      return `dungeon execution ${event.won ? 'SUCCESS' : 'FAILED'}`;
    case 'timeoutDnd':
      return `${event.player} execution timed out — auto action dispatched`;
    case 'dndLevelUp':
      return `[LEVEL] transitioned to dungeon floor ${event.level} (party healed by 50% max HP)`;
    case 'dndTrap':
      return `[TRAP] ${event.player} triggered a hidden trap and suffered ${event.damage} dmg`;
    case 'dndMessage':
      return event.message;
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
  'start.startMonopoly': 'Open workspace',
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
  'start.startSnake': 'Start watch',
  'start.startDownstairs': 'Start descent',
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

  'monopoly.idleTitle': 'Waiting for the owner to open the workspace',
  'monopoly.idleHint': '{n}/{max} members, {min} required',
  'monopoly.round': 'iteration {n}',
  'monopoly.phase': 'stage: {phase}',
  'monopoly.dice': 'step {a} + {b} = {n}',
  'monopoly.noDice': 'not dispatched yet',
  'monopoly.activePlayer': "{name}'s turn",
  'monopoly.cash': 'budget {n}',
  'monopoly.netWorth': 'score {n}',
  'monopoly.parkingPot': 'pool {n}',
  'monopoly.supply': 'available: {houses} fixes / {hotels} rewrites',
  'monopoly.jailTag': 'blocked',
  'monopoly.jailTurns': 'blocked for {n}',
  'monopoly.jailCards': '{n} tokens',
  'monopoly.bankruptTag': 'out',
  'monopoly.boardTitle': 'Explorer',
  'monopoly.here': 'you are here',
  'monopoly.mine': 'yours',
  'monopoly.ownerless': 'unclaimed',
  'monopoly.mortgagedTag': 'archived',
  'monopoly.price': '{n}',
  'monopoly.rent': 'fee {n}',
  'monopoly.roll': 'Dispatch',
  'monopoly.buy': 'Claim ({n})',
  'monopoly.decline': 'Skip',
  'monopoly.bid': 'Bid',
  'monopoly.bidAmountLabel': 'bid',
  'monopoly.passBid': 'Withdraw',
  'monopoly.auctionTitle': 'Bidding: {tile}',
  'monopoly.auctionHigh': 'leading {n} ({name})',
  'monopoly.auctionNoBid': 'no bids yet',
  'monopoly.payBail': 'Pay to unblock ({n})',
  'monopoly.useJailCard': 'Use force-push token',
  'monopoly.rollForDoubles': 'Retry',
  'monopoly.build': 'Raise level',
  'monopoly.sellHouse': 'Revert level',
  'monopoly.mortgage': 'Archive',
  'monopoly.unmortgage': 'Restore',
  'monopoly.endTurn': 'Hand off',
  'monopoly.offerTrade': 'Propose transfer',
  'monopoly.cancelTrade': 'Cancel',
  'monopoly.declareBankrupt': 'Give up',
  'monopoly.debtTitle': 'owes {name} {n}',
  'monopoly.debtToBank': 'owes {n}',
  'monopoly.debtShortfall': 'short {n}, can raise up to {max}',
  'monopoly.tradeTitle': '{name} proposes a transfer',
  'monopoly.tradeGive': 'offers',
  'monopoly.tradeWant': 'wants',
  'monopoly.tradeAccept': 'Accept',
  'monopoly.tradeReject': 'Decline',
  'monopoly.tradeTarget': 'member',
  'monopoly.tradeCashLabel': 'budget',
  'monopoly.tradeNothing': '(nothing)',
  'monopoly.resultTitle': 'Workspace closed',
  'monopoly.resultReason': 'reason: {reason}',
  'monopoly.playAgain': 'Open again',
  'monopoly.waitHost': 'Waiting for the owner',
  'monopoly.myEstates': 'My files ({n})',
  'monopoly.noEstates': 'Nothing claimed yet',
  'monopolyHint.notPlaying': 'Press Ready, then the owner starts',
  'monopolyHint.waitOthers': 'Waiting for other members',
  'monopolyHint.yourTurn': 'Your turn',
  'monopolyHint.spectating': 'Read-only',

  'snake.idleTitle': 'Waiting for the owner to start the watch',
  'snake.idleHint': '{n}/{max} members, {min} required',
  'snake.startingIn': 'watch starts in {n}s',
  'snake.controlsHint': 'Arrow keys to move — hitting a wall or any buffer costs a retry',
  'snake.yourColor': 'your color',
  'snake.lives': 'retries {n}',
  'snake.respawning': 'restarting',
  'snake.score': '{n} lines',
  'snake.alive': 'running',
  'snake.dead': 'crashed',
  'snake.resultTitle': 'Watch stopped',
  'snake.playAgain': 'Restart watch',
  'snake.waitHost': 'Waiting for the owner',
  'downstairs.health': 'retries {n}',
  'downstairs.depth': 'line {n}',
  'downstairs.eliminated': 'exited',

  'lobby.noDisguise': 'GUI',
  'lobby.noDisguiseHint': 'This task renders a graphical preview — it will not look like an editor.',

  // 踩地雷
  'start.startMinesweeper': 'Run Debugger',
  'minesweeper.idleTitle': 'Waiting to start debugging',
  'minesweeper.idleHint': '{n}/{max} members, {min} required',
  'minesweeper.score': 'fixed {n}',
  'minesweeper.finalScore': 'total {n}',
  'minesweeper.remainingMines': 'bugs remaining: {n}',
  'minesweeper.playAgain': 'Re-run pipeline',
  'minesweeper.waitHost': 'Waiting for pipeline restart',
  'minesweeperHint.notPlaying': 'Press Ready, then the owner starts',
  'minesweeperHint.waitOthers': 'Analyzing code...',
  'minesweeperHint.yourTurn': 'Your turn to inspect',
  'minesweeperHint.spectating': 'Read-only mode',

  // 龍與地下城
  'start.startDnd': 'Execute Dungeon',
  'dnd.idleTitle': 'Waiting for host to start dungeon',
  'dnd.idleHint': '{n}/{max} members, {min} required',
  'dnd.hp': 'HP {hp}/{maxHp}',
  'dnd.alive': 'ALIVE',
  'dnd.dead': 'DEAD',
  'dnd.playAgain': 'Re-run dungeon',
  'dnd.waitHost': 'Waiting for host to restart',
  'dndHint.notPlaying': 'Press Ready, then the owner starts',
  'dndHint.waitOthers': 'Waiting for other developers...',
  'dndHint.yourTurn': 'Your turn to execute actions',
  'dndHint.spectating': 'Read-only mode',
  'dnd.logTitle': 'OUTPUT — dungeon',
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
  // 大富翁。漏一條的話 GameProvider.run 會退回伺服器的中文訊息，偽裝就破了
  WRONG_PHASE: 'Not available at this stage',
  BANKRUPT: 'You are out of this run',
  NOT_ENOUGH_CASH: 'Not enough budget',
  NOT_FOR_SALE: 'This one cannot be claimed',
  BAD_TILE: 'Unknown file',
  NOT_OWNER: 'You do not own this file',
  NOT_FULL_SET: 'You need the whole directory first',
  BUILD_UNEVEN: 'Raise the lowest file in the directory first',
  HOUSE_LIMIT: 'Already at the top level',
  NO_HOUSES: 'Nothing to revert here',
  HAS_HOUSES: 'Revert the directory levels first',
  MORTGAGED: 'Already archived',
  NOT_MORTGAGED: 'Not archived',
  MORTGAGED_IN_GROUP: 'Something in this directory is archived',
  NO_HOUSE_SUPPLY: 'No fixes left',
  NO_HOTEL_SUPPLY: 'No rewrites left',
  BID_TOO_LOW: 'Bid must beat the current one',
  BID_TOO_HIGH: 'Bid exceeds your budget',
  NOT_IN_JAIL: 'You are not blocked',
  NO_JAIL_CARD: 'No force-push token',
  TRADES_DISABLED: 'Transfers are off in this run',
  BAD_TRADE: 'That transfer is not valid',
  CAN_STILL_PAY: 'You can still cover this',
  INVALID_CELL: 'Invalid block index',
  CELL_REVEALED: 'This block has already been scanned',
  CELL_FLAGGED: 'Breakmarked! Remove the breakpoint first',
  CANNOT_FLAG_REVEALED: 'Cannot place breakpoint on a scanned block',
  INVALID_CHORD: 'Breakpoint count does not match — cannot expand',
  CELL_OCCUPIED: 'That block is already taken',
  TARGET_OUT_OF_RANGE: 'Target is out of scope',
  TARGET_NOT_FOUND: 'No such target',
  ALREADY_MOVED: 'Already relocated this pass — finish with an action',
  SKILL_ON_COOLDOWN: 'Still on cooldown this pass',
  NOT_BOSS_TURN: 'Not the maintainer pass right now',
  MONSTER_NOT_FOUND: 'No such worker process',
  MONSTER_ALREADY_ACTED: 'That worker already ran this pass',
  MONSTER_ALREADY_MOVED: 'That worker already relocated this pass — it can only run a task',
  MONSTER_RESTRAINED: 'That worker is pinned to its slot for a few passes — it can still run tasks',
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
  gameType: { bigTwo: 'batch', holdem: 'stream', monopoly: 'workspace', snake: 'watch', downstairs: 'descent.ts', minesweeper: 'debug', dnd: 'dungeon' },
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
  monopolyTile: VSCODE_TILE,
  monopolyGroup: VSCODE_GROUP,
  monopolyOption: VSCODE_OPTION,
  monopolyCard: VSCODE_CARD,
  monopolyPhase: VSCODE_PHASE,
  monopolyEnd: VSCODE_END,
  monopolyHouses: vscodeHouses,
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
