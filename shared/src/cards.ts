import {
  RANK_LABEL,
  RANKS,
  SUITS,
  SUIT_ORDER,
  SUIT_SYMBOL,
  type Card,
  type Rank,
  type Suit,
} from './types.js';

/** 一張牌的絕對強度，可直接拿來排序或比大小。 */
export function cardValue(card: Card): number {
  return card.rank * 4 + SUIT_ORDER[card.suit];
}

export function compareCards(a: Card, b: Card): number {
  return cardValue(a) - cardValue(b);
}

export function makeCard(suit: Suit, rank: Rank): Card {
  return { id: `${suit}${RANK_LABEL[rank]}`, suit, rank };
}

/** 建立一副 52 張的牌。 */
export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(makeCard(suit, rank));
    }
  }
  return deck;
}

/** Fisher-Yates 洗牌，回傳新陣列。 */
export function shuffle<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i]!;
    const b = out[j]!;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

/** 由小到大排序，回傳新陣列。 */
export function sortCards(cards: readonly Card[]): Card[] {
  return cards.slice().sort(compareCards);
}

/** 依花色分組後排序，方便玩家整理手牌。 */
export function sortCardsBySuit(cards: readonly Card[]): Card[] {
  return cards.slice().sort((a, b) => {
    const s = SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
    return s !== 0 ? s : a.rank - b.rank;
  });
}

/** 顯示用文字，例如 '♠A'。 */
export function cardLabel(card: Card): string {
  return `${SUIT_SYMBOL[card.suit]}${RANK_LABEL[card.rank]}`;
}

export function cardsLabel(cards: readonly Card[]): string {
  return cards.map(cardLabel).join(' ');
}

/** 從手牌中依 id 取出對應的牌；只要有任何一個 id 找不到就回 null。 */
export function pickCards(hand: readonly Card[], ids: readonly string[]): Card[] | null {
  const remaining = new Map(hand.map((c) => [c.id, c]));
  const picked: Card[] = [];
  for (const id of ids) {
    const card = remaining.get(id);
    if (!card) return null; // 不在手上，或同一張被指定兩次
    remaining.delete(id);
    picked.push(card);
  }
  return picked;
}

/** 全場最小的牌：方塊 3，持有者先手。 */
export const DIAMOND_THREE_ID = 'D3';

export function hasDiamondThree(cards: readonly Card[]): boolean {
  return cards.some((c) => c.id === DIAMOND_THREE_ID);
}
