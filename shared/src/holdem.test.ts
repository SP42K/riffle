import { describe, expect, it } from 'vitest';
import { makeCard } from './cards.js';
import {
  bestHand,
  compareHoldemHands,
  describeHoldemHand,
  evaluateFive,
  holdemRank,
  legalActions,
  type HoldemCategory,
} from './holdem.js';
import { RANK_LABEL, type Card, type Rank, type Suit } from './types.js';

const RANK_BY_LABEL = new Map<string, Rank>(
  (Object.entries(RANK_LABEL) as Array<[string, string]>).map(([rank, label]) => [
    label,
    Number(rank) as Rank,
  ]),
);

/** 'SA D3 H10' 這種寫法直接寫牌。 */
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

function categoryOf(spec: string): HoldemCategory {
  return evaluateFive(hand(spec)).category;
}

/** a 是否強過 b。 */
function stronger(a: string, b: string): number {
  return compareHoldemHands(evaluateFive(hand(a)), evaluateFive(hand(b)));
}

describe('點數映射', () => {
  it('把大老二的 2（權重 15）換回德州的 2', () => {
    expect(holdemRank(makeCard('S', 15))).toBe(2);
  });

  it('A 是 14、K 是 13', () => {
    expect(holdemRank(makeCard('S', 14))).toBe(14);
    expect(holdemRank(makeCard('S', 13))).toBe(13);
  });
});

describe('牌型辨識', () => {
  it('高牌', () => {
    expect(categoryOf('SA D9 C7 H5 S3')).toBe('highCard');
  });

  it('一對', () => {
    expect(categoryOf('SA DA C7 H5 S3')).toBe('onePair');
  });

  it('兩對', () => {
    expect(categoryOf('SA DA C7 H7 S3')).toBe('twoPair');
  });

  it('三條', () => {
    expect(categoryOf('SA DA CA H7 S3')).toBe('threeOfAKind');
  });

  it('順子', () => {
    expect(categoryOf('S9 D8 C7 H6 S5')).toBe('straight');
  });

  it('同花', () => {
    expect(categoryOf('SA S9 S7 S5 S3')).toBe('flush');
  });

  it('葫蘆', () => {
    expect(categoryOf('SA DA CA H7 S7')).toBe('fullHouse');
  });

  it('鐵支', () => {
    expect(categoryOf('SA DA CA HA S7')).toBe('fourOfAKind');
  });

  it('同花順', () => {
    expect(categoryOf('S9 S8 S7 S6 S5')).toBe('straightFlush');
  });
});

describe('順子邊界', () => {
  it('A-2-3-4-5 是順子（輪子），且算 5 高', () => {
    const wheel = evaluateFive(hand('SA D2 C3 H4 S5'));
    expect(wheel.category).toBe('straight');
    expect(wheel.tiebreak).toEqual([5]);
  });

  it('10-J-Q-K-A 是最大的順子', () => {
    const broadway = evaluateFive(hand('S10 DJ CQ HK SA'));
    expect(broadway.tiebreak).toEqual([14]);
    expect(stronger('S10 DJ CQ HK SA', 'SA D2 C3 H4 S5')).toBeGreaterThan(0);
  });

  it('K-A-2-3-4 不是順子（A 不能連在中間）', () => {
    expect(categoryOf('SK DA C2 H3 S4')).toBe('highCard');
  });

  it('J-Q-K-A-2 在德州不是順子（那是大老二的規則）', () => {
    expect(categoryOf('SJ DQ CK HA S2')).toBe('highCard');
  });

  it('同花的輪子是同花順', () => {
    expect(categoryOf('SA S2 S3 S4 S5')).toBe('straightFlush');
  });
});

describe('牌型高低順序', () => {
  it('同花大於順子（跟大老二相反的地方）', () => {
    expect(stronger('SA S9 S7 S5 S3', 'S9 D8 C7 H6 S5')).toBeGreaterThan(0);
  });

  it('葫蘆大於同花', () => {
    expect(stronger('SA DA CA H7 S7', 'SA S9 S7 S5 S3')).toBeGreaterThan(0);
  });

  it('鐵支大於葫蘆', () => {
    expect(stronger('SA DA CA HA S7', 'SK DK CK H7 S7')).toBeGreaterThan(0);
  });

  it('同花順最大', () => {
    expect(stronger('S5 S4 S3 S2 SA', 'SA DA CA HA SK')).toBeGreaterThan(0);
  });
});

describe('kicker 比較', () => {
  it('一對相同時比三張 kicker', () => {
    expect(stronger('SA DA CK H5 S3', 'HA CA DQ S5 D3')).toBeGreaterThan(0);
  });

  it('兩對相同時比第五張', () => {
    expect(stronger('SA DA CK HK S9', 'HA CA DK SK C4')).toBeGreaterThan(0);
  });

  it('兩對先比大的那對', () => {
    expect(stronger('SA DA C3 H3 S9', 'SK DK CQ HQ S9')).toBeGreaterThan(0);
  });

  it('葫蘆先比三條再比對子', () => {
    expect(stronger('SA DA CA H2 S2', 'SK DK CK HA SA')).toBeGreaterThan(0);
    expect(stronger('SA DA CA HK SK', 'HA CA DA S2 D2')).toBeGreaterThan(0);
  });

  it('同花逐張比大小', () => {
    expect(stronger('SA SK S7 S5 S3', 'DA DK D7 D5 D2')).toBeGreaterThan(0);
  });

  it('高牌逐張比大小', () => {
    expect(stronger('SA D9 C7 H5 S4', 'HA C9 D7 S5 D3')).toBeGreaterThan(0);
  });
});

