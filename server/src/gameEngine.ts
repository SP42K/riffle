import {
  HAND_SIZE,
  TURN_MS,
  canBeat,
  cardValue,
  createDeck,
  identifyCombo,
  pickCards,
  shuffle,
  smallestLegalPlay,
  sortCards,
  type Card,
  type Combo,
  type PlayerId,
} from 'shared';

/** seats[i] 是第 i 個座位上的玩家，null 代表空位。座位順序即出牌順序。 */
export type Seats = Array<PlayerId | null>;

export interface GameState {
  hands: Map<PlayerId, Card[]>;
  turnSeat: number;
  lastPlay: { playerId: PlayerId; combo: Combo } | null;
  /** 自上一次出牌之後已經 PASS 的座位。 */
  passedSeats: Set<number>;
  /** 已出完牌的玩家，index 0 為第一名。 */
  finished: PlayerId[];
  /**
   * 開局牌的 id。持有者先手，且第一手必須包含它。
   * 4 人局固定是 ♦3；人數較少時整副牌發不完，改用「發出去的牌裡最小的那張」。
   */
  openingCardId: string | null;
  turnDeadline: number;
  over: boolean;
}

export type PlayError =
  | 'GAME_NOT_RUNNING'
  | 'NOT_YOUR_TURN'
  | 'NOT_IN_HAND'
  | 'INVALID_COMBO'
  | 'CANNOT_BEAT'
  | 'MUST_INCLUDE_OPENING'
  | 'CANNOT_PASS_ON_LEAD';

export const PLAY_ERROR_MESSAGE: Record<PlayError, string> = {
  GAME_NOT_RUNNING: '遊戲尚未開始',
  NOT_YOUR_TURN: '還沒輪到你',
  NOT_IN_HAND: '你手上沒有這些牌',
  INVALID_COMBO: '這不是合法的牌型',
  CANNOT_BEAT: '壓不過上一手牌',
  MUST_INCLUDE_OPENING: '第一手必須包含開局牌',
  CANNOT_PASS_ON_LEAD: '你有領牌權，不能 PASS',
};

// ---------------------------------------------------------------------------
// 開局
// ---------------------------------------------------------------------------

export function dealGame(seats: Seats, rng: () => number = Math.random): GameState {
  const playerIds = seats.filter((id): id is PlayerId => id !== null);
  const deck = shuffle(createDeck(), rng);

  const hands = new Map<PlayerId, Card[]>();
  playerIds.forEach((playerId, index) => {
    hands.set(playerId, sortCards(deck.slice(index * HAND_SIZE, (index + 1) * HAND_SIZE)));
  });

  // 找出發到玩家手上最小的那張牌，持有者先手
  let openingCard: Card | null = null;
  let openingSeat = 0;
  for (const [seat, playerId] of seats.entries()) {
    if (!playerId) continue;
    const smallest = hands.get(playerId)![0]!; // 手牌已排序
    if (!openingCard || cardValue(smallest) < cardValue(openingCard)) {
      openingCard = smallest;
      openingSeat = seat;
    }
  }

  return {
    hands,
    turnSeat: openingSeat,
    lastPlay: null,
    passedSeats: new Set(),
    finished: [],
    openingCardId: openingCard?.id ?? null,
    turnDeadline: Date.now() + TURN_MS,
    over: false,
  };
}

// ---------------------------------------------------------------------------
// 座位計算
// ---------------------------------------------------------------------------

export function seatOfPlayer(seats: Seats, playerId: PlayerId): number {
  return seats.indexOf(playerId);
}

/** 還在打的座位：有人坐、而且還沒出完牌。 */
export function activeSeats(seats: Seats, state: GameState): number[] {
  return seats.flatMap((playerId, seat) =>
    playerId && !state.finished.includes(playerId) ? [seat] : [],
  );
}

function nextActiveSeat(seats: Seats, state: GameState, from: number): number {
  const active = activeSeats(seats, state);
  for (let step = 1; step <= seats.length; step++) {
    const seat = (from + step) % seats.length;
    if (active.includes(seat)) return seat;
  }
  return from;
}

/**
 * 換到下一位，並判斷他是不是拿到領牌權。
 * 只要「其他還在打的人都已經 PASS」，下一位就能自由出牌 ——
 * 這個條件同時涵蓋了「出牌者剛好打完出局」的情況。
 */
function advanceTurn(seats: Seats, state: GameState): void {
  const active = activeSeats(seats, state);
  if (active.length <= 1) {
    finishGame(seats, state);
    return;
  }

  const next = nextActiveSeat(seats, state, state.turnSeat);
  const othersAllPassed = active
    .filter((seat) => seat !== next)
    .every((seat) => state.passedSeats.has(seat));

  if (othersAllPassed) {
    state.lastPlay = null;
    state.passedSeats.clear();
  }

  state.turnSeat = next;
  state.turnDeadline = Date.now() + TURN_MS;
}

