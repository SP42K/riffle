import { describe, expect, it } from 'vitest';
import { RANK_LABEL, createDeck, makeCard, type Card, type Rank, type Suit } from 'shared';
import type { Seats } from './gameEngine.js';
import {
  actionsFor,
  applyBet,
  autoActHoldem,
  buildPots,
  nextButtonSeat,
  removePlayerFromHoldem,
  startHand,
  type HoldemState,
} from './holdemEngine.js';

const RANK_BY_LABEL = new Map<string, Rank>(
  (Object.entries(RANK_LABEL) as Array<[string, string]>).map(([rank, label]) => [
    label,
    Number(rank) as Rank,
  ]),
);

function hand(spec: string): Card[] {
  if (!spec.trim()) return [];
  return spec
    .trim()
    .split(/\s+/)
    .map((token) => makeCard(token[0] as Suit, RANK_BY_LABEL.get(token.slice(1))!));
}

/**
 * 組出一副指定牌序的牌：依座位順序每人兩張底牌，接著是五張公共牌，
 * 剩下的用整副牌補滿。startHand 就是照這個順序取牌的。
 */
function deckOf(holes: readonly string[], board = ''): Card[] {
  const cards = [...holes.flatMap(hand), ...hand(board)];
  const used = new Set(cards.map((c) => c.id));
  for (const card of createDeck()) if (!used.has(card.id)) cards.push(card);
  return cards;
}

/** 依籌碼數組出座位表，玩家 id 是 'a'、'b'、'c'…。 */
function table(stacks: readonly number[]): { seats: Seats; chips: Map<string, number> } {
  const seats: Seats = stacks.map((_, i) => String.fromCharCode(97 + i));
  const chips = new Map(stacks.map((amount, i) => [String.fromCharCode(97 + i), amount]));
  return { seats, chips };
}

const turnOf = (seats: Seats, state: HoldemState) => seats[state.turnSeat];
const committedOf = (state: HoldemState, id: string) => state.committed.get(id) ?? 0;

describe('盲注與先手', () => {
  it('三人局：莊家左手小盲、再左手大盲，由大盲左手先講話', () => {
    const { seats, chips } = table([1000, 1000, 1000]);
    const state = startHand(seats, chips, 0);

    expect(state.smallBlindSeat).toBe(1);
    expect(state.bigBlindSeat).toBe(2);
    expect(committedOf(state, 'b')).toBe(10);
    expect(committedOf(state, 'c')).toBe(20);
    expect(state.currentBet).toBe(20);
    expect(turnOf(seats, state)).toBe('a');
  });

  it('兩人單挑：莊家就是小盲，翻牌前由莊家先講話', () => {
    const { seats, chips } = table([1000, 1000]);
    const state = startHand(seats, chips, 0);

    expect(state.smallBlindSeat).toBe(0);
    expect(state.bigBlindSeat).toBe(1);
    expect(turnOf(seats, state)).toBe('a');
  });

  it('兩人單挑：翻牌後改由大盲先講話', () => {
    const { seats, chips } = table([1000, 1000]);
    const state = startHand(seats, chips, 0);

    expect(applyBet(seats, state, 'a', 'call').ok).toBe(true);
    expect(applyBet(seats, state, 'b', 'check').ok).toBe(true);

    expect(state.street).toBe('flop');
    expect(state.board).toHaveLength(3);
    expect(turnOf(seats, state)).toBe('b');
  });

  it('籌碼歸零的人這一手不發牌', () => {
    const { seats, chips } = table([1000, 0, 1000]);
    const state = startHand(seats, chips, 0);

    expect(state.hole.has('b')).toBe(false);
    // 只剩兩人有籌碼，走的是單挑規則：莊家就是小盲
    expect(state.smallBlindSeat).toBe(0);
    expect(state.bigBlindSeat).toBe(2);
    expect(turnOf(seats, state)).toBe('a');
  });

  it('不足兩人有籌碼時直接結束', () => {
    const { seats, chips } = table([1000, 0]);
    const state = startHand(seats, chips, 0);
    expect(state.over).toBe(true);
  });

  it('莊家鈕會跳過沒籌碼的座位', () => {
    const { seats, chips } = table([1000, 0, 1000]);
    expect(nextButtonSeat(seats, chips, 0)).toBe(2);
    expect(nextButtonSeat(seats, chips, 2)).toBe(0);
  });
});

