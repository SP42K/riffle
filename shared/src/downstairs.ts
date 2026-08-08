import type { PlayerId } from './types.js';
import {
  activatePveBossMechanism,
  advancePveEncounter,
  advancePveEnemies,
  advancePveProgression,
  advanceToNextPveScene,
  beginPveBoss,
  consumeTeamFeverGuard,
  createPveDirector,
  createPveEncounter,
  createPveEnemy,
  createPveProgression,
  createTeamFever,
  damagePveBossWeakPoint,
  markNearbyEnemy,
  PVE_ENEMIES,
  PVE_ENTRY_TELEGRAPH_MS,
  PVE_SCENES,
  planPveEnemySpawn,
  pveEnemyIsElite,
  pveSceneExploreComplete,
  requestTeamFever,
  resolvePveEnemyContact,
  settlePveBoss,
  teamFeverActive,
  tickTeamFever,
  visiblePveEnemies,
  type PveDirectorState,
  type PveEncounterState,
  type PveEnemyState,
  type PveProgressionState,
  type TeamFeverState,
} from './downstairs/index.js';

export * from './downstairs/index.js';

export type DownstairsPlatformKind = 'normal' | 'spring' | 'spike' | 'moving' | 'fragile' | 'conveyorLeft' | 'conveyorRight' | 'bossSwitch';
export type DownstairsEndReason = 'health' | 'ceiling' | 'fall' | 'left';
export type DownstairsCharacterId = 'brave' | 'bubble' | 'tangerine' | 'star';
export type DownstairsZone = 'garden' | 'workshop' | 'rooftop' | 'stars' | 'boss';
export type DownstairsEventKind = 'golden' | 'springParty' | 'rescue';
export type DownstairsObjectiveKind = 'perfectLandings' | 'riskyLandings' | 'stars';
export type DownstairsObjectiveReward = 'cooldown' | 'combo';
export type DownstairsBossPhase = 'warning' | 'active' | 'cleared' | 'survived';
export type DownstairsBossAttack = 'stomp' | 'gust' | 'fallingRock' | 'safeShift';
export type DownstairsLandingGrade = 'perfect' | 'good' | 'edge';
export type DownstairsFeedbackEvent = 'land' | 'spring' | 'hurt' | 'star' | 'skill' | 'eliminated' | 'bossWarning' | 'bossAttack' | 'bossClear';
export const DOWNSTAIRS_CHARACTERS: readonly DownstairsCharacterId[] = ['brave', 'bubble', 'tangerine', 'star'];
const DOWNSTAIRS_BOSS_ACTIVE_MS = 32_000;
const DOWNSTAIRS_BOSS_ATTACK_CYCLE_MS = 4_000;
export const DOWNSTAIRS_FEVER_THRESHOLD = 30;
export const DOWNSTAIRS_FEVER_DURATION_MS = 5_000;

export function downstairsComboSpeedMultiplier(combo: number, feverActive = false): number {
  if (feverActive) return 1.45;
  return 1 + Math.min(30, Math.max(0, Math.floor(combo))) / 100;
}

export function downstairsComboBrakeMultiplier(combo: number, feverActive = false): number {
  if (feverActive) return 1.75;
  return 1 + Math.min(30, Math.max(0, Math.floor(combo))) / 50;
}

export function downstairsLandingGrade(playerX: number, platformX: number, platformWidth: number): DownstairsLandingGrade {
  const offset = Math.abs(playerX + DOWNSTAIRS_PLAYER_SIZE / 2 - (platformX + platformWidth / 2));
  const perfectHalfWidth = Math.max(6, Math.min(platformWidth * 0.175, (platformWidth - DOWNSTAIRS_PLAYER_SIZE) / 2));
  if (offset <= perfectHalfWidth) return 'perfect';
  if (offset <= Math.max(perfectHalfWidth + 1, platformWidth * 0.38)) return 'good';
  return 'edge';
}

export interface DownstairsPlatform {
  id: number;
  x: number;
  y: number;
  width: number;
  kind: DownstairsPlatformKind;
  originX?: number;
  fragileMs?: number;
  brokenMs?: number;
  switchUsed?: boolean;
  route?: 'safe' | 'challenge';
  pattern?: 'zigzag' | 'stairs' | 'wave' | 'rest';
  accent?: 0 | 1 | 2 | 3;
  isStart?: boolean;
  startOnly?: boolean;
  pveRole?: 'enemyPerch' | 'bossWeakPoint' | 'bossMechanism';
  pveMechanismIndex?: number;
}

export interface DownstairsStar {
  id: number;
  platformId: number;
  collectedBy: PlayerId[];
}

export interface DownstairsBossState {
  phase: DownstairsBossPhase;
  remainingMs: number;
  shield: number;
  maxShield: number;
  attack: DownstairsBossAttack;
  attackRemainingMs: number;
  targetPlatformId: number | null;
  gustDirection: -1 | 1;
  cycle: number;
  resolvedCycle: number;
}

export interface DownstairsObjective {
  id: number;
  zone: Exclude<DownstairsZone, 'boss'>;
  kind: DownstairsObjectiveKind;
  target: number;
  reward: DownstairsObjectiveReward;
  rewardAmount: number;
}

export interface DownstairsPlayerState {
  playerId: PlayerId;
  characterId: DownstairsCharacterId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  direction: -1 | 0 | 1;
  health: number;
  depth: number;
  combo: number;
  feverRemainingMs: number;
  feverGuard: boolean;
  feverFeedbackMs: number;
  feverResult: 'start' | 'complete' | 'break' | null;
  feverSequence: number;
  landingGrade: DownstairsLandingGrade | null;
  landingGradeMs: number;
  landingSequence: number;
  objectiveProgress: number;
  objectiveCompleted: boolean;
  objectiveFeedbackMs: number;
  objectiveSequence: number;
  objectiveReward: DownstairsObjectiveReward | null;
  alive: boolean;
  eliminatedAt: number | null;
  endReason: DownstairsEndReason | null;
  lastPlatformId: number;
  lastScoredPlatformId: number;
  invulnerableMs: number;
  skillCooldownMs: number;
  skillActiveMs: number;
  skillShieldCharges: number;
  skillSequence: number;
  lastFacing: -1 | 1;
  ceilingDangerMs: number;
  lastLandingKind: DownstairsPlatformKind | null;
  landingEffectMs: number;
  stars: number;
  comboShield: boolean;
  scoreBonus: number;
  starFeedbackMs: number;
  starReward: 'star' | 'shield' | 'heal' | 'bonus' | null;
  lastBossHitCycle: number;
  insertionOrder: number;
}

export interface DownstairsPveContribution {
  highestCombo: number;
  defeats: number;
  assists: number;
  bossDamage: number;
  damageTaken: number;
}

export interface DownstairsPveState {
  progression: PveProgressionState;
  teamFever: TeamFeverState;
  director: PveDirectorState;
  enemies: PveEnemyState[];
  nextEnemyId: number;
  encounter: PveEncounterState | null;
  contributions: Record<PlayerId, DownstairsPveContribution>;
}

export interface DownstairsPveView {
  progression: PveProgressionState;
  teamFever: TeamFeverState;
  enemies: PveEnemyState[];
  encounter: PveEncounterState | null;
  contributions: Record<PlayerId, DownstairsPveContribution>;
}

export interface DownstairsState {
  startedAt: number;
  elapsedMs: number;
  over: boolean;
  platforms: DownstairsPlatform[];
  players: Record<PlayerId, DownstairsPlayerState>;
  ranking: PlayerId[];
  nextPlatformId: number;
  stars: DownstairsStar[];
  nextStarId: number;
  zone: DownstairsZone;
  event: DownstairsEventKind | null;
  eventRemainingMs: number;
  nextEventAtMs: number;
  eventSeed: number;
  eventBag: DownstairsEventKind[];
  lastEvent: DownstairsEventKind | null;
  objective: DownstairsObjective | null;
  nextObjectiveId: number;
  boss: DownstairsBossState | null;
  bossCompleted: boolean;
  rescuePlatformsRemaining: number;
  rescueCooldownMs: number;
  generationRowY: number;
  generationRowSize: number;
  generationRowSlot: number;
  generationRowSeed: number;
  feedbackSequence: number;
  feedbackEvent: DownstairsFeedbackEvent | null;
  pve: DownstairsPveState | null;
}

export interface DownstairsPlayerView {
  playerId: PlayerId;
  characterId: DownstairsCharacterId;
  x: number;
  y: number;
  facing: -1 | 1;
  health: number;
  depth: number;
  combo: number;
  invulnerableMs: number;
  feverRemainingMs: number;
  feverGuard: boolean;
  feverFeedbackMs: number;
  feverResult: 'start' | 'complete' | 'break' | null;
  feverSequence: number;
  landingGrade: DownstairsLandingGrade | null;
  landingGradeMs: number;
  landingSequence: number;
  objectiveProgress: number;
  objectiveCompleted: boolean;
  objectiveFeedbackMs: number;
  objectiveSequence: number;
  objectiveReward: DownstairsObjectiveReward | null;
  alive: boolean;
  endReason: DownstairsEndReason | null;
  skillCooldownMs: number;
  skillActiveMs: number;
  ceilingDangerMs: number;
  lastPlatformId: number;
  lastLandingKind: DownstairsPlatformKind | null;
  landingEffectMs: number;
  stars: number;
  comboShield: boolean;
  scoreBonus: number;
  starFeedbackMs: number;
  starReward: 'star' | 'shield' | 'heal' | 'bonus' | null;
  eliminatedAt: number | null;
  survivedMs: number;
}

