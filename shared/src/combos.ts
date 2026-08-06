import { cardValue, cardsLabel, sortCards } from './cards.js';
import {
  COMBO_LABEL,
  CUT_ORDER,
  DEFAULT_BIG_TWO_RULES,
  DRAGON_SIZE,
  FIVE_CARD_ORDER,
  type BigTwoRules,
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
 * 認得哪些牌型看規則開關：flush 決定收不收同花，dragon 決定認不認一條龍。
 */
export function identifyCombo(
  input: readonly Card[],
  rules: BigTwoRules = DEFAULT_BIG_TWO_RULES,
): Combo | null {
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
      return identifyFiveCard(cards, rules);

    case DRAGON_SIZE:
      return rules.dragon ? identifyDragon(cards) : null;

    default:
      return null; // 大老二沒有 4 張或 6 張以上的牌型
  }
}

/** 一條龍：3 到 2 各一張。點數全不重複就一定湊齊了，因為總共只有 13 種點數。只有 dragon 開著才認。 */
function identifyDragon(cards: Card[]): Combo | null {
  const ranks = new Set(cards.map((c) => c.rank));
  if (ranks.size !== DRAGON_SIZE) return null;
  return build('dragon', cards, cards[DRAGON_SIZE - 1]!);
}

function identifyFiveCard(cards: Card[], rules: BigTwoRules): Combo | null {
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
  // 關掉同花時，湊成同花的五張牌就只是一把散牌
  if (flush) return rules.flush ? build('flush', cards, key) : null;
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

/**
 * candidate 能不能壓過 last。last 為 null 代表自由出牌，任何合法牌型都行。
 * 兩個規則開關在這裡生效：
 * - cuts：鐵支／同花順／一條龍是「切」，檯面上不管放什麼都蓋得過去；切與切之間才照 CUT_ORDER 比。
 * - matchFiveCardType：五張除了張數要一樣，還得跟領牌者用同一種牌型 —— 出順子就只能拿順子接。
 *   關掉時退回 compareCombo 的跨型比較（FIVE_CARD_ORDER）。
 */
export function canBeat(
  candidate: Combo,
  last: Combo | null,
  rules: BigTwoRules = DEFAULT_BIG_TWO_RULES,
): boolean {
  if (!last) return true;

  if (rules.cuts) {
    const cut = CUT_ORDER[candidate.type];
    const lastCut = CUT_ORDER[last.type];
    if (cut !== undefined) {
      if (lastCut === undefined) return true;
      if (cut !== lastCut) return cut > lastCut;
      return cardValue(candidate.keyCard) > cardValue(last.keyCard);
    }
    if (lastCut !== undefined) return false; // 被切走的牌只有更大的切拿得回來
  }

  if (candidate.size !== last.size) return false;
  if (rules.matchFiveCardType && candidate.size === 5 && candidate.type !== last.type) return false;
  return compareCombo(candidate, last) > 0;
}

/** canBeat 不成立的原因。呼叫端據此挑錯誤碼或提示文案。 */
export type BeatFailure =
  | 'size' // 張數不對
  | 'comboType' // 張數對，但 matchFiveCardType 要求五張跟同一種牌型
  | 'tooSmall'; // 牌型對，單純比不過

/** 壓不過的話是為什麼；壓得過回 null。 */
export function beatFailure(
  candidate: Combo,
  last: Combo | null,
  rules: BigTwoRules = DEFAULT_BIG_TWO_RULES,
): BeatFailure | null {
  if (canBeat(candidate, last, rules)) return null;
  if (!last) return 'tooSmall'; // 走不到：自由出牌一律成立
  if (candidate.size !== last.size) return 'size';
  if (
    rules.matchFiveCardType &&
    candidate.size === 5 &&
    candidate.type !== last.type &&
    // 開著切的時候，兩邊只要有一邊是切就不是「牌型不對」的問題
    (!rules.cuts || (CUT_ORDER[candidate.type] === undefined && CUT_ORDER[last.type] === undefined))
  ) {
    return 'comboType';
  }
  return 'tooSmall';
}

/** 產生 size 張的所有組合。純組合列舉，德州撲克的 7 選 5 也用這支。 */
export function* combinations(cards: readonly Card[], size: number): Generator<Card[]> {
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

const COMBO_SIZES: readonly number[] = [1, 2, 3, 5];
/** 認一條龍時多這種張數。 */
const DRAGON_COMBO_SIZES: readonly number[] = [1, 2, 3, 5, DRAGON_SIZE];

export interface FindLegalPlaysOptions {
  /** 只找包含這些牌 id 的組合（第一手必須含 ♦3 時用得到）。 */
  mustInclude?: readonly string[];
  /** 找到這麼多組就停手，用於「有沒有牌可出」這種只在意存不存在的判斷。 */
  limit?: number;
  /** 用哪些規則開關判合法，預設台灣慣例。 */
  rules?: BigTwoRules;
}

/** 跟牌時要枚舉哪些張數。可以切的話，五張（與一條龍）永遠要算進去。 */
function sizesToTry(last: Combo | null, rules: BigTwoRules): readonly number[] {
  const all = rules.dragon ? DRAGON_COMBO_SIZES : COMBO_SIZES;
  if (!last) return all;
  if (!rules.cuts) return [last.size];
  const sizes = new Set<number>([last.size, 5]); // 切一定是五張，或者一條龍
  if (rules.dragon) sizes.add(DRAGON_SIZE);
  return [...sizes];
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
  const { mustInclude, limit, rules = DEFAULT_BIG_TWO_RULES } = options;
  const out: Combo[] = [];

  for (const size of sizesToTry(last, rules)) {
    for (const cards of combinations(hand, size)) {
      if (mustInclude && !mustInclude.every((id) => cards.some((c) => c.id === id))) continue;
      const combo = identifyCombo(cards, rules);
      if (!combo || !canBeat(combo, last, rules)) continue;
      out.push(combo);
      if (limit && out.length >= limit) return out;
    }
  }

  return out;
}

/** 手上還有沒有牌能壓過 last。 */
export function hasLegalPlay(
  hand: readonly Card[],
  last: Combo | null,
  options: FindLegalPlaysOptions = {},
): boolean {
  return findLegalPlays(hand, last, { ...options, limit: 1 }).length > 0;
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
