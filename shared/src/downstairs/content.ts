export type PveSceneId = 'garden' | 'workshop' | 'rooftop' | 'ruins' | 'rift';
export type PveEnemyType =
  | 'sproutBall'
  | 'dewSlime'
  | 'gearImp'
  | 'magnetBat'
  | 'windCrow'
  | 'rainSpirit'
  | 'cometBug'
  | 'mirrorWisp';
export type PveEnemyEntry = 'platformWake' | 'edgeLeap' | 'ceilingDrop' | 'portalPop';
export type PveBossId = 'budshield' | 'clangclang' | 'rumble' | 'nightglow';

export interface PveSceneContent {
  id: PveSceneId;
  name: string;
  exploreDepthM: number;
  enemies: readonly PveEnemyType[];
  bossId: PveBossId;
}

export interface PveEnemyContent {
  id: PveEnemyType;
  name: string;
  hp: number;
  elite: boolean;
  speed: number;
  entries: readonly PveEnemyEntry[];
}

export interface PveBossContent {
  id: PveBossId;
  name: string;
  baseHp: number;
  extraHpPerPlayer: number;
  mechanicSteps: number;
  attacks: readonly string[];
  counterTip: string;
}

export interface PveBossAttackContent {
  name: string;
  warning: string;
}

export const PVE_SCENE_ORDER = ['garden', 'workshop', 'rooftop', 'ruins'] as const;

export const PVE_SCENES: Record<PveSceneId, PveSceneContent> = {
  garden: { id: 'garden', name: '苔芽庭園', exploreDepthM: 220, enemies: ['sproutBall', 'dewSlime'], bossId: 'budshield' },
  workshop: { id: 'workshop', name: '齒輪工坊', exploreDepthM: 260, enemies: ['gearImp', 'magnetBat'], bossId: 'clangclang' },
  rooftop: { id: 'rooftop', name: '暴風屋頂', exploreDepthM: 280, enemies: ['windCrow', 'rainSpirit'], bossId: 'rumble' },
  ruins: { id: 'ruins', name: '星光遺跡', exploreDepthM: 300, enemies: ['cometBug', 'mirrorWisp'], bossId: 'nightglow' },
  rift: { id: 'rift', name: '無限裂隙', exploreDepthM: 320, enemies: ['sproutBall', 'dewSlime', 'gearImp', 'magnetBat', 'windCrow', 'rainSpirit', 'cometBug', 'mirrorWisp'], bossId: 'budshield' },
};

export const PVE_ENEMIES: Record<PveEnemyType, PveEnemyContent> = {
  sproutBall: { id: 'sproutBall', name: '芽跳球', hp: 1, elite: false, speed: 30, entries: ['platformWake'] },
  dewSlime: { id: 'dewSlime', name: '露珠史萊姆', hp: 2, elite: false, speed: 24, entries: ['ceilingDrop'] },
  gearImp: { id: 'gearImp', name: '齒輪小鬼', hp: 2, elite: false, speed: 42, entries: ['portalPop'] },
  magnetBat: { id: 'magnetBat', name: '磁鐵蝠', hp: 1, elite: false, speed: 38, entries: ['edgeLeap'] },
  windCrow: { id: 'windCrow', name: '風羽鴉', hp: 1, elite: false, speed: 46, entries: ['edgeLeap'] },
  rainSpirit: { id: 'rainSpirit', name: '雨雲精', hp: 2, elite: false, speed: 26, entries: ['ceilingDrop'] },
  cometBug: { id: 'cometBug', name: '彗星蟲', hp: 2, elite: false, speed: 48, entries: ['platformWake', 'edgeLeap'] },
  mirrorWisp: { id: 'mirrorWisp', name: '鏡光靈', hp: 3, elite: true, speed: 32, entries: ['portalPop'] },
};

export const PVE_BOSSES: Record<PveBossId, PveBossContent> = {
  budshield: { id: 'budshield', name: '芽盾', baseHp: 20, extraHpPerPlayer: 6, mechanicSteps: 2, attacks: ['vineSweep', 'seedRain', 'shellStomp', 'summon'], counterTip: '踩亮兩個花苞，再攻擊背甲芽芯' },
  clangclang: { id: 'clangclang', name: '鏘鏘', baseHp: 24, extraHpPerPlayer: 6, mechanicSteps: 2, attacks: ['pistonPunch', 'magnetPull', 'gearRain', 'handClap'], counterTip: '依箭頭踩下左右斷電台' },
  rumble: { id: 'rumble', name: '轟隆', baseHp: 28, extraHpPerPlayer: 6, mechanicSteps: 2, attacks: ['gust', 'thunder', 'rainWall', 'summon'], counterTip: '踩亮兩個避雷台，再攻擊雷冠' },
  nightglow: { id: 'nightglow', name: '夜曜', baseHp: 32, extraHpPerPlayer: 8, mechanicSteps: 3, attacks: ['shadowBeam', 'orbitComet', 'phasePlatform', 'summon'], counterTip: '依序收集三枚星符，使星核實體化' },
};

export const PVE_BOSS_ATTACKS: Record<string, PveBossAttackContent> = {
  vineSweep: { name: '藤蔓橫掃', warning: '藤蔓將沿平台掃過，換到另一個高度帶' },
  seedRain: { name: '種子雨', warning: '離開發光落點' },
  shellStomp: { name: '龜殼震地', warning: '目標平台即將碎裂' },
  summon: { name: '召喚援軍', warning: '注意場景徵兆與小怪落點' },
  pistonPunch: { name: '活塞拳', warning: '手臂指向的平台即將受擊' },
  magnetPull: { name: '磁力牽引', warning: '反向操作抵抗拉力' },
  gearRain: { name: '齒輪雨', warning: '離開齒輪落點' },
  handClap: { name: '雙手拍擊', warning: '目標平台即將被夾碎' },
  gust: { name: '左右強風', warning: '觀察風向並反向操作' },
  thunder: { name: '三點落雷', warning: '離開閃電落點' },
  rainWall: { name: '降雨幕', warning: '穿過缺口，不要停在標記平台' },
  shadowBeam: { name: '暗影光束', warning: '光束鎖定的平台即將受擊' },
  orbitComet: { name: '軌道彗星', warning: '跟著弧線切換落點' },
  phasePlatform: { name: '平台相位', warning: '目標平台將暫時消失' },
};

export const PVE_ENTRY_TELEGRAPH_MS: Record<PveEnemyEntry, number> = {
  platformWake: 1_200,
  edgeLeap: 900,
  ceilingDrop: 1_100,
  portalPop: 1_300,
};

export function sceneForIndex(index: number): PveSceneId {
  return index < PVE_SCENE_ORDER.length ? PVE_SCENE_ORDER[index]! : 'rift';
}

export function bossForScene(sceneId: PveSceneId, loopTier: number): PveBossId {
  if (sceneId !== 'rift') return PVE_SCENES[sceneId].bossId;
  return PVE_BOSSES[PVE_SCENE_ORDER[loopTier % PVE_SCENE_ORDER.length] === 'garden' ? 'budshield'
    : PVE_SCENE_ORDER[loopTier % PVE_SCENE_ORDER.length] === 'workshop' ? 'clangclang'
      : PVE_SCENE_ORDER[loopTier % PVE_SCENE_ORDER.length] === 'rooftop' ? 'rumble' : 'nightglow'].id;
}
