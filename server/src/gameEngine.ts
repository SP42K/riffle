import {
  DEFAULT_BIG_TWO_RULES,
  HAND_SIZE,
  TURN_MS,
  beatFailure,
  cardValue,
  createDeck,
  identifyCombo,
  makeCard,
  pickCards,
  shuffle,
  smallestLegalPlay,
  sortCards,
  type BigTwoRules,
  type Card,
  type Combo,
  type PlayerId,
} from 'shared';

/** seats[i] 是第 i 個座位上的玩家，null 代表空位。座位順序即出牌順序。 */
export type Seats = Array<PlayerId | null>;

export interface GameState {
  /** 這一局的規則開關。發牌時就定下來，中途不會變。 */
  rules: BigTwoRules;
  hands: Map<PlayerId, Card[]>;
  turnSeat: number;
  lastPlay: { playerId: PlayerId; combo: Combo } | null;
  /**
   * 已經 PASS 的座位。
   * passLocksTrick 關著時只記到下一次有人出牌為止；開著則是整輪有效 ——
   * PASS 掉的人這一輪不會再輪到，要等其他人都 PASS、換人領牌才解禁。
   */
  passedSeats: Set<number>;
  /** 已出完牌的玩家，index 0 為第一名。 */
  finished: PlayerId[];
  /**
   * 開局牌的 id。持有者先手，且第一手必須包含它。
   * 4 人局固定是 ♣3；人數較少時整副牌發不完，就從 ♣3 依序往上找第一張有人拿到的牌。
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
  | 'MUST_MATCH_COMBO'
  | 'MUST_INCLUDE_OPENING'
  | 'CANNOT_PASS_ON_LEAD';

export const PLAY_ERROR_MESSAGE: Record<PlayError, string> = {
  GAME_NOT_RUNNING: '遊戲尚未開始',
  NOT_YOUR_TURN: '還沒輪到你',
  NOT_IN_HAND: '你手上沒有這些牌',
  INVALID_COMBO: '這不是合法的牌型',
  CANNOT_BEAT: '壓不過上一手牌',
  MUST_MATCH_COMBO: '這一輪只能用同一種五張牌型跟',
  MUST_INCLUDE_OPENING: '第一手必須包含開局牌',
  CANNOT_PASS_ON_LEAD: '你有領牌權，不能 PASS',
};

// ---------------------------------------------------------------------------
// 開局
// ---------------------------------------------------------------------------

/** cardValue 的上限是 15 * 4 + 3 = 63，加這個數就能把牌排到「繞完一圈」之後。 */
const CARD_VALUE_RANGE = 64;
const CLUB_THREE_VALUE = cardValue(makeCard('C', 3));

/**
 * 以 ♣3 為起點的環狀排序權重，數字越小越優先當開局牌。
 * 比 ♣3 小的（只有 ♦3）排到最後 —— 人數不足、♣3 沒發出去時才輪得到它。
 */
function openingOrder(card: Card): number {
  const value = cardValue(card);
  return value >= CLUB_THREE_VALUE ? value : value + CARD_VALUE_RANGE;
}

export function dealGame(
  seats: Seats,
  rules: BigTwoRules = DEFAULT_BIG_TWO_RULES,
  rng: () => number = Math.random,
): GameState {
  const playerIds = seats.filter((id): id is PlayerId => id !== null);
  const deck = shuffle(createDeck(), rng);

  const hands = new Map<PlayerId, Card[]>();
  playerIds.forEach((playerId, index) => {
    hands.set(playerId, sortCards(deck.slice(index * HAND_SIZE, (index + 1) * HAND_SIZE)));
  });

  // 開局牌是 ♣3；沒發出去就依序往上找，持有者先手
  let openingCard: Card | null = null;
  let openingSeat = 0;
  for (const [seat, playerId] of seats.entries()) {
    if (!playerId) continue;
    for (const card of hands.get(playerId)!) {
      if (!openingCard || openingOrder(card) < openingOrder(openingCard)) {
        openingCard = card;
        openingSeat = seat;
      }
    }
  }

  return {
    rules,
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

/** passLocksTrick 專用：PASS 過的人這一輪整個跳過。 */
function nextEligibleSeat(seats: Seats, state: GameState, from: number): number {
  const active = activeSeats(seats, state);
  for (let step = 1; step <= seats.length; step++) {
    const seat = (from + step) % seats.length;
    if (active.includes(seat) && !state.passedSeats.has(seat)) return seat;
  }
  return from;
}

/**
 * 換到下一位，並判斷他是不是拿到領牌權。
 * 只要「其他還在打的人都已經 PASS」，下一位就能自由出牌。
 *（出牌者剛好打完出局的情況由 commitPlay 直接清掉 lastPlay 處理。）
 */
function advanceTurn(seats: Seats, state: GameState): void {
  const active = activeSeats(seats, state);
  if (active.length <= 1) {
    finishGame(seats, state);
    return;
  }

  if (state.rules.passLocksTrick) {
    advanceTurnLockedPass(seats, state, active);
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

/**
 * passLocksTrick 的輪轉：PASS 掉就等於退出這一輪，之後有人再出牌也輪不到你。
 * 一直跳到只剩最後出牌的那一位還能動，這一輪才結束、由他重新領牌。
 */
function advanceTurnLockedPass(seats: Seats, state: GameState, active: number[]): void {
  if (!state.lastPlay) {
    // 領牌者把牌出完走人了，這一輪直接作廢，換下一位自由出牌
    state.passedSeats.clear();
    state.turnSeat = nextActiveSeat(seats, state, state.turnSeat);
  } else {
    const eligible = active.filter((seat) => !state.passedSeats.has(seat));
    if (eligible.length <= 1) {
      // 其他人都 PASS 光了，PASS 的封印在這裡一起解開
      state.lastPlay = null;
      state.turnSeat = eligible[0] ?? nextActiveSeat(seats, state, state.turnSeat);
      state.passedSeats.clear();
    } else {
      state.turnSeat = nextEligibleSeat(seats, state, state.turnSeat);
    }
  }

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

  const combo = identifyCombo(picked, state.rules);
  if (!combo) return { ok: false, error: 'INVALID_COMBO' };

  if (state.openingCardId && !picked.some((c) => c.id === state.openingCardId)) {
    return { ok: false, error: 'MUST_INCLUDE_OPENING' };
  }

  const failure = beatFailure(combo, state.lastPlay?.combo ?? null, state.rules);
  if (failure) {
    return { ok: false, error: failure === 'comboType' ? 'MUST_MATCH_COMBO' : 'CANNOT_BEAT' };
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
  // passLocksTrick 開著時 PASS 是整輪有效的，出牌不解封 —— 由 advanceTurn 在換人領牌時清掉
  if (!state.rules.passLocksTrick) state.passedSeats.clear();
  state.openingCardId = null; // 開局限制只作用於第一手

  let rank: number | null = null;
  if (state.hands.get(playerId)!.length === 0) {
    state.finished.push(playerId);
    rank = state.finished.length;
    // 出完牌的人已經離場，領牌權不會再繞回他身上 —— 直接讓下一家自由出牌
    state.lastPlay = null;
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
    rules: state.rules,
  });
  if (!combo) return null;

  return { action: 'play', result: commitPlay(seats, state, playerId, combo) };
}
