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
  hostNickname: string;
  playerCount: number;
  maxPlayers: number;
  spectatorCount: number;
  status: RoomStatus;
}

/** 牌桌上一位玩家的公開資訊。 */
export interface SeatView {
  seat: number;
  playerId: PlayerId;
  nickname: string;
  isHost: boolean;
  ready: boolean;
  connected: boolean;
  handCount: number;
  /** 本輪是否已經 PASS。 */
  passed: boolean;
  /** 已經出完牌的名次（1 起算），還在打的人為 null。 */
  rank: number | null;
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

export interface GameView {
  /** 輪到誰（playerId）。遊戲結束時為 null。 */
  turnPlayerId: PlayerId | null;
  /** 目前回合結束的時間戳（ms）。 */
  turnDeadline: number;
  lastPlay: LastPlay | null;
  /** true 表示現在是自由出牌（可出任意合法牌型）。 */
  freeLead: boolean;
  /** 開局牌 id；不為 null 時，這一手必須包含它。 */
  openingCardId: string | null;
  /** 出完牌的順序，index 0 為第一名。 */
  ranking: PlayerId[];
  over: boolean;
}

/** 伺服器推給單一 socket 的房間快照。每個人收到的內容不同。 */
export interface RoomView {
  id: string;
  name: string;
  hostId: PlayerId;
  maxPlayers: number;
  status: RoomStatus;
  seats: SeatView[];
  spectators: SpectatorView[];
  /** 收訊者自己的身分。 */
  me: { playerId: PlayerId; mode: JoinMode };
  /** 只有玩家會拿到，且只有自己的手牌。 */
  hand: Card[] | null;
  /** 只有觀戰者會拿到（上帝視角）。 */
  allHands: Record<PlayerId, Card[]> | null;
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
  'room:create': (p: { name: string; maxPlayers: number }, ack: Ack<{ roomId: string }>) => void;
  'room:join': (p: { roomId: string; mode: JoinMode }, ack: Ack<{ roomId: string }>) => void;
  'room:leave': (p: Record<string, never>, ack: Ack<null>) => void;
  'room:chat': (p: { text: string }) => void;
  'room:ready': (p: { ready: boolean }) => void;
  'game:start': (p: Record<string, never>, ack: Ack<null>) => void;
  'game:play': (p: { cardIds: string[] }, ack: Ack<null>) => void;
  'game:pass': (p: Record<string, never>, ack: Ack<null>) => void;
}

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

export const HAND_SIZE = 13;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
export const TURN_MS = 45_000;
export const DISCONNECT_GRACE_MS = 30_000;
export const CHAT_HISTORY = 100;
export const LOG_HISTORY = 60;
