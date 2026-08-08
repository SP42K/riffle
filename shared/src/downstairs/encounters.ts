import type { PlayerId } from '../types.js';
import { PVE_BOSSES, bossForScene, type PveBossId, type PveSceneId } from './content.js';

export type PveBossPhase = 'warning' | 'active' | 'staggered' | 'defeat';
export type PveBossAttackPhase = 'telegraph' | 'impact' | 'recover';
export type PveWeakPointPhase = 'locked' | 'exposed';
export type PveBossAct = 'teach' | 'mix' | 'finale';
export type PveBossFeedback = 'mechanicProgress' | 'wrongOrder' | 'weakPointReady' | 'weakPointHit' | 'alreadyHit' | 'damageCap';

export interface PveEncounterState {
  bossId: PveBossId;
  phase: PveBossPhase;
  hp: number;
  maxHp: number;
  attack: string;
  attackPhase: PveBossAttackPhase;
  attackRemainingMs: number;
  weakPoint: PveWeakPointPhase;
  weakPointRemainingMs: number;
  mechanicProgress: number;
  mechanicTarget: number;
  cycle: number;
  cycleDamage: number;
  cycleHitPlayerIds: PlayerId[];
  damageCap: number;
  sceneArenaDepthM: number;
  sequence: number;
  lastDamageBy: PlayerId | null;
  targetPlatformId: number | null;
  gustDirection: -1 | 1;
  resolvedAttackCycle: number;
  act: PveBossAct;
  mechanicOrder: number[];
  feedback: PveBossFeedback | null;
  feedbackRemainingMs: number;
}

function actForHealth(hp: number, maxHp: number): PveBossAct {
  const ratio = hp / Math.max(1, maxHp);
  return ratio <= .25 ? 'finale' : ratio <= .75 ? 'mix' : 'teach';
}

function telegraphMs(act: PveBossAct): number {
  return act === 'teach' ? 1_600 : act === 'mix' ? 1_200 : 1_000;
}

function attackForCycle(encounter: PveEncounterState): string {
  const attacks = PVE_BOSSES[encounter.bossId].attacks;
  const pool = encounter.act === 'teach' ? attacks.slice(0, 2) : encounter.act === 'finale' ? attacks.slice(1) : attacks;
  return pool[encounter.cycle % pool.length]!;
}

function mechanismOrder(bossId: PveBossId, cycle: number, target: number): number[] {
  if (bossId === 'clangclang') return cycle % 2 === 0 ? [0, 1] : [1, 0];
  return Array.from({ length: target }, (_, index) => index);
}

export function createPveEncounter(sceneId: PveSceneId, loopTier: number, alivePlayers: number, sceneArenaDepthM: number): PveEncounterState {
  const bossId = bossForScene(sceneId, loopTier);
  const content = PVE_BOSSES[bossId];
  const playerCount = Math.max(1, Math.min(4, alivePlayers));
  const maxHp = Math.min(80, content.baseHp + (playerCount - 1) * content.extraHpPerPlayer + (sceneId === 'rift' ? loopTier * 8 : 0));
  return {
    bossId, phase: 'warning', hp: maxHp, maxHp, attack: content.attacks[0]!, attackPhase: 'telegraph', attackRemainingMs: 3_000,
    weakPoint: 'locked', weakPointRemainingMs: 0, mechanicProgress: 0, mechanicTarget: content.mechanicSteps,
    cycle: 0, cycleDamage: 0, cycleHitPlayerIds: [], damageCap: playerCount + 1, sceneArenaDepthM, sequence: 1, lastDamageBy: null,
    targetPlatformId: null, gustDirection: 1, resolvedAttackCycle: -1, act: 'teach',
    mechanicOrder: mechanismOrder(bossId, 0, content.mechanicSteps), feedback: null, feedbackRemainingMs: 0,
  };
}