export interface DownstairsGameView {
  type: 'downstairs';
  turnPlayerId: null;
  over: boolean;
  elapsedMs: number;
  platforms: DownstairsPlatform[];
  players: Record<PlayerId, DownstairsPlayerView>;
  ranking: PlayerId[];
  stars: Array<DownstairsStar & { x: number; y: number }>;
  zone: DownstairsZone;
  event: DownstairsEventKind | null;
  eventRemainingMs: number;
  objective: DownstairsObjective | null;
  boss: DownstairsBossState | null;
  feedbackSequence: number;
  feedbackEvent: DownstairsFeedbackEvent | null;
  pve: DownstairsPveView | null;
}

export const DOWNSTAIRS_WIDTH = 360;
export const DOWNSTAIRS_HEIGHT = 640;
export const DOWNSTAIRS_PLAYER_SIZE = 30;
export const DOWNSTAIRS_PLATFORM_WIDTH = 48;
export const DOWNSTAIRS_CHALLENGE_WIDTH = 38;
export const DOWNSTAIRS_MIN_PLATFORMS_PER_ROW = 3;
const PLATFORM_KINDS: readonly DownstairsPlatformKind[] = ['normal', 'spring', 'normal', 'spike', 'normal'];
const CEILING_GRACE_MS = 800;

function feedback(state: DownstairsState, event: DownstairsFeedbackEvent): void {
  state.feedbackSequence += 1;
  state.feedbackEvent = event;
}

type PlatformLayout = Pick<DownstairsPlatform, 'x' | 'width' | 'route' | 'pattern' | 'accent'> & { gap: number };

/** Deterministic platform formations keep replays identical while changing the rhythm every four steps. */
export function downstairsPlatformLayout(
  id: number,
  anchor: Pick<DownstairsPlatform, 'x' | 'width'>,
  zone: DownstairsZone,
): PlatformLayout {
  const patterns = ['zigzag', 'stairs', 'wave', 'rest'] as const;
  const pattern = patterns[Math.floor(Math.max(0, id - 9) / 4) % patterns.length]!;
  const accent = (id % 4) as 0 | 1 | 2 | 3;
  const challenge = (zone === 'stars' && id % 2 === 0) || (zone === 'rooftop' && id % 5 === 0);
  const route = challenge ? 'challenge' : 'safe';
  const width = challenge ? DOWNSTAIRS_CHALLENGE_WIDTH : DOWNSTAIRS_PLATFORM_WIDTH;
  const anchorCenter = anchor.x + anchor.width / 2;
  const waveOffsets = [-64, 0, 64, 0] as const;
  let desiredCenter: number;
  if (pattern === 'wave') desiredCenter = anchorCenter + waveOffsets[accent]!;
  else if (pattern === 'stairs') desiredCenter = anchorCenter + (accent < 2 ? 58 : -58);
  else if (pattern === 'rest') desiredCenter = accent === 3 ? anchorCenter : anchorCenter + (accent % 2 === 0 ? -44 : 44);
  else desiredCenter = anchorCenter + (id % 2 === 0 ? 70 : -70);
  const minCenter = 18 + width / 2;
  const maxCenter = DOWNSTAIRS_WIDTH - 18 - width / 2;
  if (desiredCenter < minCenter || desiredCenter > maxCenter) desiredCenter = anchorCenter * 2 - desiredCenter;
  desiredCenter = Math.max(minCenter, Math.min(maxCenter, desiredCenter));
  const gap = pattern === 'rest' ? 70 : challenge ? 82 + (id * 5) % 9 : 74 + (id * 7) % 11;
  return { x: desiredCenter - width / 2, width, gap, route, pattern, accent };
}

export function downstairsDifficultyAt(elapsedMs: number): { scrollSpeed: number; spikeRate: 0 | 0.1 | 0.2 } {
  const seconds = Math.max(0, elapsedMs) / 1000;
  if (seconds < 20) return { scrollSpeed: 26 + seconds * 0.55, spikeRate: 0 };
  if (seconds < 60) return { scrollSpeed: 37 + (seconds - 20) * 0.425, spikeRate: 0.1 };
  return { scrollSpeed: Math.min(68, 54 + (seconds - 60) * (14 / 60)), spikeRate: 0.2 };
}

export function downstairsZoneAt(elapsedMs: number, bossCompleted = false): DownstairsZone {
  if (elapsedMs < 20_000) return 'garden';
  if (elapsedMs < 45_000) return 'workshop';
  if (elapsedMs < 60_000) return 'rooftop';
  return bossCompleted ? 'stars' : 'boss';
}

function platformKindFor(id: number, state: DownstairsState): DownstairsPlatformKind {
  if (state.event === 'springParty' && id % 2 === 0) return 'spring';
  if (state.zone === 'workshop' && id % 4 === 0) return 'moving';
  if (state.zone === 'rooftop') {
    if (id % 6 === 0) return 'fragile';
    if (id % 4 === 0) return id % 8 === 0 ? 'conveyorLeft' : 'conveyorRight';
  }
  if (state.zone === 'stars') {
    if (id % 7 === 0) return 'fragile';
    if (id % 6 === 0) return 'moving';
    if (id % 4 === 0) return id % 8 === 0 ? 'conveyorLeft' : 'conveyorRight';
  }
  const kind = PLATFORM_KINDS[id % PLATFORM_KINDS.length]!;
  const spikeRate = state.pve
    ? state.pve.progression.worldDepthM < 200 ? 0 : state.pve.progression.worldDepthM < 500 ? 0.1 : 0.2
    : downstairsDifficultyAt(state.elapsedMs).spikeRate;
  if (kind !== 'spike' || spikeRate === 0) return kind === 'spike' ? 'normal' : kind;
  if (spikeRate === 0.1 && id % 10 !== 3) return 'normal';
  return kind;
}

function platformCountForRow(_id: number, _zone: DownstairsZone): 3 {
  return 3;
}

function platformVariation(seed: number, salt: number, choices: number): number {
  let value = (seed ^ salt) >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return (value >>> 0) % choices;
}

function platformXForRow(slot: number, count: 2 | 3, width: number, seed: number): number {
  const pairs = [[55, 218], [118, 296], [48, 280], [150, 310], [82, 250], [42, 190]] as const;
  const triples = [[45, 160, 290], [85, 215, 318], [55, 225, 305], [120, 220, 318], [48, 180, 275], [95, 200, 300]] as const;
  const centers = count === 3
    ? triples[platformVariation(seed, 0x51f2, triples.length)]!
    : pairs[platformVariation(seed, 0xa93d, pairs.length)]!;
  const center = centers[Math.max(0, Math.min(count - 1, slot))]!;
  return Math.max(18, Math.min(DOWNSTAIRS_WIDTH - width - 18, center - width / 2));
}

function platformYOffsetForRow(slot: number, count: 2 | 3, seed: number): number {
  const pairs = [[0, 18], [16, 0], [0, 11], [8, 20], [18, 4], [4, 16]] as const;
  const triples = [[0, 18, 8], [16, 0, 22], [6, 20, 0], [18, 6, 24], [0, 12, 23], [14, 0, 19]] as const;
  const offsets = count === 3
    ? triples[platformVariation(seed, 0xc27b, triples.length)]!
    : pairs[platformVariation(seed, 0x4de1, pairs.length)]!;
  return offsets[Math.max(0, Math.min(count - 1, slot))]!;
}

function bounceVelocity(
  kind: DownstairsPlatformKind,
  platformY: number,
  platformId: number,
  platforms: readonly DownstairsPlatform[],
  playerX: number,
): number {
  if (kind === 'spring') {
    const base = platformId === 2 ? 390 : platformY < 230 ? 290 : platformY < 330 ? 370 : 430;
    const previousPlatform = platforms
      .filter((platform) => platform.id !== platformId && platform.y < platformY - 10)
      .sort((a, b) => b.y - a.y)[0];
    const aligned = previousPlatform &&
      playerX + DOWNSTAIRS_PLAYER_SIZE - 5 > previousPlatform.x &&
      playerX + 5 < previousPlatform.x + previousPlatform.width;
    if (!previousPlatform || previousPlatform.y < 70 || !aligned) return -base;
    const requiredRise = platformY - previousPlatform.y + 50;
    const requiredVelocity = Math.sqrt(2 * 980 * requiredRise);
    return -Math.min(600, Math.max(base, requiredVelocity));
  }
  if (kind === 'spike') return platformY < 230 ? -180 : platformY < 330 ? -230 : -280;
  return platformY < 230 ? -190 : platformY < 330 ? -250 : -300;
}

export const DOWNSTAIRS_SKILLS: Record<DownstairsCharacterId, { name: string; cooldownMs: number; activeMs: number }> = {
  brave: { name: '勇氣護盾', cooldownMs: 10_000, activeMs: 1_500 },
  bubble: { name: '泡泡緩降', cooldownMs: 8_000, activeMs: 2_000 },
  tangerine: { name: '活力衝刺', cooldownMs: 6_000, activeMs: 350 },
  star: { name: '星光牽引', cooldownMs: 12_000, activeMs: 1_500 },
};

function downstairsSeed(startedAt: number, playerIds: readonly PlayerId[]): number {
  let seed = (Math.trunc(startedAt) ^ 0x9e3779b9) >>> 0;
  for (const playerId of playerIds) {
    for (let index = 0; index < playerId.length; index += 1) {
      seed = Math.imul(seed ^ playerId.charCodeAt(index), 16_777_619) >>> 0;
    }
  }
  return seed || 0x6d2b79f5;
}

