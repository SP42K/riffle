import {
  BIG_TWO_RULE_KEYS,
  CHAT_HISTORY,
  DEFAULT_BIG_TWO_RULES,
  HOLDEM_START_CHIPS,
  LOG_HISTORY,
  SEAT_LIMITS,
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
  type PlayerId,
  type RoomStatus,
  type RoomSummary,
  type RoomView,
  type SeatView,
  type SystemNotice,
} from 'shared';
import { seatOfPlayer, type GameState, type Seats } from './gameEngine.js';
import { actionsFor, type HoldemState } from './holdemEngine.js';
import type { TurnBased } from './turnBased.js';

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

/** 依玩法分派的牌局。兩種 state 都滿足 TurnBased，計時與狀態判斷不必分支。 */
export type RoomGame =
  | { type: 'bigTwo'; state: GameState }
  | { type: 'holdem'; state: HoldemState };

export interface Room {
  id: string;
  name: string;
  gameType: GameType;
  /** 大老二的規則開關。建房時決定，德州撲克房用不到但一律有值。 */
  bigTwoRules: BigTwoRules;
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
  return value === 'holdem' ? 'holdem' : 'bigTwo';
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

export function clampMaxPlayers(value: unknown, gameType: GameType): number {
  const limits = SEAT_LIMITS[gameType];
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return limits.max;
  return Math.min(limits.max, Math.max(limits.min, n));
}

export function createRoom(
  id: string,
  name: string,
  gameType: GameType,
  maxPlayers: number,
  bigTwoRules: BigTwoRules,
  host: Member,
): Room {
  const room: Room = {
    id,
    name,
    gameType,
    bigTwoRules,
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

function buildGameView(room: Room, viewerId: PlayerId): GameView | null {
  if (!room.game) return null;
  return room.game.type === 'bigTwo'
    ? buildBigTwoGameView(room, room.game.state)
    : buildHoldemGameView(room, room.game.state, viewerId);
}

/** 這位玩家自己看得到的牌：大老二是手牌，德州撲克是底牌。 */
function handOf(game: RoomGame, playerId: PlayerId): Card[] {
  const cards =
    game.type === 'bigTwo' ? game.state.hands.get(playerId) : game.state.hole.get(playerId);
  return cards?.slice() ?? [];
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
    allHands = {};
    for (const playerId of room.seats) {
      if (playerId && room.players.has(playerId)) allHands[playerId] = handOf(game, playerId);
    }
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
