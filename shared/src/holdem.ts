import { combinations } from './combos.js';
import { SUIT_ORDER, type Card, type PlayerId } from './types.js';

// ---------------------------------------------------------------------------
// 點數
// ---------------------------------------------------------------------------

/**
 * 德州撲克的點數：2 最小、A 最大（2..14）。
 * 大老二把 2 編成 15 好讓 J-Q-K-A-2 連續，這裡換回 2 —— 不能改動 Rank 本身，
 * 那個編碼是大老二順子與 cardValue 的基礎。
 */
export function holdemRank(card: Card): number {
  return card.rank === 15 ? 2 : card.rank;
}

/** 顯示用的點數字面，例如 14 → 'A'、2 → '2'。 */
export const HOLDEM_RANK_LABEL: Record<number, string> = {
  2: '2',
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
};

// ---------------------------------------------------------------------------
// 牌型
// ---------------------------------------------------------------------------

export type HoldemCategory =
  | 'highCard' // 高牌
  | 'onePair' // 一對
  | 'twoPair' // 兩對
  | 'threeOfAKind' // 三條
  | 'straight' // 順子
  | 'flush' // 同花
  | 'fullHouse' // 葫蘆
  | 'fourOfAKind' // 鐵支
  | 'straightFlush'; // 同花順

export const HOLDEM_CATEGORY_LABEL: Record<HoldemCategory, string> = {
  highCard: '高牌',
  onePair: '一對',
  twoPair: '兩對',
  threeOfAKind: '三條',
  straight: '順子',
  flush: '同花',
  fullHouse: '葫蘆',
  fourOfAKind: '鐵支',
  straightFlush: '同花順',
};

/** 牌型高低，數字越大越大。注意順序跟大老二不同：德州是 順子 < 同花 < 葫蘆。 */
export const HOLDEM_CATEGORY_ORDER: Record<HoldemCategory, number> = {
  highCard: 1,
  onePair: 2,
  twoPair: 3,
  threeOfAKind: 4,
  straight: 5,
  flush: 6,
  fullHouse: 7,
  fourOfAKind: 8,
  straightFlush: 9,
};

export interface HoldemHand {
  category: HoldemCategory;
  /** 最佳的那五張，依「牌型意義」排序（例如葫蘆是三條在前、順子由大到小）。 */
  cards: Card[];
  /**
   * 同牌型比大小用的向量，字典序比較。
   * 花色完全不參與 —— 德州撲克同牌型同點數就是平手，要分池。
   */
  tiebreak: number[];
}

/** 把牌依點數分組，回傳 { value, cards }，依「張數 desc、點數 desc」排序。 */
function groupByHoldemRank(cards: readonly Card[]): Array<{ value: number; cards: Card[] }> {
  const buckets = new Map<number, Card[]>();
  for (const card of cards) {
    const value = holdemRank(card);
    const bucket = buckets.get(value);
    if (bucket) bucket.push(card);
    else buckets.set(value, [card]);
  }
  return [...buckets.entries()]
    .map(([value, group]) => ({ value, cards: group }))
    .sort((a, b) => b.cards.length - a.cards.length || b.value - a.value);
}

/**
 * 五張是不是順子。回傳最大的那張的點數，不是順子回 0。
 * A-2-3-4-5（輪子）成立，且視為 5 高。
 */
function straightHigh(valuesDesc: readonly number[]): number {
  if (valuesDesc.length !== 5) return 0;
  const distinct = new Set(valuesDesc);
  if (distinct.size !== 5) return 0;

  const high = valuesDesc[0]!;
  const low = valuesDesc[4]!;
  if (high - low === 4) return high;

  // 輪子：A-5-4-3-2，A 當 1 用，算 5 高
  if (high === 14 && valuesDesc[1] === 5) return 5;
  return 0;
}

/** 顯示用：同一組內把牌依花色排一下，讓輸出穩定。 */
function bySuit(cards: readonly Card[]): Card[] {
  return cards.slice().sort((a, b) => SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit]);
}

/**
 * 評估剛好五張牌。傳入順序無所謂。
 * 呼叫端要保證是五張不重複的牌（引擎與 bestHand 都會先擋掉）。
 */
