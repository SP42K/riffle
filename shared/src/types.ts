import type { HoldemGameView } from './holdem.js';

// ---------------------------------------------------------------------------
// 牌
// ---------------------------------------------------------------------------

/** 花色代號。排序 D < C < H < S（方塊 < 梅花 < 紅心 < 黑桃）。 */
export type Suit = 'D' | 'C' | 'H' | 'S';

/** 花色大小，數字越大越大。 */
export const SUIT_ORDER: Record<Suit, number> = { D: 0, C: 1, H: 2, S: 3 };

export const SUITS: readonly Suit[] = ['D', 'C', 'H', 'S'];

export const SUIT_SYMBOL: Record<Suit, string> = {
  D: '♦',
  C: '♣',
  H: '♥',
  S: '♠',
};

/**
 * 點數權重。大老二的順序是 3 < 4 < ... < K < A < 2，
 * 所以用 3..15 表示，2 是最大的 15。
 */
export type Rank = 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;

export const RANKS: readonly Rank[] = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

/** 顯示用的點數字面，例如 11 → 'J'、15 → '2'。 */
export const RANK_LABEL: Record<Rank, string> = {
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: '10',
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
  15: '2',
};

export interface Card {
  /** 全域唯一代號，例如 'D3'、'SA'、'H2'。用來在網路上指涉一張牌。 */
  id: string;
  suit: Suit;
  rank: Rank;
}

// ---------------------------------------------------------------------------
// 牌型
// ---------------------------------------------------------------------------

export type ComboType =
  | 'single' // 單張
  | 'pair' // 對子
  | 'triple' // 三條
  | 'straight' // 順子
  | 'flush' // 同花
  | 'fullHouse' // 葫蘆
  | 'fourOfAKind' // 鐵支
  | 'straightFlush'; // 同花順

/** 五張牌型之間的高低，數字越大越大。非五張牌型不參與跨型比較。 */
export const FIVE_CARD_ORDER: Record<string, number> = {
  straight: 1,
  flush: 2,
  fullHouse: 3,
  fourOfAKind: 4,
  straightFlush: 5,
};

export const COMBO_LABEL: Record<ComboType, string> = {
  single: '單張',
  pair: '對子',
  triple: '三條',
  straight: '順子',
  flush: '同花',
  fullHouse: '葫蘆',
  fourOfAKind: '鐵支',
  straightFlush: '同花順',
};

export interface Combo {
  type: ComboType;
  /** 原始牌組（已由小到大排序）。 */
  cards: Card[];
  /** 張數，等同 cards.length。跟牌時必須一致。 */
  size: number;
  /**
   * 同型比大小用的關鍵牌：
   * - single / pair / straight / flush / straightFlush → 組合中最大的那張
   * - triple / fullHouse → 三條中最大的那張
   * - fourOfAKind → 四張中最大的那張
   */
  keyCard: Card;
}

// ---------------------------------------------------------------------------
// 房間與遊戲狀態（伺服器 → 前端的快照）
// ---------------------------------------------------------------------------

export type PlayerId = string;

/** 一個房間只玩一種玩法，建房時決定。 */
export type GameType = 'bigTwo' | 'holdem';

export const GAME_TYPES: readonly GameType[] = ['bigTwo', 'holdem'];

export const GAME_TYPE_LABEL: Record<GameType, string> = {
  bigTwo: '大老二',
  holdem: '德州撲克',
};

/** 各玩法的人數上下限。 */
export const SEAT_LIMITS: Record<GameType, { min: number; max: number }> = {
  bigTwo: { min: 2, max: 4 },
  holdem: { min: 2, max: 9 },
};

export type RoomStatus = 'waiting' | 'playing' | 'finished';

export type JoinMode = 'play' | 'spectate';

export interface ChatMessage {
  id: string;
  /** 系統訊息時為 null。 */
  playerId: PlayerId | null;
  nickname: string;
  text: string;
  at: number;
  system?: boolean;
}

/** 大廳房間列表的一列。 */
export interface RoomSummary {
  id: string;
  name: string;
  gameType: GameType;
  hostNickname: string;
  playerCount: number;
  maxPlayers: number;
  spectatorCount: number;
  status: RoomStatus;
}

/**
 * 牌桌上一位玩家的公開資訊。
 * 只放跟玩法無關的成員資訊；玩法專屬的數字（手牌張數、籌碼…）在各自的 GameView 裡。
 */
export interface SeatView {
  seat: number;
  playerId: PlayerId;
  nickname: string;
  isHost: boolean;
  ready: boolean;
  connected: boolean;
}

export interface SpectatorView {
  playerId: PlayerId;
  nickname: string;
}