function downstairsStartPlatformX(index: number, playerCount: number): number {
  const spacing = 82;
  const firstCenter = DOWNSTAIRS_WIDTH / 2 - (Math.max(1, playerCount) - 1) * spacing / 2;
  return firstCenter + index * spacing - DOWNSTAIRS_PLATFORM_WIDTH / 2;
}

export function startDownstairs(
  playerIds: readonly PlayerId[],
  now = Date.now(),
  characters: Partial<Record<PlayerId, DownstairsCharacterId>> = {},
  mode: 'classic' | 'pve' = 'classic',
): DownstairsState {
  const players: Record<PlayerId, DownstairsPlayerState> = {};
  const startPlatforms: DownstairsPlatform[] = playerIds.map((_playerId, index) => ({
    id: index === 0 ? 2 : -index - 1,
    x: downstairsStartPlatformX(index, playerIds.length),
    y: 478,
    width: DOWNSTAIRS_PLATFORM_WIDTH,
    kind: 'spring',
    pattern: 'rest',
    accent: (index % 4) as 0 | 1 | 2 | 3,
    isStart: true,
    startOnly: index > 0,
  }));
  playerIds.forEach((playerId, index) => {
    players[playerId] = {
      playerId,
      characterId: characters[playerId] ?? 'brave',
      x: startPlatforms[index]!.x + (DOWNSTAIRS_PLATFORM_WIDTH - DOWNSTAIRS_PLAYER_SIZE) / 2,
      y: 400,
      vx: 0,
      vy: 0,
      direction: 0,
      health: 3,
      depth: 0,
      combo: 0,
      feverRemainingMs: 0,
      feverGuard: false,
      feverFeedbackMs: 0,
      feverResult: null,
      feverSequence: 0,
      landingGrade: null,
      landingGradeMs: 0,
      landingSequence: 0,
      objectiveProgress: 0,
      objectiveCompleted: false,
      objectiveFeedbackMs: 0,
      objectiveSequence: 0,
      objectiveReward: null,
      alive: true,
      eliminatedAt: null,
      endReason: null,
      lastPlatformId: -1,
      lastScoredPlatformId: -1,
      invulnerableMs: 0,
      skillCooldownMs: 0,
      skillActiveMs: 0,
      skillShieldCharges: 0,
      skillSequence: 0,
      lastFacing: 1,
      ceilingDangerMs: 0,
      lastLandingKind: null,
      landingEffectMs: 0,
      stars: 0,
      comboShield: false,
      scoreBonus: 0,
      starFeedbackMs: 0,
      starReward: null,
      lastBossHitCycle: -1,
      insertionOrder: index,
    };
  });
  const runSeed = downstairsSeed(now, playerIds);
  const state: DownstairsState = {
    startedAt: now,
    elapsedMs: 0,
    over: false,
    platforms: [
      { id: 1, x: 71, y: 552, width: DOWNSTAIRS_PLATFORM_WIDTH, kind: 'normal', pattern: 'rest', accent: 0 },
      { id: -101, x: 214, y: 566, width: DOWNSTAIRS_PLATFORM_WIDTH, kind: 'normal', pattern: 'rest', accent: 1 },
      { id: -108, x: 304, y: 576, width: DOWNSTAIRS_PLATFORM_WIDTH, kind: 'spring', pattern: 'rest', accent: 2 },
      ...startPlatforms,
      { id: -102, x: 92, y: 390, width: DOWNSTAIRS_PLATFORM_WIDTH, kind: 'normal', pattern: 'stairs', accent: 1 },
      { id: 3, x: 256, y: 376, width: DOWNSTAIRS_PLATFORM_WIDTH, kind: 'normal', pattern: 'stairs', accent: 2 },
      { id: -109, x: 180, y: 400, width: DOWNSTAIRS_PLATFORM_WIDTH, kind: 'normal', pattern: 'stairs', accent: 3 },
      { id: 4, x: 114, y: 286, width: DOWNSTAIRS_PLATFORM_WIDTH, kind: 'normal', pattern: 'zigzag', accent: 3 },
      { id: -103, x: 244, y: 302, width: DOWNSTAIRS_PLATFORM_WIDTH, kind: 'spring', pattern: 'zigzag', accent: 0 },
      { id: -110, x: 48, y: 310, width: DOWNSTAIRS_PLATFORM_WIDTH, kind: 'normal', pattern: 'zigzag', accent: 1 },
      { id: -104, x: 48, y: 211, width: DOWNSTAIRS_PLATFORM_WIDTH, kind: 'normal', pattern: 'zigzag', accent: 3 },
      { id: 5, x: 258, y: 196, width: DOWNSTAIRS_PLATFORM_WIDTH, kind: 'normal', pattern: 'zigzag', accent: 0 },
      { id: -111, x: 168, y: 220, width: DOWNSTAIRS_PLATFORM_WIDTH, kind: 'normal', pattern: 'zigzag', accent: 1 },
      { id: 6, x: 69, y: 106, width: DOWNSTAIRS_PLATFORM_WIDTH, kind: 'spring', pattern: 'wave', accent: 1 },
      { id: -105, x: 210, y: 122, width: DOWNSTAIRS_PLATFORM_WIDTH, kind: 'normal', pattern: 'wave', accent: 2 },
      { id: -112, x: 302, y: 130, width: DOWNSTAIRS_PLATFORM_WIDTH, kind: 'normal', pattern: 'wave', accent: 3 },
      { id: -106, x: 95, y: 34, width: DOWNSTAIRS_PLATFORM_WIDTH, kind: 'normal', pattern: 'wave', accent: 1 },
      { id: 7, x: 231, y: 20, width: DOWNSTAIRS_PLATFORM_WIDTH, kind: 'normal', pattern: 'wave', accent: 2 },
      { id: -113, x: 304, y: 44, width: DOWNSTAIRS_PLATFORM_WIDTH, kind: 'normal', pattern: 'wave', accent: 3 },
      { id: -114, x: 30, y: 606, width: DOWNSTAIRS_PLATFORM_WIDTH, kind: 'normal', pattern: 'rest', accent: 1 },
      { id: -107, x: 132, y: 616, width: DOWNSTAIRS_PLATFORM_WIDTH, kind: 'normal', pattern: 'rest', accent: 2 },
      { id: 8, x: 286, y: 630, width: DOWNSTAIRS_PLATFORM_WIDTH, kind: 'normal', pattern: 'rest', accent: 3 },
    ],
    players,
    ranking: [],
    nextPlatformId: 9,
    stars: [],
    nextStarId: 1,
    zone: 'garden',
    event: null,
    eventRemainingMs: 0,
    nextEventAtMs: 18_000,
    eventSeed: runSeed,
    eventBag: [],
    lastEvent: null,
    objective: null,
    nextObjectiveId: 1,
    boss: null,
    bossCompleted: false,
    rescuePlatformsRemaining: 0,
    rescueCooldownMs: 0,
    generationRowY: 630,
    generationRowSize: 0,
    generationRowSlot: 0,
    generationRowSeed: 8,
    feedbackSequence: 0,
    feedbackEvent: null,
    pve: mode === 'pve' ? {
      progression: createPveProgression(runSeed),
      teamFever: createTeamFever(),
      director: createPveDirector(),
      enemies: [],
      nextEnemyId: 1,
      encounter: null,
      contributions: Object.fromEntries(playerIds.map((playerId) => [playerId, {
        highestCombo: 0,
        defeats: 0,
        assists: 0,
        bossDamage: 0,
        damageTaken: 0,
      }])),
    } : null,
  };
  setObjectiveForZone(state, 'garden');
  return state;
}

export function setDownstairsDirection(state: DownstairsState, playerId: PlayerId, direction: number): boolean {
  const player = state.players[playerId];
  if (!player?.alive || state.over) return false;
  player.direction = direction < 0 ? -1 : direction > 0 ? 1 : 0;
  if (player.direction !== 0) player.lastFacing = player.direction;
  return true;
}

export function activateDownstairsSkill(state: DownstairsState, playerId: PlayerId): boolean {
  const player = state.players[playerId];
  if (!player?.alive || state.over || player.skillCooldownMs > 0 || player.skillActiveMs > 0) return false;
  const skill = DOWNSTAIRS_SKILLS[player.characterId];
  player.skillCooldownMs = skill.cooldownMs;
  player.skillActiveMs = skill.activeMs;
  player.skillShieldCharges = player.characterId === 'brave' ? 1 : 0;
  player.skillSequence += 1;
  if (state.pve && player.characterId === 'star') {
    markNearbyEnemy(
      state.pve.enemies,
      playerId,
      player.x + DOWNSTAIRS_PLAYER_SIZE / 2,
      player.y + DOWNSTAIRS_PLAYER_SIZE / 2,
      120,
    );
  }
  feedback(state, 'skill');
  return true;
}

function startFever(player: DownstairsPlayerState): void {
  player.combo = DOWNSTAIRS_FEVER_THRESHOLD;
  player.feverRemainingMs = DOWNSTAIRS_FEVER_DURATION_MS;
  player.feverGuard = true;
  player.feverFeedbackMs = 600;
  player.feverResult = 'start';
  player.feverSequence += 1;
}

