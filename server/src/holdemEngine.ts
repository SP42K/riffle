import {
  HOLDEM_BIG_BLIND,
  HOLDEM_SMALL_BLIND,
  TURN_MS,
  bestHand,
  compareHoldemHands,
  createDeck,
  legalActions,
  shuffle,
  type BetAction,
  type Card,
  type HoldemHand,
  type HoldemStreet,
  type LegalActions,
  type PlayerId,
} from 'shared';
import type { Seats } from './gameEngine.js';
import type { TurnBased } from './turnBased.js';

export interface Pot {
  amount: number;
  /** 有資格爭這個池的玩家。已蓋牌的人不在內，但他們的籌碼仍算在 amount 裡。 */
  eligible: PlayerId[];
}

export interface ShowdownEntry {
  playerId: PlayerId;
  /** 沒打到攤牌就結束時為 null —— 贏家不必亮牌。 */
  hole: Card[] | null;
  hand: HoldemHand | null;
  won: number;
}

export interface HoldemState extends TurnBased {
  deck: Card[];
  /** 下一張要發的牌在 deck 裡的位置。 */
  deckIndex: number;
  hole: Map<PlayerId, Card[]>;
  board: Card[];
  /** 這是房間的籌碼表本身（同一個 Map），下注與分池都直接改它。 */
  chips: Map<PlayerId, number>;
  /** 這一街已投入。 */
  committed: Map<PlayerId, number>;
  /** 這一手累計已投入，邊池照這個切。 */
  totalCommitted: Map<PlayerId, number>;
  folded: Set<PlayerId>;
  allIn: Set<PlayerId>;
  street: HoldemStreet;
  currentBet: number;
  minRaise: number;
  buttonSeat: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  smallBlind: number;
  bigBlind: number;
  /** 本街已行動過的座位。有人足額加注就清空，讓大家重新表態。 */
  actedSeats: Set<number>;
  /** 遇到不足額的 all-in 時，已行動過的人只能跟或蓋，不能再加注。 */
  cappedSeats: Set<number>;
  pots: Pot[];
  showdown: ShowdownEntry[] | null;
  handNo: number;
  /** 顯示用的最近動作。 */
  lastAction: Map<PlayerId, string>;
}

export type BetError =
  | 'GAME_NOT_RUNNING'
  | 'NOT_YOUR_TURN'
  | 'ALREADY_FOLDED'
  | 'CANNOT_CHECK'
  | 'CANNOT_CALL'
  | 'CANNOT_RAISE'
  | 'RAISE_TOO_SMALL'
  | 'NOT_ENOUGH_CHIPS'
  | 'BAD_AMOUNT';

export const BET_ERROR_MESSAGE: Record<BetError, string> = {
  GAME_NOT_RUNNING: '這一手還沒開始',
  NOT_YOUR_TURN: '還沒輪到你',
  ALREADY_FOLDED: '你已經蓋牌了',
  CANNOT_CHECK: '有人下注了，不能過牌',
  CANNOT_CALL: '目前沒有注可以跟',
  CANNOT_RAISE: '你不能加注',
  RAISE_TOO_SMALL: '加注幅度不足',
  NOT_ENOUGH_CHIPS: '籌碼不夠',
  BAD_AMOUNT: '加注金額不正確',
};

// ---------------------------------------------------------------------------
// 座位計算
// ---------------------------------------------------------------------------

/** 有人坐、而且這一手有發到牌的座位。 */
function dealtSeats(seats: Seats, state: HoldemState): number[] {
  return seats.flatMap((playerId, seat) => (playerId && state.hole.has(playerId) ? [seat] : []));
}

/** 還沒蓋牌、還有機會贏池的座位（含已 all-in 的人）。 */
function contenderSeats(seats: Seats, state: HoldemState): number[] {
  return dealtSeats(seats, state).filter((seat) => !state.folded.has(seats[seat]!));
}

/** 還能做動作的座位：沒蓋牌、沒 all-in、手上還有籌碼。 */
function actableSeats(seats: Seats, state: HoldemState): number[] {
  return contenderSeats(seats, state).filter((seat) => {
    const playerId = seats[seat]!;
    return !state.allIn.has(playerId) && (state.chips.get(playerId) ?? 0) > 0;
  });
}

/** from 之後（不含 from）第一個符合條件的座位；找不到回 -1。 */
function seatAfter(seats: Seats, from: number, allowed: readonly number[]): number {
  for (let step = 1; step <= seats.length; step++) {
    const seat = (from + step) % seats.length;
    if (allowed.includes(seat)) return seat;
  }
  return -1;
}

