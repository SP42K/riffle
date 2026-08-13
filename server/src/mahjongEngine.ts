import {
  buildMahjongWall,
  calcTai,
  canChi,
  canGang,
  canHu,
  canPeng,
  isFlowerTile,
  sortMahjongHand,
  MAHJONG_WINDS,
  type ChiOption,
  type GangChoice,
  type MahjongMeld,
  type MahjongReactionAction,
  type MahjongRoundResult,
  type MahjongScoreItem,
  type MahjongSelfDrawAction,
  type MahjongTileId,
  type PlayerId,
} from 'shared';
import type { Seats } from './gameEngine.js';

/**
 * 每個座位摸牌／出牌的思考時間，統一給真人 1 分鐘。回合之間（roundEnd）不計時，
 * 由 handlers.ts 另外排程下一局。電腦座位不會等到這個時間 —— handlers.ts 的
 * scheduleMahjongNpc 會在更短的固定延遲後就搶先幫它決定。
 */
const DISCARD_MS = 60_000;
const SELF_DRAW_MS = 60_000;
const REACTION_MS = 60_000;

/** 每人起始分數；達到 MAHJONG_TARGET_SCORE 或打滿 MAHJONG_MAX_ROUNDS 局，比賽就結束。 */
const MAHJONG_START_SCORE = 1_000;
const MAHJONG_TARGET_SCORE = 2_000;
const MAHJONG_MAX_ROUNDS = 4;
/** 每台的賠付金額，自摸每家付、放槍一家全付，跟起始／目標分數同比例縮小過。 */
const TAI_UNIT_SELF_DRAW = 10;
const TAI_UNIT_DISCARD = 30;

export type MahjongPhase = 'discard' | 'selfDraw' | 'reaction' | 'roundEnd' | 'matchEnd';

export interface MahjongPlayerState {
  hand: MahjongTileId[];
  melds: MahjongMeld[];
  discards: MahjongTileId[];
  /** 跟 discards 一一對應：這張後來被吃／碰／槓／胡走了沒有，前端用來把它從牌桌棄牌區濾掉。 */
  claimedDiscards: boolean[];
  /** 跟 discards 一一對應：全桌遞增的出牌序號，前端靠這個判斷「牌桌上最後一張棄牌」是哪家的。 */
  discardOrder: number[];
  flowers: MahjongTileId[];
  score: number;
  hasDrawnBefore: boolean;
}

interface PendingSelfDrawContext {
  isKongReplacement: boolean;
  isFirstTurnWin: boolean;
  isLastTile: boolean;
}

interface ReactionState {
  respondSeat: number;
  options: MahjongReactionAction[];
  chiOptions: ChiOption[];
  discardedTile: MahjongTileId;
  fromSeat: number;
  /** 'kong' 代表這是搶槓（加槓時被搶）而不是一般棄牌反應。 */
  source: 'discard' | 'kong';
}

export interface MahjongState {
  phase: MahjongPhase;
  round: number;
  bankerSeat: number;
  /** 開局擲的三顆骰子，用來從 0 號座位開始算出這場比賽的莊家；之後每局換莊不會重擲。 */
  bankerDice: [number, number, number];
  /** TurnBased 要求的欄位：現在該由誰輸入，不管是要出牌還是要回應吃碰槓胡。 */
  turnSeat: number;
  turnDeadline: number;
  /** 「這一局」是否結束（贏牌或流局）。回合之間會短暫為 true，讓計時器停下來，
   *  由 handlers.ts 另外排程自動開下一局 —— 跟德州撲克的 hand-over 模式一樣。 */
  over: boolean;
  /** 整場比賽（達到 20000 分）是否結束，真正的終局。 */
  matchOver: boolean;
  matchWinnerSeat: number | null;
  /**
   * 這一局的結算（phase === 'roundEnd'）是不是最後一局——分數已經到門檻或局數已經打滿。
   * 這種情況下畫面還是先照一般結算畫面顯示胡牌牌型，等 handlers.ts 給的固定秒數過了才
   * 真的呼叫 finalizeMahjongMatch 轉成 matchOver，不會直接跳過結算畫面。
   */
  pendingMatchEnd: boolean;
  wall: MahjongTileId[];
  players: MahjongPlayerState[];
  lastDiscard: { tile: MahjongTileId; fromSeat: number } | null;
  /** 全桌遞增計數器，每打出一張牌就 +1，寫進該張的 discardOrder。 */
  discardSeq: number;
  /** 這回合剛摸進手牌、還沒打出去的那張牌；碰／吃沒有摸牌動作，這時是 null。 */
  justDrawn: { seat: number; tile: MahjongTileId } | null;
  /** 結算畫面（phase === 'roundEnd'）誰按了「繼續」，index = seat。 */
  roundReady: boolean[];
  selfDraw: { canHu: boolean; gangChoices: GangChoice[] } | null;
  reaction: ReactionState | null;
  roundResult: MahjongRoundResult | null;
  anyCallHappened: boolean;
  pendingKongReplacement: boolean;
  pendingSelfDrawContext: PendingSelfDrawContext | null;
  pendingRobKong: { actingSeat: number; tile: MahjongTileId } | null;
}