function finishFever(player: DownstairsPlayerState, result: 'complete' | 'break' | null): void {
  if (player.feverRemainingMs <= 0 && !player.feverGuard) return;
  player.scoreBonus += player.combo * 2;
  player.combo = 0;
  player.feverRemainingMs = 0;
  player.feverGuard = false;
  if (result) {
    player.feverFeedbackMs = 900;
    player.feverResult = result;
    player.feverSequence += 1;
  } else {
    player.feverFeedbackMs = 0;
    player.feverResult = null;
  }
}

function blockDamageWithFever(player: DownstairsPlayerState): boolean {
  if (player.feverRemainingMs <= 0 || !player.feverGuard) return false;
  finishFever(player, 'break');
  player.invulnerableMs = 900;
  return true;
}

function applyDownstairsDamage(state: DownstairsState, player: DownstairsPlayerState): boolean {
  if (player.invulnerableMs > 0) return false;
  if (player.skillShieldCharges > 0) {
    player.skillShieldCharges -= 1;
    player.skillActiveMs = 0;
    player.invulnerableMs = 450;
    feedback(state, 'skill');
    return false;
  }
  if (state.pve && consumeTeamFeverGuard(state.pve.teamFever, player.playerId)) {
    player.invulnerableMs = 900;
    feedback(state, 'skill');
    return false;
  }
  if (state.pve && player.comboShield) {
    player.comboShield = false;
    player.invulnerableMs = 900;
    feedback(state, 'skill');
    return false;
  }
  if (blockDamageWithFever(player)) return false;
  player.health -= 1;
  player.invulnerableMs = 900;
  if (player.comboShield) player.comboShield = false;
  else player.combo = 0;
  if (state.pve) state.pve.contributions[player.playerId]!.damageTaken += 1;
  feedback(state, 'hurt');
  return true;
}

function eliminate(state: DownstairsState, player: DownstairsPlayerState, reason: DownstairsEndReason): void {
  if (!player.alive) return;
  finishFever(player, null);
  player.alive = false;
  player.direction = 0;
  player.endReason = reason;
  player.eliminatedAt = state.elapsedMs;
  feedback(state, 'eliminated');
  state.ranking = Object.values(state.players)
    .filter((item) => !item.alive)
    .sort((a, b) => b.depth - a.depth || (b.eliminatedAt ?? state.elapsedMs) - (a.eliminatedAt ?? state.elapsedMs) || a.insertionOrder - b.insertionOrder)
    .map((item) => item.playerId);
}

export function removeDownstairsPlayer(state: DownstairsState, playerId: PlayerId): void {
  const player = state.players[playerId];
  if (player) eliminate(state, player, 'left');
  state.over = Object.values(state.players).every((item) => !item.alive);
}

function startBoss(state: DownstairsState): void {
  const count = Object.values(state.players).filter((player) => player.alive).length;
  const maxShield = [0, 20, 24, 28, 32][Math.max(1, Math.min(4, count))]!;
  state.boss = {
    phase: 'warning',
    remainingMs: 3_000,
    shield: maxShield,
    maxShield,
    attack: 'stomp',
    attackRemainingMs: 1_200,
    targetPlatformId: null,
    gustDirection: 1,
    cycle: -1,
    resolvedCycle: -1,
  };
  feedback(state, 'bossWarning');
}

function updateBoss(state: DownstairsState, deltaMs: number): void {
  const boss = state.boss;
  if (!boss) return;
  boss.remainingMs = Math.max(0, boss.remainingMs - deltaMs);
  if (boss.phase === 'warning' && boss.remainingMs === 0) {
    boss.phase = 'active';
    boss.remainingMs = DOWNSTAIRS_BOSS_ACTIVE_MS;
    const switches = state.platforms.filter((platform) => platform.kind === 'normal').slice(-3);
    for (const platform of switches) {
      platform.kind = 'bossSwitch';
      platform.switchUsed = false;
    }
    return;
  }
  if (boss.phase === 'active') {
    const cycle = Math.floor((DOWNSTAIRS_BOSS_ACTIVE_MS - boss.remainingMs) / DOWNSTAIRS_BOSS_ATTACK_CYCLE_MS);
    const attackIndex = cycle % 4;
    if (cycle !== boss.cycle) {
      boss.cycle = cycle;
      feedback(state, 'bossAttack');
      for (const platform of state.platforms) {
        if (platform.kind === 'bossSwitch' && platform.switchUsed) platform.kind = 'normal';
      }
      const available = state.platforms.filter((platform) => platform.kind === 'normal' && platform.brokenMs === undefined).slice(-2);
      for (const platform of available) {
        platform.kind = 'bossSwitch';
        platform.switchUsed = false;
      }
    }
    boss.attack = (['stomp', 'gust', 'fallingRock', 'safeShift'] as const)[attackIndex]!;
    boss.attackRemainingMs = Math.max(0, 1_200 - ((DOWNSTAIRS_BOSS_ACTIVE_MS - boss.remainingMs) % DOWNSTAIRS_BOSS_ATTACK_CYCLE_MS));
    boss.gustDirection = attackIndex % 2 === 0 ? 1 : -1;
    const safePlatforms = state.platforms.filter((platform) => platform.kind !== 'bossSwitch' && platform.brokenMs === undefined);
    boss.targetPlatformId = safePlatforms.length ? safePlatforms[(attackIndex + state.nextPlatformId) % safePlatforms.length]!.id : null;
    if (boss.attackRemainingMs === 0 && boss.resolvedCycle !== boss.cycle) {
      boss.resolvedCycle = boss.cycle;
      if (boss.attack === 'stomp') {
        const target = state.platforms.find((platform) => platform.id === boss.targetPlatformId);
        if (target) {
          target.fragileMs = undefined;
          target.brokenMs = 2_200;
        }
      }
    }
    if (boss.shield <= 0) {
      boss.phase = 'cleared';
      boss.remainingMs = 2_500;
      state.bossCompleted = true;
      for (const player of Object.values(state.players)) if (player.alive) {
        player.health = Math.min(3, player.health + 1);
        player.scoreBonus += 50;
      }
      feedback(state, 'bossClear');
    } else if (boss.remainingMs === 0) {
      boss.phase = 'survived';
      boss.remainingMs = 2_500;
      state.bossCompleted = true;
      for (const player of Object.values(state.players)) if (player.alive) player.scoreBonus += 15;
    }
    return;
  }
  if (boss.remainingMs === 0) state.boss = null;
}

const OBJECTIVE_BY_ZONE: Record<Exclude<DownstairsZone, 'boss'>, Omit<DownstairsObjective, 'id' | 'zone'>> = {
  garden: { kind: 'perfectLandings', target: 2, reward: 'cooldown', rewardAmount: 2_000 },
  workshop: { kind: 'stars', target: 2, reward: 'cooldown', rewardAmount: 2_000 },
  rooftop: { kind: 'riskyLandings', target: 1, reward: 'combo', rewardAmount: 2 },
  stars: { kind: 'perfectLandings', target: 2, reward: 'cooldown', rewardAmount: 2_000 },
};

function setObjectiveForZone(state: DownstairsState, zone: DownstairsZone): void {
  state.objective = zone === 'boss'
    ? null
    : { id: state.nextObjectiveId++, zone, ...OBJECTIVE_BY_ZONE[zone] };
  for (const player of Object.values(state.players)) {
    player.objectiveProgress = 0;
    player.objectiveCompleted = false;
    player.objectiveFeedbackMs = 0;
    player.objectiveReward = null;
  }
}

function progressObjective(
  state: DownstairsState,
  player: DownstairsPlayerState,
  kind: DownstairsObjectiveKind,
): void {
  const objective = state.objective;
  if (!objective || objective.kind !== kind || player.objectiveCompleted || !player.alive) return;
  player.objectiveProgress = Math.min(objective.target, player.objectiveProgress + 1);
  if (player.objectiveProgress < objective.target) return;
  player.objectiveCompleted = true;
  player.objectiveReward = objective.reward;
  player.objectiveFeedbackMs = 1_200;
  player.objectiveSequence += 1;
  if (objective.reward === 'cooldown') {
    player.skillCooldownMs = Math.max(0, player.skillCooldownMs - objective.rewardAmount);
  } else if (state.pve) {
    awardPveCombo(state, player, objective.rewardAmount, 0);
  } else if (player.feverRemainingMs <= 0) {
    player.combo += objective.rewardAmount;
    if (player.combo >= DOWNSTAIRS_FEVER_THRESHOLD) startFever(player);
  }
}

function nextEventRandom(state: DownstairsState): number {
  let value = state.eventSeed >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  state.eventSeed = value >>> 0 || 0x6d2b79f5;
  return state.eventSeed / 0x1_0000_0000;
}

function refillEventBag(state: DownstairsState): void {
  const bag: DownstairsEventKind[] = ['golden', 'springParty', 'rescue'];
  for (let index = bag.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(nextEventRandom(state) * (index + 1));
    [bag[index], bag[swapIndex]] = [bag[swapIndex]!, bag[index]!];
  }
  if (bag[0] === state.lastEvent) {
    const swapIndex = bag.findIndex((event) => event !== state.lastEvent);
    [bag[0], bag[swapIndex]] = [bag[swapIndex]!, bag[0]!];
  }
  state.eventBag = bag;
}

function rescueEligible(state: DownstairsState): boolean {
  const alive = Object.values(state.players).filter((player) => player.alive);
  return alive.length > 0 && alive.filter((player) => player.health === 1).length > alive.length / 2 && state.rescueCooldownMs <= 0;
}