/** 這一手有資格參加的座位：有人坐、而且還有籌碼。 */
export function liveSeats(seats: Seats, chips: Map<PlayerId, number>): number[] {
  return seats.flatMap((playerId, seat) =>
    playerId && (chips.get(playerId) ?? 0) > 0 ? [seat] : [],
  );
}

/** 把莊家鈕往左推一位。沒人可當莊時回原位。 */
export function nextButtonSeat(seats: Seats, chips: Map<PlayerId, number>, from: number): number {
  const live = liveSeats(seats, chips);
  if (live.length === 0) return from;
  const next = seatAfter(seats, from, live);
  return next === -1 ? live[0]! : next;
}

// ---------------------------------------------------------------------------
// 開始一手
// ---------------------------------------------------------------------------

export interface StartHandOptions {
  smallBlind?: number;
  bigBlind?: number;
  handNo?: number;
  rng?: () => number;
  /** 測試用：直接指定牌序，跳過洗牌。 */
  deck?: readonly Card[];
}

/**
 * 發一手牌。籌碼歸零的人這一手直接坐出（不發牌）。
 * chips 會被直接改動 —— 那就是房間的籌碼表。
 */
export function startHand(
  seats: Seats,
  chips: Map<PlayerId, number>,
  buttonSeat: number,
  options: StartHandOptions = {},
): HoldemState {
  const smallBlind = options.smallBlind ?? HOLDEM_SMALL_BLIND;
  const bigBlind = options.bigBlind ?? HOLDEM_BIG_BLIND;
  const deck = options.deck ? options.deck.slice() : shuffle(createDeck(), options.rng);

  const live = liveSeats(seats, chips);

  const state: HoldemState = {
    deck,
    deckIndex: 0,
    hole: new Map(),
    board: [],
    chips,
    committed: new Map(),
    totalCommitted: new Map(),
    folded: new Set(),
    allIn: new Set(),
    street: 'preflop',
    currentBet: 0,
    minRaise: bigBlind,
    buttonSeat,
    smallBlindSeat: -1,
    bigBlindSeat: -1,
    smallBlind,
    bigBlind,
    actedSeats: new Set(),
    cappedSeats: new Set(),
    pots: [],
    showdown: null,
    handNo: options.handNo ?? 1,
    lastAction: new Map(),
    turnSeat: buttonSeat,
    turnDeadline: 0,
    over: false,
  };

  if (live.length < 2) {
    state.over = true;
    state.street = 'showdown';
    state.showdown = [];
    return state;
  }

  // 發底牌：每人兩張，照座位順序整段切（跟 dealGame 一樣的作法）
  live.forEach((seat, index) => {
    const playerId = seats[seat]!;
    state.hole.set(playerId, [deck[index * 2]!, deck[index * 2 + 1]!]);
  });
  state.deckIndex = live.length * 2;

  // 兩人單挑時莊家就是小盲，且翻牌前由莊家先講話
  const smallBlindSeat = live.length === 2 ? buttonSeat : seatAfter(seats, buttonSeat, live);
  const bigBlindSeat = seatAfter(seats, smallBlindSeat, live);
  state.smallBlindSeat = smallBlindSeat;
  state.bigBlindSeat = bigBlindSeat;

  postBlind(state, seats[smallBlindSeat]!, smallBlind, '小盲');
  postBlind(state, seats[bigBlindSeat]!, bigBlind, '大盲');
  state.currentBet = bigBlind;

  // 從大盲的下一位開始找第一個行動者；兩人局時那正好會繞回莊家
  state.turnSeat = bigBlindSeat;
  progress(seats, state);
  return state;
}

function postBlind(state: HoldemState, playerId: PlayerId, amount: number, label: string): void {
  const put = putIn(state, playerId, amount);
  state.lastAction.set(playerId, `${label} ${put}`);
}

/** 把籌碼放進池，回傳實際放進去的量（籌碼不夠就是全下）。 */
function putIn(state: HoldemState, playerId: PlayerId, amount: number): number {
  const chips = state.chips.get(playerId) ?? 0;
  const put = Math.max(0, Math.min(amount, chips));
  state.chips.set(playerId, chips - put);
  state.committed.set(playerId, (state.committed.get(playerId) ?? 0) + put);
  state.totalCommitted.set(playerId, (state.totalCommitted.get(playerId) ?? 0) + put);
  if (chips - put === 0) state.allIn.add(playerId);
  return put;
}

// ---------------------------------------------------------------------------
// 下注
// ---------------------------------------------------------------------------