export type MahjongError = 'GAME_NOT_RUNNING' | 'NOT_YOUR_TURN' | 'NOT_IN_HAND' | 'WRONG_PHASE' | 'INVALID_ACTION';

export const MAHJONG_ERROR_MESSAGE: Record<MahjongError, string> = {
  GAME_NOT_RUNNING: '遊戲尚未開始',
  NOT_YOUR_TURN: '還沒輪到你',
  NOT_IN_HAND: '你手上沒有這張牌',
  WRONG_PHASE: '現在不能做這個動作',
  INVALID_ACTION: '不合法的選擇',
};

type Result = { ok: true } | { ok: false; error: MahjongError };

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function existingPengTiles(player: MahjongPlayerState): MahjongTileId[] {
  return player.melds.filter((m) => m.type === 'peng').map((m) => m.tiles[0]!);
}

function removeN(hand: MahjongTileId[], tile: MahjongTileId, n: number): MahjongTileId[] {
  const result = hand.slice();
  for (let i = 0; i < n; i++) {
    const idx = result.indexOf(tile);
    if (idx === -1) break;
    result.splice(idx, 1);
  }
  return result;
}

function removeOneEach(hand: MahjongTileId[], tiles: readonly MahjongTileId[]): MahjongTileId[] {
  const result = hand.slice();
  for (const t of tiles) {
    const idx = result.indexOf(t);
    if (idx !== -1) result.splice(idx, 1);
  }
  return result;
}

/** 從 fromSeat 開始，依出牌順序（下家、對家、上家）巡一圈的座位陣列。 */
function seatsInPriorityOrder(fromSeat: number): number[] {
  return [1, 2, 3].map((d) => (fromSeat + d) % 4);
}

function turnOrderFrom(seat: number): number[] {
  return [0, 1, 2, 3].map((d) => (seat + d) % 4);
}

function drawTile(state: MahjongState): MahjongTileId | null {
  return state.wall.length === 0 ? null : (state.wall.shift() ?? null);
}

/** 擲三顆骰子（1~6），從 0 號座位開始數骰子總和那麼多家，決定這場比賽的莊家。 */
function rollBankerDice(rng: () => number = Math.random): [number, number, number] {
  const roll = () => Math.floor(rng() * 6) + 1;
  return [roll(), roll(), roll()];
}

// ---------------------------------------------------------------------------
// 開局 / 開新一局
// ---------------------------------------------------------------------------

export function startMahjong(seats: Seats): MahjongState {
  const bankerDice = rollBankerDice();
  const bankerSeat = (bankerDice[0] + bankerDice[1] + bankerDice[2] - 1) % 4;
  const state: MahjongState = {
    phase: 'discard',
    round: 0,
    bankerSeat,
    bankerDice,
    turnSeat: 0,
    turnDeadline: 0,
    over: false,
    matchOver: false,
    matchWinnerSeat: null,
    pendingMatchEnd: false,
    wall: [],
    players: seats.map(() => ({
      hand: [],
      melds: [],
      discards: [],
      claimedDiscards: [],
      discardOrder: [],
      flowers: [],
      score: MAHJONG_START_SCORE,
      hasDrawnBefore: false,
    })),
    lastDiscard: null,
    discardSeq: 0,
    justDrawn: null,
    roundReady: [false, false, false, false],
    selfDraw: null,
    reaction: null,
    roundResult: null,
    anyCallHappened: false,
    pendingKongReplacement: false,
    pendingSelfDrawContext: null,
    pendingRobKong: null,
  };
  resetForNewRound(state);
  return state;
}

