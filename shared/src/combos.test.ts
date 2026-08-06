import { describe, expect, it } from 'vitest';
import { createDeck, makeCard, pickCards, sortCards } from './cards.js';
import {
  beatFailure,
  canBeat,
  compareCombo,
  findLegalPlays,
  hasLegalPlay,
  identifyCombo,
  smallestLegalPlay,
} from './combos.js';
import {
  CLASSIC_BIG_TWO_RULES,
  RANK_LABEL,
  TAIWAN_BIG_TWO_RULES,
  type BigTwoRules,
  type Card,
  type Rank,
  type Suit,
} from './types.js';

/** 兩個套組寫短一點，混搭的測試就用 { ...TW, cuts: false } 這種寫法。 */
const TW = TAIWAN_BIG_TWO_RULES;
const CL = CLASSIC_BIG_TWO_RULES;

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

/** 沒指定規則就用一般規則，跟這支的預設值無關 —— 台灣的部分都寫在 beatsTw／typeOfTw。 */
function typeOf(spec: string, rules: BigTwoRules = CL): string | null {
  return identifyCombo(hand(spec), rules)?.type ?? null;
}

/** a 是否壓得過 b。 */
function beats(a: string, b: string, rules: BigTwoRules = CL): boolean {
  const ca = identifyCombo(hand(a), rules);
  const cb = identifyCombo(hand(b), rules);
  if (!ca || !cb) throw new Error(`invalid combo in "${a}" vs "${b}"`);
  return canBeat(ca, cb, rules);
}

function typeOfTw(spec: string): string | null {
  return typeOf(spec, TW);
}

