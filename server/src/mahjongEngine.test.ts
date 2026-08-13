import { describe, expect, it } from 'vitest';
import {
  allMahjongRoundReady,
  autoActMahjong,
  chooseSelfDrawAction,
  confirmMahjongRoundReady,
  discardTile,
  finalizeMahjongMatch,
  rankMahjongSeats,
  respondToReaction,
  startMahjong,
  type MahjongState,
} from './mahjongEngine.js';
import type { Seats } from './gameEngine.js';

const SEATS: Seats = ['p0', 'p1', 'p2', 'p3'];

describe('startMahjong', () => {
  it('deals 17 tiles to the banker and 16 to everyone else', () => {
    // 莊家現在是開局擲骰決定的，不再固定是 0 號座位，所以照 state.bankerSeat 動態檢查
    const state = startMahjong(SEATS);
    for (let seat = 0; seat < 4; seat++) {
      expect(state.players[seat]!.hand.length).toBe(seat === state.bankerSeat ? 17 : 16);
    }
    expect(state.phase).toBe('discard');
    expect(state.turnSeat).toBe(state.bankerSeat);
    expect(state.over).toBe(false);
    expect(state.matchOver).toBe(false);
  });

  it('picks the banker by rolling three dice and counting from seat 0', () => {
    const state = startMahjong(SEATS);
    for (const die of state.bankerDice) {
      expect(die).toBeGreaterThanOrEqual(1);
      expect(die).toBeLessThanOrEqual(6);
    }
    const sum = state.bankerDice[0] + state.bankerDice[1] + state.bankerDice[2];
    expect(state.bankerSeat).toBe((sum - 1) % 4);
  });

  it('starts every player at 1000 points', () => {
    const state = startMahjong(SEATS);
    for (const p of state.players) expect(p.score).toBe(1000);
  });
});

describe('discardTile', () => {
  it('rejects a discard from a seat that is not the current turn', () => {
    // 莊家（turnSeat）現在是擲骰決定的，不能假設是固定座位，動態挑一個「不是莊家」的座位來測
    const state = startMahjong(SEATS);
    const notTurnSeat = (state.turnSeat + 1) % 4;
    const tile = state.players[notTurnSeat]!.hand[0]!;
    const result = discardTile(SEATS, state, SEATS[notTurnSeat]!, tile);
    expect(result).toEqual({ ok: false, error: 'NOT_YOUR_TURN' });
  });

  it('rejects a tile the player does not hold', () => {
    const state = startMahjong(SEATS);
    // 用一個不存在於牌組裡的假代號，保證一定不在手上
    const result = discardTile(SEATS, state, SEATS[state.turnSeat]!, 'ZZ');
    expect(result).toEqual({ ok: false, error: 'NOT_IN_HAND' });
  });

  it('advances the turn after a legal discard with no reaction available', () => {
    const state = startMahjong(SEATS);
    const before = state.turnSeat;
    const tile = state.players[before]!.hand[0]!;
    const result = discardTile(SEATS, state, SEATS[before]!, tile);
    expect(result.ok).toBe(true);
    // 出完牌後不是還在原座位的出牌階段，就是進了反應／自摸階段
    expect(state.turnSeat === before && state.phase === 'discard').toBe(false);
  });

  it('clears justDrawn for the seat that discarded, so the client never shows a tile already thrown', () => {
    const state = startMahjong(SEATS);
    const seat = state.turnSeat;
    expect(state.justDrawn?.seat).toBe(seat);
    const tile = state.justDrawn!.tile;
    expect(discardTile(SEATS, state, SEATS[seat]!, tile).ok).toBe(true);
    // 沒人反應時下一家會馬上摸牌換掉 justDrawn；有人被問吃碰槓胡時則必須是 null，
    // 兩種情況都不可以還停在剛剛那位出牌者身上
    expect(state.justDrawn?.seat === seat).toBe(false);
  });
});


function autoPlayOneRound(state: MahjongState): void {
  let guard = 0;
  while (state.phase !== 'roundEnd' && state.phase !== 'matchEnd' && guard < 2000) {
    guard += 1;
    if (state.phase === 'discard') {
      const seat = state.turnSeat;
      const tile = state.players[seat]!.hand[state.players[seat]!.hand.length - 1]!;
      discardTile(SEATS, state, SEATS[seat]!, tile);
    } else if (state.phase === 'selfDraw') {
      chooseSelfDrawAction(SEATS, state, SEATS[state.turnSeat]!, 'none');
    } else if (state.phase === 'reaction') {
      const seat = state.reaction!.respondSeat;
      respondToReaction(SEATS, state, SEATS[seat]!, 'pass');
    }
  }
}

