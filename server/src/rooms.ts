import {
  BIG_TWO_RULE_KEYS,
  CHAT_HISTORY,
  DEFAULT_BIG_TWO_RULES,
  DEFAULT_MONOPOLY_OPTIONS,
  DEFAULT_SNAKE_OPTIONS,
  GAME_TYPES,
  HOLDEM_START_CHIPS,
  LOG_HISTORY,
  MONOPOLY_ESTATE_IDS,
  MONOPOLY_OPTION_KEYS,
  MONOPOLY_OPTION_SPEC,
  SEAT_LIMITS,
  SNAKE_OPTION_KEYS,
  SNAKE_TIME_LIMIT_MAX_SEC,
  SNAKE_TIME_LIMIT_MIN_SEC,
  liquidValueOf,
  netWorthOf,
  type BigTwoGameView,
  type BigTwoRuleKey,
  type BigTwoRules,
  type BigTwoSeatInfo,
  type ChatMessage,
  type Card,
  type GameType,
  type GameView,
  type HoldemGameView,
  type HoldemSeatInfo,
  type JoinMode,
  type LogEvent,
  type MonopolyEstateView,
  type MonopolyGameView,
  type MonopolyOptionKey,
  type MonopolyOptions,
  type MonopolySeatInfo,
  type PlayerId,
  type RoomStatus,
  type RoomSummary,
  type RoomView,
  type SeatView,
  type SnakeGameView,
  type SnakeOptions,
  type SnakeSeatInfo,
  type SystemNotice,
} from 'shared';
import { seatOfPlayer, type GameState, type Seats } from './gameEngine.js';
import { actionsFor, type HoldemState } from './holdemEngine.js';
import {
  actionsForMonopoly,
  monopolyCashOf,
  monopolyPositionOf,
  type MonopolyEvent,
  type MonopolyState,
} from './monopolyEngine.js';
import type { SnakeEvent, SnakeState } from './snakeEngine.js';
import { assertNeverGame, type TurnBased } from './turnBased.js';

export interface Member {
  playerId: PlayerId;
  nickname: string;
  socketId: string | null;
  connected: boolean;
  /** 斷線寬限計時器，重新連上時要清掉。 */
  graceTimer: NodeJS.Timeout | null;
}

export interface PlayerMember extends Member {
  ready: boolean;
}

/** 依玩法分派的牌局。四種 state 都滿足 TurnBased，計時與狀態判斷不必分支。 */
export type RoomGame =
  | { type: 'bigTwo'; state: GameState }
  | { type: 'holdem'; state: HoldemState }
  | { type: 'monopoly'; state: MonopolyState }
  | { type: 'snake'; state: SnakeState };

export interface Room {
  id: string;
  name: string;
  gameType: GameType;
  /** 大老二的規則開關。建房時決定，其他玩法用不到但一律有值。 */
  bigTwoRules: BigTwoRules;
  /** 大富翁的房間選項。建房時決定，其他玩法用不到但一律有值。 */
  monopolyOptions: MonopolyOptions;
  /** 貪吃蛇的規則開關。建房時決定，其他玩法用不到但一律有值。 */
  snakeOptions: SnakeOptions;
  hostId: PlayerId;
  maxPlayers: number;
  seats: Seats;
  players: Map<PlayerId, PlayerMember>;
  spectators: Map<PlayerId, Member>;
  chat: ChatMessage[];
  log: LogEvent[];
  game: RoomGame | null;
  /**
   * 德州撲克的房內籌碼表。房間活著就一直累積，離開再回來也保留，
   * 所以不會有「輸光就退出重進洗籌碼」這種事。
   */
  chips: Map<PlayerId, number>;
  /** 德州撲克的莊家鈕位置。 */
  buttonSeat: number;
  turnTimer: NodeJS.Timeout | null;
  /** 德州撲克：攤牌後自動發下一手的計時器，跟 turnTimer 分開才不會被清掉。 */
  handTimer: NodeJS.Timeout | null;
  /** 貪吃蛇：即時 tick 迴圈，跟回合制的 turnTimer 是平行的兩套機制，互不相干。 */
  tickTimer: NodeJS.Timeout | null;
}

/** 取出玩法無關的回合資訊。 */
export function turnStateOf(room: Room): TurnBased | null {
  return room.game?.state ?? null;
}

