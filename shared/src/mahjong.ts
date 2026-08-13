import { shuffle } from './cards.js';
import type { PlayerId } from './types.js';

// ---------------------------------------------------------------------------
// 牌
// ---------------------------------------------------------------------------

/**
 * 牌的代號：
 *   數牌 '1m'..'9m'（萬）、'1s'..'9s'（索）、'1p'..'9p'（筒）
 *   風牌 'WE'(東) 'WS'(南) 'WW'(西) 'WN'(北)
 *   三元牌 'DR'(中) 'DG'(發) 'DW'(白)
 *   花牌 'FS1'..'FS4'（春夏秋冬）、'FP1'..'FP4'（梅蘭竹菊）
 * 座位 n 的正花是 FS{n+1} 與 FP{n+1}。
 */
export type MahjongTileId = string;

export const MAHJONG_SUITS = ['m', 's', 'p'] as const;
export const MAHJONG_WINDS: readonly MahjongTileId[] = ['WE', 'WS', 'WW', 'WN'];
export const MAHJONG_DRAGONS: readonly MahjongTileId[] = ['DR', 'DG', 'DW'];
export const MAHJONG_SEASON_FLOWERS: readonly MahjongTileId[] = ['FS1', 'FS2', 'FS3', 'FS4'];
export const MAHJONG_PLANT_FLOWERS: readonly MahjongTileId[] = ['FP1', 'FP2', 'FP3', 'FP4'];
export const MAHJONG_ALL_FLOWERS: readonly MahjongTileId[] = [
  ...MAHJONG_SEASON_FLOWERS,
  ...MAHJONG_PLANT_FLOWERS,
];

export function isFlowerTile(code: MahjongTileId): boolean {
  return code[0] === 'F';
}

export function isHonorTile(code: MahjongTileId): boolean {
  return code.length === 2 && (MAHJONG_WINDS.includes(code) || MAHJONG_DRAGONS.includes(code));
}

export function isSuitedTile(code: MahjongTileId): boolean {
  return code.length === 2 && (MAHJONG_SUITS as readonly string[]).includes(code[1]!);
}

export function tileRank(code: MahjongTileId): number {
  return isSuitedTile(code) ? Number(code[0]) : 0;
}

export function tileSuit(code: MahjongTileId): string | null {
  return isSuitedTile(code) ? code[1]! : null;
}

/** 這張花牌是不是這個座位的正花。 */
export function seatOwnsFlower(seat: number, code: MahjongTileId): boolean {
  if (!isFlowerTile(code)) return false;
  return Number(code.slice(2)) === seat + 1;
}

/** 144 張牌的完整一副：108 張數牌 + 16 張風牌 + 12 張三元牌 + 8 張花牌。 */
export function buildMahjongDeck(): MahjongTileId[] {
  const deck: MahjongTileId[] = [];
  for (const suit of MAHJONG_SUITS) {
    for (let rank = 1; rank <= 9; rank++) {
      for (let i = 0; i < 4; i++) deck.push(`${rank}${suit}`);
    }
  }
  for (const w of MAHJONG_WINDS) for (let i = 0; i < 4; i++) deck.push(w);
  for (const d of MAHJONG_DRAGONS) for (let i = 0; i < 4; i++) deck.push(d);
  for (const f of MAHJONG_ALL_FLOWERS) deck.push(f);
  return deck;
}

const MAHJONG_SUIT_ORDER: Record<string, number> = { m: 0, s: 1, p: 2 };
const MAHJONG_HONOR_ORDER: Record<string, number> = {
  WE: 0,
  WS: 1,
  WW: 2,
  WN: 3,
  DR: 4,
  DG: 5,
  DW: 6,
};

function tileSortKey(code: MahjongTileId): number {
  if (isSuitedTile(code)) return MAHJONG_SUIT_ORDER[tileSuit(code)!]! * 10 + tileRank(code);
  if (code in MAHJONG_HONOR_ORDER) return 30 + MAHJONG_HONOR_ORDER[code]!;
  return 99;
}

