import type { PlayerId } from '../types.js';
import { PVE_ENEMIES } from './content.js';
import type { PveEnemyState } from './enemies.js';

export interface PveCombatPlayer {
  playerId: PlayerId;
  characterId: 'brave' | 'bubble' | 'tangerine' | 'star';
  x: number;
  y: number;
  size: number;
  vy: number;
  previousBottom: number;
  skillActive: boolean;
  skillSequence: number;
}

export type PveContactResult =
  | { kind: 'none' }
  | { kind: 'playerDamage' }
  | { kind: 'enemyHit'; damage: number; defeated: boolean; assistedBy: PlayerId[]; stomp: boolean };

export function resolvePveEnemyContact(enemy: PveEnemyState, player: PveCombatPlayer, feverActive: boolean): PveContactResult {
  if (enemy.phase !== 'active' && enemy.phase !== 'staggered') return { kind: 'none' };
  const overlaps = player.x + player.size > enemy.x && player.x < enemy.x + 24 && player.y + player.size > enemy.y && player.y < enemy.y + 24;
  if (!overlaps) return { kind: 'none' };
  const hitKey = `${enemy.attackSequence}:${player.playerId}:${player.skillSequence}`;
  if (enemy.hitKeys.includes(hitKey)) return { kind: 'none' };
  enemy.hitKeys = [...enemy.hitKeys.slice(-15), hitKey];
  const stomp = player.previousBottom <= enemy.y + 10 && player.y + player.size >= enemy.y;
  const dash = player.characterId === 'tangerine' && player.skillActive;
  const bash = player.characterId === 'brave' && player.skillActive;
  if (!stomp && !dash && !bash) return { kind: 'playerDamage' };
  let damage = 1 + (feverActive ? 1 : 0);
  if (enemy.markedBy && stomp) damage += 1;
  const assistedBy = enemy.assists.filter((id) => id !== player.playerId);
  if (enemy.markedBy && enemy.markedBy !== player.playerId && !assistedBy.includes(enemy.markedBy)) assistedBy.push(enemy.markedBy);
  enemy.lastHitBy = player.playerId;
  enemy.hp = Math.max(0, enemy.hp - damage);
  const defeated = enemy.hp === 0;
  enemy.phase = defeated ? 'defeated' : 'staggered';
  enemy.phaseRemainingMs = defeated ? 650 : 280;
  return { kind: 'enemyHit', damage, defeated, assistedBy, stomp };
}

export function markNearbyEnemy(enemies: PveEnemyState[], playerId: PlayerId, x: number, y: number, radius: number): boolean {
  let nearest: PveEnemyState | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const enemy of enemies) {
    if (enemy.phase !== 'active') continue;
    const distance = Math.hypot(enemy.x + 12 - x, enemy.y + 12 - y);
    if (distance <= radius && distance < nearestDistance) { nearest = enemy; nearestDistance = distance; }
  }
  if (!nearest) return false;
  nearest.markedBy = playerId;
  nearest.markedMs = 1_500;
  if (!nearest.assists.includes(playerId)) nearest.assists.push(playerId);
  return true;
}

export function slowEnemyByBubble(enemy: PveEnemyState, playerId: PlayerId): void {
  enemy.vx *= 0.65;
  if (!enemy.assists.includes(playerId)) enemy.assists.push(playerId);
}

export function pveEnemyIsElite(enemy: PveEnemyState): boolean {
  return PVE_ENEMIES[enemy.type].elite;
}