// ---------------------------------------------------------------------------
// 建立與成員進出
// ---------------------------------------------------------------------------

const ROOM_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉容易看錯的 I/O/0/1

export function generateRoomId(taken: (id: string) => boolean): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    let id = '';
    for (let i = 0; i < 4; i++) {
      id += ROOM_ID_ALPHABET[Math.floor(Math.random() * ROOM_ID_ALPHABET.length)];
    }
    if (!taken(id)) return id;
  }
  return `R${Date.now().toString(36).toUpperCase()}`;
}

export function normalizeGameType(value: unknown): GameType {
  // 照 GAME_TYPES 查，新增玩法時這裡不必再動 —— 寫死成三元的話新玩法會被默默吃成大老二
  return GAME_TYPES.find((type) => type === value) ?? 'bigTwo';
}

/** 逐鍵消毒：只收布林值，缺的或來路不明的一律吃預設（台灣慣例）。 */
export function normalizeBigTwoRules(value: unknown): BigTwoRules {
  const input = (value ?? {}) as Partial<Record<BigTwoRuleKey, unknown>>;
  const rules = {} as BigTwoRules;
  for (const key of BIG_TWO_RULE_KEYS) {
    rules[key] = typeof input[key] === 'boolean' ? input[key] : DEFAULT_BIG_TWO_RULES[key];
  }
  return rules;
}

/**
 * 逐鍵消毒，型別與範圍照 MONOPOLY_OPTION_SPEC 走。
 * 多一條大老二沒有的規則：三個結算條件全關的話強制補上破產淘汰，
 * 否則這局永遠結束不了。
 */
export function normalizeMonopolyOptions(value: unknown): MonopolyOptions {
  const input = (value ?? {}) as Partial<Record<MonopolyOptionKey, unknown>>;
  // 選項有布林也有數字，逐鍵寫回聯集型別會被 TS 擋，所以先組成草稿再一次收斂
  const draft: Record<string, boolean | number> = {};

  for (const key of MONOPOLY_OPTION_KEYS) {
    const spec = MONOPOLY_OPTION_SPEC[key];
    const raw = input[key];
    if (spec.kind === 'flag') {
      draft[key] = typeof raw === 'boolean' ? raw : spec.default;
    } else {
      const n = Math.floor(Number(raw));
      draft[key] = Number.isFinite(n) ? Math.min(spec.max, Math.max(spec.min, n)) : spec.default;
    }
  }

  const options = { ...DEFAULT_MONOPOLY_OPTIONS, ...draft } as MonopolyOptions;
  if (!options.lastStanding && options.roundLimit <= 0 && options.targetNetWorth <= 0) {
    options.lastStanding = true;
  }
  return options;
}

/**
 * 逐鍵消毒：布林開關照布林收，headOnCollision 只認 'bounce' / 'clash'，
 * unlimitedLivesTimeLimitSec 收數字並夾在合理範圍內，其餘吃預設。
 */
export function normalizeSnakeOptions(value: unknown): SnakeOptions {
  const input = (value ?? {}) as Partial<Record<keyof SnakeOptions, unknown>>;
  const options = { ...DEFAULT_SNAKE_OPTIONS };
  for (const key of SNAKE_OPTION_KEYS) {
    if (key === 'headOnCollision') {
      const raw = input[key];
      options.headOnCollision = raw === 'bounce' || raw === 'clash' ? raw : DEFAULT_SNAKE_OPTIONS.headOnCollision;
    } else if (key === 'unlimitedLivesTimeLimitSec') {
      const n = Math.floor(Number(input[key]));
      options.unlimitedLivesTimeLimitSec = Number.isFinite(n)
        ? Math.min(SNAKE_TIME_LIMIT_MAX_SEC, Math.max(SNAKE_TIME_LIMIT_MIN_SEC, n))
        : DEFAULT_SNAKE_OPTIONS.unlimitedLivesTimeLimitSec;
    } else {
      const raw = input[key];
      options[key] = typeof raw === 'boolean' ? raw : DEFAULT_SNAKE_OPTIONS[key];
    }
  }
  return options;
}

export function clampMaxPlayers(value: unknown, gameType: GameType): number {
  const limits = SEAT_LIMITS[gameType];
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return limits.max;
  return Math.min(limits.max, Math.max(limits.min, n));
}