/** Draws an event from a deterministic shuffle bag and records it for cross-bag de-duplication. */
export function downstairsNextEvent(state: DownstairsState): DownstairsEventKind {
  if (state.eventBag.length === 0) refillEventBag(state);
  let candidate = state.eventBag.shift()!;
  if (candidate === 'rescue' && !rescueEligible(state)) {
    const fallbacks: DownstairsEventKind[] = ['golden', 'springParty'];
    const start = Math.floor(nextEventRandom(state) * fallbacks.length);
    candidate = fallbacks[(start + (fallbacks[start] === state.lastEvent ? 1 : 0)) % fallbacks.length]!;
  }
  if (candidate === state.lastEvent) {
    candidate = candidate === 'golden' ? 'springParty' : 'golden';
  }
  state.lastEvent = candidate;
  return candidate;
}

function pveZoneForScene(sceneId: DownstairsPveState['progression']['sceneId']): Exclude<DownstairsZone, 'boss'> {
  if (sceneId === 'garden' || sceneId === 'workshop' || sceneId === 'rooftop') return sceneId;
  return 'stars';
}

function alivePvePlayerIds(state: DownstairsState): PlayerId[] {
  return Object.values(state.players).filter((player) => player.alive).map((player) => player.playerId);
}

function awardPveCombo(state: DownstairsState, player: DownstairsPlayerState, combo: number, scoreDepthM: number): void {
  const pve = state.pve;
  if (!pve || !player.alive) return;
  player.scoreBonus += scoreDepthM;
  if (!teamFeverActive(pve.teamFever)) {
    player.combo += combo;
    pve.contributions[player.playerId]!.highestCombo = Math.max(pve.contributions[player.playerId]!.highestCombo, player.combo);
    if (requestTeamFever(pve.teamFever, player.playerId, player.combo, alivePvePlayerIds(state))) {
      player.combo = 0;
      player.feverFeedbackMs = 600;
      player.feverResult = 'start';
      player.feverSequence = pve.teamFever.sequence;
    }
  }
}

function clearPvePlatformRoles(state: DownstairsState): void {
  for (const platform of state.platforms) {
    if (platform.pveRole === 'bossMechanism' && platform.kind === 'bossSwitch') platform.kind = 'normal';
    if (platform.pveRole !== 'enemyPerch') platform.pveRole = undefined;
    platform.switchUsed = false;
    platform.pveMechanismIndex = undefined;
  }
}

function predictedPveLandingPlatformIds(state: DownstairsState): Set<number> {
  const result = new Set<number>();
  for (const player of Object.values(state.players)) {
    if (!player.alive) continue;
    result.add(player.lastPlatformId);
    const feet = player.y + DOWNSTAIRS_PLAYER_SIZE;
    const target = state.platforms
      .filter((platform) => platform.brokenMs === undefined && platform.kind !== 'spike' && platform.y > feet + 12 && platform.y < feet + 190 &&
        Math.abs(platform.x + platform.width / 2 - (player.x + DOWNSTAIRS_PLAYER_SIZE / 2)) <= 125)
      .sort((a, b) => a.y - b.y || Math.abs(a.x - player.x) - Math.abs(b.x - player.x))[0];
    if (target) result.add(target.id);
  }
  return result;
}

function pvePlatformTimeToContactMs(state: DownstairsState, platform: DownstairsPlatform): number {
  let closest = Number.POSITIVE_INFINITY;
  for (const player of Object.values(state.players)) {
    if (!player.alive) continue;
    const verticalGap = platform.y - (player.y + DOWNSTAIRS_PLAYER_SIZE);
    if (verticalGap <= 0) continue;
    const approachSpeed = Math.max(90, player.vy + 35);
    closest = Math.min(closest, verticalGap / approachSpeed * 1_000);
  }
  return Number.isFinite(closest) ? closest : 2_000;
}

function ensurePveEncounterPlatforms(state: DownstairsState): void {
  const encounter = state.pve?.encounter;
  if (!encounter || encounter.phase === 'warning' || encounter.phase === 'defeat') return;
  if (encounter.weakPoint === 'exposed') {
    for (const platform of state.platforms) {
      if (platform.pveRole === 'bossMechanism') {
        platform.pveRole = undefined;
        platform.pveMechanismIndex = undefined;
        if (platform.kind === 'bossSwitch') platform.kind = 'normal';
      }
    }
    if (!state.platforms.some((platform) => platform.pveRole === 'bossWeakPoint')) {
      const target = state.platforms
        .filter((platform) => platform.kind === 'normal' && platform.brokenMs === undefined && platform.y > 150 && platform.y < 560)
        .sort((a, b) => b.y - a.y)[0];
      if (target) target.pveRole = 'bossWeakPoint';
    }
    return;
  }
  for (const platform of state.platforms) if (platform.pveRole === 'bossWeakPoint') platform.pveRole = undefined;
  const current = state.platforms.filter((platform) => platform.pveRole === 'bossMechanism' && !platform.switchUsed);
  const orderedMechanism = encounter.bossId === 'clangclang' || encounter.bossId === 'nightglow';
  const currentIndices = new Set(current.map((platform) => platform.pveMechanismIndex));
  const neededIndices = orderedMechanism
    ? encounter.mechanicOrder.slice(encounter.mechanicProgress).filter((index) => !currentIndices.has(index))
    : encounter.mechanicOrder.slice(0, Math.max(0, encounter.mechanicTarget - encounter.mechanicProgress - current.length));
  if (neededIndices.length === 0) return;
  const protectedIds = predictedPveLandingPlatformIds(state);
  const candidates = state.platforms
    .filter((platform) => platform.kind === 'normal' && platform.brokenMs === undefined && !platform.pveRole && !protectedIds.has(platform.id) && platform.y > 120 && platform.y < 590)
    .sort((a, b) => b.y - a.y || a.x - b.x)
    .slice(0, neededIndices.length);
  for (const [offset, platform] of candidates.entries()) {
    platform.kind = 'bossSwitch';
    platform.pveRole = 'bossMechanism';
    platform.pveMechanismIndex = neededIndices[offset];
    platform.switchUsed = false;
  }
}

function preparePveBossTelegraph(state: DownstairsState): void {
  const encounter = state.pve?.encounter;
  if (!encounter || encounter.phase !== 'active' || encounter.attackPhase !== 'telegraph' || encounter.targetPlatformId !== null) return;
  const protectedIds = predictedPveLandingPlatformIds(state);
  const candidates = state.platforms.filter((platform) =>
    platform.brokenMs === undefined && platform.pveRole !== 'bossMechanism' && platform.pveRole !== 'bossWeakPoint' &&
    platform.kind !== 'spike' && !protectedIds.has(platform.id) && platform.y > 100 && platform.y < 600 &&
    state.platforms.filter((other) => other.id !== platform.id && other.brokenMs === undefined && other.kind !== 'spike' && Math.abs(other.y - platform.y) <= 34).length >= 2
  );
  if (candidates.length) encounter.targetPlatformId = candidates[(encounter.cycle + state.pve!.progression.runSeed) % candidates.length]!.id;
}

function resolvePveBossImpact(state: DownstairsState): void {
  const pve = state.pve;
  const encounter = pve?.encounter;
  if (!pve || !encounter || encounter.phase !== 'active' || encounter.attackPhase !== 'impact' || encounter.resolvedAttackCycle === encounter.cycle) return;
  encounter.resolvedAttackCycle = encounter.cycle;
  feedback(state, 'bossAttack');
  if (encounter.attack === 'summon') {
    const platform = state.platforms.find((item) => item.id === encounter.targetPlatformId && item.brokenMs === undefined);
    const type = PVE_SCENES[pve.progression.sceneId].enemies[encounter.cycle % PVE_SCENES[pve.progression.sceneId].enemies.length];
    if (platform && type && pve.enemies.filter((enemy) => enemy.phase !== 'defeated' && enemy.phase !== 'escaped').length < 5) {
      const entry = PVE_ENEMIES[type].entries[0]!;
      pve.enemies.push(createPveEnemy(pve.nextEnemyId++, {
        type,
        entry,
        card: 'bossSummon',
        platformId: platform.id,
        telegraphMs: PVE_ENTRY_TELEGRAPH_MS[entry] + 300,
        cueMs: 550,
        enteringMs: 450,
        settlingMs: 300,
        entryDirection: platform.x + platform.width / 2 < 180 ? -1 : 1,
        x: platform.x + platform.width / 2 - 12,
        y: platform.y - 24,
      }));
      platform.pveRole = 'enemyPerch';
    }
    return;
  }
  if (encounter.attack === 'gust' || encounter.attack === 'magnetPull' || encounter.attack === 'vineSweep' || encounter.attack === 'rainWall') {
    const force = encounter.attack === 'magnetPull' ? 150 : encounter.attack === 'gust' ? 135 : 105;
    for (const player of Object.values(state.players)) if (player.alive) player.vx += encounter.gustDirection * force;
    if (encounter.attack !== 'rainWall') return;
  }
  const target = state.platforms.find((platform) => platform.id === encounter.targetPlatformId);
  if (!target) return;
  if (encounter.attack === 'shellStomp' || encounter.attack === 'phasePlatform' || encounter.attack === 'handClap') {
    target.fragileMs = undefined;
    target.brokenMs = 1_800;
  }
  for (const player of Object.values(state.players)) {
    if (!player.alive || player.lastPlatformId !== target.id) continue;
    applyDownstairsDamage(state, player);
  }
}

function retirePveEnemiesForBoss(state: DownstairsState): void {
  const pve = state.pve;
  if (!pve) return;
  for (const enemy of pve.enemies) {
    if (enemy.phase === 'defeated' || enemy.phase === 'escaped') continue;
    enemy.phase = 'escaped'; enemy.phaseRemainingMs = 400;
  }
  for (const platform of state.platforms) if (platform.pveRole === 'enemyPerch') platform.pveRole = undefined;
}