/** 續下一局：分數與莊家位置延續，其餘（牌、面子、棄牌…）重置。 */
export function continueMahjongRound(state: MahjongState): void {
  resetForNewRound(state);
}

function resetForNewRound(state: MahjongState): void {
  state.round += 1;
  state.anyCallHappened = false;
  state.roundResult = null;
  state.selfDraw = null;
  state.reaction = null;
  state.lastDiscard = null;
  state.discardSeq = 0;
  state.justDrawn = null;
  state.roundReady = [false, false, false, false];
  state.pendingKongReplacement = false;
  state.pendingSelfDrawContext = null;
  state.pendingRobKong = null;
  state.pendingMatchEnd = false;
  state.over = false;

  for (const p of state.players) {
    p.hand = [];
    p.melds = [];
    p.discards = [];
    p.claimedDiscards = [];
    p.discardOrder = [];
    p.flowers = [];
    p.hasDrawnBefore = false;
  }

  state.wall = buildMahjongWall();
  for (const seat of turnOrderFrom(state.bankerSeat)) {
    state.players[seat]!.hand = state.wall.splice(0, 16);
  }
  for (const seat of turnOrderFrom(state.bankerSeat)) {
    const player = state.players[seat]!;
    for (;;) {
      const idx = player.hand.findIndex(isFlowerTile);
      if (idx === -1) break;
      const [f] = player.hand.splice(idx, 1);
      player.flowers.push(f!);
      if (state.wall.length === 0) break;
      player.hand.push(state.wall.shift()!);
    }
    player.hand = sortMahjongHand(player.hand);
  }

  beginTurn(state, state.bankerSeat);
}

// ---------------------------------------------------------------------------
// 回合流程
// ---------------------------------------------------------------------------

function beginTurn(state: MahjongState, seat: number): void {
  state.turnSeat = seat;
  const player = state.players[seat]!;
  let tile = drawTile(state);
  if (tile === null) {
    endRoundDraw(state);
    return;
  }
  while (isFlowerTile(tile)) {
    player.flowers.push(tile);
    tile = drawTile(state);
    if (tile === null) {
      endRoundDraw(state);
      return;
    }
  }
  player.hand.push(tile);
  player.hand = sortMahjongHand(player.hand);
  state.justDrawn = { seat, tile };

  const isKongReplacement = state.pendingKongReplacement;
  state.pendingKongReplacement = false;
  const isFirstTurnWin = !state.anyCallHappened && !player.hasDrawnBefore;
  player.hasDrawnBefore = true;
  const isLastTile = state.wall.length === 0;
  state.pendingSelfDrawContext = { isKongReplacement, isFirstTurnWin, isLastTile };

  const hu = canHu(player.hand, player.melds);
  const gangChoices = canGang(player.hand, null, true, existingPengTiles(player));

  if (hu || gangChoices.length > 0) {
    state.phase = 'selfDraw';
    state.selfDraw = { canHu: hu, gangChoices };
    state.turnDeadline = Date.now() + SELF_DRAW_MS;
    return;
  }
  goToDiscard(state, seat);
}

function goToDiscard(state: MahjongState, seat: number): void {
  state.turnSeat = seat;
  state.phase = 'discard';
  state.selfDraw = null;
  state.turnDeadline = Date.now() + DISCARD_MS;
}

function continueAfterNoReaction(state: MahjongState, fromSeat: number): void {
  state.pendingKongReplacement = false;
  beginTurn(state, (fromSeat + 1) % 4);
}

function offerReaction(
  state: MahjongState,
  seat: number,
  options: MahjongReactionAction[],
  discardedTile: MahjongTileId,
  fromSeat: number,
  chiOptions: ChiOption[],
  source: 'discard' | 'kong',
): void {
  state.turnSeat = seat;
  state.phase = 'reaction';
  state.reaction = { respondSeat: seat, options, chiOptions, discardedTile, fromSeat, source };
  state.turnDeadline = Date.now() + REACTION_MS;
}

