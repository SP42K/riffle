import type { PlayerId } from '../types.js';

export type TeamFeverPhase = 'idle' | 'active' | 'cooldown';

export interface TeamFeverState {
  phase: TeamFeverPhase;
  remainingMs: number;
  cooldownMs: number;
  sourcePlayerId: PlayerId | null;
  sequence: number;
  perPlayerGuardUsed: Record<PlayerId, boolean>;
  readyPlayerIds: PlayerId[];
}

export function createTeamFever(): TeamFeverState {
  return { phase: 'idle', remainingMs: 0, cooldownMs: 0, sourcePlayerId: null, sequence: 0, perPlayerGuardUsed: {}, readyPlayerIds: [] };
}

export function tickTeamFever(state: TeamFeverState, deltaMs: number): void {
  if (state.phase === 'active') {
    state.remainingMs = Math.max(0, state.remainingMs - deltaMs);
    if (state.remainingMs === 0) {
      state.phase = 'cooldown';
      state.cooldownMs = 4_000;
    }
  } else if (state.phase === 'cooldown') {
    state.cooldownMs = Math.max(0, state.cooldownMs - deltaMs);
    if (state.cooldownMs === 0) {
      state.phase = 'idle';
      state.sourcePlayerId = null;
    }
  }
}

export function requestTeamFever(
  state: TeamFeverState,
  playerId: PlayerId,
  combo: number,
  alivePlayerIds: readonly PlayerId[],
): boolean {
  if (combo < 30) return false;
  if (state.phase !== 'idle') {
    if (!state.readyPlayerIds.includes(playerId)) state.readyPlayerIds.push(playerId);
    return false;
  }
  state.phase = 'active';
  state.remainingMs = 5_000;
  state.cooldownMs = 0;
  state.sourcePlayerId = playerId;
  state.sequence += 1;
  state.readyPlayerIds = state.readyPlayerIds.filter((id) => id !== playerId);
  state.perPlayerGuardUsed = Object.fromEntries(alivePlayerIds.map((id) => [id, false]));
  return true;
}

export function consumeTeamFeverGuard(state: TeamFeverState, playerId: PlayerId): boolean {
  if (state.phase !== 'active' || state.perPlayerGuardUsed[playerId] !== false) return false;
  state.perPlayerGuardUsed[playerId] = true;
  return true;
}

export function teamFeverActive(state: TeamFeverState): boolean {
  return state.phase === 'active' && state.remainingMs > 0;
}