describe('下注流程', () => {
  it('大盲在翻牌前無人加注時仍有表態權', () => {
    const { seats, chips } = table([1000, 1000, 1000]);
    const state = startHand(seats, chips, 0);

    expect(applyBet(seats, state, 'a', 'call').ok).toBe(true);
    expect(applyBet(seats, state, 'b', 'call').ok).toBe(true);
    // 三家都投入 20 了，但大盲還沒表態，這一街不能就這樣結束
    expect(state.street).toBe('preflop');
    expect(turnOf(seats, state)).toBe('c');

    expect(applyBet(seats, state, 'c', 'check').ok).toBe(true);
    expect(state.street).toBe('flop');
    // 翻牌後由莊家左手第一位先講話
    expect(turnOf(seats, state)).toBe('b');
  });

  it('大盲可以行使加注權', () => {
    const { seats, chips } = table([1000, 1000, 1000]);
    const state = startHand(seats, chips, 0);

    applyBet(seats, state, 'a', 'call');
    applyBet(seats, state, 'b', 'call');
    expect(applyBet(seats, state, 'c', 'raise', 60).ok).toBe(true);

    expect(state.street).toBe('preflop');
    expect(state.currentBet).toBe(60);
    expect(turnOf(seats, state)).toBe('a');
  });

  it('有人下注時不能過牌', () => {
    const { seats, chips } = table([1000, 1000, 1000]);
    const state = startHand(seats, chips, 0);
    expect(applyBet(seats, state, 'a', 'check')).toEqual({ ok: false, error: 'CANNOT_CHECK' });
  });

  it('不是自己的回合不能動作', () => {
    const { seats, chips } = table([1000, 1000, 1000]);
    const state = startHand(seats, chips, 0);
    expect(applyBet(seats, state, 'b', 'call')).toEqual({ ok: false, error: 'NOT_YOUR_TURN' });
  });

  it('加注幅度不足會被擋下來', () => {
    const { seats, chips } = table([1000, 1000, 1000]);
    const state = startHand(seats, chips, 0);
    expect(applyBet(seats, state, 'a', 'raise', 30)).toEqual({ ok: false, error: 'RAISE_TOO_SMALL' });
    expect(applyBet(seats, state, 'a', 'raise', 40).ok).toBe(true);
  });

  it('加注超過手上籌碼會被擋下來', () => {
    const { seats, chips } = table([1000, 1000, 1000]);
    const state = startHand(seats, chips, 0);
    expect(applyBet(seats, state, 'a', 'raise', 2000)).toEqual({
      ok: false,
      error: 'NOT_ENOUGH_CHIPS',
    });
  });

  it('再加注的最小幅度跟著上一次加注的幅度走', () => {
    const { seats, chips } = table([1000, 1000, 1000]);
    const state = startHand(seats, chips, 0);

    applyBet(seats, state, 'a', 'raise', 60); // 幅度 40
    expect(state.minRaise).toBe(40);
    expect(applyBet(seats, state, 'b', 'raise', 90)).toEqual({
      ok: false,
      error: 'RAISE_TOO_SMALL',
    });
    expect(applyBet(seats, state, 'b', 'raise', 100).ok).toBe(true);
  });

  it('一街打完會把本街投入歸零並重開注額', () => {
    const { seats, chips } = table([1000, 1000]);
    const state = startHand(seats, chips, 0);

    applyBet(seats, state, 'a', 'call');
    applyBet(seats, state, 'b', 'check');

    expect(state.currentBet).toBe(0);
    expect(committedOf(state, 'a')).toBe(0);
    expect(state.totalCommitted.get('a')).toBe(20);
  });

  it('打到河牌會依序發出五張公共牌', () => {
    const { seats, chips } = table([1000, 1000]);
    const state = startHand(seats, chips, 0);

    applyBet(seats, state, 'a', 'call');
    applyBet(seats, state, 'b', 'check');
    expect(state.board).toHaveLength(3);

    applyBet(seats, state, 'b', 'check');
    applyBet(seats, state, 'a', 'check');
    expect(state.street).toBe('turn');
    expect(state.board).toHaveLength(4);

    applyBet(seats, state, 'b', 'check');
    applyBet(seats, state, 'a', 'check');
    expect(state.street).toBe('river');
    expect(state.board).toHaveLength(5);

    applyBet(seats, state, 'b', 'check');
    applyBet(seats, state, 'a', 'check');
    expect(state.over).toBe(true);
    expect(state.showdown).not.toBeNull();
  });
});