describe('claimedDiscards', () => {
  it('marks a discard as claimed once it is pengged, so the client can hide it from the table', () => {
    const state = startMahjong(SEATS);
    const seat = state.turnSeat; // 莊家，現在是擲骰決定的，不假設固定是 0
    const pengSeat = (seat + 1) % 4; // 下家碰，跟莊家一定不同座位
    const tile = '5s';
    state.players[seat]!.hand[0] = tile; // 保證手上有這張可以打
    state.players[pengSeat]!.hand[0] = tile;
    state.players[pengSeat]!.hand[1] = tile; // 保證下家湊得出碰

    const before = state.players[seat]!.discards.length;
    discardTile(SEATS, state, SEATS[seat]!, tile);
    expect(state.phase).toBe('reaction');
    expect(state.reaction?.respondSeat).toBe(pengSeat);
    expect(state.players[seat]!.claimedDiscards[before]).toBe(false);

    respondToReaction(SEATS, state, SEATS[pengSeat]!, 'peng');
    expect(state.players[seat]!.claimedDiscards[before]).toBe(true);
    expect(state.players[pengSeat]!.melds).toContainEqual({
      type: 'peng',
      tiles: [tile, tile, tile],
      concealed: false,
      from: seat,
    });
  });
});

describe('反應順位', () => {
  it('前面順位的人過了以後，還是要問後面想吃的人，不能直接輪下一家', () => {
    const state = startMahjong(SEATS);
    const seat = state.turnSeat;
    const chiSeat = (seat + 1) % 4; // 只有下家能吃
    const pengSeat = (seat + 2) % 4; // 對家能碰，順位比吃高，會先被問
    const tile = '5s';
    // 除了要碰的那家，其他人手上都不能有這張，不然會多冒出一個碰的候選人打亂順位
    for (const s of [seat, chiSeat, (seat + 3) % 4]) {
      const p = state.players[s]!;
      p.hand = p.hand.map((t) => (t === tile ? '9s' : t));
    }
    state.players[seat]!.hand[0] = tile;
    state.players[pengSeat]!.hand[0] = tile;
    state.players[pengSeat]!.hand[1] = tile;
    state.players[chiSeat]!.hand[0] = '6s';
    state.players[chiSeat]!.hand[1] = '7s';

    expect(discardTile(SEATS, state, SEATS[seat]!, tile).ok).toBe(true);
    expect(state.reaction?.respondSeat).toBe(pengSeat);

    respondToReaction(SEATS, state, SEATS[pengSeat]!, 'pass');
    expect(state.phase).toBe('reaction');
    expect(state.reaction?.respondSeat).toBe(chiSeat);
    expect(state.reaction?.options).toContain('chi');

    // 全部人都過了才輪下一家
    respondToReaction(SEATS, state, SEATS[chiSeat]!, 'pass');
    expect(state.reaction).toBe(null);
    expect(state.turnSeat).toBe(chiSeat);
  });
});

describe('mahjong round-end ready gate', () => {
  it('rejects a confirm outside the roundEnd screen', () => {
    const state = startMahjong(SEATS);
    expect(confirmMahjongRoundReady(SEATS, state, 'p0')).toEqual({ ok: false, error: 'WRONG_PHASE' });
  });

  it('rejects a confirm from someone not seated at the table', () => {
    const state = startMahjong(SEATS);
    state.phase = 'roundEnd';
    expect(confirmMahjongRoundReady(SEATS, state, 'nobody')).toEqual({ ok: false, error: 'NOT_YOUR_TURN' });
  });

  it('only counts as everyone ready once every seat has confirmed', () => {
    const state = startMahjong(SEATS);
    state.phase = 'roundEnd';
    state.roundReady = [false, false, false, false];

    expect(allMahjongRoundReady(SEATS, state)).toBe(false);
    for (const playerId of ['p0', 'p1', 'p2', 'p3']) {
      expect(confirmMahjongRoundReady(SEATS, state, playerId)).toEqual({ ok: true });
    }
    expect(state.roundReady).toEqual([true, true, true, true]);
    expect(allMahjongRoundReady(SEATS, state)).toBe(true);
  });

  it('treats a vacated seat as already ready so the game never stalls waiting on nobody', () => {
    const state = startMahjong(SEATS);
    state.phase = 'roundEnd';
    state.roundReady = [false, false, false, false];

    const seatsWithVacancy: Seats = ['p0', 'p1', 'p2', null];
    for (const playerId of ['p0', 'p1', 'p2']) {
      confirmMahjongRoundReady(seatsWithVacancy, state, playerId);
    }
    expect(allMahjongRoundReady(seatsWithVacancy, state)).toBe(true);
  });
});