function updatePveWorld(state: DownstairsState, deltaMs: number): number {
  const pve = state.pve!;
  tickTeamFever(pve.teamFever, deltaMs);
  const speed = advancePveProgression(pve.progression, deltaMs);
  state.zone = pveZoneForScene(pve.progression.sceneId);
  state.event = null;
  state.eventRemainingMs = 0;
  if (!pve.encounter && pveSceneExploreComplete(pve.progression)) {
    beginPveBoss(pve.progression);
    pve.encounter = createPveEncounter(
      pve.progression.sceneId,
      pve.progression.loopTier,
      alivePvePlayerIds(state).length,
      pve.progression.worldDepthM,
    );
    retirePveEnemiesForBoss(state);
    feedback(state, 'bossWarning');
  }
  if (pve.encounter) {
    const beforePhase = pve.encounter.phase;
    const result = advancePveEncounter(pve.encounter, deltaMs, teamFeverActive(pve.teamFever));
    if (beforePhase === 'warning' && pve.encounter.phase === 'active') pve.progression.phase = 'boss';
    if (pve.encounter.phase === 'defeat') settlePveBoss(pve.progression);
    preparePveBossTelegraph(state);
    resolvePveBossImpact(state);
    if (result === 'complete') {
      for (const player of Object.values(state.players)) if (player.alive) {
        player.health = Math.min(3, player.health + 1);
        player.scoreBonus += 50;
      }
      feedback(state, 'bossClear');
      clearPvePlatformRoles(state);
      pve.encounter = null;
      advanceToNextPveScene(pve.progression);
      state.zone = pveZoneForScene(pve.progression.sceneId);
      setObjectiveForZone(state, state.zone);
    } else ensurePveEncounterPlatforms(state);
  }
  return pve.encounter?.phase === 'warning' ? speed * .9 : speed;
}

function advancePveWorldEnemies(state: DownstairsState, deltaMs: number): void {
  const pve = state.pve;
  if (!pve) return;
  const encounterActive = pve.encounter?.phase === 'active';
  const protectedIds = predictedPveLandingPlatformIds(state);
  const plan = encounterActive ? null : planPveEnemySpawn(
    pve.director,
    pve.progression.runSeed,
    pve.progression.sceneId,
    pve.progression.worldDepthM,
    alivePvePlayerIds(state).length,
    pve.enemies.filter((enemy) => enemy.phase !== 'defeated' && enemy.phase !== 'escaped').length,
    state.platforms.map((platform) => ({
      id: platform.id,
      x: platform.x,
      y: platform.y,
      width: platform.width,
      broken: platform.brokenMs !== undefined,
      bossTarget: platform.pveRole === 'bossMechanism' || platform.pveRole === 'bossWeakPoint',
      occupied: pve.enemies.some((enemy) => enemy.platformId === platform.id && enemy.phase !== 'defeated' && enemy.phase !== 'escaped'),
      safe: platform.kind !== 'spike' && Object.values(state.players).some((player) => player.alive && platform.y > player.y + DOWNSTAIRS_PLAYER_SIZE + 20),
      playerOccupied: Object.values(state.players).some((player) => player.alive && (player.lastPlatformId === platform.id ||
        (player.x + DOWNSTAIRS_PLAYER_SIZE > platform.x && player.x < platform.x + platform.width && Math.abs(player.y + DOWNSTAIRS_PLAYER_SIZE - platform.y) < 18))),
      predictedLanding: protectedIds.has(platform.id),
      timeToContactMs: pvePlatformTimeToContactMs(state, platform),
    })),
  );
  if (plan) {
    pve.enemies.push(createPveEnemy(pve.nextEnemyId++, plan));
    const platform = state.platforms.find((item) => item.id === plan.platformId);
    if (platform) platform.pveRole = 'enemyPerch';
  }
  const slowedEnemyIds: number[] = [];
  for (const player of Object.values(state.players)) {
    if (!player.alive || player.characterId !== 'bubble' || player.skillActiveMs <= 0) continue;
    for (const enemy of pve.enemies) {
      if (enemy.phase !== 'active') continue;
      if (Math.hypot(enemy.x + 12 - (player.x + 15), enemy.y + 12 - (player.y + 15)) <= 60) {
        slowedEnemyIds.push(enemy.id);
        if (!enemy.assists.includes(player.playerId)) enemy.assists.push(player.playerId);
      }
    }
  }
  advancePveEnemies(
    pve.enemies,
    state.platforms.map((platform) => ({ id: platform.id, x: platform.x, y: platform.y, width: platform.width, broken: platform.brokenMs !== undefined })),
    deltaMs,
    teamFeverActive(pve.teamFever),
    slowedEnemyIds,
  );
  pve.enemies = visiblePveEnemies(pve.enemies);
  for (const platform of state.platforms) {
    if (platform.pveRole === 'enemyPerch' && !pve.enemies.some((enemy) => enemy.platformId === platform.id && enemy.phase !== 'defeated' && enemy.phase !== 'escaped')) {
      platform.pveRole = undefined;
    }
  }
}

function resolvePveCombatForPlayer(state: DownstairsState, player: DownstairsPlayerState, previousBottom: number): void {
  const pve = state.pve;
  if (!pve || !player.alive) return;
  for (const enemy of pve.enemies) {
    const result = resolvePveEnemyContact(enemy, {
      playerId: player.playerId,
      characterId: player.characterId,
      x: player.x,
      y: player.y,
      size: DOWNSTAIRS_PLAYER_SIZE,
      vy: player.vy,
      previousBottom,
      skillActive: player.skillActiveMs > 0,
      skillSequence: player.skillSequence,
    }, teamFeverActive(pve.teamFever));
    if (result.kind === 'playerDamage') {
      applyDownstairsDamage(state, player);
      continue;
    }
    if (result.kind !== 'enemyHit') continue;
    if (result.stomp) player.vy = -300;
    if (player.characterId === 'brave' && player.skillActiveMs > 0) {
      player.skillShieldCharges = 0;
      player.skillActiveMs = 0;
    }
    const elite = pveEnemyIsElite(enemy);
    const defeatScore = result.defeated ? (elite ? 15 : 8) + (teamFeverActive(pve.teamFever) ? 5 : 0) : 0;
    awardPveCombo(state, player, elite ? 3 : 2, defeatScore);
    if (result.defeated) {
      pve.contributions[player.playerId]!.defeats += 1;
      if (elite && !state.stars.some((star) => star.platformId === enemy.platformId)) {
        state.stars.push({ id: state.nextStarId++, platformId: enemy.platformId, collectedBy: [] });
      }
      for (const assisterId of result.assistedBy) {
        const assister = state.players[assisterId];
        if (!assister?.alive) continue;
        awardPveCombo(state, assister, 1, 3);
        pve.contributions[assisterId]!.assists += 1;
      }
    }
  }
}

function updateZoneAndEvents(state: DownstairsState, deltaMs: number): void {
  state.rescueCooldownMs = Math.max(0, state.rescueCooldownMs - deltaMs);
  if (!state.bossCompleted && state.elapsedMs >= 60_000 && !state.boss) startBoss(state);
  updateBoss(state, deltaMs);
  const nextZone = state.boss ? 'boss' : downstairsZoneAt(state.elapsedMs, state.bossCompleted);
  if (nextZone !== state.zone) {
    state.zone = nextZone;
    setObjectiveForZone(state, nextZone);
  }
  if (state.boss) {
    state.event = null;
    state.eventRemainingMs = 0;
    return;
  }
  if (state.eventRemainingMs > 0) {
    state.eventRemainingMs = Math.max(0, state.eventRemainingMs - deltaMs);
    if (state.eventRemainingMs === 0) state.event = null;
  } else if (state.elapsedMs >= state.nextEventAtMs) {
    state.event = downstairsNextEvent(state);
    if (state.event === 'rescue') {
      state.rescuePlatformsRemaining = 3;
      state.rescueCooldownMs = 30_000;
    }
    state.eventRemainingMs = 10_000;
    state.nextEventAtMs += 15_000;
  }
}