export function evaluateFive(input: readonly Card[]): HoldemHand {
  const groups = groupByHoldemRank(input);
  const valuesDesc = input.map(holdemRank).sort((a, b) => b - a);
  const flush = input.every((c) => c.suit === input[0]!.suit);
  const high = straightHigh(valuesDesc);

  // 順子 / 同花順：排序要照順子的順序，輪子的 A 擺最後
  if (high) {
    const ordered =
      high === 5 && valuesDesc[0] === 14
        ? [5, 4, 3, 2, 14].map((v) => input.find((c) => holdemRank(c) === v)!)
        : input.slice().sort((a, b) => holdemRank(b) - holdemRank(a));
    return {
      category: flush ? 'straightFlush' : 'straight',
      cards: ordered,
      tiebreak: [high],
    };
  }

  if (flush) {
    return {
      category: 'flush',
      cards: input.slice().sort((a, b) => holdemRank(b) - holdemRank(a)),
      tiebreak: valuesDesc,
    };
  }

  const cards = groups.flatMap((g) => bySuit(g.cards));
  const sizes = groups.map((g) => g.cards.length).join('');
  const values = groups.map((g) => g.value);

  switch (sizes) {
    case '41':
      return { category: 'fourOfAKind', cards, tiebreak: values };
    case '32':
      return { category: 'fullHouse', cards, tiebreak: values };
    case '311':
      return { category: 'threeOfAKind', cards, tiebreak: values };
    case '221':
      return { category: 'twoPair', cards, tiebreak: values };
    case '2111':
      return { category: 'onePair', cards, tiebreak: values };
    default:
      return { category: 'highCard', cards, tiebreak: valuesDesc };
  }
}

/**
 * 從任意張數（通常是底牌 2 + 公共牌 5）挑出最強的五張。
 * 不到五張、或有重複的牌，回 null。
 */
export function bestHand(input: readonly Card[]): HoldemHand | null {
  const ids = new Set(input.map((c) => c.id));
  if (ids.size !== input.length) return null;
  if (input.length < 5) return null;

  let best: HoldemHand | null = null;
  // 7 選 5 只有 21 種，直接暴力枚舉
  for (const five of combinations(input, 5)) {
    const hand = evaluateFive(five);
    if (!best || compareHoldemHands(hand, best) > 0) best = hand;
  }
  return best;
}