export interface CreateRoomInput {
  id: string;
  name: string;
  gameType: GameType;
  maxPlayers: number;
  bigTwoRules: BigTwoRules;
  monopolyOptions: MonopolyOptions;
  snakeOptions: SnakeOptions;
  host: Member;
}

export function createRoom(input: CreateRoomInput): Room {
  const { id, name, gameType, maxPlayers, bigTwoRules, monopolyOptions, snakeOptions, host } = input;
  const room: Room = {
    id,
    name,
    gameType,
    bigTwoRules,
    monopolyOptions,
    snakeOptions,
    hostId: host.playerId,
    maxPlayers,
    seats: Array.from({ length: maxPlayers }, () => null),
    players: new Map(),
    spectators: new Map(),
    chat: [],
    log: [],
    game: null,
    chips: new Map(),
    buttonSeat: -1, // 還沒發過牌；第一手會往後推一位，也就是從座位 0 開始坐莊
    turnTimer: null,
    handTimer: null,
    tickTimer: null,
  };
  seatPlayer(room, host);
  return room;
}

/** 讓成員入座，回傳座位編號；沒有空位回 null。 */
export function seatPlayer(room: Room, member: Member): number | null {
  const seat = room.seats.indexOf(null);
  if (seat === -1) return null;
  room.seats[seat] = member.playerId;
  room.players.set(member.playerId, { ...member, ready: false });
  // 第一次入座才發籌碼；回鍋的人接回原本的堆疊
  if (room.gameType === 'holdem' && !room.chips.has(member.playerId)) {
    room.chips.set(member.playerId, HOLDEM_START_CHIPS);
  }
  return seat;
}

export function addSpectator(room: Room, member: Member): void {
  room.spectators.set(member.playerId, member);
}

/**
 * 把成員從房間移除。
 * 遊戲進行中的玩家會空出座位，但手牌留著 —— 引擎會把空位當成不存在的座位跳過。
 * 籌碼刻意不刪，這樣改觀戰或重新入座都接得回來。
 */
export function removeMember(room: Room, playerId: PlayerId): void {
  const seat = room.seats.indexOf(playerId);
  if (seat !== -1) room.seats[seat] = null;
  room.players.delete(playerId);
  room.spectators.delete(playerId);

  if (room.hostId === playerId) {
    const nextHost = room.seats.find((id): id is PlayerId => id !== null);
    if (nextHost) room.hostId = nextHost;
  }
}

export function memberOf(room: Room, playerId: PlayerId): Member | undefined {
  return room.players.get(playerId) ?? room.spectators.get(playerId);
}

export function modeOf(room: Room, playerId: PlayerId): JoinMode | null {
  if (room.players.has(playerId)) return 'play';
  if (room.spectators.has(playerId)) return 'spectate';
  return null;
}

export function isEmpty(room: Room): boolean {
  return room.players.size === 0 && room.spectators.size === 0;
}

export function seatedPlayers(room: Room): PlayerMember[] {
  return room.seats.flatMap((id) => {
    const player = id ? room.players.get(id) : undefined;
    return player ? [player] : [];
  });
}

/** 開得了新局的條件：人數夠、而且除了房主以外都按了準備。 */
export function canStart(room: Room): boolean {
  const players = seatedPlayers(room);
  if (players.length < SEAT_LIMITS[room.gameType].min) return false;
  return players.every((p) => p.ready || p.playerId === room.hostId);
}

/** 德州撲克：把籌碼歸零的人補回起始籌碼，回傳補了哪些人。 */
export function refillChips(room: Room): PlayerId[] {
  const refilled: PlayerId[] = [];
  for (const playerId of room.seats) {
    if (!playerId) continue;
    if ((room.chips.get(playerId) ?? 0) > 0) continue;
    room.chips.set(playerId, HOLDEM_START_CHIPS);
    refilled.push(playerId);
  }
  return refilled;
}

/** 德州撲克：還有籌碼、開得了下一手的玩家數。 */
export function fundedCount(room: Room): number {
  return room.seats.filter((id) => id !== null && (room.chips.get(id) ?? 0) > 0).length;
}

// ---------------------------------------------------------------------------
// 聊天與戰報
// ---------------------------------------------------------------------------

let messageSeq = 0;

