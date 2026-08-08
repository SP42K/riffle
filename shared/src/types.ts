import type { HoldemCategory, HoldemGameView, HoldemStreet } from './holdem.js';
import type {
  MonopolyAction,
  MonopolyCardId,
  MonopolyEndReason,
  MonopolyEstateId,
  MonopolyGameView,
  MonopolyOptions,
  MonopolyPhase,
  MonopolyTileId,
} from './monopoly.js';
import type { SnakeDirection, SnakeGameView, SnakeItemKind, SnakeOptions } from './snake.js';

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
  | 'straightFlush' // 同花順
  | 'dragon'; // 一條龍：3 到 2 各一張，只有台灣規則認得

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
  dragon: '一條龍',
};

/**
 * 台灣規則的「切」：不管檯面上是什麼牌，這幾種牌型都蓋得過去。數字越大越大。
 * 一條龍 > 同花順 > 鐵支，跟 FIVE_CARD_ORDER 的相對高低一致。
 */
export const CUT_ORDER: Partial<Record<ComboType, number>> = {
  fourOfAKind: 1,
  straightFlush: 2,
  dragon: 3,
};

/** 一條龍的張數：3 到 2 各一張，剛好是一整手牌。 */
export const DRAGON_SIZE = 13;

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
export type GameType = 'bigTwo' | 'holdem' | 'monopoly' | 'snake';

export const GAME_TYPES: readonly GameType[] = ['bigTwo', 'holdem', 'monopoly', 'snake'];

export const GAME_TYPE_LABEL: Record<GameType, string> = {
  bigTwo: '大老二',
  holdem: '德州撲克',
  monopoly: '大富翁',
  snake: '貪吃蛇',
};

/**
 * 大老二的規則開關。建房時逐項決定，中途不會變。
 * 每一條都是獨立的 —— 想怎麼搭就怎麼搭，台灣慣例只是其中一種組合。
 */
export interface BigTwoRules {
  /** 鐵支／同花順／一條龍是「切」，檯面上不管放什麼牌型都蓋得過去。 */
  cuts: boolean;
  /** 認一條龍：3 到 2 各一張，13 張一次出完。 */
  dragon: boolean;
  /** 同花算合法牌型。 */
  flush: boolean;
  /** 五張只能用同一種牌型跟 —— 出順子就只能拿順子接，葫蘆不行。 */
  matchFiveCardType: boolean;
  /** PASS 掉就得等這一輪結束才能再出牌。 */
  passLocksTrick: boolean;
}

export type BigTwoRuleKey = keyof BigTwoRules;

/** 顯示與消毒的固定順序。 */
export const BIG_TWO_RULE_KEYS: readonly BigTwoRuleKey[] = [
  'cuts',
  'dragon',
  'flush',
  'matchFiveCardType',
  'passLocksTrick',
];

export const BIG_TWO_RULE_LABEL: Record<BigTwoRuleKey, string> = {
  cuts: '可以切',
  dragon: '認一條龍',
  flush: '同花',
  matchFiveCardType: '五張同型跟',
  passLocksTrick: 'PASS 鎖整輪',
};

/** 台灣慣例：不收同花，其餘全開。 */
export const TAIWAN_BIG_TWO_RULES: BigTwoRules = {
  cuts: true,
  dragon: true,
  flush: false,
  matchFiveCardType: true,
  passLocksTrick: true,
};

/** 一般規則：五張可以跨牌型壓、同花合法、沒有切、PASS 之後輪到還是能出。 */
export const CLASSIC_BIG_TWO_RULES: BigTwoRules = {
  cuts: false,
  dragon: false,
  flush: true,
  matchFiveCardType: false,
  passLocksTrick: false,
};

/** 沒指定就用台灣慣例。 */
export const DEFAULT_BIG_TWO_RULES: BigTwoRules = TAIWAN_BIG_TWO_RULES;

/** 顯示用的套組名。五項全中才算套組，只要動過一項就是自訂。 */
export type BigTwoPreset = 'taiwan' | 'classic' | 'custom';

export const BIG_TWO_PRESETS: readonly BigTwoPreset[] = ['taiwan', 'classic', 'custom'];

/** custom 不在這裡 —— 它是「都不中」的結果，沒有對應的旗標組合。 */
export const BIG_TWO_PRESET_RULES: Record<'taiwan' | 'classic', BigTwoRules> = {
  taiwan: TAIWAN_BIG_TWO_RULES,
  classic: CLASSIC_BIG_TWO_RULES,
};

export const BIG_TWO_PRESET_LABEL: Record<BigTwoPreset, string> = {
  taiwan: '台灣規則',
  classic: '一般規則',
  custom: '自訂規則',
};