describe('短 all-in 不重開加注權', () => {
  it('已表態過的人只能跟或蓋，還沒表態的人仍可加注', () => {
    // c 是大盲且只有 130 籌碼，加到 130 只多了 30，不足最小加注幅度 80
    const { seats, chips } = table([1000, 1000, 130, 1000]);
    const state = startHand(seats, chips, 0);

    applyBet(seats, state, 'd', 'call'); // 四人局由大盲左手的 d 先講話
    applyBet(seats, state, 'a', 'raise', 100); // 幅度 80，所有人重新表態
    expect(state.minRaise).toBe(80);
    applyBet(seats, state, 'b', 'fold');
    expect(applyBet(seats, state, 'c', 'allin').ok).toBe(true);

    expect(state.currentBet).toBe(130);
    expect(state.minRaise).toBe(80); // 沒被短 all-in 改動

    // a 加注後 d 還沒重新表態過，仍保有加注權
    expect(turnOf(seats, state)).toBe('d');
    expect(actionsFor(seats, state, 'd').canRaise).toBe(true);
    applyBet(seats, state, 'd', 'call');

    // a 在短 all-in 之前已經表態過了，只能跟或蓋
    expect(turnOf(seats, state)).toBe('a');
    const actions = actionsFor(seats, state, 'a');
    expect(actions.canRaise).toBe(false);
    expect(actions.canCall).toBe(true);
    expect(actions.callAmount).toBe(30);
    expect(applyBet(seats, state, 'a', 'raise', 300)).toEqual({ ok: false, error: 'CANNOT_RAISE' });
  });

  it('足額加注會重開所有人的加注權', () => {
    const { seats, chips } = table([1000, 1000, 1000]);
    const state = startHand(seats, chips, 0);

    applyBet(seats, state, 'a', 'raise', 60);
    applyBet(seats, state, 'b', 'raise', 200);
    expect(turnOf(seats, state)).toBe('c');
    applyBet(seats, state, 'c', 'call');
    expect(turnOf(seats, state)).toBe('a');
    expect(actionsFor(seats, state, 'a').canRaise).toBe(true);
  });
});

describe('邊池', () => {
  it('三人不同額度 all-in 會切出主池與邊池，並分別比牌', () => {
    const { seats, chips } = table([100, 200, 300]);
    // a 皇家同花順（吃主池）、c 一對 Q（吃邊池）、b 高牌
    const deck = deckOf(['SA SK', 'D2 D3', 'HQ H2'], 'SQ SJ S10 D7 C8');
    const state = startHand(seats, chips, 2, { deck });

    // 莊家是 c，小盲 a、大盲 b，由 c 先講話
    expect(turnOf(seats, state)).toBe('c');
    applyBet(seats, state, 'c', 'allin');
    applyBet(seats, state, 'a', 'allin');
    applyBet(seats, state, 'b', 'allin');

    expect(state.over).toBe(true);
    expect(state.board).toHaveLength(5);

    // c 多押的 100 沒人跟得起，退回去
    expect(state.totalCommitted.get('c')).toBe(200);
    expect(state.pots).toEqual([
      { amount: 300, eligible: ['a', 'b', 'c'] },
      { amount: 200, eligible: ['b', 'c'] },
    ]);

    expect(chips.get('a')).toBe(300); // 主池 300
    expect(chips.get('b')).toBe(0);
    expect(chips.get('c')).toBe(300); // 退回的 100 + 邊池 200
    expect(chips.get('a')! + chips.get('b')! + chips.get('c')!).toBe(600);
  });

  it('已蓋牌的人籌碼留在池裡但沒有分池資格', () => {
    const { seats, chips } = table([1000, 1000, 1000]);
    const state = startHand(seats, chips, 0);

    applyBet(seats, state, 'a', 'call');
    applyBet(seats, state, 'b', 'call');
    applyBet(seats, state, 'c', 'check');
    // 翻牌後 b 下注、c 蓋牌、a 跟注
    applyBet(seats, state, 'b', 'raise', 50);
    applyBet(seats, state, 'c', 'fold');
    applyBet(seats, state, 'a', 'call');

    const pots = buildPots(seats, state);
    expect(pots).toHaveLength(1);
    expect(pots[0]!.amount).toBe(160); // 20×3 + 50×2
    expect(pots[0]!.eligible.sort()).toEqual(['a', 'b']);
  });

  it('沒人跟的下注會退還，不會白白丟進池裡', () => {
    const { seats, chips } = table([1000, 1000, 1000]);
    const state = startHand(seats, chips, 0);

    applyBet(seats, state, 'a', 'raise', 200);
    applyBet(seats, state, 'b', 'fold');
    applyBet(seats, state, 'c', 'fold');

    expect(state.over).toBe(true);
    // a 贏的是兩家的盲注 30，多押的 180 原封退回
    expect(chips.get('a')).toBe(1030);
    expect(chips.get('b')).toBe(990);
    expect(chips.get('c')).toBe(980);
  });
});