describe('finishRound match-end conditions', () => {
  it('flags the deciding round as pendingMatchEnd but still shows a normal roundEnd screen first', () => {
    const state = startMahjong(SEATS);
    state.players[0]!.score = 2000;
    autoPlayOneRound(state);
    // 結算畫面（含胡牌牌型／台數）要先完整顯示出來，不能因為這局剛好衝到終局分數就直接跳過
    expect(state.phase).toBe('roundEnd');
    expect(state.pendingMatchEnd).toBe(true);
    expect(state.matchOver).toBe(false);

    finalizeMahjongMatch(state);
    expect(state.matchOver).toBe(true);
    expect(state.phase).toBe('matchEnd');
    expect(state.players[state.matchWinnerSeat!]!.score).toBeGreaterThanOrEqual(2000);
  });

  it('flags the 4th round as pendingMatchEnd even if nobody reached the target score', () => {
    const state = startMahjong(SEATS);
    state.round = 4;
    autoPlayOneRound(state);
    expect(state.phase).toBe('roundEnd');
    expect(state.pendingMatchEnd).toBe(true);
    expect(state.matchOver).toBe(false);

    finalizeMahjongMatch(state);
    expect(state.matchOver).toBe(true);
  });

  it('does not flag pendingMatchEnd for an ordinary round that neither hits the score nor the round limit', () => {
    const state = startMahjong(SEATS);
    autoPlayOneRound(state);
    expect(state.phase).toBe('roundEnd');
    expect(state.pendingMatchEnd).toBe(false);
    expect(state.matchOver).toBe(false);
  });
});

describe('rankMahjongSeats', () => {
  it('orders seats by score, highest first', () => {
    const state = startMahjong(SEATS);
    state.players[0]!.score = 9000;
    state.players[1]!.score = 12000;
    state.players[2]!.score = 8000;
    state.players[3]!.score = 11000;
    expect(rankMahjongSeats(state)).toEqual([1, 3, 0, 2]);
  });
});

describe('a full round can be auto-played to completion', () => {
  it('reaches roundEnd or matchEnd without throwing, always leaving exactly one seat to act', () => {
    const state: MahjongState = startMahjong(SEATS);
    let guard = 0;
    while (state.phase !== 'roundEnd' && state.phase !== 'matchEnd' && guard < 2000) {
      guard += 1;
      if (state.phase === 'discard') {
        const seat = state.turnSeat;
        const tile = state.players[seat]!.hand[state.players[seat]!.hand.length - 1]!;
        const res = discardTile(SEATS, state, SEATS[seat]!, tile);
        expect(res.ok).toBe(true);
      } else if (state.phase === 'selfDraw') {
        const res = chooseSelfDrawAction(SEATS, state, SEATS[state.turnSeat]!, 'none');
        expect(res.ok).toBe(true);
      } else if (state.phase === 'reaction') {
        const seat = state.reaction!.respondSeat;
        const res = respondToReaction(SEATS, state, SEATS[seat]!, 'pass');
        expect(res.ok).toBe(true);
      }
    }
    expect(guard).toBeLessThan(2000);
    expect(['roundEnd', 'matchEnd']).toContain(state.phase);
    expect(state.roundResult).not.toBeNull();
  });

  it('autoActMahjong never gets stuck: repeatedly calling it also reaches an end phase', () => {
    const state = startMahjong(SEATS);
    let guard = 0;
    while (state.phase !== 'roundEnd' && state.phase !== 'matchEnd' && guard < 2000) {
      guard += 1;
      autoActMahjong(state);
    }
    expect(guard).toBeLessThan(2000);
    expect(['roundEnd', 'matchEnd']).toContain(state.phase);
  });
});