/** 手牌顯示用的固定排序：萬索筒依點數，然後風牌，然後三元牌。 */
export function sortMahjongHand(tiles: readonly MahjongTileId[]): MahjongTileId[] {
  return tiles.slice().sort((a, b) => tileSortKey(a) - tileSortKey(b));
}

/** 牌面文字，例如 '3m' → '3萬'、'WE' → '東'、'DR' → '中'。log 與提示用。 */
export function mahjongTileLabel(code: MahjongTileId): string {
  // 1 筒的牌面是圓餅圖案，唸法用中文數字「一筒」；2~9 筒還是叫「N筒」，不跟著改
  if (code === '1p') return '一筒';
  const suitName: Record<string, string> = { m: '萬', s: '條', p: '筒' };
  if (isSuitedTile(code)) return `${tileRank(code)}${suitName[tileSuit(code)!]}`;
  const honor: Record<string, string> = {
    WE: '東',
    WS: '南',
    WW: '西',
    WN: '北',
    DR: '中',
    DG: '發',
    DW: '白',
  };
  if (code in honor) return honor[code]!;
  const flower: Record<string, string> = {
    FS1: '春',
    FS2: '夏',
    FS3: '秋',
    FS4: '冬',
    FP1: '梅',
    FP2: '蘭',
    FP3: '竹',
    FP4: '菊',
  };
  return flower[code] ?? code;
}

// ---------------------------------------------------------------------------
// 面子
// ---------------------------------------------------------------------------

export type MeldType = 'chi' | 'peng' | 'gang';

export interface MahjongMeld {
  type: MeldType;
  tiles: MahjongTileId[];
  /** 暗槓為 true；吃、碰、明槓、加槓皆為 false。 */
  concealed: boolean;
  /** 這副面子的牌是跟誰要來的；暗槓沒有來源，為 null。 */
  from: number | null;
}

export type GangKind = 'an' | 'ming' | 'jia';

export interface GangChoice {
  /** an=暗槓（手上四張）、ming=明槓（碰別人棄牌湊四張）、jia=加槓（已碰過再摸到第四張）。 */
  kind: GangKind;
  tile: MahjongTileId;
}

export type ChiOption = readonly [MahjongTileId, MahjongTileId];

function countTile(hand: readonly MahjongTileId[], code: MahjongTileId): number {
  let n = 0;
  for (const t of hand) if (t === code) n++;
  return n;
}

/** 吃：只有棄牌者下家能吃，座位相鄰的檢查由呼叫端負責，這裡只看牌形。 */
export function canChi(hand: readonly MahjongTileId[], discarded: MahjongTileId): ChiOption[] {
  if (!isSuitedTile(discarded)) return [];
  const suit = tileSuit(discarded)!;
  const rank = tileRank(discarded);
  const has = (r: number) => hand.includes(`${r}${suit}`);
  const results: ChiOption[] = [];
  if (rank - 2 >= 1 && has(rank - 2) && has(rank - 1)) {
    results.push([`${rank - 2}${suit}`, `${rank - 1}${suit}`]);
  }
  if (rank - 1 >= 1 && rank + 1 <= 9 && has(rank - 1) && has(rank + 1)) {
    results.push([`${rank - 1}${suit}`, `${rank + 1}${suit}`]);
  }
  if (rank + 2 <= 9 && has(rank + 1) && has(rank + 2)) {
    results.push([`${rank + 1}${suit}`, `${rank + 2}${suit}`]);
  }
  return results;
}

export function canPeng(hand: readonly MahjongTileId[], discarded: MahjongTileId): boolean {
  return countTile(hand, discarded) >= 2;
}

/**
 * 槓的所有可能：
 * - 別人棄牌時（isSelfDraw=false）：手上已有三張同牌可明槓。
 * - 自己摸牌時（isSelfDraw=true）：手上湊滿四張可暗槓；或摸到的牌跟既有的碰面子相同可加槓。
 */