export function makeChatMessage(
  nickname: string,
  text: string,
  playerId: PlayerId | null,
): ChatMessage {
  return { id: `m${++messageSeq}`, playerId, nickname, text, at: Date.now() };
}

export function makeSystemMessage(notice: SystemNotice): ChatMessage {
  return {
    id: `m${++messageSeq}`,
    playerId: null,
    nickname: 'system',
    // text 只是給沒認得這個事件的前端當後備，正常情況下前端會照外觀自己組句子
    text: notice.player,
    at: Date.now(),
    system: true,
    notice,
  };
}

export function pushChat(history: ChatMessage[], message: ChatMessage): void {
  history.push(message);
  if (history.length > CHAT_HISTORY) history.splice(0, history.length - CHAT_HISTORY);
}

export function pushLog(room: Room, event: LogEvent): void {
  room.log.push(event);
  if (room.log.length > LOG_HISTORY) room.log.splice(0, room.log.length - LOG_HISTORY);
}

export function nicknameOf(room: Room, playerId: PlayerId): string {
  return memberOf(room, playerId)?.nickname ?? '(已離開)';
}

/**
 * 大富翁引擎事件 → 戰報。
 * 這一層存在的理由是「一個動作會生出好幾行戰報」（擲骰 → 移動 → 付租 → 破產），
 * 另外兩種玩法在 handler 裡直接組一兩行就夠了。
 */
export function monopolyLogOf(room: Room, event: MonopolyEvent): LogEvent {
  const who = (playerId: PlayerId) => nicknameOf(room, playerId);
  switch (event.t) {
    case 'move':
      return { t: 'move', player: who(event.player), dice: event.dice, tile: event.tile };
    case 'buy':
      return { t: 'buy', player: who(event.player), tile: event.tile, price: event.price };
    case 'rent':
      return {
        t: 'rent',
        player: who(event.player),
        owner: who(event.owner),
        tile: event.tile,
        amount: event.amount,
      };
    case 'tax':
      return { t: 'tax', player: who(event.player), tile: event.tile, amount: event.amount };
    case 'cash':
      return {
        t: 'monopolyCash',
        player: who(event.player),
        amount: event.amount,
        source: event.source,
      };
    case 'auctionStart':
      return { t: 'auctionStart', tile: event.tile };
    case 'bid':
      return { t: 'bid', player: who(event.player), amount: event.amount };
    case 'auctionEnd':
      return {
        t: 'auctionEnd',
        player: event.player ? who(event.player) : null,
        tile: event.tile,
        amount: event.amount,
      };
    case 'build':
      return {
        t: 'build',
        player: who(event.player),
        tile: event.tile,
        houses: event.houses,
        sold: event.sold,
      };
    case 'mortgage':
      return {
        t: 'mortgage',
        player: who(event.player),
        tile: event.tile,
        amount: event.amount,
        redeem: event.redeem,
      };
    case 'drawCard':
      return { t: 'drawCard', player: who(event.player), card: event.card };
    case 'jailed':
      return { t: 'jailed', player: who(event.player) };
    case 'freed':
      return { t: 'freed', player: who(event.player), how: event.how };
    case 'trade':
      return {
        t: 'trade',
        from: who(event.from),
        to: who(event.to),
        give: event.give,
        giveCash: event.giveCash,
        want: event.want,
        wantCash: event.wantCash,
      };
    case 'bankrupt':
      return {
        t: 'bankrupt',
        player: who(event.player),
        creditor: event.creditor ? who(event.creditor) : null,
      };
    case 'over':
      return { t: 'monopolyOver', reason: event.reason, ranking: event.ranking.map(who) };
  }
}

/** 貪吃蛇引擎事件 → 戰報。跟大富翁那份是同一個道理，只是事件種類少很多。 */
export function snakeLogOf(room: Room, event: SnakeEvent): LogEvent {
  const who = (playerId: PlayerId) => nicknameOf(room, playerId);
  switch (event.t) {
    case 'respawn':
      return { t: 'snakeRespawn', player: who(event.player) };
    case 'death':
      return { t: 'snakeDeath', player: who(event.player) };
    case 'mine':
      return { t: 'snakeMineEaten', player: who(event.player) };
    case 'food':
      return { t: 'snakeFoodEaten', player: who(event.player) };
    case 'cut':
      return { t: 'snakeCut', attacker: who(event.attacker), victim: who(event.victim) };
    case 'item':
      return { t: 'snakeItemUsed', player: who(event.player), item: event.item };
    case 'dash':
      return { t: 'snakeDashCharging', player: who(event.player) };
    case 'over':
      return { t: 'snakeOver', ranking: event.ranking.map(who) };
  }
}