describe('花色不影響大小', () => {
  it('點數完全相同就是平手，要分池', () => {
    expect(stronger('SA SK SQ SJ S9', 'DA DK DQ DJ D9')).toBe(0);
    expect(stronger('SA DA C7 H5 S3', 'HA CA D7 S5 C3')).toBe(0);
  });

  it('同花順也一樣，花色不分高下', () => {
    expect(stronger('S9 S8 S7 S6 S5', 'D9 D8 D7 D6 D5')).toBe(0);
  });
});

describe('七選五', () => {
  it('從七張裡挑出最強的五張', () => {
    // 底牌 ♠A ♠K + 公共牌 ♠Q ♠J ♠10 ♥2 ♦2 → 皇家同花順，而不是兩對
    const best = bestHand(hand('SA SK SQ SJ S10 H2 D2'))!;
    expect(best.category).toBe('straightFlush');
    expect(best.tiebreak).toEqual([14]);
  });

  it('會捨棄手上的對子去成順子', () => {
    const best = bestHand(hand('S9 D8 C7 H6 S5 DA HA'))!;
    expect(best.category).toBe('straight');
    expect(best.tiebreak).toEqual([9]);
  });

  it('六張同花取最大的五張', () => {
    const best = bestHand(hand('SA SK SQ S9 S7 S3 H2'))!;
    expect(best.category).toBe('flush');
    expect(best.tiebreak).toEqual([14, 13, 12, 9, 7]);
  });

  it('不到五張回 null', () => {
    expect(bestHand(hand('SA SK'))).toBeNull();
  });

  it('有重複的牌回 null', () => {
    expect(bestHand(hand('SA SA SK SQ SJ'))).toBeNull();
  });

  it('回傳的五張就是實際用到的牌', () => {
    const best = bestHand(hand('SA DA CA H7 S7 D3 C2'))!;
    expect(best.category).toBe('fullHouse');
    expect(best.cards).toHaveLength(5);
    expect(best.cards.map((c) => c.id).sort()).toEqual(['CA', 'DA', 'H7', 'S7', 'SA'].sort());
  });
});

describe('牌型描述', () => {
  it('皇家同花順有專屬名稱', () => {
    expect(describeHoldemHand(evaluateFive(hand('SA SK SQ SJ S10')))).toBe('皇家同花順');
  });

  it('葫蘆講三條再講對子', () => {
    expect(describeHoldemHand(evaluateFive(hand('SK DK CK H7 S7')))).toBe('葫蘆 K 帶 7');
  });

  it('輪子順講 5 高', () => {
    expect(describeHoldemHand(evaluateFive(hand('SA D2 C3 H4 S5')))).toBe('順子 5 高');
  });

  it('兩對講兩個點數', () => {
    expect(describeHoldemHand(evaluateFive(hand('SA DA CK HK S9')))).toBe('兩對 A 與 K');
  });
});

describe('下注合法性', () => {
  const base = {
    chips: 1000,
    committed: 0,
    currentBet: 0,
    minRaise: 20,
    folded: false,
    allIn: false,
    isTurn: true,
  };

  it('沒人下注時可以過牌，不能跟注', () => {
    const actions = legalActions(base);
    expect(actions.canCheck).toBe(true);
    expect(actions.canCall).toBe(false);
    expect(actions.canRaise).toBe(true);
    expect(actions.minRaiseTo).toBe(20);
    expect(actions.maxRaiseTo).toBe(1000);
  });

  it('有人下注時要跟注，且跟注額扣掉本街已投入的部分', () => {
    const actions = legalActions({ ...base, currentBet: 100, committed: 40 });
    expect(actions.canCheck).toBe(false);
    expect(actions.canCall).toBe(true);
    expect(actions.callAmount).toBe(60);
    expect(actions.minRaiseTo).toBe(120);
  });

  it('籌碼不夠跟滿時，跟注額就是全部籌碼', () => {
    const actions = legalActions({ ...base, chips: 30, currentBet: 100 });
    expect(actions.callAmount).toBe(30);
    expect(actions.canRaise).toBe(false); // 加不到超過現有注額，只能 all-in 跟
  });

  it('籌碼不夠加滿最小幅度時仍可短加注 all-in', () => {
    const actions = legalActions({ ...base, chips: 110, currentBet: 100 });
    expect(actions.canRaise).toBe(true);
    expect(actions.minRaiseTo).toBe(110); // 被 maxRaiseTo 夾住，不是 120
    expect(actions.maxRaiseTo).toBe(110);
  });

  it('不是自己的回合、已蓋牌、已 all-in 都不能動作', () => {
    expect(legalActions({ ...base, isTurn: false }).canFold).toBe(false);
    expect(legalActions({ ...base, folded: true }).canFold).toBe(false);
    expect(legalActions({ ...base, allIn: true }).canCheck).toBe(false);
    expect(legalActions({ ...base, chips: 0 }).canCheck).toBe(false);
  });
});