export function canGang(
  hand: readonly MahjongTileId[],
  discarded: MahjongTileId | null,
  isSelfDraw: boolean,
  existingPengTiles: readonly MahjongTileId[] = [],
): GangChoice[] {
  const results: GangChoice[] = [];
  if (!isSelfDraw) {
    if (discarded && countTile(hand, discarded) >= 3) {
      results.push({ kind: 'ming', tile: discarded });
    }
    return results;
  }
  const counts = new Map<MahjongTileId, number>();
  for (const t of hand) counts.set(t, (counts.get(t) ?? 0) + 1);
  for (const [t, c] of counts) {
    if (c >= 4) results.push({ kind: 'an', tile: t });
  }
  for (const t of existingPengTiles) {
    if (hand.includes(t)) results.push({ kind: 'jia', tile: t });
  }
  return results;
}

function removeOne(tiles: readonly MahjongTileId[], code: MahjongTileId): MahjongTileId[] | null {
  const idx = tiles.indexOf(code);
  if (idx === -1) return null;
  return tiles.slice(0, idx).concat(tiles.slice(idx + 1));
}

function canFormAllSets(
  tiles: readonly MahjongTileId[],
  setsNeeded: number,
  memo: Map<string, boolean>,
): boolean {
  if (setsNeeded === 0) return tiles.length === 0;
  if (tiles.length === 0) return false;
  const key = `${tiles.join(',')}|${setsNeeded}`;
  const cached = memo.get(key);
  if (cached !== undefined) return cached;
  let result = false;
  const first = tiles[0]!;
  if (tiles[1] === first && tiles[2] === first) {
    if (canFormAllSets(tiles.slice(3), setsNeeded - 1, memo)) result = true;
  }
  if (!result && isSuitedTile(first)) {
    const suit = tileSuit(first)!;
    const rank = tileRank(first);
    if (rank <= 7) {
      const rest1 = removeOne(tiles.slice(1), `${rank + 1}${suit}`);
      if (rest1) {
        const rest2 = removeOne(rest1, `${rank + 2}${suit}`);
        if (rest2 && canFormAllSets(rest2, setsNeeded - 1, memo)) result = true;
      }
    }
  }
  memo.set(key, result);
  return result;
}

/**
 * concealedTiles 必須已經包含胡的那張牌。melds 是已經吃碰槓過的面子，
 * 每副算進五組裡的其中一組。
 */
export function canHu(concealedTiles: readonly MahjongTileId[], melds: readonly MahjongMeld[] = []): boolean {
  const setsNeeded = 5 - melds.length;
  const totalNeeded = setsNeeded * 3 + 2;
  if (setsNeeded < 0 || concealedTiles.length !== totalNeeded) return false;
  const sorted = sortMahjongHand(concealedTiles);
  const memo = new Map<string, boolean>();
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i] === sorted[i + 1]) {
      const rest = sorted.slice(0, i).concat(sorted.slice(i + 2));
      if (canFormAllSets(rest, setsNeeded, memo)) return true;
    }
  }
  return false;
}

export interface DecomposedSet {
  type: 'triplet' | 'sequence';
  tiles: [MahjongTileId, MahjongTileId, MahjongTileId];
}

export interface Decomposition {
  pair: MahjongTileId;
  sets: DecomposedSet[];
}

/**
 * 回傳一種合法拆法（供計台使用）。一手牌若有多種拆法，只採用找到的第一種——
 * 不保證選到台數最高的拆法，這是文件化過的簡化（見 scoring 相關說明）。
 */
export function decomposeConcealed(
  concealedTiles: readonly MahjongTileId[],
  setsNeeded: number,
): Decomposition | null {
  const sorted = sortMahjongHand(concealedTiles);
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i] === sorted[i + 1]) {
      const rest = sorted.slice(0, i).concat(sorted.slice(i + 2));
      const sets = formSets(rest, setsNeeded);
      if (sets) return { pair: sorted[i]!, sets };
    }
  }
  return null;
}