function findHuCandidate(state: MahjongState, fromSeat: number, tile: MahjongTileId): number | null {
  for (const seat of seatsInPriorityOrder(fromSeat)) {
    const p = state.players[seat]!;
    if (canHu([...p.hand, tile], p.melds)) return seat;
  }
  return null;
}

function findPengGangCandidate(
  state: MahjongState,
  fromSeat: number,
  tile: MahjongTileId,
): { seat: number; type: 'gang' | 'peng' } | null {
  for (const seat of seatsInPriorityOrder(fromSeat)) {
    const p = state.players[seat]!;
    if (canGang(p.hand, tile, false).length > 0) return { seat, type: 'gang' };
    if (canPeng(p.hand, tile)) return { seat, type: 'peng' };
  }
  return null;
}

function findChiCandidate(
  state: MahjongState,
  fromSeat: number,
  tile: MahjongTileId,
): { seat: number; chiOptions: ChiOption[] } | null {
  const seat = (fromSeat + 1) % 4;
  const chiOptions = canChi(state.players[seat]!.hand, tile);
  return chiOptions.length > 0 ? { seat, chiOptions } : null;
}

function resolveDiscardReactions(state: MahjongState, fromSeat: number, tile: MahjongTileId): void {
  const huSeat = findHuCandidate(state, fromSeat, tile);
  if (huSeat !== null) {
    offerReaction(state, huSeat, ['hu', 'pass'], tile, fromSeat, [], 'discard');
    return;
  }
  const pg = findPengGangCandidate(state, fromSeat, tile);
  if (pg) {
    offerReaction(state, pg.seat, pg.type === 'gang' ? ['gang', 'peng', 'pass'] : ['peng', 'pass'], tile, fromSeat, [], 'discard');
    return;
  }
  const chi = findChiCandidate(state, fromSeat, tile);
  if (chi) {
    offerReaction(state, chi.seat, ['chi', 'pass'], tile, fromSeat, chi.chiOptions, 'discard');
    return;
  }
  continueAfterNoReaction(state, fromSeat);
}

function applyDiscard(state: MahjongState, tile: MahjongTileId): void {
  const seat = state.turnSeat;
  const player = state.players[seat]!;
  player.hand.splice(player.hand.indexOf(tile), 1);
  player.discards.push(tile);
  player.claimedDiscards.push(false);
  state.discardSeq += 1;
  player.discardOrder.push(state.discardSeq);
  state.lastDiscard = { tile, fromSeat: seat };
  state.phase = 'discard';
  resolveDiscardReactions(state, seat, tile);
}

function offerRobKong(state: MahjongState, actingSeat: number, tile: MahjongTileId): void {
  const order = seatsInPriorityOrder(actingSeat);
  let robberSeat: number | null = null;
  for (const s of order) {
    const p = state.players[s]!;
    if (canHu([...p.hand, tile], p.melds)) {
      robberSeat = s;
      break;
    }
  }
  if (robberSeat === null) {
    completeJiaGang(state, actingSeat, tile);
    return;
  }
  state.pendingRobKong = { actingSeat, tile };
  offerReaction(state, robberSeat, ['hu', 'pass'], tile, actingSeat, [], 'kong');
}

function completeJiaGang(state: MahjongState, seat: number, tile: MahjongTileId): void {
  const player = state.players[seat]!;
  const meldIdx = player.melds.findIndex((m) => m.type === 'peng' && m.tiles[0] === tile);
  if (meldIdx >= 0) {
    const from = player.melds[meldIdx]!.from;
    player.melds[meldIdx] = { type: 'gang', tiles: [tile, tile, tile, tile], concealed: false, from };
  }
  player.hand = removeN(player.hand, tile, 1);
  state.anyCallHappened = true;
  state.pendingKongReplacement = true;
  state.pendingRobKong = null;
  beginTurn(state, seat);
}