/** 這組旗標對應到哪個套組。 */
export function bigTwoPresetOf(rules: BigTwoRules): BigTwoPreset {
  for (const [preset, presetRules] of Object.entries(BIG_TWO_PRESET_RULES)) {
    if (BIG_TWO_RULE_KEYS.every((key) => rules[key] === presetRules[key])) {
      return preset as BigTwoPreset;
    }
  }
  return 'custom';
}

/** 各玩法的人數上下限。 */
export const SEAT_LIMITS: Record<GameType, { min: number; max: number }> = {
  bigTwo: { min: 2, max: 4 },
  holdem: { min: 2, max: 9 },
  monopoly: { min: 2, max: 6 },
  snake: { min: 2, max: 6 },
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
  /** 系統訊息才有：結構化的事件，句子由前端依外觀組，text 只是後備。 */
  notice?: SystemNotice;
}

/** 房間內的系統通知。跟 LogEvent 一樣只給結構，不給句子。 */
export type SystemNotice =
  | { t: 'created'; player: string }
  | { t: 'joined'; player: string }
  | { t: 'spectating'; player: string }
  | { t: 'left'; player: string }
  | { t: 'disconnected'; player: string }
  /** 貪吃蛇的「影響到別人」道具生效時發的公告，比戰報那六行更顯眼——聊天室看得到。 */
  | { t: 'snakeItem'; player: string; item: SnakeItemKind }
  /** 貪吃蛇按下衝刺（X 鍵）充能的瞬間發的公告，給其他人一點反應時間閃避。 */
  | { t: 'snakeDash'; player: string };