describe('分池與零頭', () => {
  it('平手均分，零頭給莊家左手最近的贏家', () => {
    const { seats, chips } = table([51, 51, 51]);
    // a 與 b 的牌力完全相同（A K J 9 7 高牌），c 蓋牌
    const deck = deckOf(['SA SK', 'DA DK', 'H3 H4'], 'C2 C5 C7 H9 HJ');
    const state = startHand(seats, chips, 0, { deck, smallBlind: 5, bigBlind: 15 });

    applyBet(seats, state, 'a', 'allin');
    applyBet(seats, state, 'b', 'allin');
    applyBet(seats, state, 'c', 'fold');

    expect(state.over).toBe(true);
    expect(state.pots).toEqual([{ amount: 117, eligible: ['a', 'b'] }]);

    // 117 除不盡，零頭給莊家（座位 0）左手最近的贏家 b
    expect(chips.get('b')).toBe(59);
    expect(chips.get('a')).toBe(58);
    expect(chips.get('c')).toBe(36);
  });
});

describe('提早結束', () => {
  it('只剩一人未蓋牌時立刻結算，且不揭露底牌', () => {
    const { seats, chips } = table([1000, 1000]);
    const state = startHand(seats, chips, 0);

    applyBet(seats, state, 'a', 'raise', 60);
    applyBet(seats, state, 'b', 'fold');

    expect(state.over).toBe(true);
    expect(state.board).toHaveLength(0); // 沒必要再發公共牌
    expect(state.showdown).toEqual([{ playerId: 'a', hole: null, hand: null, won: 40 }]);
    expect(chips.get('a')).toBe(1020);
  });

  it('全員 all-in 時直接發完公共牌再攤牌', () => {
    const { seats, chips } = table([1000, 1000]);
    const state = startHand(seats, chips, 0);

    applyBet(seats, state, 'a', 'allin');
    applyBet(seats, state, 'b', 'allin');

    expect(state.over).toBe(true);
    expect(state.street).toBe('showdown');
    expect(state.board).toHaveLength(5);
    expect(state.showdown).toHaveLength(2);
    expect(state.showdown!.every((entry) => entry.hole !== null)).toBe(true);
  });
});

describe('代打與離席', () => {
  it('逾時代打：能過牌就過牌', () => {
    const { seats, chips } = table([1000, 1000]);
    const state = startHand(seats, chips, 0);
    applyBet(seats, state, 'a', 'call');

    expect(autoActHoldem(seats, state)).toEqual({ playerId: 'b', action: 'check' });
    expect(state.street).toBe('flop');
  });

  it('逾時代打：有注要跟就蓋牌', () => {
    const { seats, chips } = table([1000, 1000, 1000]);
    const state = startHand(seats, chips, 0);

    expect(autoActHoldem(seats, state)).toEqual({ playerId: 'a', action: 'fold' });
    expect(state.folded.has('a')).toBe(true);
  });

  it('中途離開視為蓋牌，已投入的籌碼留在池裡', () => {
    const { seats, chips } = table([1000, 1000, 1000]);
    const state = startHand(seats, chips, 0);

    applyBet(seats, state, 'a', 'call'); // a 投入 20
    removePlayerFromHoldem(seats, state, 'a');

    expect(state.folded.has('a')).toBe(true);
    expect(state.totalCommitted.get('a')).toBe(20);
    expect(chips.get('a')).toBe(980);
    // a 不是當下該行動的人，回合不該被推走
    expect(turnOf(seats, state)).toBe('b');
  });

  it('該行動的人離開時，回合會交給下一位', () => {
    const { seats, chips } = table([1000, 1000, 1000]);
    const state = startHand(seats, chips, 0);

    expect(turnOf(seats, state)).toBe('a');
    removePlayerFromHoldem(seats, state, 'a');
    expect(turnOf(seats, state)).toBe('b');
  });

  it('剩最後一人時這一手立刻結束', () => {
    const { seats, chips } = table([1000, 1000, 1000]);
    const state = startHand(seats, chips, 0);

    removePlayerFromHoldem(seats, state, 'a');
    removePlayerFromHoldem(seats, state, 'b');

    expect(state.over).toBe(true);
    expect(chips.get('c')).toBe(1010); // 收下 b 的小盲
  });
});