function finishGame(seats: Seats, state: GameState): void {
  // 最後剩下的那位補進名次
  for (const seat of activeSeats(seats, state)) {
    const playerId = seats[seat];
    if (playerId) state.finished.push(playerId);
  }
  state.over = true;
  state.lastPlay = null;
  state.turnDeadline = 0;
}

/**
 * 玩家中途離開房間：抽掉他的座位與手牌，必要時把回合推給下一位。
 * 已經打完的人留在名次裡不動。
 */
export function removePlayerFromGame(seats: Seats, state: GameState, playerId: PlayerId): void {
  const seat = seats.indexOf(playerId);
  if (seat === -1) return;

  seats[seat] = null;
  state.hands.delete(playerId);
  state.passedSeats.delete(seat);
  if (state.over) return;

  if (activeSeats(seats, state).length <= 1) {
    finishGame(seats, state);
  } else if (state.turnSeat === seat) {
    advanceTurn(seats, state);
  }
}

// ---------------------------------------------------------------------------
// 出牌 / PASS
// ---------------------------------------------------------------------------

export interface PlayResult {
  combo: Combo;
  /** 這手出完後手牌歸零，玩家取得的名次（1 起算）；沒出完則為 null。 */
  rank: number | null;
}

export function playCards(
  seats: Seats,
  state: GameState,
  playerId: PlayerId,
  cardIds: readonly string[],
): { ok: true; result: PlayResult } | { ok: false; error: PlayError } {
  if (state.over) return { ok: false, error: 'GAME_NOT_RUNNING' };
  if (seats[state.turnSeat] !== playerId) return { ok: false, error: 'NOT_YOUR_TURN' };

  const hand = state.hands.get(playerId);
  if (!hand) return { ok: false, error: 'GAME_NOT_RUNNING' };

  const picked = pickCards(hand, cardIds);
  if (!picked) return { ok: false, error: 'NOT_IN_HAND' };

  const combo = identifyCombo(picked);
  if (!combo) return { ok: false, error: 'INVALID_COMBO' };

  if (state.openingCardId && !picked.some((c) => c.id === state.openingCardId)) {
    return { ok: false, error: 'MUST_INCLUDE_OPENING' };
  }

  if (!canBeat(combo, state.lastPlay?.combo ?? null)) {
    return { ok: false, error: 'CANNOT_BEAT' };
  }

  return { ok: true, result: commitPlay(seats, state, playerId, combo) };
}

/** 已驗證過的出牌，實際套用到狀態上。 */
function commitPlay(seats: Seats, state: GameState, playerId: PlayerId, combo: Combo): PlayResult {
  const playedIds = new Set(combo.cards.map((c) => c.id));
  const hand = state.hands.get(playerId)!;
  state.hands.set(
    playerId,
    hand.filter((c) => !playedIds.has(c.id)),
  );

  state.lastPlay = { playerId, combo };
  state.passedSeats.clear();
  state.openingCardId = null; // 開局限制只作用於第一手

  let rank: number | null = null;
  if (state.hands.get(playerId)!.length === 0) {
    state.finished.push(playerId);
    rank = state.finished.length;
  }

  advanceTurn(seats, state);
  return { combo, rank };
}

export function passTurn(
  seats: Seats,
  state: GameState,
  playerId: PlayerId,
): { ok: true } | { ok: false; error: PlayError } {
  if (state.over) return { ok: false, error: 'GAME_NOT_RUNNING' };
  if (seats[state.turnSeat] !== playerId) return { ok: false, error: 'NOT_YOUR_TURN' };
  if (!state.lastPlay) return { ok: false, error: 'CANNOT_PASS_ON_LEAD' };

  state.passedSeats.add(state.turnSeat);
  advanceTurn(seats, state);
  return { ok: true };
}

/**
 * 逾時或斷線時代打：能 PASS 就 PASS，有領牌權則出最小的一組合法牌。
 * 回傳實際做了什麼，方便寫進戰報。
 */
export function autoAct(
  seats: Seats,
  state: GameState,
): { action: 'pass' } | { action: 'play'; result: PlayResult } | null {
  if (state.over) return null;
  const playerId = seats[state.turnSeat];
  if (!playerId) return null;

  if (state.lastPlay) {
    passTurn(seats, state, playerId);
    return { action: 'pass' };
  }

  const hand = state.hands.get(playerId) ?? [];
  const combo = smallestLegalPlay(hand, null, {
    mustInclude: state.openingCardId ? [state.openingCardId] : undefined,
  });
  if (!combo) return null;

  return { action: 'play', result: commitPlay(seats, state, playerId, combo) };
}
