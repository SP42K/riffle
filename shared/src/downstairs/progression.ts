import { PVE_SCENES, sceneForIndex, type PveSceneId } from './content.js';

export type PveRunPhase = 'explore' | 'bossWarning' | 'boss' | 'settle';

export interface PveProgressionState {
  worldDepthM: number;
  sceneId: PveSceneId;
  sceneIndex: number;
  sceneStartDepthM: number;
  sceneDepthM: number;
  runSeed: number;
  loopTier: number;
  defeatedBosses: number;
  phase: PveRunPhase;
  simulationRemainderMs: number;
}

export function createPveProgression(runSeed: number): PveProgressionState {
  return {
    worldDepthM: 0,
    sceneId: 'garden',
    sceneIndex: 0,
    sceneStartDepthM: 0,
    sceneDepthM: 0,
    runSeed: runSeed >>> 0 || 0x6d2b79f5,
    loopTier: 0,
    defeatedBosses: 0,
    phase: 'explore',
    simulationRemainderMs: 0,
  };
}

function lerpAt(value: number, start: number, end: number, from: number, to: number): number {
  const progress = Math.max(0, Math.min(1, (value - start) / Math.max(1, end - start)));
  return from + (to - from) * progress;
}

export function pveScrollSpeedAtDepth(worldDepthM: number): number {
  const depth = Math.max(0, worldDepthM);
  if (depth < 200) return lerpAt(depth, 0, 200, 26, 34);
  if (depth < 500) return lerpAt(depth, 200, 500, 34, 46);
  if (depth < 900) return lerpAt(depth, 500, 900, 46, 58);
  if (depth < 1_300) return lerpAt(depth, 900, 1_300, 58, 66);
  if (depth < 2_000) return lerpAt(depth, 1_300, 2_000, 66, 72);
  return 72;
}

export function advancePveProgression(state: PveProgressionState, deltaMs: number): number {
  state.simulationRemainderMs += Math.min(100, Math.max(0, deltaMs));
  while (state.simulationRemainderMs >= 10) {
    state.worldDepthM += pveScrollSpeedAtDepth(state.worldDepthM) * 0.001;
    state.simulationRemainderMs -= 10;
  }
  state.sceneDepthM = state.worldDepthM - state.sceneStartDepthM;
  return pveScrollSpeedAtDepth(state.worldDepthM);
}

export function pveSceneExploreComplete(state: PveProgressionState): boolean {
  return state.phase === 'explore' && state.sceneDepthM >= PVE_SCENES[state.sceneId].exploreDepthM;
}

export function beginPveBoss(state: PveProgressionState): void {
  if (state.phase === 'explore') state.phase = 'bossWarning';
}

export function markPveBossActive(state: PveProgressionState): void {
  state.phase = 'boss';
}

export function settlePveBoss(state: PveProgressionState): void {
  state.phase = 'settle';
}

export function advanceToNextPveScene(state: PveProgressionState): void {
  state.defeatedBosses += 1;
  state.sceneIndex += 1;
  state.sceneId = sceneForIndex(state.sceneIndex);
  state.loopTier = Math.max(0, state.sceneIndex - 4);
  state.sceneStartDepthM = state.worldDepthM;
  state.sceneDepthM = 0;
  state.phase = 'explore';
}