function formSets(tiles: readonly MahjongTileId[], setsNeeded: number): DecomposedSet[] | null {
  if (setsNeeded === 0) return tiles.length === 0 ? [] : null;
  if (tiles.length === 0) return null;
  const first = tiles[0]!;
  if (tiles[1] === first && tiles[2] === first) {
    const sub = formSets(tiles.slice(3), setsNeeded - 1);
    if (sub) return [{ type: 'triplet', tiles: [first, first, first] }, ...sub];
  }
  if (isSuitedTile(first)) {
    const suit = tileSuit(first)!;
    const rank = tileRank(first);
    if (rank <= 7) {
      const t2 = `${rank + 1}${suit}`;
      const t3 = `${rank + 2}${suit}`;
      const r1 = removeOne(tiles.slice(1), t2);
      if (r1) {
        const r2 = removeOne(r1, t3);
        if (r2) {
          const sub = formSets(r2, setsNeeded - 1);
          if (sub) return [{ type: 'sequence', tiles: [first, t2, t3] }, ...sub];
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 計台
// ---------------------------------------------------------------------------

export interface MahjongScoreContext {
  /** 已包含胡牌那張的暗牌。 */
  concealedTiles: readonly MahjongTileId[];
  melds: readonly MahjongMeld[];
  winType: 'selfDraw' | 'discard';
  isDealer: boolean;
  flowers: readonly MahjongTileId[];
  /** 自風。 */
  seatWind: MahjongTileId;
  /** 圈風，本簡化版固定東風場。 */
  roundWind: MahjongTileId;
  isFirstTurnWin: boolean;
  isKongReplacement: boolean;
  isLastTile: boolean;
  isRobKong: boolean;
}

export interface MahjongScoreItem {
  name: string;
  tai: number;
}

export interface MahjongScoreResult {
  items: MahjongScoreItem[];
  total: number;
  valid: boolean;
}

function isConcealedHand(melds: readonly MahjongMeld[]): boolean {
  return melds.every((m) => m.type === 'gang' && m.concealed);
}

/**
 * 簡化版台灣十六張計台表，非正式比賽逐字對照版本，台數比對多份坊間常見台數表
 * （天胡 24、地胡 16、槓上開花／海底撈月／河底撈魚／搶槓皆 1 台、莊家 1 台、
 * 單組三元刻 1 台、五暗刻 8 台）校正，但各家牌桌規則本來就有差異，非唯一標準：
 * - 單一東風場，沒有圈風輪替
 * - 沒有七對子／十三么，一律用標準 5 組＋1 對判斷
 * - 一手牌若有多種拆法，只採用 decomposeConcealed 找到的第一種
 * - 沒有聽牌相關的天聽／地聽／人胡等進階牌型
 */
export function calcTai(ctx: MahjongScoreContext): MahjongScoreResult {
  const {
    concealedTiles,
    melds,
    winType,
    isDealer,
    flowers,
    seatWind,
    roundWind,
    isFirstTurnWin,
    isKongReplacement,
    isLastTile,
    isRobKong,
  } = ctx;

  const setsNeeded = 5 - melds.length;
  const decomposition = decomposeConcealed(concealedTiles, setsNeeded);
  const items: MahjongScoreItem[] = [];
  if (!decomposition) return { items, total: 0, valid: false };

  const meldSets = melds.map((m) => ({
    type: (m.type === 'chi' ? 'sequence' : 'triplet') as 'sequence' | 'triplet',
    tiles: m.tiles.slice(0, 3),
    concealed: m.type === 'gang' ? !!m.concealed : false,
  }));
  const concealedSets = decomposition.sets.map((s) => ({ ...s, concealed: true }));
  const sets = [...meldSets, ...concealedSets];
  const pair = decomposition.pair;

  const allTiles = [...concealedTiles, ...melds.flatMap((m) => m.tiles)];
  const usedSuits = new Set(allTiles.filter(isSuitedTile).map((t) => tileSuit(t)!));
  const hasHonorTile = allTiles.some(isHonorTile);
  const concealed = isConcealedHand(melds);

  const add = (name: string, tai: number) => {
    if (tai > 0) items.push({ name, tai });
  };

  const seatIndex = MAHJONG_WINDS.indexOf(seatWind);
  const ownFlowerCount = flowers.filter((f) => Number(f.slice(2)) === seatIndex + 1).length;
  if (flowers.length) add('花牌', flowers.length);
  if (ownFlowerCount) add('正花', ownFlowerCount);

  if (winType === 'selfDraw') add('自摸', 1);
  if (concealed) add('門清', 1);

  const sequenceCount = sets.filter((s) => s.type === 'sequence').length;
  const tripletCount = sets.filter((s) => s.type === 'triplet').length;

  if (sequenceCount === 5 && !isHonorTile(pair)) add('平胡', 2);
  if (tripletCount === 5) add('碰碰胡', 4);

  if (!hasHonorTile && usedSuits.size === 1) {
    add('清一色', 8);
  } else if (usedSuits.size === 1 && hasHonorTile) {
    add('混一色', 4);
  } else if (usedSuits.size === 0 && hasHonorTile) {
    add('字一色', 16);
  }

  const dragonTriplets = sets.filter((s) => s.type === 'triplet' && MAHJONG_DRAGONS.includes(s.tiles[0]!));
  if (dragonTriplets.length === 3) {
    add('大三元', 8);
  } else if (dragonTriplets.length === 2 && MAHJONG_DRAGONS.includes(pair)) {
    add('小三元', 4);
  } else if (dragonTriplets.length > 0) {
    // 未湊成小/大三元的單組三元刻（中/發/白），每組照樣算 1 台
    add('三元牌', dragonTriplets.length);
  }

  const windTriplets = sets.filter((s) => s.type === 'triplet' && MAHJONG_WINDS.includes(s.tiles[0]!));
  if (windTriplets.length === 4) {
    add('大四喜', 16);
  } else if (windTriplets.length === 3 && MAHJONG_WINDS.includes(pair)) {
    add('小四喜', 8);
  }
  if (windTriplets.some((s) => s.tiles[0] === seatWind)) add('自風', 1);
  if (windTriplets.some((s) => s.tiles[0] === roundWind)) add('圈風', 1);

  const preWinCount = concealedTiles.length - 1;
  if (winType === 'discard' && melds.length >= 4 && preWinCount <= 1) add('全求人', 2);

  // 天胡／地胡／海底撈月／河底撈魚／槓上開花／搶槓／莊家：台數比對多份坊間台數表校正過
  if (isFirstTurnWin && winType === 'selfDraw' && isDealer) add('天胡', 24);
  if (isFirstTurnWin && winType === 'selfDraw' && !isDealer) add('地胡', 16);
  if (isKongReplacement && winType === 'selfDraw') add('槓上開花', 1);
  if (isLastTile) add(winType === 'selfDraw' ? '海底撈月' : '河底撈魚', 1);
  if (isRobKong) add('搶槓', 1);
  if (isDealer) add('莊家', 1);

  const concealedTripletCount = sets.filter((s) => s.type === 'triplet' && s.concealed).length;
  if (concealedTripletCount === 5) add('五暗刻', 8);
  else if (concealedTripletCount === 4) add('四暗刻', 5);
  else if (concealedTripletCount === 3) add('三暗刻', 2);

  const gangCount = melds.filter((m) => m.type === 'gang').length;
  if (gangCount > 0) add('槓', gangCount);

  let total = items.reduce((sum, it) => sum + it.tai, 0);
  if (total === 0) {
    add('屁胡', 1);
    total = 1;
  }

  return { items, total, valid: true };
}

// ---------------------------------------------------------------------------
// 遊戲快照（伺服器 → 前端）
// ---------------------------------------------------------------------------

export type MahjongPhase = 'discard' | 'selfDraw' | 'reaction' | 'roundEnd' | 'matchEnd';

export interface MahjongSeatInfo {
  handCount: number;
  melds: MahjongMeld[];
  discards: MahjongTileId[];
  /**
   * 跟 discards 一一對應：這張棄牌後來被吃／碰／槓／胡走了沒有。
   * 前端畫牌桌棄牌區時要濾掉這些——牌已經在別人的面子或胡牌裡了，不該在桌上留一份。
   */
  claimedDiscards: boolean[];
  /**
   * 跟 discards 一一對應：全桌（不分座位）遞增的出牌序號，用來判斷牌桌上「最後一張棄牌」
   * ——不能只看某一家自己陣列的最後一筆，因為畫面上是四家混在一起顯示的。
   */
  discardOrder: number[];
  flowers: MahjongTileId[];
  score: number;
  isDealer: boolean;
}

export interface MahjongLastDiscard {
  tile: MahjongTileId;
  fromSeat: number;
}

export type MahjongSelfDrawAction = 'hu' | 'gang' | 'none';
export type MahjongReactionAction = 'hu' | 'peng' | 'gang' | 'chi' | 'pass';

/** 自摸後的胡／槓提示，只送給該座位本人。 */
export interface MahjongSelfDrawOptions {
  canHu: boolean;
  gangChoices: GangChoice[];
}

/** 吃／碰／槓／胡的反應提示，只送給被詢問的那個座位。 */
export interface MahjongReactionOptions {
  respondSeat: number;
  options: MahjongReactionAction[];
  chiOptions: ChiOption[];
  discardedTile: MahjongTileId;
  fromSeat: number;
}

export interface MahjongRoundResult {
  winnerSeat: number | null;
  winType: 'selfDraw' | 'discard' | 'draw';
  tai: number;
  breakdown: MahjongScoreItem[];
  /** 每個座位這一局的輸贏（正負皆有），index = seat。 */
  payments: number[];
  /** 結算後的最新分數，index = seat。 */
  scores: number[];
}

export interface MahjongGameView {
  type: 'taiwanMahjong';
  phase: MahjongPhase;
  round: number;
  bankerSeat: number;
  /** 開局擲的三顆骰子（從 0 號座位數骰子和決定莊家），整場比賽固定不變。 */
  bankerDice: [number, number, number];
  wallCount: number;
  /** 現在該由誰輸入：可能是該摸牌出牌的人，也可能是被問吃碰槓胡的人。結束時為 null。 */
  turnPlayerId: PlayerId | null;
  turnDeadline: number;
  /** 整場比賽（而非單局）是否結束。 */
  over: boolean;
  matchWinnerSeat: number | null;
  seats: Record<number, MahjongSeatInfo>;
  lastDiscard: MahjongLastDiscard | null;
  /** 只有輪到你自摸決策時才有值。 */
  mySelfDraw: MahjongSelfDrawOptions | null;
  /** 只有輪到你被問吃碰槓胡時才有值。 */
  myReaction: MahjongReactionOptions | null;
  /** 這回合剛摸到、還沒決定要不要打出去的那張牌；只有輪到你出牌時才有值，
   *  讓前端把它跟手牌分開一格顯示，別人看不到。碰／吃不用摸牌，這時是 null。 */
  myJustDrawn: MahjongTileId | null;
  roundResult: MahjongRoundResult | null;
  /** 胡牌後公布全場的手牌，讓所有玩家（不只是觀戰者）能互相核對；平常是 null。 */
  allHands: Record<number, MahjongTileId[]> | null;
  /** 結算畫面（phase === 'roundEnd'）誰按了「繼續」，index = seat；其他時候都是全 false。 */
  roundReady: boolean[];
  /**
   * 這一局的結算畫面是不是最後一局（分數已達門檻或局數已打滿）。這種情況下結算畫面
   * 不用等玩家按繼續，過一段固定時間伺服器會自動轉成 over === true 的整場結束畫面。
   */
  pendingMatchEnd: boolean;
}

// ---------------------------------------------------------------------------
// Socket 動作
// ---------------------------------------------------------------------------

export type MahjongAction =
  | { kind: 'discard'; tile: MahjongTileId }
  | { kind: 'selfDraw'; action: MahjongSelfDrawAction; tile?: MahjongTileId }
  | { kind: 'respond'; action: MahjongReactionAction; chiTiles?: [MahjongTileId, MahjongTileId] }
  | { kind: 'continueRound' };

export const MAHJONG_ACTION_KINDS: readonly MahjongAction['kind'][] = [
  'discard',
  'selfDraw',
  'respond',
  'continueRound',
];

export function buildMahjongWall(rng: () => number = Math.random): MahjongTileId[] {
  return shuffle(buildMahjongDeck(), rng);
}