export interface BetResult {
  action: BetAction;
  /** 這次實際放進池的籌碼。 */
  amount: number;
  /** 寫戰報用的中文描述。 */
  label: string;
  streetAdvanced: boolean;
  handOver: boolean;
}

/** 產生某位玩家目前的可用動作。前端拿到的也是這一份。 */
export function actionsFor(seats: Seats, state: HoldemState, playerId: PlayerId): LegalActions {
  const seat = seats.indexOf(playerId);
  const capped = seat !== -1 && state.cappedSeats.has(seat);
  const actions = legalActions({
    chips: state.chips.get(playerId) ?? 0,
    committed: state.committed.get(playerId) ?? 0,
    currentBet: state.currentBet,
    minRaise: state.minRaise,
    folded: state.folded.has(playerId),
    allIn: state.allIn.has(playerId),
    isTurn: !state.over && seats[state.turnSeat] === playerId,
  });
  if (!capped) return actions;
  // 前面有人短 all-in，已表態過的人只能跟或蓋
  return { ...actions, canRaise: false, minRaiseTo: 0, maxRaiseTo: 0 };
}

export function applyBet(
  seats: Seats,
  state: HoldemState,
  playerId: PlayerId,
  action: BetAction,
  amount?: number,
): { ok: true; result: BetResult } | { ok: false; error: BetError } {
  if (state.over) return { ok: false, error: 'GAME_NOT_RUNNING' };
  if (seats[state.turnSeat] !== playerId) return { ok: false, error: 'NOT_YOUR_TURN' };
  if (state.folded.has(playerId)) return { ok: false, error: 'ALREADY_FOLDED' };

  const actions = actionsFor(seats, state, playerId);
  const committed = state.committed.get(playerId) ?? 0;
  const streetBefore = state.street;
  let put = 0;
  let label: string;

  switch (action) {
    case 'fold': {
      state.folded.add(playerId);
      label = '蓋牌';
      break;
    }

    case 'check': {
      if (!actions.canCheck) return { ok: false, error: 'CANNOT_CHECK' };
      label = '過牌';
      break;
    }

    case 'call': {
      if (!actions.canCall) return { ok: false, error: 'CANNOT_CALL' };
      put = putIn(state, playerId, actions.callAmount);
      label = state.allIn.has(playerId) ? `跟注 ${put}（all-in）` : `跟注 ${put}`;
      break;
    }

    case 'raise':
    case 'allin': {
      let raiseTo: number;
      if (action === 'allin') {
        // 加不到超過現有注額時，all-in 就是一次跟不滿的跟注
        if (!actions.canRaise) {
          if (!actions.canCall) return { ok: false, error: 'CANNOT_CALL' };
          put = putIn(state, playerId, actions.callAmount);
          label = `跟注 ${put}（all-in）`;
          break;
        }
        raiseTo = actions.maxRaiseTo;
      } else {
        if (!Number.isInteger(amount)) return { ok: false, error: 'BAD_AMOUNT' };
        if (!actions.canRaise) return { ok: false, error: 'CANNOT_RAISE' };
        raiseTo = amount!;
        if (raiseTo > actions.maxRaiseTo) return { ok: false, error: 'NOT_ENOUGH_CHIPS' };
        if (raiseTo < actions.minRaiseTo) return { ok: false, error: 'RAISE_TOO_SMALL' };
      }

      put = putIn(state, playerId, raiseTo - committed);
      const total = committed + put;
      const increment = total - state.currentBet;
      state.currentBet = total;

      if (increment >= state.minRaise) {
        // 足額加注：重開加注權，所有人重新表態
        state.minRaise = increment;
        state.actedSeats.clear();
        state.cappedSeats.clear();
      } else {
        // 短 all-in：注額提高了，但已表態過的人不能再加注
        for (const seat of state.actedSeats) state.cappedSeats.add(seat);
      }

      // 本街原本沒人下注就叫「下注」，否則是「加注到」
      label = increment === total ? `下注 ${total}` : `加注到 ${total}`;
      if (state.allIn.has(playerId)) label += '（all-in）';
      break;
    }

    default:
      return { ok: false, error: 'BAD_AMOUNT' };
  }

  state.actedSeats.add(state.turnSeat);
  state.lastAction.set(playerId, label);
  progress(seats, state);

  return {
    ok: true,
    result: {
      action,
      amount: put,
      label,
      streetAdvanced: state.street !== streetBefore,
      handOver: state.over,
    },
  };
}

