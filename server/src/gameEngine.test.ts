import { describe, expect, it } from 'vitest';
import {
  CLASSIC_BIG_TWO_RULES,
  HAND_SIZE,
  RANK_LABEL,
  TAIWAN_BIG_TWO_RULES,
  cardValue,
  makeCard,
  sortCards,
  type BigTwoRules,
  type Card,
  type Rank,
  type Suit,
} from 'shared';
import {
  activeSeats,
  autoAct,
  dealGame,
  passTurn,
  playCards,
  type GameState,
  type Seats,
} from './gameEngine.js';

const RANK_BY_LABEL = new Map<string, Rank>(
  (Object.entries(RANK_LABEL) as Array<[string, string]>).map(([rank, label]) => [
    label,
    Number(rank) as Rank,
  ]),
);

function hand(spec: string): Card[] {
  if (!spec.trim()) return [];
  return sortCards(
    spec
      .trim()
      .split(/\s+/)
      .map((token) => makeCard(token[0] as Suit, RANK_BY_LABEL.get(token.slice(1))!)),
  );
}

/** 直接組出一個進行中的局，方便測回合流程。第一位玩家先手，且沒有開局牌限制。 */
function setup(
  specs: Record<string, string>,
  rules: BigTwoRules = CLASSIC_BIG_TWO_RULES,
): { seats: Seats; state: GameState } {
  const seats: Seats = Object.keys(specs);
  const hands = new Map(Object.entries(specs).map(([id, spec]) => [id, hand(spec)]));
  return {
    seats,
    state: {
      rules,
      hands,
      turnSeat: 0,
      lastPlay: null,
      passedSeats: new Set(),
      finished: [],
      openingCardId: null,
      turnDeadline: Date.now() + 45_000,
      over: false,
    },
  };
}

const turn = (seats: Seats, state: GameState) => seats[state.turnSeat];

describe('發牌', () => {
  it('四人局每人 13 張，持 ♣3 者先手', () => {
    const seats: Seats = ['a', 'b', 'c', 'd'];
    const state = dealGame(seats);

    for (const id of seats) {
      expect(state.hands.get(id!)).toHaveLength(HAND_SIZE);
    }
    expect(state.openingCardId).toBe('C3');

    const leader = seats[state.turnSeat]!;
    expect(state.hands.get(leader)!.some((c) => c.id === 'C3')).toBe(true);
  });

  it('每個人拿到的牌不重複', () => {
    const state = dealGame(['a', 'b', 'c', 'd']);
    const all = [...state.hands.values()].flat().map((c) => c.id);
    expect(new Set(all).size).toBe(52);
  });

  it('人數不足時整副牌發不完，開局牌從 ♣3 依序往上找', () => {
    const seats: Seats = ['a', 'b'];
    const state = dealGame(seats);

    expect(state.hands.get('a')).toHaveLength(HAND_SIZE);
    expect(state.hands.get('b')).toHaveLength(HAND_SIZE);

    const dealt = [...state.hands.values()].flat();
    expect(dealt).toHaveLength(26);

    // 以 ♣3 為起點繞一圈，比它小的 ♦3 排到最後
    const clubThree = cardValue(makeCard('C', 3));
    const order = (card: Card) => (cardValue(card) >= clubThree ? cardValue(card) : cardValue(card) + 64);
    const expected = dealt.reduce((best, card) => (order(card) < order(best) ? card : best));

    expect(state.openingCardId).toBe(expected.id);
    // 開局牌一定在先手玩家手上
    const leader = seats[state.turnSeat]!;
    expect(state.hands.get(leader)!.some((c) => c.id === expected.id)).toBe(true);
  });

  it('♣3 只要有發出去就一定是開局牌', () => {
    const clubThree = cardValue(makeCard('C', 3));

    for (let i = 0; i < 200; i++) {
      const state = dealGame(['a', 'b']);
      const dealt = [...state.hands.values()].flat();

      if (dealt.some((c) => c.id === 'C3')) {
        expect(state.openingCardId).toBe('C3');
      } else {
        // 沒有 ♣3 就往上找；連 ♦3 也只有在往上都找不到時才輪得到
        const above = dealt.filter((c) => cardValue(c) > clubThree);
        expect(state.openingCardId).toBe(
          above.length > 0 ? sortCards(above)[0]!.id : 'D3',
        );
      }
    }
  });
});

