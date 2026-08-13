import {
  isFlowerTile,
  isHonorTile,
  isSuitedTile,
  tileRank,
  tileSuit,
  type ChiOption,
  type GangChoice,
  type MahjongMeld,
  type MahjongReactionAction,
  type MahjongSelfDrawAction,
  type MahjongTileId,
} from 'shared';
import type { MahjongPlayerState } from './mahjongEngine.js';

/**
 * 電腦玩家的出牌／吃碰槓胡決策，移植自 mahjong-pixel 的 src/ai.js，邏輯不變，
 * 只是換成這裡的型別（GangChoice 用 kind/tile，不是原本的 type/tiles）。
 * 純粹是「看起來像會打牌」的簡單啟發式算法，不是求解器。
 */

function isTerminalTile(tile: MahjongTileId): boolean {
  const r = tileRank(tile);
  return r === 1 || r === 9;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function frequencyMap(tiles: readonly MahjongTileId[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const t of tiles) map[t] = (map[t] ?? 0) + 1;
  return map;
}

interface AiContext {
  allDiscards: MahjongTileId[][];
  allMeldsPublic: { seat: number; melds: MahjongMeld[] }[];
  wallCount: number;
  bankerSeat: number;
  discardedTile?: MahjongTileId;
  chiOptions?: ChiOption[];
  gangChoices?: GangChoice[];
}

function buildVisibleMap(context: AiContext): Record<string, number> {
  const all: MahjongTileId[] = [];
  for (const seatDiscards of context.allDiscards) all.push(...seatDiscards);
  for (const entry of context.allMeldsPublic) {
    for (const meld of entry.melds) all.push(...meld.tiles);
  }
  return frequencyMap(all);
}

function meldTiles(melds: readonly MahjongMeld[]): MahjongTileId[] {
  const out: MahjongTileId[] = [];
  for (const m of melds) out.push(...m.tiles);
  return out;
}

/**
 * 粗略判斷「是不是在拼一色」：用來讓碰／吃／槓別隨便吃進不同花色的牌，
 * 免得把清一色／混一色的機會親手拆掉。
 */
function dominantSuitInfo(player: MahjongPlayerState): { pursuing: boolean; suit: string | null } {
  const allTiles = [...player.hand, ...meldTiles(player.melds)];
  const counts: Record<string, number> = { m: 0, s: 0, p: 0 };
  let suitedCount = 0;
  let honorCount = 0;
  for (const t of allTiles) {
    const suit = tileSuit(t);
    if (suit) {
      counts[suit] = (counts[suit] ?? 0) + 1;
      suitedCount += 1;
    } else if (isHonorTile(t)) {
      honorCount += 1;
    }
  }
  let bestSuit: string | null = null;
  let bestCount = -1;
  for (const suit of ['m', 's', 'p']) {
    if ((counts[suit] ?? 0) > bestCount) {
      bestCount = counts[suit] ?? 0;
      bestSuit = suit;
    }
  }
  const fraction = suitedCount > 0 ? bestCount / suitedCount : 0;
  const pursuing = suitedCount >= 5 && fraction >= 0.75 && honorCount <= 2;
  return { pursuing, suit: bestSuit };
}

/** 分數越高越值得留著；挑棄牌時挑分數最低的，判斷吃牌組合值不值時把它反過來看。 */
function tileKeepValue(
  tile: MahjongTileId,
  handFreq: Record<string, number>,
  visibleMap: Record<string, number>,
): number {
  if (isFlowerTile(tile)) return -1000; // 正常不該留在 hand 裡，萬一有也絕對優先打掉

  const cnt = handFreq[tile] ?? 0;
  if (cnt >= 3) return 500; // 刻子／槓子的料，基本不會打
  if (cnt === 2) return 300; // 預設保護對子

  let score: number;
  if (isHonorTile(tile)) {
    score = 20; // 單張字牌只能靠碰／槓成型，沒有順子的可能
  } else if (isSuitedTile(tile)) {
    const rank = tileRank(tile);
    const suit = tileSuit(tile)!;
    let neighborBonus = 0;
    for (const delta of [1, -1]) {
      if (handFreq[`${rank + delta}${suit}`]) neighborBonus += 40;
    }
    for (const delta of [2, -2]) {
      if (handFreq[`${rank + delta}${suit}`]) neighborBonus += 15;
    }
    score = 20 + neighborBonus;
    if (isTerminalTile(tile)) score -= 10; // 么九只有單邊能接龍
  } else {
    score = 20;
  }

  const visible = visibleMap[tile] ?? 0;
  score -= visible * 12; // 場上看得越多，這張牌對自己越沒用、打出去也越安全

  return score;
}

export function aiChooseDiscard(player: MahjongPlayerState, context: AiContext): MahjongTileId {
  try {
    const hand = player.hand;
    if (!hand || hand.length === 0) return hand?.[0] as MahjongTileId;

    const handFreq = frequencyMap(hand);
    const visibleMap = buildVisibleMap(context);

    let best: MahjongTileId | null = null;
    let bestScore = Infinity;
    for (const tile of hand) {
      const score = tileKeepValue(tile, handFreq, visibleMap);
      if (best === null || score < bestScore) {
        best = tile;
        bestScore = score;
        continue;
      }
      if (score === bestScore) {
        const currentIsDead = isHonorTile(best) || isTerminalTile(best);
        const candidateIsDead = isHonorTile(tile) || isTerminalTile(tile);
        if (!currentIsDead && candidateIsDead) {
          best = tile;
          bestScore = score;
        } else if (currentIsDead === candidateIsDead) {
          const currentVisible = visibleMap[best] ?? 0;
          const candidateVisible = visibleMap[tile] ?? 0;
          if (candidateVisible > currentVisible) {
            best = tile;
            bestScore = score;
          }
        }
      }
    }

    return best ?? hand[hand.length - 1]!;
  } catch {
    const hand = player.hand;
    return hand?.[hand.length - 1] ?? ('1m' as MahjongTileId);
  }
}

function chiComboCost(combo: ChiOption, handFreq: Record<string, number>, visibleMap: Record<string, number>): number {
  let total = 0;
  for (const t of combo) total += tileKeepValue(t, handFreq, visibleMap);
  return total;
}

function pickBestChiCombo(
  chiOptions: readonly ChiOption[],
  hand: readonly MahjongTileId[],
  visibleMap: Record<string, number>,
): ChiOption | null {
  if (chiOptions.length === 0) return null;
  const handFreq = frequencyMap(hand);
  let best = chiOptions[0]!;
  let bestCost = Infinity;
  for (const combo of chiOptions) {
    const cost = chiComboCost(combo, handFreq, visibleMap);
    if (cost < bestCost) {
      bestCost = cost;
      best = combo;
    }
  }
  return best;
}

function pengProbability(player: MahjongPlayerState, discardedTile: MahjongTileId | undefined, flush: { pursuing: boolean; suit: string | null }): number {
  let prob = 0.75;
  if (flush.pursuing && discardedTile) {
    const suit = tileSuit(discardedTile);
    if (suit && suit !== flush.suit) prob = 0.1;
  }
  if (discardedTile && (isHonorTile(discardedTile) || isTerminalTile(discardedTile))) prob += 0.1;
  if (player.melds.length === 0 && player.discards.length <= 4) prob -= 0.15;
  if (player.melds.length >= 2) prob += 0.1;
  return clamp(prob, 0.05, 0.95);
}

function chiProbability(player: MahjongPlayerState, discardedTile: MahjongTileId | undefined, flush: { pursuing: boolean; suit: string | null }): number {
  let prob = 0.5;
  if (flush.pursuing && discardedTile) {
    const suit = tileSuit(discardedTile);
    if (suit && suit !== flush.suit) prob = 0.05;
  }
  if (player.melds.length === 0) prob -= 0.15;
  else prob += 0.15;
  return clamp(prob, 0.05, 0.9);
}

function gangFromDiscardProbability(player: MahjongPlayerState): number {
  let prob = 0.85;
  if (player.melds.length === 0 && player.discards.length <= 4) prob = 0.4;
  return clamp(prob, 0.05, 0.95);
}

export function aiRespond(
  player: MahjongPlayerState,
  options: readonly MahjongReactionAction[],
  context: AiContext,
): { action: MahjongReactionAction; chiTiles?: [MahjongTileId, MahjongTileId] } {
  try {
    const opts = new Set(options);
    if (opts.has('hu')) return { action: 'hu' };

    const flush = dominantSuitInfo(player);
    const discardedTile = context.discardedTile;

    if (opts.has('gang') && Math.random() < gangFromDiscardProbability(player)) {
      return { action: 'gang' };
    }
    if (opts.has('peng') && Math.random() < pengProbability(player, discardedTile, flush)) {
      return { action: 'peng' };
    }
    if (opts.has('chi')) {
      const chiOptions = context.chiOptions ?? [];
      if (chiOptions.length > 0 && Math.random() < chiProbability(player, discardedTile, flush)) {
        const visibleMap = buildVisibleMap(context);
        const combo = pickBestChiCombo(chiOptions, player.hand, visibleMap);
        if (combo) return { action: 'chi', chiTiles: [combo[0], combo[1]] };
      }
    }
    return { action: 'pass' };
  } catch {
    return { action: 'pass' };
  }
}

export function aiSelfDrawAction(
  player: MahjongPlayerState,
  options: { canHu: boolean; gangChoices: readonly GangChoice[] },
): { action: MahjongSelfDrawAction; tile?: MahjongTileId } {
  try {
    if (options.canHu) return { action: 'hu' };

    const choices = options.gangChoices;
    if (choices.length > 0) {
      const an = choices.find((c) => c.kind === 'an');
      const jia = choices.find((c) => c.kind === 'jia');
      const chosen = an ?? jia ?? choices[0]!;
      // 暗槓完全不會被搶槓，比加槓稍微更願意選
      const prob = chosen.kind === 'an' ? 0.7 : 0.65;
      if (Math.random() < prob) return { action: 'gang', tile: chosen.tile };
    }
    return { action: 'none' };
  } catch {
    return { action: 'none' };
  }
}

export type { AiContext };