// ---------------------------------------------------------------------------
// 快照
// ---------------------------------------------------------------------------

export function statusOf(room: Room): RoomStatus {
  if (!room.game) return 'waiting';
  return room.game.state.over ? 'finished' : 'playing';
}

export function buildSummary(room: Room): RoomSummary {
  return {
    id: room.id,
    name: room.name,
    gameType: room.gameType,
    bigTwoRules: room.gameType === 'bigTwo' ? room.bigTwoRules : null,
    monopolyOptions: room.gameType === 'monopoly' ? room.monopolyOptions : null,
    snakeOptions: room.gameType === 'snake' ? room.snakeOptions : null,
    hostNickname: nicknameOf(room, room.hostId),
    playerCount: room.players.size,
    maxPlayers: room.maxPlayers,
    spectatorCount: room.spectators.size,
    status: statusOf(room),
  };
}

function buildSeats(room: Room): SeatView[] {
  return room.seats.flatMap((playerId, seat) => {
    if (!playerId) return [];
    const player = room.players.get(playerId);
    if (!player) return [];
    return [
      {
        seat,
        playerId,
        nickname: player.nickname,
        isHost: playerId === room.hostId,
        ready: player.ready,
        connected: player.connected,
      } satisfies SeatView,
    ];
  });
}

function buildBigTwoGameView(room: Room, game: GameState): BigTwoGameView {
  const seats: Record<number, BigTwoSeatInfo> = {};
  for (const [seat, playerId] of room.seats.entries()) {
    if (!playerId || !room.players.has(playerId)) continue;
    const rankIndex = game.finished.indexOf(playerId);
    seats[seat] = {
      handCount: game.hands.get(playerId)?.length ?? 0,
      passed: game.passedSeats.has(seat),
      rank: rankIndex === -1 ? null : rankIndex + 1,
    };
  }

  return {
    type: 'bigTwo',
    turnPlayerId: game.over ? null : (room.seats[game.turnSeat] ?? null),
    turnDeadline: game.turnDeadline,
    over: game.over,
    lastPlay: game.lastPlay
      ? {
          playerId: game.lastPlay.playerId,
          nickname: nicknameOf(room, game.lastPlay.playerId),
          combo: game.lastPlay.combo,
        }
      : null,
    freeLead: game.lastPlay === null,
    openingCardId: game.openingCardId,
    ranking: game.finished.slice(),
    seats,
  };
}

function buildHoldemGameView(room: Room, game: HoldemState, viewerId: PlayerId): HoldemGameView {
  const seats: Record<number, HoldemSeatInfo> = {};
  for (const [seat, playerId] of room.seats.entries()) {
    if (!playerId || !room.players.has(playerId)) continue;
    seats[seat] = {
      committed: game.committed.get(playerId) ?? 0,
      totalCommitted: game.totalCommitted.get(playerId) ?? 0,
      folded: game.folded.has(playerId),
      allIn: game.allIn.has(playerId),
      // 0 表示這一手沒發到牌（籌碼歸零或中途入座），前端據此顯示「坐出」
      holeCount: game.hole.get(playerId)?.length ?? 0,
      isButton: seat === game.buttonSeat,
      blind: seat === game.smallBlindSeat ? 'sb' : seat === game.bigBlindSeat ? 'bb' : null,
      lastAction: game.lastAction.get(playerId) ?? null,
    };
  }

  return {
    type: 'holdem',
    turnPlayerId: game.over ? null : (room.seats[game.turnSeat] ?? null),
    turnDeadline: game.turnDeadline,
    over: game.over,
    handNo: game.handNo,
    street: game.street,
    board: game.board.slice(),
    pots: game.pots.map((pot) => ({ amount: pot.amount, eligible: pot.eligible.slice() })),
    totalPot: game.pots.reduce((sum, pot) => sum + pot.amount, 0),
    currentBet: game.currentBet,
    minRaise: game.minRaise,
    smallBlind: game.smallBlind,
    bigBlind: game.bigBlind,
    seats,
    showdown:
      game.showdown?.map((entry) => ({
        playerId: entry.playerId,
        nickname: nicknameOf(room, entry.playerId),
        hole: entry.hole?.slice() ?? null,
        hand: entry.hand,
        won: entry.won,
      })) ?? null,
    myActions: room.players.has(viewerId) ? actionsFor(room.seats, game, viewerId) : null,
  };
}