function applySelfDraw(state: MahjongState, action: MahjongSelfDrawAction, chosenTile?: MahjongTileId): void {
  const seat = state.turnSeat;
  const ctx = state.pendingSelfDrawContext ?? { isKongReplacement: false, isFirstTurnWin: false, isLastTile: false };
  state.selfDraw = null;

  if (action === 'hu') {
    endRoundWin(state, seat, 'selfDraw', { ...ctx, fromSeat: null, tile: null, isRobKong: false });
    return;
  }
  if (action === 'gang') {
    const player = state.players[seat]!;
    const gangChoices = canGang(player.hand, null, true, existingPengTiles(player));
    const match = (chosenTile && gangChoices.find((g) => g.tile === chosenTile)) || gangChoices[0];
    if (!match) {
      goToDiscard(state, seat);
      return;
    }
    if (match.kind === 'an') {
      player.hand = removeN(player.hand, match.tile, 4);
      player.melds.push({ type: 'gang', tiles: [match.tile, match.tile, match.tile, match.tile], concealed: true, from: null });
      state.anyCallHappened = true;
      state.pendingKongReplacement = true;
      beginTurn(state, seat);
      return;
    }
    // jia：加槓前先讓其他人有機會搶槓胡
    offerRobKong(state, seat, match.tile);
    return;
  }
  goToDiscard(state, seat);
}

/** 這家最新的那張棄牌被吃／碰／槓／胡走了，前端的牌桌棄牌區要把它濾掉。 */
function markDiscardClaimed(state: MahjongState, seat: number): void {
  const player = state.players[seat]!;
  const idx = player.claimedDiscards.length - 1;
  if (idx >= 0) player.claimedDiscards[idx] = true;
}

function applyReaction(state: MahjongState, action: MahjongReactionAction, chiTiles?: [MahjongTileId, MahjongTileId]): void {
  const r = state.reaction!;
  state.reaction = null;
  const seat = r.respondSeat;
  const tile = r.discardedTile;
  const fromSeat = r.fromSeat;

  if (action === 'pass') {
    if (r.source === 'kong') {
      const pending = state.pendingRobKong;
      if (pending) completeJiaGang(state, pending.actingSeat, pending.tile);
      return;
    }
    continueAfterNoReaction(state, fromSeat);
    return;
  }

  if (action === 'hu') {
    // 搶槓的「棄牌」其實是別人加槓摸到的牌，從沒進過 discards，不用（也不能）標記
    if (r.source === 'discard') markDiscardClaimed(state, fromSeat);
    endRoundWin(state, seat, 'discard', {
      fromSeat,
      tile,
      isRobKong: r.source === 'kong',
      isLastTile: state.wall.length === 0,
      isFirstTurnWin: false,
      isKongReplacement: false,
    });
    return;
  }

  const player = state.players[seat]!;
  if (action === 'gang') {
    markDiscardClaimed(state, fromSeat);
    player.hand = removeN(player.hand, tile, 3);
    player.melds.push({ type: 'gang', tiles: [tile, tile, tile, tile], concealed: false, from: fromSeat });
    state.anyCallHappened = true;
    state.pendingKongReplacement = true;
    beginTurn(state, seat);
    return;
  }
  if (action === 'peng') {
    markDiscardClaimed(state, fromSeat);
    player.hand = removeN(player.hand, tile, 2);
    player.melds.push({ type: 'peng', tiles: [tile, tile, tile], concealed: false, from: fromSeat });
    state.anyCallHappened = true;
    // 碰不用摸牌，這一手沒有「剛摸到的牌」可以顯示
    state.justDrawn = null;
    goToDiscard(state, seat);
    return;
  }
  if (action === 'chi') {
    markDiscardClaimed(state, fromSeat);
    const chosen =
      (chiTiles && r.chiOptions.find((opt) => opt[0] === chiTiles[0] && opt[1] === chiTiles[1])) || r.chiOptions[0]!;
    player.hand = removeOneEach(player.hand, chosen);
    player.melds.push({ type: 'chi', tiles: sortMahjongHand([...chosen, tile]), concealed: false, from: fromSeat });
    state.anyCallHappened = true;
    // 吃不用摸牌，這一手沒有「剛摸到的牌」可以顯示
    state.justDrawn = null;
    goToDiscard(state, seat);
  }
}