export function advanceDownstairs(state: DownstairsState, deltaMs: number): void {
  if (state.over) return;
  const dt = Math.min(Math.max(deltaMs, 0), 100) / 1000;
  state.elapsedMs += deltaMs;
  const speed = state.pve
    ? updatePveWorld(state, deltaMs)
    : (updateZoneAndEvents(state, deltaMs), downstairsDifficultyAt(state.elapsedMs).scrollSpeed);
  for (const platform of state.platforms) {
    platform.y -= speed * dt;
    if (platform.kind === 'moving') {
      platform.originX ??= platform.x;
      platform.x = Math.max(18, Math.min(DOWNSTAIRS_WIDTH - platform.width - 18, platform.originX + Math.sin((state.elapsedMs + platform.id * 370) / 900) * 38));
    }
    if (state.boss?.phase === 'active' && state.boss.attack === 'safeShift' && state.boss.attackRemainingMs <= 0 && state.boss.targetPlatformId === platform.id) {
      platform.x = Math.max(18, Math.min(DOWNSTAIRS_WIDTH - platform.width - 18, platform.x + state.boss.gustDirection * 34 * dt));
    }
    if (platform.fragileMs !== undefined) {
      platform.fragileMs = Math.max(0, platform.fragileMs - deltaMs);
      if (platform.fragileMs === 0) {
        platform.fragileMs = undefined;
        platform.brokenMs = 2_500;
      }
    } else if (platform.brokenMs !== undefined) {
      platform.brokenMs = Math.max(0, platform.brokenMs - deltaMs);
      if (platform.brokenMs === 0) platform.brokenMs = undefined;
    }
    if (platform.y < -16) {
      if (platform.startOnly) continue;
      const id = state.nextPlatformId++;
      const anchor = state.platforms
        .filter((item) => item !== platform)
        .reduce((lowest, item) => item.y > lowest.y ? item : lowest);
      const layout = downstairsPlatformLayout(id, anchor, state.zone);
      const rescue = state.rescuePlatformsRemaining > 0;
      if (state.generationRowSlot >= state.generationRowSize) {
        state.generationRowSize = platformCountForRow(id, state.zone);
        state.generationRowSlot = 0;
        state.generationRowSeed = id;
        // Keep the whole scattered cluster visible while the opening recycle pool is still filling.
        state.generationRowY = Math.min(DOWNSTAIRS_HEIGHT - 30, anchor.y + layout.gap);
      }
      const rowCount = state.generationRowSize as 2 | 3;
      const rowSlot = state.generationRowSlot;
      const rowChallenge = !rescue && state.zone !== 'garden' && state.zone !== 'boss' &&
        rowSlot === 1 + platformVariation(state.generationRowSeed, 0x7331, 2);
      const generatedRoute = rowChallenge ? 'challenge' : 'safe';
      platform.id = id;
      platform.width = generatedRoute === 'challenge' ? DOWNSTAIRS_CHALLENGE_WIDTH : DOWNSTAIRS_PLATFORM_WIDTH;
      platform.x = platformXForRow(rowSlot, rowCount, platform.width, state.generationRowSeed);
      platform.y = state.generationRowY + platformYOffsetForRow(rowSlot, rowCount, state.generationRowSeed);
      platform.route = generatedRoute;
      platform.pattern = layout.pattern;
      platform.accent = layout.accent;
      platform.isStart = false;
      platform.startOnly = false;
      platform.kind = platformKindFor(id, state);
      if (rescue || (platform.route === 'safe' && (platform.kind === 'spike' || platform.kind === 'fragile'))) platform.kind = 'normal';
      if (rescue) state.rescuePlatformsRemaining -= 1;
      state.generationRowSlot += 1;
      platform.originX = platform.x;
      platform.fragileMs = undefined;
      platform.brokenMs = undefined;
      platform.switchUsed = false;
      platform.pveRole = undefined;
      state.stars = state.stars.filter((star) => state.platforms.some((item) => item.id === star.platformId));
      if ((platform.route === 'challenge' || state.event === 'golden') && id % (state.event === 'golden' ? 2 : 3) === 0) {
        state.stars.push({ id: state.nextStarId++, platformId: id, collectedBy: [] });
      }
    }
  }
  state.platforms = state.platforms.filter((platform) => !(platform.startOnly && platform.y < -16));
  advancePveWorldEnemies(state, deltaMs);

  for (const player of Object.values(state.players)) {
    if (!player.alive) continue;
    const oldBottom = player.y + DOWNSTAIRS_PLAYER_SIZE;
    const skillActive = player.skillActiveMs > 0;
    const dashing = skillActive && player.characterId === 'tangerine';
    const guided = skillActive && player.characterId === 'star';
    let movementDirection = player.direction;
    if (dashing && movementDirection === 0) movementDirection = player.lastFacing;
    if (guided && player.direction === 0) {
      const playerCenter = player.x + DOWNSTAIRS_PLAYER_SIZE / 2;
      const lastScoredPlatform = state.platforms.find((platform) => platform.id === player.lastScoredPlatformId);
      const minimumTargetY = Math.max(
        player.y + DOWNSTAIRS_PLAYER_SIZE,
        lastScoredPlatform ? lastScoredPlatform.y + 35 : Number.NEGATIVE_INFINITY,
      );
      let target: DownstairsPlatform | undefined;
      let targetScore = Number.POSITIVE_INFINITY;
      const candidates = state.platforms.filter((platform) =>
        platform.id !== player.lastScoredPlatformId &&
        platform.kind !== 'spike' &&
        platform.brokenMs === undefined &&
        platform.y > minimumTargetY &&
        platform.y < player.y + 230
      );
      const routeCandidates = lastScoredPlatform
        ? candidates.filter((platform) =>
            platform.x + platform.width < lastScoredPlatform.x + 5 ||
            platform.x > lastScoredPlatform.x + lastScoredPlatform.width - 5
          )
        : candidates;
      for (const platform of routeCandidates.length ? routeCandidates : candidates) {
        if (
          platform.y > minimumTargetY
        ) {
          const horizontalDistance = Math.abs(platform.x + platform.width / 2 - playerCenter);
          const score = platform.y - player.y + horizontalDistance * 0.35;
          if (score < targetScore) {
            target = platform;
            targetScore = score;
          }
        }
      }
      if (target) {
        const difference = target.x + target.width / 2 - playerCenter;
        if (Math.abs(difference) > 5) movementDirection = difference < 0 ? -1 : 1;
      }
    }
    const sharedFever = state.pve ? teamFeverActive(state.pve.teamFever) : false;
    const comboSpeed = state.pve ? (sharedFever ? 1.35 : downstairsComboSpeedMultiplier(player.combo)) : downstairsComboSpeedMultiplier(player.combo, player.feverRemainingMs > 0);
    const brakeControl = state.pve ? (sharedFever ? 1.35 : downstairsComboBrakeMultiplier(player.combo)) : downstairsComboBrakeMultiplier(player.combo, player.feverRemainingMs > 0);
    const reversing = movementDirection !== 0 && Math.abs(player.vx) > 5 && Math.sign(player.vx) !== movementDirection;
    player.vx += movementDirection * (dashing ? 1_900 : guided ? 1_150 : 900) * comboSpeed * (reversing ? brakeControl : 1) * dt;
    player.vx *= Math.pow(movementDirection === 0 ? 0.001 : 0.25, dt * (movementDirection === 0 || reversing ? brakeControl : 1));
    const maxSpeed = (dashing ? 350 : 210) * comboSpeed;
    player.vx = Math.max(-maxSpeed, Math.min(maxSpeed, player.vx));
    const bubble = skillActive && player.characterId === 'bubble' && player.vy > 0;
    player.vy = Math.min(bubble ? 300 : 660, player.vy + 980 * (bubble ? 0.45 : 1) * dt);
    player.x = Math.max(0, Math.min(DOWNSTAIRS_WIDTH - DOWNSTAIRS_PLAYER_SIZE, player.x + player.vx * dt));
    player.y += player.vy * dt;
    player.invulnerableMs = Math.max(0, player.invulnerableMs - deltaMs);
    const feverWasActive = player.feverRemainingMs > 0;
    player.feverRemainingMs = Math.max(0, player.feverRemainingMs - deltaMs);
    player.feverFeedbackMs = Math.max(0, player.feverFeedbackMs - deltaMs);
    if (player.feverFeedbackMs === 0) player.feverResult = null;
    if (feverWasActive && player.feverRemainingMs === 0) finishFever(player, 'complete');
    player.landingGradeMs = Math.max(0, player.landingGradeMs - deltaMs);
    if (player.landingGradeMs === 0) player.landingGrade = null;
    player.objectiveFeedbackMs = Math.max(0, player.objectiveFeedbackMs - deltaMs);
    if (player.objectiveFeedbackMs === 0) player.objectiveReward = null;
    player.skillCooldownMs = Math.max(0, player.skillCooldownMs - deltaMs);
    player.skillActiveMs = Math.max(0, player.skillActiveMs - deltaMs);
    player.landingEffectMs = Math.max(0, player.landingEffectMs - deltaMs);
    player.starFeedbackMs = Math.max(0, player.starFeedbackMs - deltaMs);
    if (player.starFeedbackMs === 0) player.starReward = null;
    if (player.skillActiveMs === 0) player.skillShieldCharges = 0;

    // Ignore a platform only until the player has clearly bounced above it.
    // This prevents duplicate collision while leaving the surface, but still
    // allows the player to intentionally land on the same platform again.
    if (player.vy < 0 && player.lastPlatformId >= 0) {
      const previousPlatform = state.platforms.find((platform) => platform.id === player.lastPlatformId);
      if (!previousPlatform || player.y + DOWNSTAIRS_PLAYER_SIZE < previousPlatform.y - 8) {
        player.lastPlatformId = -1;
      }
    }

    if (state.boss?.phase === 'active' && state.boss.attack === 'gust' && state.boss.attackRemainingMs <= 0) {
      player.vx += state.boss.gustDirection * 260 * dt;
    }
    if (state.boss?.phase === 'active' && state.boss.attack === 'fallingRock' && state.boss.attackRemainingMs <= 0 && player.lastBossHitCycle !== state.boss.cycle) {
      const target = state.platforms.find((platform) => platform.id === state.boss?.targetPlatformId);
      if (target && player.x + DOWNSTAIRS_PLAYER_SIZE > target.x && player.x < target.x + target.width) {
        player.lastBossHitCycle = state.boss.cycle;
        applyDownstairsDamage(state, player);
      }
    }

    if (player.vy >= 0) {
      const newBottom = player.y + DOWNSTAIRS_PLAYER_SIZE;
      const platform = state.platforms.find(
        (item) =>
          item.brokenMs === undefined && item.id !== player.lastPlatformId && oldBottom <= item.y + 7 && newBottom >= item.y &&
          player.x + DOWNSTAIRS_PLAYER_SIZE - 5 > item.x && player.x + 5 < item.x + item.width,
      );
      if (platform) {
        feedback(state, platform.kind === 'spring' ? 'spring' : 'land');
        const stomped = state.boss?.phase === 'active' && state.boss.attack === 'stomp' &&
          state.boss.attackRemainingMs <= 0 && state.boss.targetPlatformId === platform.id;
        player.y = platform.y - DOWNSTAIRS_PLAYER_SIZE;
        player.lastPlatformId = platform.id;
        player.lastLandingKind = platform.kind;
        player.landingEffectMs = platform.kind === 'normal' ? 0 : 450;
        const newScoredLanding = player.lastScoredPlatformId !== platform.id;
        const safeLanding = platform.kind !== 'spike' && !stomped;
        if (newScoredLanding) {
          player.lastScoredPlatformId = platform.id;
          if (safeLanding) {
            const grade = downstairsLandingGrade(player.x, platform.x, platform.width);
            const challenge = platform.route === 'challenge';
            const comboGain = grade === 'perfect' ? (challenge ? 3 : 2) : grade === 'good' && challenge ? 2 : 1;
            const depthBonus = grade === 'perfect' ? (challenge ? 5 : 3) : grade === 'good' && challenge ? 2 : 0;
            player.landingGrade = grade;
            player.landingGradeMs = 700;
            player.landingSequence += 1;
            player.scoreBonus += depthBonus;
            if (grade === 'perfect') player.skillCooldownMs = Math.max(0, player.skillCooldownMs - 700);
            if (state.pve) {
              awardPveCombo(state, player, comboGain, teamFeverActive(state.pve.teamFever) ? 10 : 0);
            } else if (player.feverRemainingMs > 0) player.scoreBonus += 10;
            else {
              player.combo += comboGain;
              if (player.combo >= DOWNSTAIRS_FEVER_THRESHOLD) startFever(player);
            }
            if (grade === 'perfect') progressObjective(state, player, 'perfectLandings');
            if (challenge || ['moving', 'fragile', 'conveyorLeft', 'conveyorRight'].includes(platform.kind)) {
              progressObjective(state, player, 'riskyLandings');
            }
          }
        }
        if (platform.kind === 'spring') player.vy = bounceVelocity(platform.kind, platform.y, platform.id, state.platforms, player.x);
        else if (platform.kind === 'spike' || stomped) {
          player.vy = bounceVelocity('spike', platform.y, platform.id, state.platforms, player.x);
          if (newScoredLanding) applyDownstairsDamage(state, player);
        } else player.vy = bounceVelocity(platform.kind, platform.y, platform.id, state.platforms, player.x);
        if (platform.kind === 'fragile' && platform.fragileMs === undefined) platform.fragileMs = 1_200;
        if (platform.kind === 'conveyorLeft') player.vx -= 70;
        if (platform.kind === 'conveyorRight') player.vx += 70;
        if (platform.pveRole === 'bossMechanism' && !platform.switchUsed && state.pve?.encounter) {
          platform.switchUsed = activatePveBossMechanism(state.pve.encounter, platform.pveMechanismIndex);
          ensurePveEncounterPlatforms(state);
        } else if (platform.pveRole === 'bossWeakPoint' && state.pve?.encounter) {
          const damage = damagePveBossWeakPoint(state.pve.encounter, player.playerId, 1, teamFeverActive(state.pve.teamFever));
          if (damage > 0) {
            player.scoreBonus += 15;
            state.pve.contributions[player.playerId]!.bossDamage += damage;
            if (damage >= 1) awardPveCombo(state, player, 3, 0);
          }
          ensurePveEncounterPlatforms(state);
        } else if (platform.kind === 'bossSwitch' && !platform.switchUsed && state.boss?.phase === 'active') {
          platform.switchUsed = true;
          state.boss.shield = Math.max(0, state.boss.shield - 2);
        }
      }
    }

    for (const star of state.stars) {
      if (star.collectedBy.includes(player.playerId)) continue;
      const platform = state.platforms.find((item) => item.id === star.platformId);
      if (!platform) continue;
      const starX = platform.x + platform.width / 2;
      const starY = platform.y - 28;
      if (Math.abs(player.x + DOWNSTAIRS_PLAYER_SIZE / 2 - starX) > 24 || Math.abs(player.y + DOWNSTAIRS_PLAYER_SIZE / 2 - starY) > 28) continue;
      star.collectedBy.push(player.playerId);
      feedback(state, 'star');
      player.stars += 1;
      player.scoreBonus += 5;
      player.starReward = 'star';
      if (player.stars % 3 === 0) {
        player.comboShield = true;
        player.starReward = 'shield';
      }
      if (player.stars % 9 === 0) {
        if (player.health < 3) {
          player.health += 1;
          player.starReward = 'heal';
        } else {
          player.scoreBonus += 30;
          player.starReward = 'bonus';
        }
      }
      player.starFeedbackMs = 900;
      progressObjective(state, player, 'stars');
    }

    resolvePveCombatForPlayer(state, player, oldBottom);
    player.depth = state.pve
      ? Math.floor(state.pve.progression.worldDepthM) + player.combo * 2 + player.scoreBonus
      : Math.floor(state.elapsedMs / 180) + player.combo * 2 + player.scoreBonus;
    player.ceilingDangerMs = player.y < 52 ? player.ceilingDangerMs + deltaMs : 0;
    if (player.health <= 0) eliminate(state, player, 'health');
    else if (player.y < -30 || player.ceilingDangerMs >= CEILING_GRACE_MS) eliminate(state, player, 'ceiling');
    else if (player.y > DOWNSTAIRS_HEIGHT + 30) eliminate(state, player, 'fall');
  }
  state.over = Object.values(state.players).every((player) => !player.alive);
}