describe('開局牌限制', () => {
  it('第一手沒帶開局牌會被擋，帶了就過', () => {
    const { seats, state } = setup({ a: 'D3 C4 H5', b: 'S2 SA SK' });
    state.openingCardId = 'D3';

    expect(playCards(seats, state, 'a', ['C4'])).toEqual({
      ok: false,
      error: 'MUST_INCLUDE_OPENING',
    });

    const res = playCards(seats, state, 'a', ['D3']);
    expect(res.ok).toBe(true);
    expect(state.openingCardId).toBeNull(); // 限制只作用於第一手
  });
});

describe('出牌驗證', () => {
  it('不是自己的回合不能出牌', () => {
    const { seats, state } = setup({ a: 'D3 C4', b: 'S2 SA' });
    expect(playCards(seats, state, 'b', ['S2'])).toEqual({ ok: false, error: 'NOT_YOUR_TURN' });
  });

  it('出手上沒有的牌會被擋', () => {
    const { seats, state } = setup({ a: 'D3 C4', b: 'S2 SA' });
    expect(playCards(seats, state, 'a', ['S2'])).toEqual({ ok: false, error: 'NOT_IN_HAND' });
  });

  it('非法牌型會被擋', () => {
    const { seats, state } = setup({ a: 'D3 C4', b: 'S2 SA' });
    expect(playCards(seats, state, 'a', ['D3', 'C4'])).toEqual({ ok: false, error: 'INVALID_COMBO' });
  });

  it('壓不過上一手會被擋', () => {
    const { seats, state } = setup({ a: 'S2 D3', b: 'C4 H5' });
    playCards(seats, state, 'a', ['S2']);
    expect(playCards(seats, state, 'b', ['C4'])).toEqual({ ok: false, error: 'CANNOT_BEAT' });
  });

  it('出牌成功會從手牌移除', () => {
    const { seats, state } = setup({ a: 'D3 C4', b: 'S2 SA' });
    playCards(seats, state, 'a', ['D3']);
    expect(state.hands.get('a')!.map((c) => c.id)).toEqual(['C4']);
    expect(state.lastPlay?.playerId).toBe('a');
  });
});

describe('回合與領牌權', () => {
  it('依座位順序輪轉', () => {
    const { seats, state } = setup({ a: 'D3 D4', b: 'C5 C6', c: 'H7 H8', d: 'S9 S10' });
    playCards(seats, state, 'a', ['D3']);
    expect(turn(seats, state)).toBe('b');
    playCards(seats, state, 'b', ['C5']);
    expect(turn(seats, state)).toBe('c');
  });

  it('領牌者不能 PASS', () => {
    const { seats, state } = setup({ a: 'D3 D4', b: 'C5 C6' });
    expect(passTurn(seats, state, 'a')).toEqual({ ok: false, error: 'CANNOT_PASS_ON_LEAD' });
  });

  it('其他人全部 PASS 後，出牌者取回領牌權', () => {
    const { seats, state } = setup({ a: 'D3 D4', b: 'C5 C6', c: 'H7 H8', d: 'S9 S10' });
    playCards(seats, state, 'a', ['D4']);
    passTurn(seats, state, 'b');
    passTurn(seats, state, 'c');
    passTurn(seats, state, 'd');

    expect(turn(seats, state)).toBe('a');
    expect(state.lastPlay).toBeNull(); // 自由出牌
    expect(state.passedSeats.size).toBe(0);
  });

  it('兩人局：對手 PASS 後立刻取回領牌權', () => {
    const { seats, state } = setup({ a: 'D3 D4', b: 'C5 C6' });
    playCards(seats, state, 'a', ['D4']);
    passTurn(seats, state, 'b');
    expect(turn(seats, state)).toBe('a');
    expect(state.lastPlay).toBeNull();
  });

  it('出牌者打完出局時，下一家直接取得領牌權', () => {
    const { seats, state } = setup({ a: 'S2', b: 'C5 C6', c: 'H7 H8', d: 'S9 S10' });
    // a 用最後一張牌出局
    const res = playCards(seats, state, 'a', ['S2']);
    expect(res.ok && res.result.rank).toBe(1);
    expect(activeSeats(seats, state)).toEqual([1, 2, 3]);

    // 領牌權不會再繞回出局的 a，所以 b 可以自由出牌，也不能 PASS
    expect(turn(seats, state)).toBe('b');
    expect(state.lastPlay).toBeNull();
    expect(passTurn(seats, state, 'b')).toEqual({ ok: false, error: 'CANNOT_PASS_ON_LEAD' });
    expect(playCards(seats, state, 'b', ['C5']).ok).toBe(true);
  });

  it('出完牌的人不再進入輪轉', () => {
    const { seats, state } = setup({ a: 'S2', b: 'C5 C6', c: 'H7 H8' });
    playCards(seats, state, 'a', ['S2']); // a 出局
    expect(turn(seats, state)).toBe('b');

    playCards(seats, state, 'b', ['C5']);
    passTurn(seats, state, 'c');
    // a 已出局，c PASS 後直接繞回 b，不會停在 a
    expect(turn(seats, state)).toBe('b');
    expect(state.lastPlay).toBeNull();
  });
});