interface WinExtra {
  fromSeat: number | null;
  tile: MahjongTileId | null;
  isRobKong: boolean;
  isKongReplacement: boolean;
  isFirstTurnWin: boolean;
  isLastTile: boolean;
}

function endRoundWin(state: MahjongState, winnerSeat: number, winType: 'selfDraw' | 'discard', extra: WinExtra): void {
  const player = state.players[winnerSeat]!;
  const concealedTiles = winType === 'selfDraw' ? player.hand.slice() : [...player.hand, extra.tile!];
  const seatWind = MAHJONG_WINDS[(winnerSeat - state.bankerSeat + 4) % 4]!;
  const scoreResult = calcTai({
    concealedTiles,
    melds: player.melds,
    winType,
    isDealer: winnerSeat === state.bankerSeat,
    flowers: player.flowers,
    seatWind,
    roundWind: 'WE',
    isFirstTurnWin: extra.isFirstTurnWin,
    isKongReplacement: extra.isKongReplacement,
    isLastTile: extra.isLastTile,
    isRobKong: extra.isRobKong,
  });
  const tai = scoreResult.total;
  const payments = [0, 0, 0, 0];
  if (winType === 'selfDraw') {
    for (let s = 0; s < 4; s++) {
      if (s === winnerSeat) continue;
      payments[s]! -= tai * TAI_UNIT_SELF_DRAW;
      payments[winnerSeat]! += tai * TAI_UNIT_SELF_DRAW;
    }
  } else {
    const payer = extra.fromSeat!;
    payments[payer]! -= tai * TAI_UNIT_DISCARD;
    payments[winnerSeat]! += tai * TAI_UNIT_DISCARD;
  }
  for (let s = 0; s < 4; s++) state.players[s]!.score += payments[s]!;

  const items: MahjongScoreItem[] = scoreResult.items;
  state.roundResult = {
    winnerSeat,
    winType,
    tai,
    breakdown: items,
    payments: payments.slice(),
    scores: state.players.map((p) => p.score),
  };

  if (winnerSeat !== state.bankerSeat) {
    state.bankerSeat = (state.bankerSeat + 1) % 4;
  }
  finishRound(state);
}

function endRoundDraw(state: MahjongState): void {
  state.roundResult = {
    winnerSeat: null,
    winType: 'draw',
    tai: 0,
    breakdown: [],
    payments: [0, 0, 0, 0],
    scores: state.players.map((p) => p.score),
  };
  finishRound(state);
}

/**
 * 每一局結束（贏牌或流局）一律先進 roundEnd，把胡牌牌型／台數結算畫面完整顯示出來——
 * 就算這局已經讓比賽達到終局條件，也不會直接跳過結算畫面。是不是最後一局只記在
 * pendingMatchEnd 裡，由 handlers.ts 決定顯示完結算畫面後何時真的呼叫 finalizeMahjongMatch。
 */
function finishRound(state: MahjongState): void {
  state.selfDraw = null;
  state.reaction = null;
  state.over = true;
  state.turnDeadline = 0;
  state.phase = 'roundEnd';
  // 結算畫面要等大家按繼續才能開下一局，每次進到這個畫面都要重新歸零。
  state.roundReady = [false, false, false, false];

  // 兩個結束條件哪個先到都算數：有人衝到目標分數，或是已經打滿局數上限。
  const maxScore = Math.max(...state.players.map((p) => p.score));
  state.pendingMatchEnd = maxScore >= MAHJONG_TARGET_SCORE || state.round >= MAHJONG_MAX_ROUNDS;
}

/**
 * 結算畫面顯示完畢後，真正把比賽收尾：贏家是當下分數最高的那位
 * （打滿局數上限時未必有人衝到 MAHJONG_TARGET_SCORE）。只有 pendingMatchEnd 的
 * 那一局結束後才會呼叫。
 */
export function finalizeMahjongMatch(state: MahjongState): void {
  const maxScore = Math.max(...state.players.map((p) => p.score));
  state.matchWinnerSeat = state.players.findIndex((p) => p.score === maxScore);
  state.matchOver = true;
  state.phase = 'matchEnd';
}