/** 逾時或斷線時代打：能過牌就過牌，否則蓋牌。 */
export function autoActHoldem(
  seats: Seats,
  state: HoldemState,
): { playerId: PlayerId; action: 'check' | 'fold' } | null {
  if (state.over) return null;
  const playerId = seats[state.turnSeat];
  if (!playerId) return null;

  const actions = actionsFor(seats, state, playerId);
  const action = actions.canCheck ? 'check' : 'fold';
  const result = applyBet(seats, state, playerId, action);
  return result.ok ? { playerId, action } : null;
}

/**
 * 玩家中途離開：視同蓋牌，已投入的籌碼留在池裡。
 * 座位由 rooms.removeMember 清空，這裡只負責把這一手推下去。
 */
export function removePlayerFromHoldem(
  seats: Seats,
  state: HoldemState,
  playerId: PlayerId,
): void {
  if (!state.hole.has(playerId)) return;
  state.folded.add(playerId);
  state.lastAction.set(playerId, '離開');
  if (state.over) return;

  // 只有在「該行動的人不能再行動了」或「場上只剩一人」時才推進，
  // 否則會把還沒表態的當前玩家跳過去
  const currentActable = actableSeats(seats, state).includes(state.turnSeat);
  if (!currentActable || contenderSeats(seats, state).length <= 1) progress(seats, state);
}

// ---------------------------------------------------------------------------
// 流程推進
// ---------------------------------------------------------------------------

/** 這一街的下注是不是已經打完了。 */
function bettingClosed(seats: Seats, state: HoldemState): boolean {
  const actable = actableSeats(seats, state);
  if (actable.length === 0) return true;

  if (actable.length === 1) {
    // 只剩一個人能動：跟平了就沒得打，還沒跟平就讓他表態
    const playerId = seats[actable[0]!]!;
    return (state.committed.get(playerId) ?? 0) >= state.currentBet;
  }

  return actable.every(
    (seat) =>
      state.actedSeats.has(seat) &&
      (state.committed.get(seats[seat]!) ?? 0) >= state.currentBet,
  );
}

/**
 * 一次動作之後把牌局推到下一個該停的地方。
 * 全員 all-in 時會連續開完剩下的公共牌，所以是迴圈而不是單次判斷。
 *
 * 前提：呼叫時 turnSeat 上的人已經表態完畢（或 turnSeat 只是搜尋起點），
 * 因為找下一位是從 turnSeat 的下一格開始找的。
 */
function progress(seats: Seats, state: HoldemState): void {
  for (;;) {
    if (contenderSeats(seats, state).length <= 1) return finishHand(seats, state);

    if (!bettingClosed(seats, state)) {
      const next = seatAfter(seats, state.turnSeat, actableSeats(seats, state));
      if (next === -1) return finishHand(seats, state);
      state.turnSeat = next;
      state.turnDeadline = Date.now() + TURN_MS;
      state.pots = buildPots(seats, state);
      return;
    }

    if (state.street === 'river') return finishHand(seats, state);
    dealNextStreet(seats, state);
  }
}

function dealNextStreet(seats: Seats, state: HoldemState): void {
  const draw = (count: number) => {
    for (let i = 0; i < count; i++) {
      const card = state.deck[state.deckIndex++];
      if (card) state.board.push(card);
    }
  };

  switch (state.street) {
    case 'preflop':
      state.street = 'flop';
      draw(3);
      break;
    case 'flop':
      state.street = 'turn';
      draw(1);
      break;
    default:
      state.street = 'river';
      draw(1);
      break;
  }

  state.currentBet = 0;
  state.minRaise = state.bigBlind;
  state.actedSeats.clear();
  state.cappedSeats.clear();
  state.lastAction.clear();
  for (const playerId of state.committed.keys()) state.committed.set(playerId, 0);

  // 翻牌後由莊家左手第一位先講話 —— 從莊家往下找即可
  state.turnSeat = state.buttonSeat;
}

// ---------------------------------------------------------------------------
// 邊池與結算
// ---------------------------------------------------------------------------

/**
 * 依各人這一手累計投入切出主池與邊池。
 * 已蓋牌的人籌碼仍算進池裡，但不列入 eligible。
 */