/** 大廳房間列表的一列。 */
export interface RoomSummary {
  id: string;
  name: string;
  gameType: GameType;
  /** 只有大老二房有值，其他玩法為 null。 */
  bigTwoRules: BigTwoRules | null;
  /** 只有大富翁房有值，其他玩法為 null。 */
  monopolyOptions: MonopolyOptions | null;
  /** 只有貪吃蛇房有值，其他玩法為 null。 */
  snakeOptions: SnakeOptions | null;
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
export type GameView = BigTwoGameView | HoldemGameView | MonopolyGameView | SnakeGameView;

// ---------------------------------------------------------------------------
// 戰報
// ---------------------------------------------------------------------------

/**
 * 戰報事件。伺服器只送結構，句子由前端依外觀（skin）自己組。
 * 這樣隱匿模式才有辦法把「小明 出 對子 ♠A ♥A」講成工作用語。
 * cards / board 一律放 card id（'SA'、'D3'），讓前端用自己的卡面寫法渲染。
 */
export type LogEvent =
  // 大老二
  | { t: 'bigTwoStart'; players: number }
  | { t: 'lead'; player: string }
  | { t: 'play'; player: string; combo: ComboType; cards: string[] }
  | { t: 'pass'; player: string }
  | { t: 'finished'; player: string; rank: number }
  | { t: 'bigTwoOver'; ranking: string[] }
  // 德州撲克
  | { t: 'rebuy'; player: string; amount: number }
  | { t: 'holdemStart'; handNo: number; smallBlind: number; bigBlind: number }
  | { t: 'button'; player: string }
  | { t: 'bet'; player: string; action: SeatAction }
  | { t: 'street'; street: HoldemStreet; board: string[] }
  | { t: 'board'; board: string[] }
  | { t: 'showdown'; player: string; category: HoldemCategory; tiebreak: number[]; won: number }
  | { t: 'uncontested'; player: string; won: number }
  // 大富翁
  | { t: 'monopolyStart'; players: number; startCash: number }
  | { t: 'move'; player: string; dice: [number, number]; tile: MonopolyTileId }
  | { t: 'buy'; player: string; tile: MonopolyEstateId; price: number }
  | { t: 'rent'; player: string; owner: string; tile: MonopolyEstateId; amount: number }
  | { t: 'tax'; player: string; tile: MonopolyTileId; amount: number }
  /** 進出帳但不是租金也不是稅：薪水、停車場獎金、卡片、玩家之間的收付。 */
  | { t: 'monopolyCash'; player: string; amount: number; source: 'salary' | 'parking' | 'card' | 'players' }
  | { t: 'auctionStart'; tile: MonopolyEstateId }
  | { t: 'bid'; player: string; amount: number }
  | { t: 'auctionEnd'; player: string | null; tile: MonopolyEstateId; amount: number }
  /** houses 是動完之後的等級（5 為飯店）；sold 為 true 表示拆掉一棟。 */
  | { t: 'build'; player: string; tile: MonopolyEstateId; houses: number; sold: boolean }
  | { t: 'mortgage'; player: string; tile: MonopolyEstateId; amount: number; redeem: boolean }
  | { t: 'drawCard'; player: string; card: MonopolyCardId }
  | { t: 'jailed'; player: string }
  | { t: 'freed'; player: string; how: 'bail' | 'card' | 'doubles' | 'served' }
  | {
      t: 'trade';
      from: string;
      to: string;
      give: MonopolyEstateId[];
      giveCash: number;
      want: MonopolyEstateId[];
      wantCash: number;
    }
  | { t: 'bankrupt'; player: string; creditor: string | null }
  | { t: 'monopolyOver'; reason: MonopolyEndReason; ranking: string[] }
  // 貪吃蛇
  | { t: 'snakeStart'; players: number }
  /** 死掉但還有命，進入重生倒數。 */
  | { t: 'snakeRespawn'; player: string }
  /** 兩條命用完，徹底出局。 */
  | { t: 'snakeDeath'; player: string }
  /** 吃到果實（一般或屍體果實）。 */
  | { t: 'snakeFoodEaten'; player: string }
  /** 吃到自己顏色的地雷果實拿到加分。 */
  | { t: 'snakeMineEaten'; player: string }
  /** 用掉一個道具（子彈是每發都送一次）。 */
  | { t: 'snakeItemUsed'; player: string; item: SnakeItemKind }
  /** 按下衝刺（X 鍵）開始充能。 */
  | { t: 'snakeDashCharging'; player: string }
  /** 衝刺途中撞進別人身體、把對方截斷（只有衝刺會截斷，一般碰撞一律算自己死）。 */
  | { t: 'snakeCut'; attacker: string; victim: string }
  | { t: 'snakeOver'; ranking: string[] }
  // 逾時代打
  | { t: 'timeout'; player: string; auto: 'pass' | 'check' | 'fold' }
  | { t: 'timeoutPlay'; player: string; combo: ComboType; cards: string[] }
  | { t: 'timeoutMonopoly'; player: string; phase: MonopolyPhase };

/**
 * 一次下注動作的結構化描述。座位上的「最近動作」與戰報共用。
 * bet/raise 的 amount 是這次放進池的量，to 是這一街總共加到多少。
 */
export interface SeatAction {
  kind: 'sb' | 'bb' | 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'leave';
  amount: number;
  to?: number;
  allIn: boolean;
}

/** 伺服器推給單一 socket 的房間快照。每個人收到的內容不同。 */
export interface RoomView {
  id: string;
  name: string;
  gameType: GameType;
  /** 只有大老二房有值。前端靠它決定要用哪一套規則算合法出牌。 */
  bigTwoRules: BigTwoRules | null;
  /** 只有大富翁房有值。 */
  monopolyOptions: MonopolyOptions | null;
  /** 只有貪吃蛇房有值。 */
  snakeOptions: SnakeOptions | null;
  hostId: PlayerId;
  maxPlayers: number;
  status: RoomStatus;
  seats: SeatView[];
  spectators: SpectatorView[];
  /** 收訊者自己的身分。 */
  me: { playerId: PlayerId; mode: JoinMode };
  /** 只有玩家會拿到：大老二是手牌，德州撲克是自己的底牌。大富翁沒有暗牌，為 null。 */
  hand: Card[] | null;
  /** 只有觀戰者、而且這個玩法有暗牌時才拿得到（上帝視角）。 */
  allHands: Record<PlayerId, Card[]> | null;
  /**
   * 德州撲克的房內籌碼，其他玩法為 null。
   * 這是房間層的狀態（跨手累積），所以不放在單手的 GameView 裡。
   */
  chips: Record<PlayerId, number> | null;
  game: GameView | null;
  log: LogEvent[];
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
    p: {
      name: string;
      maxPlayers: number;
      gameType: GameType;
      bigTwoRules?: Partial<BigTwoRules>;
      monopolyOptions?: Partial<MonopolyOptions>;
      snakeOptions?: Partial<SnakeOptions>;
    },
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
  /** 大富翁專用。17 種動作走同一個事件，靠 action.kind 收窄。 */
  'game:monopoly': (p: { action: MonopolyAction }, ack: Ack<null>) => void;
  /**
   * 貪吃蛇專用。只是把方向意圖寫進緩衝，下一拍 tick 才會真的套用 ——
   * 跟其他玩法的「這一手就是這一手」不同，這裡送出不代表這一拍已經轉向。
   */
  'game:snake': (p: { dir: SnakeDirection }, ack: Ack<null>) => void;
  /** 貪吃蛇專用：用掉道具欄第一格（空白鍵觸發）。子彈欄位用完才會真的清空。 */
  'game:snakeItem': (p: Record<string, never>, ack: Ack<null>) => void;
  /** 貪吃蛇專用：觸發衝刺截斷技能（X 鍵）。房間沒開 cutting 選項或還在冷卻時無效。 */
  'game:snakeDash': (p: Record<string, never>, ack: Ack<null>) => void;
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
