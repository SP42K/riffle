import type { PlayerId } from '../types.js';
import { PVE_ENEMIES, type PveEnemyEntry, type PveEnemyType } from './content.js';
import type { PveEncounterCard, PveSpawnPlan } from './director.js';

export type PveEnemyPhase = 'cue' | 'telegraph' | 'entering' | 'settling' | 'active' | 'staggered' | 'defeated' | 'escaped';

export interface PveEnemyState {
  id: number;
  type: PveEnemyType;
  entry: PveEnemyEntry;
  phase: PveEnemyPhase;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  platformId: number;
  telegraphMs: number;
  phaseRemainingMs: number;
  attackSequence: number;
  hitKeys: string[];
  assists: PlayerId[];
  markedBy: PlayerId | null;
  markedMs: number;
  lastHitBy: PlayerId | null;
  ageMs: number;
  card: PveEncounterCard;
  cueMs: number;
  enteringMs: number;
  settlingMs: number;
  entryDirection: -1 | 1;
}

export interface PveEnemyPlatformAnchor { id: number; x: number; y: number; width: number; broken?: boolean }

export function createPveEnemy(id: number, plan: PveSpawnPlan): PveEnemyState {
  const content = PVE_ENEMIES[plan.type];
  return {
    id, type: plan.type, entry: plan.entry, phase: 'cue', x: plan.x, y: plan.y, vx: content.speed, vy: 0,
    hp: content.hp, maxHp: content.hp, platformId: plan.platformId, telegraphMs: plan.telegraphMs,
    phaseRemainingMs: plan.cueMs ?? 450, attackSequence: 0, hitKeys: [], assists: [], markedBy: null, markedMs: 0, lastHitBy: null, ageMs: 0,
    card: plan.card ?? 'solo', cueMs: plan.cueMs ?? 450, enteringMs: plan.enteringMs ?? 400, settlingMs: plan.settlingMs ?? 250,
    entryDirection: plan.entryDirection ?? (plan.x < 180 ? -1 : 1),
  };
}

export function advancePveEnemies(
  enemies: PveEnemyState[],
  platforms: readonly PveEnemyPlatformAnchor[],
  deltaMs: number,
  feverActive: boolean,
  slowedEnemyIds: readonly number[] = [],
): void {
  const dt = Math.min(100, Math.max(0, deltaMs)) / 1000;
  for (const enemy of enemies) {
    enemy.ageMs += Math.max(0, deltaMs);
    enemy.markedMs = Math.max(0, enemy.markedMs - deltaMs);
    if (enemy.markedMs === 0) enemy.markedBy = null;
    if (enemy.phase === 'defeated' || enemy.phase === 'escaped') {
      enemy.phaseRemainingMs = Math.max(0, enemy.phaseRemainingMs - deltaMs);
      continue;
    }
    const platform = platforms.find((item) => item.id === enemy.platformId);
    if (!platform || platform.broken || platform.y < -30) {
      enemy.phase = 'escaped'; enemy.phaseRemainingMs = 400; continue;
    }
    if (enemy.phase === 'cue' || enemy.phase === 'telegraph' || enemy.phase === 'entering' || enemy.phase === 'settling') {
      let remaining = Math.max(0, deltaMs);
      while (remaining > 0 && (enemy.phase === 'cue' || enemy.phase === 'telegraph' || enemy.phase === 'entering' || enemy.phase === 'settling')) {
        const step = Math.min(remaining, enemy.phaseRemainingMs);
        enemy.phaseRemainingMs = Math.max(0, enemy.phaseRemainingMs - step);
        remaining -= step;
        const targetX = platform.x + platform.width / 2 - 12;
        const targetY = platform.y - 24;
        if (enemy.phase === 'entering') {
          const progress = 1 - enemy.phaseRemainingMs / Math.max(1, enemy.enteringMs);
          if (enemy.entry === 'edgeLeap') {
            const originX = enemy.entryDirection < 0 ? -30 : 390;
            enemy.x = originX + (targetX - originX) * progress;
            enemy.y = targetY - Math.sin(Math.PI * progress) * 58;
          } else if (enemy.entry === 'ceilingDrop') {
            enemy.x = targetX; enemy.y = -30 + (targetY + 30) * progress;
          } else { enemy.x = targetX; enemy.y = targetY; }
        } else { enemy.x = targetX; enemy.y = targetY; }
        if (enemy.phaseRemainingMs > 0) break;
        if (enemy.phase === 'cue') { enemy.phase = 'telegraph'; enemy.phaseRemainingMs = enemy.telegraphMs; }
        else if (enemy.phase === 'telegraph') { enemy.phase = 'entering'; enemy.phaseRemainingMs = enemy.enteringMs; }
        else if (enemy.phase === 'entering') { enemy.phase = 'settling'; enemy.phaseRemainingMs = enemy.settlingMs; }
        else { enemy.phase = 'active'; enemy.attackSequence += 1; }
      }
      continue;
    }
    if (enemy.phase === 'staggered') {
      enemy.phaseRemainingMs = Math.max(0, enemy.phaseRemainingMs - deltaMs);
      if (enemy.phaseRemainingMs === 0) { enemy.phase = 'active'; enemy.attackSequence += 1; }
      enemy.y = platform.y - 24;
      continue;
    }
    const behaviorScale = enemy.type === 'gearImp' && enemy.ageMs % 2_200 < 700 ? 1.75
      : enemy.type === 'mirrorWisp' ? 0.72
        : 1;
    const speedScale = (feverActive ? 0.8 : 1) * (slowedEnemyIds.includes(enemy.id) ? 0.65 : 1) * behaviorScale;
    enemy.x += enemy.vx * speedScale * dt;
    const minX = platform.x + 3;
    const maxX = platform.x + platform.width - 27;
    if (enemy.x <= minX || enemy.x >= maxX) {
      enemy.x = Math.max(minX, Math.min(maxX, enemy.x));
      enemy.vx *= -1;
      enemy.attackSequence += 1;
    }
    const hop = enemy.type === 'sproutBall' ? Math.abs(Math.sin(enemy.ageMs / 260)) * 12
      : enemy.type === 'cometBug' || enemy.type === 'windCrow' || enemy.type === 'magnetBat' ? Math.abs(Math.sin(enemy.ageMs / 420)) * 7
        : enemy.type === 'mirrorWisp' ? Math.sin(enemy.ageMs / 520) * 5
          : 0;
    enemy.y = platform.y - 24 - hop;
  }
}

export function visiblePveEnemies(enemies: readonly PveEnemyState[]): PveEnemyState[] {
  return enemies.filter((enemy) => !(enemy.phase === 'escaped' && enemy.phaseRemainingMs === 0) && !(enemy.phase === 'defeated' && enemy.phaseRemainingMs === 0));
}