/** 台灣規則版的 beats。 */
function beatsTw(a: string, b: string): boolean {
  return beats(a, b, TW);
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

describe('台灣規則：牌型', () => {
  const dragon = 'D3 C4 H5 S6 D7 C8 H9 S10 DJ CQ HK SA D2';

  it('不收同花，湊成同花的五張只是散牌', () => {
    expect(typeOfTw('D3 D5 D7 D9 DJ')).toBeNull();
    expect(typeOf('D3 D5 D7 D9 DJ')).toBe('flush'); // 一般規則照舊
  });

  it('同花順不受影響，還是同花順', () => {
    expect(typeOfTw('D3 D4 D5 D6 D7')).toBe('straightFlush');
  });

  it('一條龍是 3 到 2 各一張', () => {
    expect(typeOfTw(dragon)).toBe('dragon');
    expect(typeOf(dragon)).toBeNull(); // 一般規則沒有 13 張的牌型
  });

  it('13 張但點數有重複就不是一條龍', () => {
    expect(typeOfTw('D3 C3 H5 S6 D7 C8 H9 S10 DJ CQ HK SA D2')).toBeNull();
  });
});

describe('台灣規則：切', () => {
  const single = 'S2';
  const pair = 'S2 H2';
  const straight = 'D3 C4 H5 S6 D7';
  const fullHouse = 'D3 C3 H3 S4 D4';
  const quads = 'D8 C8 H8 S8 D4';
  const bigQuads = 'D9 C9 H9 S9 D4';
  const straightFlush = 'C3 C4 C5 C6 C7';
  const dragon = 'D3 C4 H5 S6 D7 C8 H9 S10 DJ CQ HK SA D2';

  it('鐵支壓得過任何張數的牌', () => {
    expect(beatsTw(quads, single)).toBe(true);
    expect(beatsTw(quads, pair)).toBe(true);
    expect(beatsTw(quads, straight)).toBe(true);
    expect(beatsTw(quads, fullHouse)).toBe(true);
  });

  it('被切走之後只有更大的切拿得回來', () => {
    expect(beatsTw(pair, quads)).toBe(false);
    expect(beatsTw(straight, quads)).toBe(false);
    expect(beatsTw(fullHouse, quads)).toBe(false);
    expect(beatsTw(bigQuads, quads)).toBe(true); // 同樣是鐵支，比點數
  });

  it('一條龍 > 同花順 > 鐵支', () => {
    expect(beatsTw(straightFlush, quads)).toBe(true);
    expect(beatsTw(quads, straightFlush)).toBe(false);
    expect(beatsTw(dragon, straightFlush)).toBe(true);
    expect(beatsTw(dragon, quads)).toBe(true);
    expect(beatsTw(straightFlush, dragon)).toBe(false);
  });
});

describe('台灣規則：五張只能同型跟', () => {
  const straight = 'D3 C4 H5 S6 D7';
  const bigStraight = 'D4 C5 H6 S7 D8';
  const fullHouse = 'D3 C3 H3 S4 D4';
  const bigFullHouse = 'D9 C9 H9 S4 D4';

  it('順子只能用順子接', () => {
    expect(beatsTw(bigStraight, straight)).toBe(true);
    expect(beatsTw(fullHouse, straight)).toBe(false); // 一般規則裡葫蘆壓得過順子
    expect(beats(fullHouse, straight)).toBe(true);
  });

  it('葫蘆只能用葫蘆接', () => {
    expect(beatsTw(bigFullHouse, fullHouse)).toBe(true);
    expect(beatsTw(bigStraight, fullHouse)).toBe(false);
  });

  it('beatFailure 分得出「牌型不對」與「單純比不過」', () => {
    const small = identifyCombo(hand(straight), TW)!;
    const big = identifyCombo(hand(bigStraight), TW)!;
    const house = identifyCombo(hand(fullHouse), TW)!;
    const pair = identifyCombo(hand('S2 H2'), TW)!;

    expect(beatFailure(big, small, TW)).toBeNull();
    expect(beatFailure(small, big, TW)).toBe('tooSmall');
    expect(beatFailure(house, small, TW)).toBe('comboType');
    expect(beatFailure(pair, small, TW)).toBe('size');
  });
});

describe('台灣規則：找出可出的牌', () => {
  it('跟單張時也會把手上的切算進來', () => {
    const myHand = hand('D8 C8 H8 S8 D4');
    const last = identifyCombo(hand('SA'), TW)!;
    const plays = findLegalPlays(myHand, last, { rules: TW });

    // 沒有單張壓得過 ♠A，但鐵支可以切
    expect(plays).toHaveLength(1);
    expect(plays[0]!.type).toBe('fourOfAKind');
  });

  it('有得跟就不會浪費切', () => {
    const myHand = hand('D3 C4 H5 S6 D7 D8 C8 H8 S8');
    const last = identifyCombo(hand('D3 C4 H5 S6 C7'), TW)!;
    const smallest = smallestLegalPlay(myHand, last, { rules: TW });
    expect(smallest?.type).toBe('straight');
  });

  it('同花不會被列進可出的牌', () => {
    const myHand = hand('D3 D5 D7 D9 DJ');
    const plays = findLegalPlays(myHand, null, { rules: TW });
    expect(plays.some((p) => p.type === 'flush')).toBe(false);
    expect(plays.every((p) => p.size <= 3)).toBe(true); // 只剩單張，湊不出對子
  });
});

describe('規則開關可以單獨拆開用', () => {
  const straight = 'D3 C4 H5 S6 D7';
  const fullHouse = 'D3 C3 H3 S4 D4';
  const quads = 'D8 C8 H8 S8 D4';
  const flush = 'D3 D5 D7 D9 DJ';
  const dragon = 'D3 C4 H5 S6 D7 C8 H9 S10 DJ CQ HK SA D2';

  it('關掉切之後，鐵支只是一種五張牌型', () => {
    const noCuts = { ...TW, cuts: false };
    expect(beats(quads, straight, noCuts)).toBe(false); // 五張同型跟還在，鐵支跟不了順子
    expect(beats('S2', quads, noCuts)).toBe(false); // 張數不對
  });

  it('關掉五張同型跟，切還是切', () => {
    const loose = { ...TW, matchFiveCardType: false };
    expect(beats(fullHouse, straight, loose)).toBe(true); // 退回跨型比較
    expect(beats(quads, straight, loose)).toBe(true); // 切照舊
    expect(beats(straight, quads, loose)).toBe(false);
  });

  it('同花可以單獨開回來，而且照樣受同型跟限制', () => {
    const withFlush = { ...TW, flush: true };
    expect(typeOf(flush, withFlush)).toBe('flush');
    expect(beats(flush, straight, withFlush)).toBe(false); // 順子只能用順子接
    expect(beats(flush, straight, { ...withFlush, matchFiveCardType: false })).toBe(true);
  });

  it('一條龍可以在沒有切的情況下認：只有一條龍跟得起', () => {
    const dragonOnly = { ...CL, dragon: true };
    expect(typeOf(dragon, dragonOnly)).toBe('dragon');
    expect(beats(quads, dragon, dragonOnly)).toBe(false); // 張數不對，也沒有切
    // 領牌時 13 張是合法選項，等於一次出完
    const plays = findLegalPlays(hand(dragon), null, { rules: dragonOnly });
    expect(plays.some((p) => p.type === 'dragon')).toBe(true);
  });

  it('關掉一條龍時，findLegalPlays 不會去枚舉 13 張', () => {
    const plays = findLegalPlays(hand(dragon), null, { rules: { ...TW, dragon: false } });
    expect(plays.some((p) => p.size === 13)).toBe(false);
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