export function buildPots(seats: Seats, state: HoldemState): Pot[] {
  const entries = [...state.totalCommitted.entries()].filter(([, amount]) => amount > 0);
  if (entries.length === 0) return [];

  // 依座位排序，快照的內容才不會受 Map 插入順序影響
  const contenders = contenderSeats(seats, state).map((seat) => seats[seat]!);
  const levels = [...new Set(entries.map(([, amount]) => amount))].sort((a, b) => a - b);

  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    const layer = level - prev;
    prev = level;
    if (layer <= 0) continue;

    const participants = entries.filter(([, amount]) => amount >= level);
    const reached = new Set(participants.map(([id]) => id));
    const eligible = contenders.filter((id) => reached.has(id));
    const pot: Pot = { amount: layer * participants.length, eligible };

    // 資格相同的相鄰層併成同一個池，顯示乾淨一點
    const last = pots[pots.length - 1];
    if (last && sameMembers(last.eligible, pot.eligible)) last.amount += pot.amount;
    else pots.push(pot);
  }
  return pots;
}

function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/**
 * 退還沒人跟的部分：投入最多的那個人，超過第二高的差額拿回去。
 * 沒有這一步的話，「下注後全員蓋牌」會把自己的錢也賠進池裡。
 */
function returnUncalled(state: HoldemState): void {
  const amounts = [...state.totalCommitted.values()].sort((a, b) => b - a);
  const top = amounts[0] ?? 0;
  const second = amounts[1] ?? 0;
  if (top <= second) return;

  for (const [playerId, amount] of state.totalCommitted) {
    if (amount !== top) continue;
    const refund = top - second;
    state.chips.set(playerId, (state.chips.get(playerId) ?? 0) + refund);
    state.totalCommitted.set(playerId, second);
    state.allIn.delete(playerId); // 退錢之後就不再是 all-in 了
    return;
  }
}

function finishHand(seats: Seats, state: HoldemState): void {
  returnUncalled(state);
  state.pots = buildPots(seats, state);

  const contenders = contenderSeats(seats, state);
  const contenderIds = contenders.map((seat) => seats[seat]!);
  const reachedShowdown = contenderIds.length > 1;

  const hands = new Map<PlayerId, HoldemHand>();
  if (reachedShowdown) {
    for (const playerId of contenderIds) {
      const hand = bestHand([...(state.hole.get(playerId) ?? []), ...state.board]);
      if (hand) hands.set(playerId, hand);
    }
  }

  const won = new Map<PlayerId, number>();
  for (const pot of state.pots) {
    // 池裡的錢全來自已蓋牌的人時，交給還在場上的人分
    const eligible = pot.eligible.length > 0 ? pot.eligible : contenderIds;
    if (eligible.length === 0) continue;

    const winners = reachedShowdown ? pickWinners(eligible, hands) : eligible;
    if (winners.length === 0) continue;

    const share = Math.floor(pot.amount / winners.length);
    let odd = pot.amount - share * winners.length;
    // 零頭給莊家左手方向最近的贏家
    for (const playerId of orderFromButton(seats, state, winners)) {
      const extra = odd > 0 ? 1 : 0;
      odd -= extra;
      won.set(playerId, (won.get(playerId) ?? 0) + share + extra);
    }
  }

  for (const [playerId, amount] of won) {
    state.chips.set(playerId, (state.chips.get(playerId) ?? 0) + amount);
  }

  state.showdown = contenderIds.map((playerId) => ({
    playerId,
    hole: reachedShowdown ? (state.hole.get(playerId) ?? null) : null,
    hand: hands.get(playerId) ?? null,
    won: won.get(playerId) ?? 0,
  }));

  state.street = 'showdown';
  state.over = true;
  state.turnDeadline = 0;
}

function pickWinners(eligible: readonly PlayerId[], hands: Map<PlayerId, HoldemHand>): PlayerId[] {
  let best: HoldemHand | null = null;
  let winners: PlayerId[] = [];
  for (const playerId of eligible) {
    const hand = hands.get(playerId);
    if (!hand) continue;
    const diff = best ? compareHoldemHands(hand, best) : 1;
    if (diff > 0) {
      best = hand;
      winners = [playerId];
    } else if (diff === 0) {
      winners.push(playerId);
    }
  }
  return winners;
}

/** 依「莊家左手起」的順序排列，決定零頭給誰。 */
function orderFromButton(
  seats: Seats,
  state: HoldemState,
  playerIds: readonly PlayerId[],
): PlayerId[] {
  const wanted = new Set(playerIds);
  const out: PlayerId[] = [];
  for (let step = 1; step <= seats.length; step++) {
    const playerId = seats[(state.buttonSeat + step) % seats.length];
    if (playerId && wanted.has(playerId)) out.push(playerId);
  }
  // 已離座的贏家不會出現在 seats 裡，補在最後
  for (const playerId of playerIds) if (!out.includes(playerId)) out.push(playerId);
  return out;
}

export { contenderSeats, actableSeats };
