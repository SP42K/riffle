import { cardValue, cardsLabel, sortCards } from './cards.js';
import {
  COMBO_LABEL,
  FIVE_CARD_ORDER,
  type Card,
  type Combo,
  type ComboType,
  type Rank,
} from './types.js';

/** 把牌依點數分組，回傳每組的牌陣列，並依「組大小 desc、點數 desc」排序。 */
function groupByRank(cards: readonly Card[]): Card[][] {
  const buckets = new Map<Rank, Card[]>();
  for (const card of cards) {
    const bucket = buckets.get(card.rank);
    if (bucket) bucket.push(card);
    else buckets.set(card.rank, [card]);
  }
  return [...buckets.values()].sort((a, b) => b.length - a.length || b[0]!.rank - a[0]!.rank);
}

function highest(cards: readonly Card[]): Card {
  return cards.reduce((best, c) => (cardValue(c) > cardValue(best) ? c : best));
}

/** 點數是否連續。因為 2 的權重是 15，J-Q-K-A-2 天然連續，而 A-2-3-4-5 天然不連續。 */
function isConsecutive(sorted: readonly Card[]): boolean {
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.rank !== sorted[i - 1]!.rank + 1) return false;
  }
  return true;
}

function isSameSuit(cards: readonly Card[]): boolean {
  return cards.every((c) => c.suit === cards[0]!.suit);
}

function build(type: ComboType, cards: Card[], keyCard: Card): Combo {
  return { type, cards, size: cards.length, keyCard };
}

/**
 * 辨識牌型。不是合法牌型就回 null。
 * 傳入順序無所謂，回傳的 combo.cards 一律由小到大排序。
 */
export function identifyCombo(input: readonly Card[]): Combo | null {
  // 同一張牌被指定兩次視為非法
  const ids = new Set(input.map((c) => c.id));
  if (ids.size !== input.length) return null;

  const cards = sortCards(input);

  switch (cards.length) {
    case 1:
      return build('single', cards, cards[0]!);

    case 2:
      return cards[0]!.rank === cards[1]!.rank ? build('pair', cards, cards[1]!) : null;

    case 3:
      return cards[0]!.rank === cards[1]!.rank && cards[1]!.rank === cards[2]!.rank
        ? build('triple', cards, cards[2]!)
        : null;

    case 5:
      return identifyFiveCard(cards);

    default:
      return null; // 大老二沒有 4 張或 6 張以上的牌型
  }
}

function identifyFiveCard(cards: Card[]): Combo | null {
  const groups = groupByRank(cards);
  const top = groups[0]!;

  // 鐵支：4 + 1
  if (top.length === 4) {
    return build('fourOfAKind', cards, highest(top));
  }

  // 葫蘆：3 + 2
  if (top.length === 3 && groups[1]?.length === 2) {
    return build('fullHouse', cards, highest(top));
  }

  // 剩下只可能是每個點數都不同的牌
  if (groups.length !== 5) return null;

  const straight = isConsecutive(cards);
  const flush = isSameSuit(cards);
  const key = cards[4]!; // 已排序，最後一張即最大

  if (straight && flush) return build('straightFlush', cards, key);
  if (flush) return build('flush', cards, key);
  if (straight) return build('straight', cards, key);
  return null;
}

/**
 * 同張數的兩個牌型比大小。回傳 >0 表示 a 大於 b。
 * 張數不同時無意義，會回 NaN —— 呼叫端請先用 canBeat() 檢查。
 */
export function compareCombo(a: Combo, b: Combo): number {
  if (a.size !== b.size) return NaN;

  if (a.size === 5) {
    const diff = FIVE_CARD_ORDER[a.type]! - FIVE_CARD_ORDER[b.type]!;
    if (diff !== 0) return diff;
  }

  return cardValue(a.keyCard) - cardValue(b.keyCard);
}

/** candidate 能不能壓過 last。last 為 null 代表自由出牌，任何合法牌型都行。 */
export function canBeat(candidate: Combo, last: Combo | null): boolean {
  if (!last) return true;
  if (candidate.size !== last.size) return false;
  return compareCombo(candidate, last) > 0;
}

/** 產生 size 張的所有組合。 */
function* combinations(cards: readonly Card[], size: number): Generator<Card[]> {
  const idx: number[] = [];
  const n = cards.length;
  if (size > n) return;

  for (let i = 0; i < size; i++) idx.push(i);

  while (true) {
    yield idx.map((i) => cards[i]!);

    let i = size - 1;
    while (i >= 0 && idx[i]! === n - size + i) i--;
    if (i < 0) return;
    idx[i]!++;
    for (let j = i + 1; j < size; j++) idx[j] = idx[j - 1]! + 1;
  }
}

const COMBO_SIZES = [1, 2, 3, 5] as const;

export interface FindLegalPlaysOptions {
  /** 只找包含這些牌 id 的組合（第一手必須含 ♦3 時用得到）。 */
  mustInclude?: readonly string[];
  /** 找到這麼多組就停手，用於「有沒有牌可出」這種只在意存不存在的判斷。 */
  limit?: number;
}

/**
 * 列出手牌中所有能壓過 last 的合法出牌。
 * 13 張手牌最多也才 C(13,5)=1287 種組合，直接暴力枚舉即可。
 */
export function findLegalPlays(
  hand: readonly Card[],
  last: Combo | null,
  options: FindLegalPlaysOptions = {},
): Combo[] {
  const { mustInclude, limit } = options;
  const sizes = last ? [last.size] : COMBO_SIZES;
  const out: Combo[] = [];

  for (const size of sizes) {
    for (const cards of combinations(hand, size)) {
      if (mustInclude && !mustInclude.every((id) => cards.some((c) => c.id === id))) continue;
      const combo = identifyCombo(cards);
      if (!combo || !canBeat(combo, last)) continue;
      out.push(combo);
      if (limit && out.length >= limit) return out;
    }
  }

  return out;
}

/** 手上還有沒有牌能壓過 last。 */
export function hasLegalPlay(hand: readonly Card[], last: Combo | null): boolean {
  return findLegalPlays(hand, last, { limit: 1 }).length > 0;
}

/** 逾時自動出牌時用：挑最小的一組合法牌。 */
export function smallestLegalPlay(
  hand: readonly Card[],
  last: Combo | null,
  options: FindLegalPlaysOptions = {},
): Combo | null {
  const plays = findLegalPlays(hand, last, options);
  if (plays.length === 0) return null;
  return plays.reduce((best, combo) => {
    if (combo.size !== best.size) return combo.size < best.size ? combo : best;
    return compareCombo(combo, best) < 0 ? combo : best;
  });
}

export function describeCombo(combo: Combo): string {
  return `${COMBO_LABEL[combo.type]} ${cardsLabel(combo.cards)}`;
}
