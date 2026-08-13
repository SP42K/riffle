import { PVE_ENEMIES, PVE_ENTRY_TELEGRAPH_MS, PVE_SCENES, type PveEnemyEntry, type PveEnemyType, type PveSceneId } from './content.js';

export interface PveDirectorState {
  spawnIndex: number;
  nextSpawnDepthM: number;
  enemyBag: PveEnemyType[];
  entryBag: PveEnemyEntry[];
  lastEntries: PveEnemyEntry[];
  recentPlatformIds: number[];
  pendingCard: Array<{ type: PveEnemyType; entry: PveEnemyEntry; card: PveEncounterCard }>;
  pendingReadyDepthM: number;
  eliteCardScene: PveSceneId | null;
}

export type PveEncounterCard = 'solo' | 'crossfire' | 'eliteEscort' | 'bossSummon';

export interface PveDirectorPlatform {
  id: number;
  x: number;
  y: number;
  width: number;
  broken?: boolean;
  bossTarget?: boolean;
  occupied?: boolean;
  safe?: boolean;
  playerOccupied?: boolean;
  predictedLanding?: boolean;
  timeToContactMs?: number;
}

export interface PveSpawnPlan {
  type: PveEnemyType;
  entry: PveEnemyEntry;
  platformId: number;
  telegraphMs: number;
  x: number;
  y: number;
  card?: PveEncounterCard;
  cueMs?: number;
  enteringMs?: number;
  settlingMs?: number;
  entryDirection?: -1 | 1;
}

export function createPveDirector(): PveDirectorState {
  return {
    spawnIndex: 0, nextSpawnDepthM: 48, enemyBag: [], entryBag: [], lastEntries: [], recentPlatformIds: [],
    pendingCard: [], pendingReadyDepthM: 0, eliteCardScene: null,
  };
}

function randomIndex(seed: number, salt: number, length: number): number {
  let value = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
  return (value >>> 0) % Math.max(1, length);
}

function shuffled<T>(values: readonly T[], seed: number, salt: number): T[] {
  const output = [...values];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swap = randomIndex(seed, salt + index, index + 1);
    [output[index], output[swap]] = [output[swap]!, output[index]!];
  }
  return output;
}

export function pveEnemyLimit(alivePlayers: number): number {
  return [0, 2, 3, 4, 5][Math.max(0, Math.min(4, alivePlayers))]!;
}

export function planPveEnemySpawn(
  director: PveDirectorState,
  runSeed: number,
  sceneId: PveSceneId,
  worldDepthM: number,
  alivePlayers: number,
  activeEnemyCount: number,
  platforms: readonly PveDirectorPlatform[],
): PveSpawnPlan | null {
  const pendingReady = director.pendingCard.length > 0 && worldDepthM >= director.pendingReadyDepthM;
  if (worldDepthM < 40 || (!pendingReady && worldDepthM < director.nextSpawnDepthM) || activeEnemyCount >= pveEnemyLimit(alivePlayers)) return null;
  const candidates = platforms.filter((platform) => !platform.broken && !platform.bossTarget && !platform.occupied && !platform.playerOccupied &&
    !platform.predictedLanding && platform.safe !== false && platform.y > 90 && platform.y < 570 &&
    (platform.timeToContactMs === undefined || (platform.timeToContactMs >= 1_200 && platform.timeToContactMs <= 3_000)) &&
    !director.recentPlatformIds.includes(platform.id));
  if (candidates.length < 2) return null;
  const sceneEnemies = PVE_SCENES[sceneId].enemies;
  if (director.enemyBag.length === 0) director.enemyBag = shuffled(sceneEnemies, runSeed, director.spawnIndex + Math.floor(worldDepthM / 50));
  const queued = pendingReady ? director.pendingCard[0] : undefined;
  const type = queued?.type ?? director.enemyBag.shift()!;
  const content = PVE_ENEMIES[type];
  if (content.elite && activeEnemyCount >= Math.max(1, pveEnemyLimit(alivePlayers) - 1)) return null;
  if (director.entryBag.length === 0) {
    const allowed = content.entries.filter((entry) => entry !== 'portalPop' || sceneId !== 'garden');
    director.entryBag = shuffled(allowed, runSeed ^ 0xa5a5a5a5, director.spawnIndex);
  }
  let entry = queued?.entry ?? director.entryBag.shift() ?? content.entries[0]!;
  const repeated = director.lastEntries.slice(-2).every((item) => item === entry);
  if (repeated) entry = content.entries.find((item) => item !== entry) ?? (entry === 'ceilingDrop' ? 'platformWake' : entry);
  const platform = candidates[randomIndex(runSeed, director.spawnIndex + Math.floor(worldDepthM), candidates.length)]!;
  const card: PveEncounterCard = queued?.card ?? (content.elite && director.eliteCardScene !== sceneId ? 'eliteEscort'
    : worldDepthM >= 80 && alivePlayers >= 2 && director.spawnIndex % 4 === 2 ? 'crossfire' : 'solo');
  if (queued) director.pendingCard.shift();
  if (!queued && card === 'crossfire') {
    const partnerType = sceneEnemies[(sceneEnemies.indexOf(type) + 1) % sceneEnemies.length]!;
    const partnerEntry = PVE_ENEMIES[partnerType].entries.find((item) => item !== entry) ?? PVE_ENEMIES[partnerType].entries[0]!;
    director.pendingCard.push({ type: partnerType, entry: partnerEntry, card });
    director.pendingReadyDepthM = worldDepthM + 10;
  } else if (!queued && card === 'eliteEscort') {
    const escortType = sceneEnemies.find((item) => !PVE_ENEMIES[item].elite) ?? type;
    director.pendingCard.push({ type: escortType, entry: PVE_ENEMIES[escortType].entries[0]!, card });
    director.pendingReadyDepthM = worldDepthM + 12;
    director.eliteCardScene = sceneId;
  }
  if (!queued) director.nextSpawnDepthM = worldDepthM + 38 + randomIndex(runSeed, director.spawnIndex + 31, 25);
  director.spawnIndex += 1;
  director.lastEntries = [...director.lastEntries.slice(-1), entry];
  director.recentPlatformIds = [...director.recentPlatformIds.slice(-1), platform.id];
  const telegraphMs = Math.max(PVE_ENTRY_TELEGRAPH_MS[entry], Math.min(1_800, Math.round((platform.timeToContactMs ?? 2_000) * .55)));
  return {
    type, entry, card, platformId: platform.id, telegraphMs, cueMs: 450, enteringMs: 400, settlingMs: 250,
    entryDirection: platform.x + platform.width / 2 < 180 ? -1 : 1,
    x: platform.x + platform.width / 2 - 12, y: platform.y - 24,
  };
}