/** 比大小。>0 表示 a 大於 b，0 表示完全平手（要分池）。 */
export function compareHoldemHands(a: HoldemHand, b: HoldemHand): number {
  const diff = HOLDEM_CATEGORY_ORDER[a.category] - HOLDEM_CATEGORY_ORDER[b.category];
  if (diff !== 0) return diff;

  const len = Math.max(a.tiebreak.length, b.tiebreak.length);
  for (let i = 0; i < len; i++) {
    const av = a.tiebreak[i] ?? 0;
    const bv = b.tiebreak[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

const label = (value: number | undefined): string => HOLDEM_RANK_LABEL[value ?? 0] ?? '?';

export function describeHoldemHand(hand: HoldemHand): string {
  const [first, second] = hand.tiebreak;
  switch (hand.category) {
    case 'straightFlush':
      return first === 14 ? '皇家同花順' : `同花順 ${label(first)} 高`;
    case 'fourOfAKind':
      return `鐵支 ${label(first)}`;
    case 'fullHouse':
      return `葫蘆 ${label(first)} 帶 ${label(second)}`;
    case 'flush':
      return `同花 ${label(first)} 高`;
    case 'straight':
      return `順子 ${label(first)} 高`;
    case 'threeOfAKind':
      return `三條 ${label(first)}`;
    case 'twoPair':
      return `兩對 ${label(first)} 與 ${label(second)}`;
    case 'onePair':
      return `一對 ${label(first)}`;
    default:
      return `高牌 ${label(first)}`;
  }
}

// ---------------------------------------------------------------------------
// 下注合法性（伺服器驗證與前端按鈕共用同一份）
// ---------------------------------------------------------------------------

export interface BetContext {
  /** 手上還剩多少籌碼。 */
  chips: number;
  /** 這一街已經投入多少。 */
  committed: number;
  /** 這一街目前的最高注。 */
  currentBet: number;
  /** 最小加注幅度（初始為大盲，有人加注後改成該次加注的幅度）。 */
  minRaise: number;
  folded: boolean;
  allIn: boolean;
  isTurn: boolean;
}

export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  /** 跟注實際要再放進池的量（已扣掉本街已投入，且不超過手上籌碼）。 */
  callAmount: number;
  canRaise: boolean;
  /** 加注用「這一街總共加到多少」表示，避免前後端對增量/總量理解不一致。 */
  minRaiseTo: number;
  maxRaiseTo: number;
}

const NO_ACTIONS: LegalActions = {
  canFold: false,
  canCheck: false,
  canCall: false,
  callAmount: 0,
  canRaise: false,
  minRaiseTo: 0,
  maxRaiseTo: 0,
};

export function legalActions(ctx: BetContext): LegalActions {
  if (!ctx.isTurn || ctx.folded || ctx.allIn || ctx.chips <= 0) return { ...NO_ACTIONS };

  const toCall = Math.max(0, ctx.currentBet - ctx.committed);
  const maxRaiseTo = ctx.committed + ctx.chips;
  // 籌碼不夠加滿最小幅度時仍可以 all-in（短加注），只是不會重開加注權
  const canRaise = maxRaiseTo > ctx.currentBet;
  const minRaiseTo = canRaise ? Math.min(ctx.currentBet + ctx.minRaise, maxRaiseTo) : 0;

  return {
    canFold: true,
    canCheck: toCall === 0,
    canCall: toCall > 0,
    callAmount: Math.min(toCall, ctx.chips),
    canRaise,
    minRaiseTo: canRaise ? minRaiseTo : 0,
    maxRaiseTo: canRaise ? maxRaiseTo : 0,
  };
}

// ---------------------------------------------------------------------------
// 桌面規則常數
// ---------------------------------------------------------------------------

/** 進房時發給每位玩家的籌碼。房內現金局，不做持久化。 */
export const HOLDEM_START_CHIPS = 1000;
export const HOLDEM_SMALL_BLIND = 10;
export const HOLDEM_BIG_BLIND = 20;
/** 攤牌後停留多久再自動發下一手。 */
export const HOLDEM_SHOWDOWN_MS = 6_000;

export type HoldemStreet = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export const HOLDEM_STREET_LABEL: Record<HoldemStreet, string> = {
  preflop: '翻牌前',
  flop: '翻牌',
  turn: '轉牌',
  river: '河牌',
  showdown: '攤牌',
};

// ---------------------------------------------------------------------------
// 快照（伺服器 → 前端）
// ---------------------------------------------------------------------------

/** 座位在「這一手」裡的狀態。籌碼是房間層的，看 RoomView.chips。 */
export interface HoldemSeatInfo {
  /** 這一街已投入。 */
  committed: number;
  /** 這一手累計已投入，邊池就是照這個切的。 */
  totalCommitted: number;
  folded: boolean;
  allIn: boolean;
  holeCount: number;
  isButton: boolean;
  blind: 'sb' | 'bb' | null;
  /** 顯示用的最近動作，例如 '跟注 20'。 */
  lastAction: string | null;
}

export interface HoldemPotView {
  amount: number;
  /** 有資格爭這個池的玩家（已蓋牌的人不在內）。 */
  eligible: PlayerId[];
}

export interface HoldemShowdownEntry {
  playerId: PlayerId;
  nickname: string;
  /** 沒打到攤牌就結束時為 null —— 贏家不必亮牌。 */
  hole: Card[] | null;
  hand: HoldemHand | null;
  won: number;
}

export interface HoldemGameView {
  type: 'holdem';
  turnPlayerId: PlayerId | null;
  turnDeadline: number;
  /** 這一手是否已結束（不是整桌結束）。 */
  over: boolean;
  handNo: number;
  street: HoldemStreet;
  board: Card[];
  pots: HoldemPotView[];
  totalPot: number;
  currentBet: number;
  minRaise: number;
  smallBlind: number;
  bigBlind: number;
  /** seat → 該座位的公開資訊。 */
  seats: Record<number, HoldemSeatInfo>;
  showdown: HoldemShowdownEntry[] | null;
  /** 針對收訊者算好的可用動作，前端不必自己推規則。 */
  myActions: LegalActions | null;
}