/** 結算畫面按下「繼續」；只有輪到這個畫面（phase === 'roundEnd'）時才算數。 */
export function confirmMahjongRoundReady(seats: Seats, state: MahjongState, playerId: PlayerId): Result {
  if (state.phase !== 'roundEnd') return { ok: false, error: 'WRONG_PHASE' };
  const seat = seats.indexOf(playerId);
  if (seat === -1) return { ok: false, error: 'NOT_YOUR_TURN' };
  state.roundReady[seat] = true;
  return { ok: true };
}

/** 是否每個還坐著的座位都按了繼續（空位跳過，不會卡住）。 */
export function allMahjongRoundReady(seats: Seats, state: MahjongState): boolean {
  return seats.every((playerId, seat) => playerId === null || state.roundReady[seat] === true);
}

// ---------------------------------------------------------------------------
// 對外動作（含玩家身分驗證）
// ---------------------------------------------------------------------------

export function discardTile(seats: Seats, state: MahjongState, playerId: PlayerId, tile: MahjongTileId): Result {
  if (state.over) return { ok: false, error: 'GAME_NOT_RUNNING' };
  if (state.phase !== 'discard') return { ok: false, error: 'WRONG_PHASE' };
  if (seats[state.turnSeat] !== playerId) return { ok: false, error: 'NOT_YOUR_TURN' };
  if (!state.players[state.turnSeat]!.hand.includes(tile)) return { ok: false, error: 'NOT_IN_HAND' };
  applyDiscard(state, tile);
  return { ok: true };
}

export function chooseSelfDrawAction(
  seats: Seats,
  state: MahjongState,
  playerId: PlayerId,
  action: MahjongSelfDrawAction,
  tile?: MahjongTileId,
): Result {
  if (state.over) return { ok: false, error: 'GAME_NOT_RUNNING' };
  if (state.phase !== 'selfDraw' || !state.selfDraw) return { ok: false, error: 'WRONG_PHASE' };
  if (seats[state.turnSeat] !== playerId) return { ok: false, error: 'NOT_YOUR_TURN' };
  if (action === 'hu' && !state.selfDraw.canHu) return { ok: false, error: 'INVALID_ACTION' };
  if (action === 'gang' && state.selfDraw.gangChoices.length === 0) return { ok: false, error: 'INVALID_ACTION' };
  applySelfDraw(state, action, tile);
  return { ok: true };
}

export function respondToReaction(
  seats: Seats,
  state: MahjongState,
  playerId: PlayerId,
  action: MahjongReactionAction,
  chiTiles?: [MahjongTileId, MahjongTileId],
): Result {
  if (state.over) return { ok: false, error: 'GAME_NOT_RUNNING' };
  if (state.phase !== 'reaction' || !state.reaction) return { ok: false, error: 'WRONG_PHASE' };
  if (seats[state.reaction.respondSeat] !== playerId) return { ok: false, error: 'NOT_YOUR_TURN' };
  if (!state.reaction.options.includes(action)) return { ok: false, error: 'INVALID_ACTION' };
  applyReaction(state, action, chiTiles);
  return { ok: true };
}

/**
 * 逾時代打：出牌階段優先打掉這一手剛摸到的那張牌（真人在想的通常就是「這張要不要」），
 * 碰／吃來的沒有摸牌可打，退回丟手牌最後一張；自摸階段不動作、反應階段一律 PASS。
 */
export function autoActMahjong(state: MahjongState): { action: string } | null {
  if (state.over) return null;
  switch (state.phase) {
    case 'discard': {
      const player = state.players[state.turnSeat]!;
      const tile =
        state.justDrawn && state.justDrawn.seat === state.turnSeat
          ? state.justDrawn.tile
          : player.hand[player.hand.length - 1];
      if (!tile) return null;
      applyDiscard(state, tile);
      return { action: 'discard' };
    }
    case 'selfDraw':
      applySelfDraw(state, 'none');
      return { action: 'selfDrawNone' };
    case 'reaction':
      applyReaction(state, 'pass');
      return { action: 'pass' };
    default:
      return null;
  }
}

/** 座位依分數高到低排出名次，供 handlers.ts 換成 playerId 廣播。 */
export function rankMahjongSeats(state: MahjongState): number[] {
  return [0, 1, 2, 3].sort((a, b) => state.players[b]!.score - state.players[a]!.score);
}