describe('台灣規則：PASS 之後這一輪就不能再出', () => {
  it('PASS 掉的人不會再輪到，別人出牌也不解封', () => {
    const { seats, state } = setup(
      { a: 'D3 D4 D5', b: 'C6 C7 C8', c: 'H9 H10 HJ', d: 'SQ SK SA' },
      TAIWAN_BIG_TWO_RULES,
    );
    playCards(seats, state, 'a', ['D3']);
    passTurn(seats, state, 'b'); // b 退出這一輪
    expect(turn(seats, state)).toBe('c');

    playCards(seats, state, 'c', ['H9']);
    expect(state.passedSeats.has(1)).toBe(true); // c 出牌並沒有把 b 放回來
    expect(turn(seats, state)).toBe('d');

    playCards(seats, state, 'd', ['SQ']);
    expect(turn(seats, state)).toBe('a'); // 跳過 b
  });

  it('一般規則裡 PASS 過的人下一圈還是輪得到', () => {
    const { seats, state } = setup({ a: 'D3 D4 D5', b: 'C6 C7 C8', c: 'H9 H10 HJ', d: 'SQ SK SA' });
    playCards(seats, state, 'a', ['D3']);
    passTurn(seats, state, 'b');
    playCards(seats, state, 'c', ['H9']);
    playCards(seats, state, 'd', ['SQ']);
    passTurn(seats, state, 'a');
    expect(turn(seats, state)).toBe('b');
  });

  it('三家都 PASS 之後由最後出牌者重新領牌，封印一起解開', () => {
    const { seats, state } = setup(
      { a: 'D3 D4', b: 'C6 C7', c: 'H9 H10', d: 'SQ SK' },
      TAIWAN_BIG_TWO_RULES,
    );
    playCards(seats, state, 'a', ['D4']);
    passTurn(seats, state, 'b');
    passTurn(seats, state, 'c');
    passTurn(seats, state, 'd');

    expect(turn(seats, state)).toBe('a');
    expect(state.lastPlay).toBeNull();
    expect(state.passedSeats.size).toBe(0);
  });

  it('領牌者出完牌走人時，這一輪作廢，下一位自由出牌', () => {
    const { seats, state } = setup(
      { a: 'S2', b: 'C6 C7', c: 'H9 H10', d: 'SQ SK' },
      TAIWAN_BIG_TWO_RULES,
    );
    state.passedSeats.add(1); // b 這一輪已經 PASS 過
    playCards(seats, state, 'a', ['S2']); // a 出完出局

    expect(turn(seats, state)).toBe('b');
    expect(state.lastPlay).toBeNull();
    expect(state.passedSeats.size).toBe(0);
  });
});