export function downstairsView(state: DownstairsState): DownstairsGameView {
  return {
    type: 'downstairs',
    turnPlayerId: null,
    over: state.over,
    elapsedMs: state.elapsedMs,
    platforms: state.platforms.map((platform) => ({ ...platform })),
    players: Object.fromEntries(Object.values(state.players).map((player) => [player.playerId, {
      playerId: player.playerId,
      characterId: player.characterId,
      x: player.x,
      y: player.y,
      facing: player.vx < -5 ? -1 : 1,
      health: player.health,
      depth: player.depth,
      combo: player.combo,
      invulnerableMs: player.invulnerableMs,
      feverRemainingMs: player.feverRemainingMs,
      feverGuard: player.feverGuard,
      feverFeedbackMs: player.feverFeedbackMs,
      feverResult: player.feverResult,
      feverSequence: player.feverSequence,
      landingGrade: player.landingGrade,
      landingGradeMs: player.landingGradeMs,
      landingSequence: player.landingSequence,
      objectiveProgress: player.objectiveProgress,
      objectiveCompleted: player.objectiveCompleted,
      objectiveFeedbackMs: player.objectiveFeedbackMs,
      objectiveSequence: player.objectiveSequence,
      objectiveReward: player.objectiveReward,
      alive: player.alive,
      endReason: player.endReason,
      skillCooldownMs: player.skillCooldownMs,
      skillActiveMs: player.skillActiveMs,
      ceilingDangerMs: player.ceilingDangerMs,
      lastPlatformId: player.lastPlatformId,
      lastLandingKind: player.lastLandingKind,
      landingEffectMs: player.landingEffectMs,
      stars: player.stars,
      comboShield: player.comboShield,
      scoreBonus: player.scoreBonus,
      starFeedbackMs: player.starFeedbackMs,
      starReward: player.starReward,
      eliminatedAt: player.eliminatedAt,
      survivedMs: player.eliminatedAt ?? state.elapsedMs,
    }])),
    ranking: Object.values(state.players)
      .sort((a, b) => b.depth - a.depth || (b.eliminatedAt ?? state.elapsedMs) - (a.eliminatedAt ?? state.elapsedMs) || a.insertionOrder - b.insertionOrder)
      .map((player) => player.playerId),
    stars: state.stars.flatMap((star) => {
      const platform = state.platforms.find((item) => item.id === star.platformId);
      return platform ? [{ ...star, collectedBy: star.collectedBy.slice(), x: platform.x + platform.width / 2, y: platform.y - 28 }] : [];
    }),
    zone: state.zone,
    event: state.event,
    eventRemainingMs: state.eventRemainingMs,
    objective: state.objective ? { ...state.objective } : null,
    boss: state.boss ? { ...state.boss } : null,
    feedbackSequence: state.feedbackSequence,
    feedbackEvent: state.feedbackEvent,
    pve: state.pve ? {
      progression: { ...state.pve.progression },
      teamFever: {
        ...state.pve.teamFever,
        perPlayerGuardUsed: { ...state.pve.teamFever.perPlayerGuardUsed },
        readyPlayerIds: state.pve.teamFever.readyPlayerIds.slice(),
      },
      enemies: state.pve.enemies.map((enemy) => ({
        ...enemy,
        hitKeys: enemy.hitKeys.slice(),
        assists: enemy.assists.slice(),
      })),
      encounter: state.pve.encounter ? {
        ...state.pve.encounter,
        cycleHitPlayerIds: state.pve.encounter.cycleHitPlayerIds.slice(),
      } : null,
      contributions: Object.fromEntries(Object.entries(state.pve.contributions).map(([playerId, contribution]) => [playerId, { ...contribution }])),
    } : null,
  };
}