export function advancePveEncounter(encounter: PveEncounterState, deltaMs: number, feverActive: boolean): 'active' | 'defeated' | 'complete' {
  encounter.attackRemainingMs = Math.max(0, encounter.attackRemainingMs - deltaMs);
  encounter.feedbackRemainingMs = Math.max(0, encounter.feedbackRemainingMs - deltaMs);
  if (encounter.feedbackRemainingMs === 0) encounter.feedback = null;
  if (encounter.weakPoint === 'exposed') {
    encounter.weakPointRemainingMs = Math.max(0, encounter.weakPointRemainingMs - deltaMs);
    if (encounter.weakPointRemainingMs === 0) { encounter.weakPoint = 'locked'; encounter.mechanicProgress = 0; encounter.sequence += 1; }
  }
  if (encounter.phase === 'warning') {
    if (encounter.attackRemainingMs === 0) { encounter.phase = 'active'; encounter.attackPhase = 'telegraph'; encounter.attackRemainingMs = telegraphMs(encounter.act); encounter.sequence += 1; }
    return 'active';
  }
  if (encounter.phase === 'staggered') {
    if (encounter.attackRemainingMs === 0) { encounter.phase = 'active'; encounter.attackPhase = 'telegraph'; encounter.attackRemainingMs = telegraphMs(encounter.act); encounter.sequence += 1; }
    return 'active';
  }
  if (encounter.phase === 'defeat') return encounter.attackRemainingMs === 0 ? 'complete' : 'defeated';
  if (encounter.attackRemainingMs === 0) {
    if (encounter.attackPhase === 'telegraph') { encounter.attackPhase = 'impact'; encounter.attackRemainingMs = 300; }
    else if (encounter.attackPhase === 'impact') {
      encounter.attackPhase = 'recover';
      const recover = encounter.act === 'teach' ? 1_700 : encounter.act === 'mix' ? 1_400 : 1_100;
      encounter.attackRemainingMs = Math.round(recover * (feverActive ? 1.2 : 1));
    }
    else {
      encounter.cycle += 1;
      encounter.cycleDamage = 0;
      encounter.cycleHitPlayerIds = [];
      encounter.attack = attackForCycle(encounter);
      encounter.mechanicOrder = mechanismOrder(encounter.bossId, encounter.cycle, encounter.mechanicTarget);
      encounter.gustDirection = encounter.cycle % 2 === 0 ? 1 : -1;
      encounter.targetPlatformId = null;
      encounter.attackPhase = 'telegraph';
      encounter.attackRemainingMs = telegraphMs(encounter.act);
    }
    encounter.sequence += 1;
  }
  return 'active';
}

export function activatePveBossMechanism(encounter: PveEncounterState, mechanismIndex = encounter.mechanicOrder[encounter.mechanicProgress] ?? encounter.mechanicProgress): boolean {
  if (encounter.phase !== 'active' || encounter.weakPoint === 'exposed') return false;
  const ordered = encounter.bossId === 'clangclang' || encounter.bossId === 'nightglow';
  const expected = encounter.mechanicOrder[encounter.mechanicProgress] ?? encounter.mechanicProgress;
  if (ordered && mechanismIndex !== expected) {
    encounter.mechanicProgress = Math.max(0, encounter.mechanicProgress - 1);
    encounter.feedback = 'wrongOrder'; encounter.feedbackRemainingMs = 1_000; encounter.sequence += 1;
    return false;
  }
  encounter.mechanicProgress = Math.min(encounter.mechanicTarget, encounter.mechanicProgress + 1);
  if (encounter.mechanicProgress >= encounter.mechanicTarget) {
    encounter.weakPoint = 'exposed';
    encounter.weakPointRemainingMs = 2_200;
    encounter.feedback = 'weakPointReady';
  } else {
    encounter.feedback = 'mechanicProgress';
  }
  encounter.feedbackRemainingMs = 1_000; encounter.sequence += 1;
  return true;
}

export function damagePveBossWeakPoint(encounter: PveEncounterState, playerId: PlayerId, baseDamage: number, feverActive: boolean): number {
  if ((encounter.phase !== 'active' && encounter.phase !== 'staggered') || encounter.weakPoint !== 'exposed') return 0;
  if (encounter.cycleHitPlayerIds.includes(playerId)) {
    encounter.feedback = 'alreadyHit'; encounter.feedbackRemainingMs = 900; encounter.sequence += 1; return 0;
  }
  const cap = encounter.damageCap + (feverActive ? 1 : 0);
  if (encounter.cycleDamage >= cap) {
    encounter.feedback = 'damageCap'; encounter.feedbackRemainingMs = 900; encounter.sequence += 1; return 0;
  }
  const damage = Math.max(0, Math.min(baseDamage + (feverActive ? 1 : 0), cap - encounter.cycleDamage, encounter.hp));
  if (damage <= 0) return 0;
  const before = encounter.hp;
  encounter.hp -= damage;
  encounter.cycleDamage += damage;
  encounter.cycleHitPlayerIds.push(playerId);
  encounter.lastDamageBy = playerId;
  encounter.feedback = 'weakPointHit'; encounter.feedbackRemainingMs = 900;
  encounter.act = actForHealth(encounter.hp, encounter.maxHp);
  encounter.sequence += 1;
  if (encounter.hp === 0) {
    encounter.phase = 'defeat'; encounter.attackRemainingMs = 2_500; encounter.weakPoint = 'locked';
  } else {
    const crossedQuarter = Math.floor(before / Math.max(1, encounter.maxHp / 4)) !== Math.floor(encounter.hp / Math.max(1, encounter.maxHp / 4));
    if (crossedQuarter) { encounter.phase = 'staggered'; encounter.attackRemainingMs = 1_200; }
  }
  return damage;
}