describe('台灣規則：牌型限制與切', () => {
  it('五張只能用同一種牌型跟，鐵支則可以切', () => {
    const { seats, state } = setup(
      { a: 'D3 C4 H5 S6 D7 SK', b: 'D9 C9 H9 S4 D4 C8 H8 S8 D8' },
      TAIWAN_BIG_TWO_RULES,
    );
    playCards(seats, state, 'a', ['D3', 'C4', 'H5', 'S6', 'D7']); // 順子

    expect(playCards(seats, state, 'b', ['D9', 'C9', 'H9', 'S4', 'D4'])).toEqual({
      ok: false,
      error: 'MUST_MATCH_COMBO',
    });
    expect(playCards(seats, state, 'b', ['C8', 'H8', 'S8', 'D8', 'S4']).ok).toBe(true);
  });

  it('同花不是合法牌型', () => {
    const { seats, state } = setup(
      { a: 'D3 D5 D7 D9 DJ', b: 'S2 SA' },
      TAIWAN_BIG_TWO_RULES,
    );
    expect(playCards(seats, state, 'a', ['D3', 'D5', 'D7', 'D9', 'DJ'])).toEqual({
      ok: false,
      error: 'INVALID_COMBO',
    });
  });
});

describe('規則開關可以單獨拆開用', () => {
  it('一般規則加上 PASS 鎖整輪，輪轉就跟著鎖', () => {
    const { seats, state } = setup(
      { a: 'D3 D4 D5', b: 'C6 C7 C8', c: 'H9 H10 HJ', d: 'SQ SK SA' },
      { ...CLASSIC_BIG_TWO_RULES, passLocksTrick: true },
    );
    playCards(seats, state, 'a', ['D3']);
    passTurn(seats, state, 'b');
    playCards(seats, state, 'c', ['H9']);
    expect(state.passedSeats.has(1)).toBe(true); // 出牌沒有把 b 放回來
    playCards(seats, state, 'd', ['SQ']);
    expect(turn(seats, state)).toBe('a'); // 跳過 b
  });

  it('台灣規則關掉 PASS 鎖整輪，同花仍然不合法但 PASS 過的人回得來', () => {
    const { seats, state } = setup(
      { a: 'D3 D4 D5', b: 'C6 C7 C8', c: 'H9 H10 HJ', d: 'SQ SK SA' },
      { ...TAIWAN_BIG_TWO_RULES, passLocksTrick: false },
    );
    playCards(seats, state, 'a', ['D3']);
    passTurn(seats, state, 'b');
    playCards(seats, state, 'c', ['H9']);
    expect(state.passedSeats.size).toBe(0); // 有人出牌就解封
    playCards(seats, state, 'd', ['SQ']);
    passTurn(seats, state, 'a');
    expect(turn(seats, state)).toBe('b');
  });
});

describe('結束與名次', () => {
  it('剩最後一人時遊戲結束，名次依出完順序', () => {
    const { seats, state } = setup({ a: 'D3', b: 'C4', c: 'S2' });

    playCards(seats, state, 'a', ['D3']); // a 第一名
    playCards(seats, state, 'b', ['C4']); // b 第二名
    // 只剩 c，遊戲自動結束
    expect(state.over).toBe(true);
    expect(state.finished).toEqual(['a', 'b', 'c']);
  });

  it('結束後不能再出牌', () => {
    const { seats, state } = setup({ a: 'D3', b: 'C4' });
    playCards(seats, state, 'a', ['D3']);
    expect(state.over).toBe(true);
    expect(playCards(seats, state, 'b', ['C4'])).toEqual({ ok: false, error: 'GAME_NOT_RUNNING' });
  });
});

describe('代打（逾時／斷線）', () => {
  it('跟牌時自動 PASS', () => {
    const { seats, state } = setup({ a: 'S2 D3', b: 'C4 C5' });
    playCards(seats, state, 'a', ['S2']);
    expect(autoAct(seats, state)).toEqual({ action: 'pass' });
    expect(turn(seats, state)).toBe('a');
  });

  it('有領牌權時自動出最小的一張', () => {
    const { seats, state } = setup({ a: 'S2 D3 C9', b: 'C4 C5' });
    const acted = autoAct(seats, state);
    expect(acted?.action).toBe('play');
    expect(state.lastPlay?.combo.cards.map((c) => c.id)).toEqual(['D3']);
  });

  it('有開局牌限制時，代打也會遵守', () => {
    const { seats, state } = setup({ a: 'D3 C9 S2', b: 'C4 C5' });
    state.openingCardId = 'D3';
    autoAct(seats, state);
    expect(state.lastPlay?.combo.cards.map((c) => c.id)).toEqual(['D3']);
  });
});
