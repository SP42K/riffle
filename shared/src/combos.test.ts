import { describe, expect, it } from 'vitest';
import { createDeck, makeCard, pickCards, sortCards } from './cards.js';
import {
  canBeat,
  compareCombo,
  findLegalPlays,
  hasLegalPlay,
  identifyCombo,
  smallestLegalPlay,
} from './combos.js';
import { RANK_LABEL, type Card, type Rank, type Suit } from './types.js';

const RANK_BY_LABEL = new Map<string, Rank>(
  (Object.entries(RANK_LABEL) as Array<[string, string]>).map(([rank, label]) => [
    label,
    Number(rank) as Rank,
  ]),
);

/** 'S A' 這種寫法太囉嗦，這裡用 'SA D3 H10' 直接寫牌。 */
function hand(spec: string): Card[] {
  return spec
    .trim()
    .split(/\s+/)
    .map((token) => {
      const suit = token[0] as Suit;
      const rank = RANK_BY_LABEL.get(token.slice(1));
      if (!rank) throw new Error(`bad card token: ${token}`);
      return makeCard(suit, rank);
    });
}

function typeOf(spec: string): string | null {
  return identifyCombo(hand(spec))?.type ?? null;
}

/** a 是否壓得過 b。 */
function beats(a: string, b: string): boolean {
  const ca = identifyCombo(hand(a));
  const cb = identifyCombo(hand(b));
  if (!ca || !cb) throw new Error(`invalid combo in "${a}" vs "${b}"`);
  return canBeat(ca, cb);
}

describe('牌型辨識', () => {
  it('辨識基本牌型', () => {
    expect(typeOf('D3')).toBe('single');
    expect(typeOf('D5 H5')).toBe('pair');
    expect(typeOf('D5 H5 S5')).toBe('triple');
  });

  it('辨識五張牌型', () => {
    expect(typeOf('D3 C4 H5 S6 D7')).toBe('straight');
    expect(typeOf('D3 D7 D9 DJ DK')).toBe('flush');
    expect(typeOf('D5 H5 S5 C9 D9')).toBe('fullHouse');
    expect(typeOf('D8 C8 H8 S8 D2')).toBe('fourOfAKind');
    expect(typeOf('D3 D4 D5 D6 D7')).toBe('straightFlush');
  });

  it('傳入順序不影響辨識', () => {
    expect(typeOf('S6 D3 D7 H5 C4')).toBe('straight');
    expect(typeOf('D9 S5 C9 H5 D5')).toBe('fullHouse');
  });

  it('拒絕非法張數', () => {
    expect(typeOf('D3 C3 H3 S3')).toBeNull(); // 4 張不是牌型
    expect(typeOf('D3 C4 H5 S6 D7 C8')).toBeNull(); // 6 張
    expect(identifyCombo([])).toBeNull();
  });

  it('拒絕湊不成型的組合', () => {
    expect(typeOf('D5 H6')).toBeNull(); // 不成對
    expect(typeOf('D5 H5 S6')).toBeNull(); // 不成三條
    expect(typeOf('D3 C4 H5 S6 D9')).toBeNull(); // 5 張但不順不同花
    expect(typeOf('D3 C3 H5 S6 D7')).toBeNull(); // 有對子的 5 張不是牌型
  });

  it('拒絕重複指定同一張牌', () => {
    const d3 = makeCard('D', 3);
    expect(identifyCombo([d3, d3])).toBeNull();
  });
});

describe('順子邊界', () => {
  it('接受 10-J-Q-K-A', () => {
    expect(typeOf('D10 CJ HQ SK DA')).toBe('straight');
  });

  it('接受 J-Q-K-A-2（最大的順子）', () => {
    expect(typeOf('DJ CQ HK SA D2')).toBe('straight');
  });

  it('拒絕跨頭的 A-2-3-4-5 與 Q-K-A-2-3', () => {
    expect(typeOf('DA C2 H3 S4 D5')).toBeNull();
    expect(typeOf('DQ CK HA S2 D3')).toBeNull();
  });

  it('J-Q-K-A-2 壓得過 10-J-Q-K-A', () => {
    expect(beats('DJ CQ HK SA D2', 'D10 CJ HQ SK DA')).toBe(true);
  });
});

describe('同型比大小', () => {
  it('單張先比點數', () => {
    expect(beats('D2', 'SA')).toBe(true); // 2 最大，即使是最小的花色
    expect(beats('S3', 'DA')).toBe(false);
  });

  it('點數相同時比花色', () => {
    expect(beats('S7', 'H7')).toBe(true);
    expect(beats('D7', 'C7')).toBe(false);
    expect(beats('C7', 'D7')).toBe(true);
  });

  it('對子比點數，同點數比較大的花色', () => {
    expect(beats('D8 C8', 'HJ SJ')).toBe(false);
    expect(beats('S5 D5', 'H5 C5')).toBe(true); // ♠ > ♥
    expect(beats('H5 C5', 'S5 D5')).toBe(false);
  });

  it('三條只比點數', () => {
    expect(beats('D9 C9 H9', 'D8 C8 S8')).toBe(true);
    expect(beats('D4 C4 H4', 'DK CK SK')).toBe(false);
  });

  it('順子比最大張，再比花色', () => {
    expect(beats('D4 C5 H6 S7 D8', 'D3 C4 H5 S6 D7')).toBe(true);
    // 同樣是 3-7，比最大張 7 的花色
    expect(beats('C3 D4 D5 D6 S7', 'D3 C4 H5 S6 H7')).toBe(true);
  });

  it('葫蘆比三條的點數', () => {
    expect(beats('D9 C9 H9 S4 D4', 'D8 C8 H8 SA DA')).toBe(true);
  });

  it('鐵支比四張的點數', () => {
    expect(beats('D9 C9 H9 S9 D3', 'D8 C8 H8 S8 DA')).toBe(true);
  });
});