export interface LastPlay {
  playerId: PlayerId;
  nickname: string;
  combo: Combo;
}

export interface BigTwoSeatInfo {
  handCount: number;
  /** 本輪是否已經 PASS。 */
  passed: boolean;
  /** 已經出完牌的名次（1 起算），還在打的人為 null。 */
  rank: number | null;
}

export interface BigTwoGameView {
  type: 'bigTwo';
  /** 輪到誰（playerId）。遊戲結束時為 null。 */
  turnPlayerId: PlayerId | null;
  /** 目前回合結束的時間戳（ms）。 */
  turnDeadline: number;
  over: boolean;
  lastPlay: LastPlay | null;
  /** true 表示現在是自由出牌（可出任意合法牌型）。 */
  freeLead: boolean;
  /** 開局牌 id；不為 null 時，這一手必須包含它。 */
  openingCardId: string | null;
  /** 出完牌的順序，index 0 為第一名。 */
  ranking: PlayerId[];
  /** seat → 該座位的公開資訊。 */
  seats: Record<number, BigTwoSeatInfo>;
}

/** 依 type 分派的玩法快照。前端用 game.type 收窄。 */
export type GameView = BigTwoGameView | HoldemGameView;

/** 伺服器推給單一 socket 的房間快照。每個人收到的內容不同。 */
export interface RoomView {
  id: string;
  name: string;
  gameType: GameType;
  hostId: PlayerId;
  maxPlayers: number;
  status: RoomStatus;
  seats: SeatView[];
  spectators: SpectatorView[];
  /** 收訊者自己的身分。 */
  me: { playerId: PlayerId; mode: JoinMode };
  /** 只有玩家會拿到：大老二是手牌，德州撲克是自己的底牌。 */
  hand: Card[] | null;
  /** 只有觀戰者會拿到（上帝視角）。 */
  allHands: Record<PlayerId, Card[]> | null;
  /**
   * 德州撲克的房內籌碼，其他玩法為 null。
   * 這是房間層的狀態（跨手累積），所以不放在單手的 GameView 裡。
   */
  chips: Record<PlayerId, number> | null;
  game: GameView | null;
  log: string[];
}

// ---------------------------------------------------------------------------
// Socket 事件
// ---------------------------------------------------------------------------

export interface ErrorPayload {
  code: string;
  message: string;
}

export type Ack<T> = (res: { ok: true; data: T } | { ok: false; error: ErrorPayload }) => void;

/** Client → Server */
export interface ClientToServerEvents {
  'session:hello': (p: { playerId: PlayerId; nickname: string }, ack: Ack<{ roomId: string | null }>) => void;
  'lobby:chat': (p: { text: string }) => void;
  'room:create': (
    p: { name: string; maxPlayers: number; gameType: GameType },
    ack: Ack<{ roomId: string }>,
  ) => void;
  'room:join': (p: { roomId: string; mode: JoinMode }, ack: Ack<{ roomId: string }>) => void;
  'room:leave': (p: Record<string, never>, ack: Ack<null>) => void;
  'room:chat': (p: { text: string }) => void;
  'room:ready': (p: { ready: boolean }) => void;
  'game:start': (p: Record<string, never>, ack: Ack<null>) => void;
  /** 大老二專用。 */
  'game:play': (p: { cardIds: string[] }, ack: Ack<null>) => void;
  /** 大老二專用。 */
  'game:pass': (p: Record<string, never>, ack: Ack<null>) => void;
  /** 德州撲克專用。amount 是「這一街總共加到多少」，不是增量。 */
  'game:action': (p: { action: BetAction; amount?: number }, ack: Ack<null>) => void;
}

export type BetAction = 'fold' | 'check' | 'call' | 'raise' | 'allin';

/** Server → Client */
export interface ServerToClientEvents {
  'lobby:state': (p: { rooms: RoomSummary[] }) => void;
  'lobby:chat': (p: { messages: ChatMessage[] }) => void;
  'room:state': (p: RoomView | null) => void;
  'room:chat': (p: { messages: ChatMessage[] }) => void;
  'game:over': (p: { ranking: Array<{ playerId: PlayerId; nickname: string }> }) => void;
  error: (p: ErrorPayload) => void;
}

// ---------------------------------------------------------------------------
// 規則常數
// ---------------------------------------------------------------------------

/** 大老二每人的手牌張數。人數上限請看 SEAT_LIMITS。 */
export const HAND_SIZE = 13;
export const TURN_MS = 45_000;
export const DISCONNECT_GRACE_MS = 30_000;
export const CHAT_HISTORY = 100;
export const LOG_HISTORY = 60;