function buildMonopolyGameView(
  room: Room,
  game: MonopolyState,
  viewerId: PlayerId,
): MonopolyGameView {
  const seats: Record<number, MonopolySeatInfo> = {};
  for (const [seat, playerId] of room.seats.entries()) {
    if (!playerId || !room.players.has(playerId)) continue;
    const cash = monopolyCashOf(game, playerId);
    seats[seat] = {
      cash,
      position: monopolyPositionOf(game, playerId),
      inJail: game.inJail.has(playerId),
      jailTurns: game.jailTurns.get(playerId) ?? 0,
      jailCards: game.jailCards.get(playerId) ?? 0,
      bankrupt: game.bankrupt.has(playerId),
      netWorth: netWorthOf(cash, game.estates, playerId),
    };
  }

  const estates: MonopolyEstateView[] = MONOPOLY_ESTATE_IDS.map((tile) => ({
    tile,
    owner: game.estates[tile].owner,
    houses: game.estates[tile].houses,
    mortgaged: game.estates[tile].mortgaged,
  }));

  const debtor = game.debt ? (room.seats[game.debt.debtorSeat] ?? null) : null;

  return {
    type: 'monopoly',
    turnPlayerId: game.over ? null : (room.seats[game.turnSeat] ?? null),
    turnDeadline: game.turnDeadline,
    over: game.over,
    phase: game.phase,
    round: game.round,
    activePlayerId: game.over ? null : (room.seats[game.activeSeat] ?? null),
    dice: game.dice ? [game.dice[0], game.dice[1]] : null,
    parkingPot: game.parkingPot,
    houseSupply: game.houseSupply,
    hotelSupply: game.hotelSupply,
    seats,
    estates,
    auction: game.auction
      ? {
          tile: game.auction.tile,
          highBid: game.auction.highBid,
          highBidderId: game.auction.highBidder,
          bidderId: room.seats[game.auction.bidderSeat] ?? null,
        }
      : null,
    trade: game.trade
      ? {
          fromId: room.seats[game.trade.fromSeat] ?? '',
          toId: room.seats[game.trade.toSeat] ?? '',
          give: game.trade.give.slice(),
          giveCash: game.trade.giveCash,
          want: game.trade.want.slice(),
          wantCash: game.trade.wantCash,
        }
      : null,
    debt:
      game.debt && debtor
        ? {
            debtorId: debtor,
            creditorId: game.debt.creditor,
            amount: game.debt.amount,
            shortfall: Math.max(0, game.debt.amount - monopolyCashOf(game, debtor)),
            canRaise: liquidValueOf(game.estates, debtor),
          }
        : null,
    result: game.result
      ? { reason: game.result.reason, ranking: game.result.ranking.slice() }
      : null,
    myActions: room.players.has(viewerId)
      ? actionsForMonopoly(room.seats, game, viewerId)
      : null,
  };
}