describe('五張牌型跨型比大小', () => {
  const straight = 'D3 C4 H5 S6 D7';
  const flush = 'D3 D5 D7 D9 DJ';
  const fullHouse = 'D3 C3 H3 S4 D4';
  const quads = 'D3 C3 H3 S3 D4';
  const straightFlush = 'C3 C4 C5 C6 C7';

  it('同花 > 順子', () => {
    expect(beats(flush, straight)).toBe(true);
    expect(beats(straight, flush)).toBe(false);
  });

  it('葫蘆 > 同花', () => {
    expect(beats(fullHouse, flush)).toBe(true);
  });

  it('鐵支 > 葫蘆', () => {
    expect(beats(quads, fullHouse)).toBe(true);
  });

  it('同花順 > 鐵支，且壓得過所有五張牌型', () => {
    expect(beats(straightFlush, quads)).toBe(true);
    expect(beats(straightFlush, straight)).toBe(true);
    expect(beats(straightFlush, flush)).toBe(true);
    expect(beats(straightFlush, fullHouse)).toBe(true);
  });

  it('最小的同花順也壓得過最大的鐵支', () => {
    expect(beats('D3 D4 D5 D6 D7', 'D2 C2 H2 S2 SA')).toBe(true);
  });
});

describe('跟牌張數限制', () => {
  it('張數不同一律不能壓', () => {
    expect(beats('S2', 'D3 C3')).toBe(false);
    expect(beats('S2 H2', 'D3')).toBe(false);
    expect(beats('D3 D4 D5 D6 D7', 'S2 H2')).toBe(false);
  });

  it('compareCombo 對不同張數回 NaN', () => {
    const a = identifyCombo(hand('S2'))!;
    const b = identifyCombo(hand('S2 H2'))!;
    expect(Number.isNaN(compareCombo(a, b))).toBe(true);
  });

  it('自由出牌時任何合法牌型都可以', () => {
    expect(canBeat(identifyCombo(hand('D3'))!, null)).toBe(true);
    expect(canBeat(identifyCombo(hand('D3 C4 H5 S6 D7'))!, null)).toBe(true);
  });
});

describe('找出可出的牌', () => {
  it('跟牌時只找同張數且壓得過的組合', () => {
    const myHand = hand('D3 C3 H5 S5 D9 C9 SA');
    const last = identifyCombo(hand('D4 C4'))!;
    const plays = findLegalPlays(myHand, last);
    expect(plays.every((p) => p.size === 2)).toBe(true);
    // 5、9 兩對可以，3 那對不行
    expect(plays).toHaveLength(2);
  });

  it('沒牌可壓時回空陣列', () => {
    const myHand = hand('D3 C4 H5');
    const last = identifyCombo(hand('S2'))!;
    expect(findLegalPlays(myHand, last)).toHaveLength(0);
    expect(hasLegalPlay(myHand, last)).toBe(false);
  });

  it('mustInclude 可強制第一手包含 ♦3', () => {
    const myHand = hand('D3 C3 H5 S5');
    const plays = findLegalPlays(myHand, null, { mustInclude: ['D3'] });
    expect(plays.every((p) => p.cards.some((c) => c.id === 'D3'))).toBe(true);
    // 單張 ♦3、對 3 兩種
    expect(plays).toHaveLength(2);
  });

  it('smallestLegalPlay 優先挑張數少且最小的', () => {
    const myHand = hand('D3 C3 H5 S5 D9');
    const smallest = smallestLegalPlay(myHand, null);
    expect(smallest?.size).toBe(1);
    expect(smallest?.cards[0]?.id).toBe('D3');
  });

  it('smallestLegalPlay 跟牌時挑剛好壓過的那組', () => {
    const myHand = hand('D3 C4 SA D2');
    const last = identifyCombo(hand('H5'))!;
    expect(smallestLegalPlay(myHand, last)?.cards[0]?.id).toBe('SA');
  });
});

describe('牌組', () => {
  it('一副牌 52 張且不重複', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map((c) => c.id)).size).toBe(52);
  });

  it('♦3 最小、♠2 最大', () => {
    const sorted = sortCards(createDeck());
    expect(sorted[0]!.id).toBe('D3');
    expect(sorted[51]!.id).toBe('S2');
  });

  it('pickCards 抓不到牌時回 null', () => {
    const myHand = hand('D3 C4 H5');
    expect(pickCards(myHand, ['D3', 'H5'])).toHaveLength(2);
    expect(pickCards(myHand, ['S2'])).toBeNull();
    expect(pickCards(myHand, ['D3', 'D3'])).toBeNull(); // 同一張不能用兩次
  });
});