function buildSnakeGameView(game: SnakeState): SnakeGameView {
  const now = Date.now();
  const seats: Record<number, SnakeSeatInfo> = {};
  for (const snake of game.snakes.values()) {
    seats[snake.seat] = {
      body: snake.body.map((cell) => ({ ...cell })),
      alive: snake.lives > 0,
      respawning: snake.respawnAt !== null,
      lives: snake.lives,
      score: snake.score,
      dir: snake.dir,
      inventory: snake.inventory.map((slot) => ({ ...slot })),
      speedUntil: snake.speedUntil,
      shieldUntil: snake.shieldUntil,
      reversedUntil: snake.reversedUntil,
      magnetUntil: snake.magnetUntil,
      dashChargeUntil: snake.dashChargeUntil,
      dashActive: snake.dashStepsRemaining > 0,
      dashCooldownUntil: snake.dashCooldownUntil,
    };
  }

  return {
    type: 'snake',
    // 貪吃蛇沒有「輪到誰」，turnPlayerId 恆為惰性值；turnDeadline 借來扛開局倒數，
    // 倒數結束後歸零 —— 前端沿用既有的 useCountdown，不必為它另開一條欄位
    turnPlayerId: null,
    turnDeadline: !game.over && now < game.startAt ? game.startAt : 0,
    over: game.over,
    width: game.width,
    height: game.height,
    food: game.food.map((cell) => ({ ...cell })),
    corpseFood: game.corpseFood.map((cell) => ({ ...cell })),
    mine: game.mine
      ? { seat: game.mine.seat, cell: { ...game.mine.cell }, warning: now < game.mine.telegraphUntil }
      : null,
    items: game.items.map((item) => ({ cell: { ...item.cell }, kind: item.kind })),
    bullets: game.bullets.map((b) => ({ cell: { ...b.cell }, dir: b.dir })),
    pendingEffects: game.pendingEffects.map((p) => ({ ...p })),
    seats,
    ranking: game.ranking.slice(),
  };
}

function buildGameView(room: Room, viewerId: PlayerId): GameView | null {
  const game = room.game;
  if (!game) return null;
  switch (game.type) {
    case 'bigTwo':
      return buildBigTwoGameView(room, game.state);
    case 'holdem':
      return buildHoldemGameView(room, game.state, viewerId);
    case 'monopoly':
      return buildMonopolyGameView(room, game.state, viewerId);
    case 'snake':
      return buildSnakeGameView(game.state);
    default:
      return assertNeverGame(game);
  }
}

/**
 * 這位玩家自己看得到的牌：大老二是手牌，德州撲克是底牌。
 * 大富翁沒有暗牌，回 null —— 呼叫端據此完全不建「上帝視角」面板。
 */
function handOf(game: RoomGame, playerId: PlayerId): Card[] | null {
  switch (game.type) {
    case 'bigTwo':
      return game.state.hands.get(playerId)?.slice() ?? [];
    case 'holdem':
      return game.state.hole.get(playerId)?.slice() ?? [];
    case 'monopoly':
      return null;
    case 'snake':
      return null;
    default:
      return assertNeverGame(game);
  }
}

/**
 * 為單一觀看者產生房間快照。
 * 玩家只拿得到自己的牌；觀戰者是上帝視角，拿得到所有人的牌。
 */
export function buildRoomView(room: Room, viewerId: PlayerId): RoomView | null {
  const mode = modeOf(room, viewerId);
  if (!mode) return null;

  const game = room.game;
  let allHands: Record<PlayerId, Card[]> | null = null;
  if (mode === 'spectate' && game) {
    const table: Record<PlayerId, Card[]> = {};
    let any = false;
    for (const playerId of room.seats) {
      if (!playerId || !room.players.has(playerId)) continue;
      const cards = handOf(game, playerId);
      if (!cards) continue; // 這個玩法沒有暗牌
      table[playerId] = cards;
      any = true;
    }
    // 全空就維持 null，觀戰面板才不會長出一個沒有內容的「上帝視角」標題
    if (any) allHands = table;
  }

  let chips: Record<PlayerId, number> | null = null;
  if (room.gameType === 'holdem') {
    chips = {};
    for (const playerId of room.seats) {
      if (playerId && room.players.has(playerId)) chips[playerId] = room.chips.get(playerId) ?? 0;
    }
  }

  return {
    id: room.id,
    name: room.name,
    gameType: room.gameType,
    bigTwoRules: room.gameType === 'bigTwo' ? room.bigTwoRules : null,
    monopolyOptions: room.gameType === 'monopoly' ? room.monopolyOptions : null,
    snakeOptions: room.gameType === 'snake' ? room.snakeOptions : null,
    hostId: room.hostId,
    maxPlayers: room.maxPlayers,
    status: statusOf(room),
    seats: buildSeats(room),
    spectators: [...room.spectators.values()].map((s) => ({
      playerId: s.playerId,
      nickname: s.nickname,
    })),
    me: { playerId: viewerId, mode },
    hand: mode === 'play' ? (game ? handOf(game, viewerId) : []) : null,
    allHands,
    chips,
    game: buildGameView(room, viewerId),
    log: room.log.slice(),
  };
}

export { seatOfPlayer };
