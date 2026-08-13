import { TURN_MS, DND_BOSS_SEAT, DND_CLASS_MOVE, DND_CLASS_RANGE, DND_DIFFICULTY_MULTIPLIER, DND_EQUIPMENT_SPEC, DND_EQUIPMENT_NAME, type DndDifficulty, type DndEquipment, type PlayerId, type DndAction, type DndCellView, type DndSeatInfo, type DndPiece, type DndFx, type DndFxKind, type LogEvent, type DownstairsCharacterId, type DndClassId } from 'shared';

export type Seats = Array<PlayerId | null>;

export interface DndState {
  board: DndCellView[][];
  turnSeat: number;
  turnDeadline: number;
  over: boolean;
  seats: Record<number, DndSeatInfo>;
  ranking: PlayerId[];
  level: number;
  traps: Array<{ r: number; c: number; triggered: boolean }>;
  /** 法師【火牆】燒著的格子，turns 是還會燒幾回合 */
  fireWalls: Array<{ r: number; c: number; turns: number; dmg: number; hostile?: boolean }>;
  bossSpawned: boolean;
  turnHasMoved: boolean;
  /** B3 的虛空酋長是否已經在 1/4 血時召回一、二樓的 Boss（只會發動一次） */
  finalPhase: boolean;
  /** 難度，開局時定案。乘數同時吃在怪物的 HP、傷害與 AC 上。 */
  difficulty: DndDifficulty;
  /** 操控怪物的玩家座位（固定是 DND_BOSS_SEAT）；null 代表沒人當魔王，怪物全自動。 */
  bossSeat: number | null;
  /**
   * NPC 隊友（空位補上的角色）由誰操作；null 代表 AI 自動行動。
   * 單人房設成自己就等於同時操作 4 個角色。
   */
  npcController: PlayerId | null;
  /** 這一局是不是打贏了。over 為 false 時沒有意義。 */
  won: boolean;
  /** 進行到第幾輪。護送關的伏兵與補兵都靠它。 */
  roundCount: number;
  /** 護送關：已經獲救 / 半路陣亡的村民數。 */
  villagersRescued: number;
  villagersLost: number;
  /** B5 邪神：分身被清空後的空窗，>0 代表這幾輪不能再召喚，本體可以被打。 */
  godWindow: number;
  /** B5 邪神：是否已經進入奪舍階段（過半血）。 */
  godPhase2: boolean;
  /** B5 開場的信徒總數，用來判斷「清掉 3/4 了沒」。 */
  godMinionTotal: number;
  /** 現在輪到冒險者還是魔王。沒有魔王時恆為 'party'。 */
  phase: 'party' | 'boss';
  /** 這一輪已經用掉「移動」的怪物 id。 */
  monsterMoved: Set<string>;
  /** 這一輪已經用掉「行動」（攻擊／自動結算）的怪物 id —— 對牠來說這輪結束了。 */
  monsterActed: Set<string>;
  /**
   * 剛剛這一次行動裡發動的技能／被動，只給前端冒圖示用。
   * 每次 applyDndAction／魔王行動一進來就清空，所以快照裡永遠是「最新一次」的。
   */
  fx: DndFx[];
  /** B6：已經打碎幾個祭壇。其他層恆為 0。 */
  altarsDestroyed: number;
  /** B6：場上那隻虛空酋長的 id；null 代表現在沒有。用來偵測牠被打死了沒。 */
  gateChiefId: string | null;
  /** 術士【嗜魔鬥志】：還剩幾輪，隨從的傷害會被放大。 */
  allyRage: number;
}

/** 記一筆技能特效。同一個棋子同一種特效只記一次，避免連續觸發時圖示疊在一起。 */
function pushFx(state: DndState, pieceId: string, kind: DndFxKind): void {
  if (!state.fx.some((item) => item.pieceId === pieceId && item.kind === kind)) {
    state.fx.push({ pieceId, kind });
  }
}

export type DndError =
  | 'GAME_NOT_RUNNING'
  | 'NOT_YOUR_TURN'
  | 'INVALID_CELL'
  | 'CELL_OCCUPIED'
  | 'TARGET_OUT_OF_RANGE'
  | 'TARGET_NOT_FOUND'
  | 'BAD_ACTION'
  | 'ALREADY_MOVED'
  | 'SKILL_ON_COOLDOWN'
  | 'NOT_BOSS_TURN'
  | 'MONSTER_NOT_FOUND'
  | 'MONSTER_ALREADY_ACTED'
  | 'MONSTER_ALREADY_MOVED'
  | 'MONSTER_RESTRAINED'
  | 'MONSTER_CHARMED'
  | 'PLAYER_RESTRAINED'
  | 'TARGET_INVULNERABLE'
  | 'SUMMON_LIMIT'
  | 'SUMMON_EXHAUSTED';

export const DND_ERROR_MESSAGE: Record<DndError, string> = {
  GAME_NOT_RUNNING: '遊戲尚未開始或已結束',
  NOT_YOUR_TURN: '還沒輪到你行動',
  INVALID_CELL: '無效的移動座標',
  CELL_OCCUPIED: '該格子已被佔用',
  TARGET_OUT_OF_RANGE: '目標超出技能施放範圍',
  TARGET_NOT_FOUND: '找不到目標',
  BAD_ACTION: '無效的行動指令',
  ALREADY_MOVED: '這回合已經移動過了，只能選擇攻擊／技能／休息來結束回合',
  SKILL_ON_COOLDOWN: '技能還在冷卻中，這回合不能使用',
  NOT_BOSS_TURN: '現在不是魔王的怪物回合',
  MONSTER_NOT_FOUND: '找不到這隻怪物',
  MONSTER_ALREADY_ACTED: '這隻怪物這一輪已經行動過了',
  MONSTER_ALREADY_MOVED: '這隻怪物這一輪已經移動過了，只能選擇攻擊',
  MONSTER_RESTRAINED: '這隻怪物被網子纏住，這幾回合不能移動，但還可以攻擊',
  MONSTER_CHARMED: '這隻怪物被【魅惑】了，這幾回合不聽你的指揮',
  PLAYER_RESTRAINED: '你被邪神分身的羅網纏住，這幾回合不能移動，但還可以攻擊或使用技能',
  // B6 的祭壇與大門也會擋下攻擊，訊息不能再寫死成邪神
  TARGET_INVULNERABLE: '你的攻擊被一層看不見的東西彈開了',
  SUMMON_LIMIT: '你的隨從已經到達上限了',
  SUMMON_EXHAUSTED: '這一層樓的召喚次數已經用完了',
};

export const BOARD_SIZE = 16;

/** 座位固定 4 個（沒人坐的由 NPC 隊友補上），回合推進的繞圈判定一律以它為準。 */
const SEAT_COUNT = 4;

/**
 * 一次玩家動作最多推進幾「輪」。放逐最長 2 輪就會到期，正常情況一兩輪內
 * 就會找到下一位可行動的真人；跑滿代表全隊都動不了，直接判定冒險失敗。
 */
const MAX_ROUND_LAPS = 12;

export const CLASS_STATS: Record<DndClassId, { name: string; hp: number; ac: number; attackBonus: number; dmgDice: number; dmgFlat: number; description: string }> = {
  brave: { name: 'Knight (騎士)', hp: 24, ac: 14, attackBonus: 4, dmgDice: 8, dmgFlat: 2, description: '前線護盾。【鎖鏈】：把 3 格內的怪物或一名隊友拉到身旁。【反射】：受擊時把 1/3 傷害彈回攻擊者。【武勇】：各 1/3 機率暈眩／擊退／極限防禦 (移動3格)' },
  bubble: { name: 'Rogue (盜賊)', hp: 18, ac: 12, attackBonus: 5, dmgDice: 8, dmgFlat: 8, description: '突襲刺客，極高機動。【撒網】：把 5 格內的一隻怪物釘在原地 3 回合、每回合扣 1 HP（牠仍能攻擊；虛空酋長靠瞬移不受影響）。【弱點打擊】：各 1/2 機率降低目標 AC 或傷害 (移動6格)' },
  tangerine: { name: 'Mage (法師)', hp: 16, ac: 10, attackBonus: 3, dmgDice: 12, dmgFlat: 2, description: '遠程爆發，攻擊距離 3 格。【火牆】：拉出一道燒 2 回合的 3 格火牆。【法術侵蝕】：各 1/2 機率衝擊波（把目標震退 2 格）或束縛（3 回合不能動） (移動2格)' },
  star: { name: 'Cleric (牧師)', hp: 20, ac: 12, attackBonus: 3, dmgDice: 6, dmgFlat: 2, description: '隊伍的命脈。【神聖治癒】：補 3 格內隊友 4 點 HP。【神聖判官】：每次攻擊從目標汲取 1 點生命，自己回多少目標就扣多少 (移動2格)' },
  gladiator: { name: 'Gladiator (鬥士)', hp: 30, ac: 12, attackBonus: 4, dmgDice: 10, dmgFlat: 2, description: '血厚甲薄的前線輸出。【野蠻衝撞】：衝到 5 格內的目標身旁，造成 5 傷害並暈眩 1 回合。【嗜血】：命中時各 1/2 機率致命斬殺（傷害 ×1.2）或旋風（周圍 8 格各吃半刀） (移動3格)' },
  archer: { name: 'Archer (弓手)', hp: 18, ac: 12, attackBonus: 6, dmgDice: 8, dmgFlat: 2, description: '射程 5 格的後排輸出。【狙擊】：接下來 6 回合無視射程，帶弓時每次出手連射。【獵殺】：命中與否都各 1/2 機率放血（3 回合每回合 -1）或穿刺（射中時才會貫穿到目標正後方的怪） (移動3格)' },
  bard: { name: 'Bard (吟遊詩人)', hp: 18, ac: 12, attackBonus: 3, dmgDice: 6, dmgFlat: 3, description: '全隊的增益核心。【進擊之歌】：一回合內全隊傷害 +40%（冷卻 2 回合）。【即興吟唱】：出手時各 1/3 機率讓全隊 AC +3、命中 +2，或全體回 1 點 HP (移動3格)' },
  summoner: { name: 'Summoner (召喚術士)', hp: 20, ac: 12, attackBonus: 3, dmgDice: 6, dmgFlat: 2, description: '把敵人變成戰力的術士，攻擊距離 2 格。【魔物召喚】：召出 2 隻替你作戰的哥布林。【墮落低語】：出手時各 1/3 機率洗腦目標、讓牠魅惑後遊蕩 2 回合，或發動魂體轉化強化隨從 (移動2格)' },
};

/**
 * 主動技能的冷卻回合數。沒列的一律 1 回合 ——
 * 吟遊詩人的【進擊之歌】太強，收 2 回合。
 */
const SKILL_COOLDOWN: Partial<Record<DndClassId, number>> = {
  bard: 2,
};

const ALL_CLASSES: DndClassId[] = ['brave', 'bubble', 'tangerine', 'star', 'gladiator', 'archer', 'bard', 'summoner'];

function spawnTraps(state: DndState, count: number, rng: () => number) {
  state.traps = [];
  // 隊伍的出生格（棋盤是 16x16，不是 8x8）。生怪／擺人之後才會呼叫這裡，
  // 所以被佔用的格子本來就會被跳過，這份清單是換層時的第二道保險。
  const corners = ['15,6', '15,7', '15,8', '15,9'];
  let trapsSpawned = 0;
  let attempts = 0;
  
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (state.board[r]?.[c]) {
        state.board[r]![c]!.trapTriggered = false;
      }
    }
  }

  while (trapsSpawned < count && attempts < 200) {
    attempts++;
    const r = Math.floor(rng() * BOARD_SIZE);
    const c = Math.floor(rng() * BOARD_SIZE);
    const key = `${r},${c}`;
    if (corners.includes(key)) continue;
    const cell = state.board[r]?.[c];
    if (cell && cell.piece === null) {
      if (!state.traps.some((t) => t.r === r && t.c === c)) {
        state.traps.push({ r, c, triggered: false });
        trapsSpawned++;
      }
    }
  }
}

/**
 * 這隻棋子是不是「敵方怪物」。
 *
 * 召喚術士會召出／洗腦出站在我方的哥布林，牠們的 type 一樣是 'goblin'，
 * 靠 `ally` 旗標區分。凡是問「場上還有幾隻怪」「玩家能不能打它」「AI 該不該動它」
 * 的地方都要走這個函式，直接比對 type 會把我方單位一起算進去 ——
 * 那會讓清怪型的樓層永遠過不了關。
 */
function isHostile(piece: DndPiece | null | undefined): boolean {
  return !!piece && piece.type === 'goblin' && !piece.ally;
}

/** 站在冒險者這一邊的怪（召喚物與被洗腦的）。 */
function isAlly(piece: DndPiece | null | undefined): boolean {
  return !!piece && piece.type === 'goblin' && piece.ally === true;
}

function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
}

/**
 * 特殊怪物的模板。哥布林盜賊靠 speed 一次衝 5 格，哥布林法師靠 range 隔 3 格放法術，
 * runMonstersTurn 直接讀棋子上的欄位，不再用名字硬判。
 */
const GOBLIN_ROGUE = {
  name: 'Goblin Rogue (哥布林盜賊)',
  hp: 12,
  ac: 12,
  speed: 5,
  range: 1,
  attackBonus: 3,
  dmgDice: 6,
} as const;

const GOBLIN_MAGE = {
  name: 'Goblin Mage (哥布林法師)',
  hp: 10,
  ac: 10,
  speed: 1,
  range: 3,
  attackBonus: 3,
  dmgDice: 8,
} as const;

/** B6 的編成。菁英是原版的強化，英雄與巨魔靠 monsterPassive 帶被動。 */
const ELITE_GOBLIN_ROGUE = {
  name: 'Elite Goblin Rogue (菁英哥布林盜賊)',
  hp: 22, ac: 14, speed: 6, range: 1, attackBonus: 5, dmgDice: 8,
} as const;

const ELITE_GOBLIN_MAGE = {
  name: 'Elite Goblin Mage (菁英哥布林法師)',
  hp: 18, ac: 12, speed: 1, range: 4, attackBonus: 5, dmgDice: 10,
} as const;

/** 名字裡有「薩滿」就會自動吃到既有的治療／召喚 AI，不必另外寫分支。 */
const GOBLIN_SHAMAN = {
  name: 'Goblin Shaman (哥布林薩滿)',
  hp: 18, ac: 12, speed: 1, range: 3, attackBonus: 4, dmgDice: 8,
} as const;

const GOBLIN_HERO = {
  name: 'Goblin Hero (哥布林英雄)',
  hp: 24, ac: 14, speed: 2, range: 1, attackBonus: 4, dmgDice: 8,
  passive: 'hero',
} as const;

const TROLL = {
  name: 'Troll (巨魔)',
  hp: 40, ac: 13, speed: 2, range: 1, attackBonus: 4, dmgDice: 10,
  passive: 'troll',
} as const;

/** 召喚術士叫得出來的隨從。普通哥布林是沒有【召喚書】時的基本款。 */
const PLAIN_GOBLIN = {
  name: 'Goblin (召喚物)',
  hp: 16, ac: 11, speed: 2, range: 1, attackBonus: 2, dmgDice: 6,
} as const;

const ELITE_GOBLIN = {
  name: 'Elite Goblin (菁英哥布林)',
  hp: 24, ac: 13, speed: 2, range: 1, attackBonus: 4, dmgDice: 8,
} as const;

/** 祭壇每 3 輪吐出來的怪池 —— 全遊戲的非 Boss 怪。 */
const GATE_MONSTER_POOL = [
  GOBLIN_ROGUE, GOBLIN_MAGE,
  ELITE_GOBLIN_ROGUE, ELITE_GOBLIN_MAGE,
  GOBLIN_SHAMAN, GOBLIN_HERO, TROLL,
] as const;

interface MonsterTemplate {
  readonly name: string;
  readonly hp: number;
  readonly ac: number;
  readonly speed: number;
  readonly range: number;
  readonly attackBonus: number;
  readonly dmgDice: number;
  readonly passive?: 'void' | 'hero' | 'troll';
}

function makeGoblin(id: string, template: MonsterTemplate): DndPiece {
  return {
    id,
    type: 'goblin',
    name: template.name,
    hp: template.hp,
    maxHp: template.hp,
    ac: template.ac,
    speed: template.speed,
    range: template.range,
    attackBonus: template.attackBonus,
    dmgDice: template.dmgDice,
    ...(template.passive ? { monsterPassive: template.passive } : {}),
  };
}

/**
 * 依難度縮放怪物的 HP 與 AC。傷害是在攻擊時才乘（runMonstersTurn），
 * 因為傷害是每次擲骰算出來的，不像血量與護甲是掛在棋子上的固定值。
 */
function scaleMonster(piece: DndPiece, difficulty: DndDifficulty): DndPiece {
  const mult = DND_DIFFICULTY_MULTIPLIER[difficulty];
  if (mult === 1) return piece;
  piece.hp = Math.max(1, Math.round(piece.hp * mult));
  piece.maxHp = Math.max(1, Math.round(piece.maxHp * mult));
  piece.ac = Math.max(1, Math.round(piece.ac * mult));
  return piece;
}

/** 開局之後生怪一律走這裡，難度才不會漏掉某一種怪。 */
function spawnMonster(state: DndState, piece: DndPiece): DndPiece {
  return scaleMonster(piece, state.difficulty);
}

function findPieceById(state: DndState, id: string): { piece: DndPiece; r: number; c: number } | null {
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = state.board[r]?.[c]?.piece;
      if (piece?.id === id) return { piece, r, c };
    }
  }
  return null;
}

/** 護送關開場：在最底列的空格排出 10 個村民。素質比照牧師。 */
function spawnVillagers(state: DndState): void {
  const bottom = BOARD_SIZE - 1;
  let placed = 0;
  for (let c = 0; c < BOARD_SIZE && placed < VILLAGER_COUNT; c++) {
    const cell = state.board[bottom]?.[c];
    if (!cell || cell.piece !== null) continue;
    cell.piece = {
      id: `v-${placed}`,
      type: 'villager',
      name: `村民 ${placed + 1}`,
      hp: 20,
      maxHp: 20,
      ac: 12,
    };
    placed++;
  }
}

/**
 * 村民每輪往上跑一格。正上方被佔住就試左上／右上，都不行就原地不動。
 * 從第 0 列再往上就是跑出地圖 ＝ 獲救。
 *
 * 由上往下處理：走在前面的先讓開，後面的才跟得上，不然一路都會卡住。
 */
function moveVillagers(state: DndState): LogEvent[] {
  const events: LogEvent[] = [];

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = state.board[r]?.[c];
      const piece = cell?.piece;
      if (!piece || piece.type !== 'villager') continue;

      if (r === 0) {
        cell!.piece = null;
        state.villagersRescued++;
        events.push({ t: 'dndMessage', message: `🏃 ${piece.name} 逃出了地下城！（已獲救 ${state.villagersRescued} 人）` } as any);
        continue;
      }

      const tries = [{ r: r - 1, c }, { r: r - 1, c: c - 1 }, { r: r - 1, c: c + 1 }];
      for (const next of tries) {
        if (!inBounds(next.r, next.c)) continue;
        const target = state.board[next.r]?.[next.c];
        if (!target || target.piece !== null) continue;
        target.piece = piece;
        cell!.piece = null;
        break;
      }
    }
  }

  return events;
}

/** 場上還剩幾個村民。 */
function villagersOnBoard(state: DndState): number {
  let n = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (state.board[r]?.[c]?.piece?.type === 'villager') n++;
    }
  }
  return n;
}

/** 護送關每輪的加派：第 2 輪伏兵、之後每 3 輪從最底列補一隻盜賊。 */
function escortReinforcements(state: DndState, rng: () => number): LogEvent[] {
  const events: LogEvent[] = [];

  if (state.roundCount === ESCORT_AMBUSH_ROUND) {
    const ambush = [
      { r: 3, c: 3 }, { r: 3, c: 12 }, { r: 8, c: 3 },
      { r: 8, c: 12 }, { r: 5, c: 7 }, { r: 5, c: 8 },
    ];
    ambush.forEach((spot, idx) => {
      placeNear(state, spot.r, spot.c, spawnMonster(state, {
        id: `m-ambush-${idx}`, type: 'goblin', name: `Goblin ${String.fromCharCode(65 + idx)}`,
        hp: 16, maxHp: 16, ac: 11,
      }));
    });
    [{ r: 7, c: 2 }, { r: 7, c: 13 }, { r: 9, c: 7 }].forEach((spot, idx) => {
      placeNear(state, spot.r, spot.c, spawnMonster(state, makeGoblin(`m-ambush-rogue-${idx}`, GOBLIN_ROGUE)));
    });
    events.push({ t: 'dndMessage', message: '⚔️ 伏兵殺出！哥布林從四面八方湧向村民！' } as any);
    return events;
  }

  if (state.roundCount > ESCORT_AMBUSH_ROUND && state.roundCount % ESCORT_REINFORCE_EVERY === 0) {
    const bottom = BOARD_SIZE - 1;
    const rogue = spawnMonster(state, makeGoblin(`m-chase-${state.roundCount}`, GOBLIN_ROGUE));
    const start = Math.floor(rng() * BOARD_SIZE);
    for (let i = 0; i < BOARD_SIZE; i++) {
      const c = (start + i) % BOARD_SIZE;
      const cell = state.board[bottom]?.[c];
      if (cell && cell.piece === null) {
        cell.piece = rogue;
        events.push({ t: 'dndMessage', message: '🥷 又一隻哥布林盜賊從後方追了上來！' } as any);
        break;
      }
    }
  }

  return events;
}

/**
 * 護送關的結算：場上村民歸零就分勝負。
 * 救到門檻就生樓梯往下一層，沒救到就整局失敗。
 */
function resolveEscortLevel(seats: Seats, state: DndState, events: LogEvent[], rng: () => number): void {
  if (state.level !== ESCORT_LEVEL || state.over) return;
  if (villagersOnBoard(state) > 0) return;

  if (state.villagersRescued >= VILLAGER_RESCUE_TARGET) {
    const stairCell = findEmptyCellNearCenter(state);
    if (stairCell) {
      stairCell.piece = {
        id: 'staircase', type: 'staircase', name: '樓梯 (Stairs)', hp: 0, maxHp: 0, ac: 0,
      };
    }
    events.push({
      t: 'dndMessage',
      message: `🎉 護送任務成功！${state.villagersRescued} 位村民平安逃出，通往深處的樓梯出現了！`,
    } as any);
    awardEscortEquipment(seats, state, events, rng);
  } else {
    events.push({
      t: 'dndMessage',
      message: `💀 只有 ${state.villagersRescued} 位村民逃出來，村子沒能保住…`,
    } as any);
    state.over = true;
    state.won = false;
    state.ranking = rankDndSeats(seats, state);
    events.push({ t: 'dndOver', won: false });
  }
}

// ---------------------------------------------------------------------------
// B5 哥布林邪神
// ---------------------------------------------------------------------------

/** 從 (r,c) 的上下左右找一個空格；沒有就回 null。 */
function freeCellNextTo(state: DndState, r: number, c: number): { r: number; c: number } | null {
  const adj = [{ r: r - 1, c }, { r: r + 1, c }, { r, c: c - 1 }, { r, c: c + 1 }];
  for (const pos of adj) {
    if (!inBounds(pos.r, pos.c)) continue;
    if (state.board[pos.r]?.[pos.c]?.piece === null) return pos;
  }
  return null;
}

/** 場上的雜兵數（邪神本體與分身不算）。 */
function countMinions(state: DndState): number {
  let n = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = state.board[r]?.[c]?.piece;
      if (isHostile(piece) && !piece!.id.startsWith('boss-5')) n++;
    }
  }
  return n;
}

/** 場上同時存在的分身數。 */
const GOD_COPY_COUNT = 2;
/** 分身被清空之後，邪神有幾輪不能召喚（也就是可以被打的空窗）。 */
const GOD_WINDOW_ROUNDS = 2;
/** 血量掉到這個比例以下進入奪舍階段。 */
const GOD_PHASE2_RATIO = 0.5;

function godCopies(state: DndState): Array<{ piece: DndPiece; r: number; c: number }> {
  const found: Array<{ piece: DndPiece; r: number; c: number }> = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = state.board[r]?.[c]?.piece;
      if (piece?.id.startsWith('boss-5-copy')) found.push({ piece, r, c });
    }
  }
  return found;
}

/**
 * 照著冒險者的模樣捏出分身：血量、防禦、職業都照抄（含裝備加成後的數值），
 * 所以隊伍越強、分身越難打。分身會用被複製職業的技能。
 */
function summonGodCopies(seats: Seats, state: DndState, rng: () => number): LogEvent[] {
  const events: LogEvent[] = [];
  const boss = findPieceById(state, 'boss-5');
  if (!boss) return events;

  const living: DndPiece[] = [];
  for (let seat = 0; seat < SEAT_COUNT; seat++) {
    if (!state.seats[seat]?.alive) continue;
    const piece = findSeatPiece(seats, state, seat)?.piece;
    if (piece) living.push(piece);
  }
  if (living.length === 0) return events;

  const missing = GOD_COPY_COUNT - godCopies(state).length;
  for (let i = 0; i < missing; i++) {
    const model = living[Math.floor(rng() * living.length)]!;
    const classId = (model.classId ?? 'brave') as DndClassId;
    const copy: DndPiece = {
      id: `boss-5-copy-${state.roundCount}-${i}-${Math.floor(rng() * 10000)}`,
      type: 'goblin',
      name: `邪神分身（${CLASS_STATS[classId].name.split(' ')[1] ?? classId}）`,
      hp: model.maxHp,
      maxHp: model.maxHp,
      ac: model.ac,
      copyClass: classId,
      attackBonus: CLASS_STATS[classId].attackBonus,
      dmgDice: CLASS_STATS[classId].dmgDice,
      range: DND_CLASS_RANGE[classId as DndClassId] ?? 1,
      speed: DND_CLASS_MOVE[classId],
    };
    if (placeNear(state, boss.r, boss.c, copy)) {
      events.push({ t: 'dndMessage', kind: 'skill', message: `🪞 邪神捏出了一個${copy.name}！` } as any);
    }
  }
  return events;
}

/**
 * 邪神的每輪維護：免疫開關、空窗倒數、補分身，以及過半血之後的奪舍。
 * 免疫直接寫在棋子上，攻擊結算讀那個旗標就好。
 */
function updateEvilGod(seats: Seats, state: DndState, rng: () => number): LogEvent[] {
  const events: LogEvent[] = [];
  const boss = findPieceById(state, 'boss-5');
  if (!boss) return events;

  const phase2 = boss.piece.hp <= boss.piece.maxHp * GOD_PHASE2_RATIO;
  if (phase2 && !state.godPhase2) {
    state.godPhase2 = true;
    events.push({
      t: 'dndMessage', kind: 'skill',
      message: '🌀 邪神的軀殼裂開了 —— 它開始在分身之間流竄。',
    } as any);
  }

  // 分身清空後開一段空窗，期間不能召喚
  if (godCopies(state).length === 0) {
    if (state.godWindow > 0) {
      state.godWindow--;
      if (state.godWindow === 0) {
        events.push(...summonGodCopies(seats, state, rng));
      } else {
        events.push({ t: 'dndMessage', kind: 'skill', message: `💢 邪神還捏不出新的分身 —— 還有 ${state.godWindow} 輪！` } as any);
      }
    } else {
      state.godWindow = GOD_WINDOW_ROUNDS;
      events.push({
        t: 'dndMessage', kind: 'skill',
        message: '💥 分身全被打碎了！邪神身上的光芒黯了下來。',
      } as any);
    }
  }

  // 奪舍：把本體的身分（連同血量）搬到某個分身的位置上。
  // 血量跟著走，血條就是「哪一個才是本體」的線索。
  if (phase2) {
    const copies = godCopies(state);
    if (copies.length > 0) {
      const target = copies[Math.floor(rng() * copies.length)]!;
      const bossCell = state.board[boss.r]?.[boss.c];
      const copyCell = state.board[target.r]?.[target.c];
      if (bossCell && copyCell) {
        bossCell.piece = target.piece;
        copyCell.piece = boss.piece;
        pushFx(state, boss.piece.id, 'possess');
        events.push({ t: 'dndMessage', kind: 'skill', message: '🌀 邪神換了一具身體 —— 你分不清剛才打的是哪一個了。' } as any);
      }
    }
  }

  // 免疫只在前半場成立；奪舍階段本體是打得到的
  boss.piece.invulnerable = !phase2 && godCopies(state).length > 0;

  return events;
}

/**
 * 邪神本體的攻擊被動：命中時三選一，各 1/3。
 * 【錯位】與目標交換位置／【震懾】暈眩一回合／【彈飛】把目標往後推 3 格。
 */
function evilGodPassive(
  state: DndState,
  mon: { piece: DndPiece; r: number; c: number },
  victim: { piece: DndPiece; r: number; c: number; seat: number },
  rng: () => number,
): LogEvent[] {
  const events: LogEvent[] = [];
  const who = victim.piece.name.split(' ')[0];
  const roll = Math.floor(rng() * 3);

  if (roll === 0) {
    // 錯位是把人扯到「某個分身」的位置上 —— 跟本體交換沒有意義，
    // 它本來就貼著你打，換完還是面對面。
    const copies = godCopies(state);
    if (copies.length === 0) {
      events.push({ t: 'dndMessage', kind: 'skill', message: '🌀 邪神想扭曲空間，但場上沒有分身可以替換。' } as any);
      return events;
    }

    const swapWith = copies[Math.floor(rng() * copies.length)]!;
    const copyCell = state.board[swapWith.r]?.[swapWith.c];
    const victimCell = state.board[victim.r]?.[victim.c];
    if (copyCell && victimCell) {
      copyCell.piece = victim.piece;
      victimCell.piece = swapWith.piece;
      victim.r = swapWith.r;
      victim.c = swapWith.c;
      pushFx(state, victim.piece.id, 'swap');
      events.push({
        t: 'dndMessage', kind: 'skill',
        message: `🌀 邪神扭曲了空間，把 ${who} 跟 ${swapWith.piece.name} 對調了位置！`,
      } as any);
    }
    return events;
  }

  if (roll === 1) {
    const seatInfo = victim.seat >= 0 ? state.seats[victim.seat] : undefined;
    if (seatInfo) {
      seatInfo.stunnedTurns = 1;
      pushFx(state, victim.piece.id, 'stun');
      events.push({ t: 'dndMessage', kind: 'skill', message: `💫 ${who} 被震懾了，下一個回合無法行動！` } as any);
    }
    return events;
  }

  // 彈飛：沿著「邪神 → 目標」的方向推 3 格
  if (!shoveAway(state, mon, victim, 3)) {
    events.push({ t: 'dndMessage', kind: 'skill', message: `💢 邪神想把 ${who} 彈飛，但身後沒有空間！` } as any);
    return events;
  }
  pushFx(state, victim.piece.id, 'knockback');
  events.push({ t: 'dndMessage', kind: 'skill', message: `💨 ${who} 被邪神一掌轟飛了出去！` } as any);
  return events;
}

/**
 * 沿著「攻擊者 → 目標」的方向把目標推開 N 格，撞到邊界或別的棋子就停在前一格。
 * 推得動回傳 true 並就地更新 victim 的座標；一格都推不動回傳 false。
 * 邪神的彈飛、巨魔的重擊、哥布林英雄的恐懼都走這一份。
 */
function shoveAway(
  state: DndState,
  from: { r: number; c: number },
  victim: { piece: DndPiece; r: number; c: number },
  distance: number,
): boolean {
  const dr = Math.sign(victim.r - from.r);
  const dc = Math.sign(victim.c - from.c);
  if (dr === 0 && dc === 0) return false;

  let landedR = victim.r;
  let landedC = victim.c;
  for (let step = 0; step < distance; step++) {
    const nr = landedR + dr;
    const nc = landedC + dc;
    if (!inBounds(nr, nc) || state.board[nr]?.[nc]?.piece !== null) break;
    landedR = nr;
    landedC = nc;
  }
  if (landedR === victim.r && landedC === victim.c) return false;

  state.board[victim.r]![victim.c]!.piece = null;
  state.board[landedR]![landedC]!.piece = victim.piece;
  victim.r = landedR;
  victim.c = landedC;
  return true;
}

/**
 * B6 新怪的攻擊被動。
 * - 哥布林英雄：1/2 暈眩一回合、1/2 把人嚇退一格
 * - 巨魔：一掌把人打飛 5 格
 */
function b6MonsterPassive(
  state: DndState,
  mon: { piece: DndPiece; r: number; c: number },
  victim: { piece: DndPiece; r: number; c: number; seat: number },
  rng: () => number,
): LogEvent[] {
  const events: LogEvent[] = [];
  const who = victim.piece.name.split(' ')[0];

  if (mon.piece.monsterPassive === 'troll') {
    if (!shoveAway(state, mon, victim, 5)) {
      events.push({ t: 'dndMessage', kind: 'skill', message: `💢 巨魔想把 ${who} 打飛，但身後沒有空間！` } as any);
      return events;
    }
    pushFx(state, victim.piece.id, 'knockback');
    events.push({ t: 'dndMessage', kind: 'skill', message: `💨 巨魔一記橫掃，把 ${who} 轟飛了 5 格！` } as any);
    return events;
  }

  // 哥布林英雄
  if (Math.floor(rng() * 2) === 0) {
    const seatInfo = victim.seat >= 0 ? state.seats[victim.seat] : undefined;
    if (seatInfo) {
      seatInfo.stunnedTurns = 1;
      pushFx(state, victim.piece.id, 'stun');
      events.push({ t: 'dndMessage', kind: 'skill', message: `💫 哥布林英雄的盾擊震暈了 ${who}，下一回合無法行動！` } as any);
    }
    return events;
  }

  if (!shoveAway(state, mon, victim, 1)) {
    events.push({ t: 'dndMessage', kind: 'skill', message: `😱 ${who} 想後退，但身後已經無路可退！` } as any);
    return events;
  }
  pushFx(state, victim.piece.id, 'fear');
  events.push({ t: 'dndMessage', kind: 'skill', message: `😱 哥布林英雄的威壓讓 ${who} 踉蹌退開了一格！` } as any);
  return events;
}

/**
 * 分身使用被複製職業的技能。回傳空陣列代表這回合沒放技能，交還給一般的攻擊／移動邏輯。
 *
 * - 法師：鋪一道燒冒險者的火牆（hostile）
 * - 牧師：幫附近受傷的怪物補血
 * - 盜賊：對 5 格內的冒險者撒網，纏住不能移動
 * - 騎士：沒有主動技能，反射寫在受擊那一側
 */
function runCopySkill(
  seats: Seats,
  state: DndState,
  mon: { piece: DndPiece; r: number; c: number },
  rng: () => number,
): LogEvent[] {
  const events: LogEvent[] = [];
  // 兩輪放一次，不然分身會變成無限控場
  if (state.roundCount % 2 !== 0) return events;

  const nearestHero = () => {
    let best: { piece: DndPiece; r: number; c: number; seat: number } | null = null;
    let bestDist = 9999;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const piece = state.board[r]?.[c]?.piece;
        if (!piece || piece.type !== 'player') continue;
        const seat = seatIndexOfPiece(seats, piece);
        if (seat === -1 || !state.seats[seat]?.alive) continue;
        const dist = Math.abs(mon.r - r) + Math.abs(mon.c - c);
        if (dist < bestDist) { bestDist = dist; best = { piece, r, c, seat }; }
      }
    }
    return best ? { ...best, dist: bestDist } : null;
  };

  if (mon.piece.copyClass === 'tangerine') {
    const hero = nearestHero();
    if (!hero || hero.dist > FIRE_WALL_RANGE + 1) return events;
    // 直接把火牆蓋在對方腳下
    for (const cell of [{ r: hero.r, c: hero.c }, { r: hero.r - 1, c: hero.c }, { r: hero.r + 1, c: hero.c }]) {
      if (!inBounds(cell.r, cell.c)) continue;
      const existing = state.fireWalls.find((w) => w.r === cell.r && w.c === cell.c);
      if (existing) { existing.turns = FIRE_WALL_TURNS; existing.hostile = true; }
      else state.fireWalls.push({ r: cell.r, c: cell.c, turns: FIRE_WALL_TURNS, dmg: FIRE_WALL_DAMAGE, hostile: true });
    }
    events.push({ t: 'dndMessage', message: `🔥 ${mon.piece.name} 在 ${hero.piece.name.split(' ')[0]} 腳下燃起了火牆！` } as any);
    return events;
  }

  if (mon.piece.copyClass === 'star') {
    let wounded: DndPiece | null = null;
    let bestDist = 9999;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const piece = state.board[r]?.[c]?.piece;
        if (!piece || piece.type !== 'goblin' || piece.id === mon.piece.id) continue;
        if (piece.hp >= piece.maxHp) continue;
        const dist = Math.abs(mon.r - r) + Math.abs(mon.c - c);
        if (dist <= CLERIC_HEAL_RANGE && dist < bestDist) { bestDist = dist; wounded = piece; }
      }
    }
    if (!wounded) return events;
    wounded.hp = Math.min(wounded.maxHp, wounded.hp + CLERIC_HEAL_AMOUNT);
    events.push({
      t: 'dndAttack', player: mon.piece.name, target: wounded.name,
      roll: 0, hit: true, damage: -CLERIC_HEAL_AMOUNT,
    });
    return events;
  }

  if (mon.piece.copyClass === 'bubble') {
    const hero = nearestHero();
    if (!hero || hero.dist > ROGUE_NET_RANGE) return events;
    const seatInfo = state.seats[hero.seat];
    if (!seatInfo || (seatInfo.restrainedTurns ?? 0) > 0) return events;
    seatInfo.restrainedTurns = ROGUE_NET_TURNS;
    events.push({
      t: 'dndMessage', kind: 'skill',
      message: `🕸️ ${mon.piece.name} 甩出羅網，${hero.piece.name.split(' ')[0]} 接下來 ${ROGUE_NET_TURNS} 回合無法移動！`,
    } as any);
    return events;
  }

  return events;
}

/** 從 (r,c) 一圈一圈往外找空格擺棋子，找不到就退回場中央。 */
function placeNear(state: DndState, r: number, c: number, piece: DndPiece): boolean {
  for (let radius = 1; radius <= 4; radius++) {
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (!inBounds(nr, nc)) continue;
        const cell = state.board[nr]?.[nc];
        if (cell && cell.piece === null) {
          cell.piece = piece;
          return true;
        }
      }
    }
  }
  const fallback = findEmptyCellNearCenter(state);
  if (!fallback) return false;
  fallback.piece = piece;
  return true;
}

/**
 * 虛空酋長掉到 1/4 血時的最終階段：把一樓的督軍與二樓的大薩滿一起召回戰場。
 * 只發生一次，用 state.finalPhase 記著。召回的是同樣的 id，所以督軍照樣會分裂、
 * 大薩滿照樣會治療與召喚 —— 牠們的機制原封不動跟著回來。
 */
function checkBossFinalPhase(state: DndState, rng: () => number): LogEvent[] {
  if (state.finalPhase) return [];
  const boss = findPieceById(state, 'boss-3');
  if (!boss || boss.piece.hp > boss.piece.maxHp / 4) return [];

  state.finalPhase = true;
  const events: LogEvent[] = [
    { t: 'dndMessage', message: '☠️ 虛空酋長重傷嘶吼，撕開了通往上層的裂隙！' } as any,
  ];

  const warlord = spawnMonster(state, {
    id: 'boss-1', type: 'goblin', name: 'Goblin Warlord (督軍)', hp: 35, maxHp: 35, ac: 12,
  });
  const shaman = spawnMonster(state, {
    id: 'boss-2', type: 'goblin', name: 'Goblin High Shaman (大薩滿)', hp: 50, maxHp: 50, ac: 13,
  });

  if (placeNear(state, boss.r, boss.c, warlord)) {
    events.push({ t: 'dndMessage', message: '⚔️ Goblin Warlord (督軍) 從裂隙中再度現身！' } as any);
  }
  if (placeNear(state, boss.r, boss.c, shaman)) {
    events.push({ t: 'dndMessage', message: '🔮 Goblin High Shaman (大薩滿) 從裂隙中再度現身！' } as any);
  }

  return events;
}

const DEBUFF_TURNS = 2;
/** 法師被動【破魔】把目標的 AC 打成原本的七成。 */
/** 法師【衝擊波】把目標往後推幾格。 */
const MAGE_SHOCK_PUSH = 2;
/** 法師被動【束縛】綁住的回合數（純定身，不扣血）。 */
const MAGE_BIND_TURNS = 3;
const DEBUFF_RATIO = 0.6;

/** 地城總層數。護送關是第 3 層，虛空酋長挪到第 4 層。 */
const MAX_LEVEL = 6;

/** 護送關（B3）的設定。 */
const ESCORT_LEVEL = 3;

/** B6「異世界大門」：拆祭壇關門的最終層。過關條件不是清怪，怪會一直補。 */
const GATE_LEVEL = 6;
const ALTAR_COUNT = 4;
const ALTAR_HP = 40;
const ALTAR_AC = 10;
/** 每幾輪，每個還立著的祭壇各吐一隻怪。 */
const GATE_SPAWN_EVERY = 3;
/** 每幾輪生一隻虛空酋長（場上已經有一隻就跳過）。 */
const GATE_CHIEF_EVERY = 5;
/** 打碎一個祭壇時，聖物腐化幾回合。 */
const RELIC_CORRUPT_TURNS = 3;
const VILLAGER_COUNT = 10;
/** 救到這個數字（含）就過關，跟裝備獎勵的階梯對齊。 */
const VILLAGER_RESCUE_TARGET = 5;
/** 第幾輪出現伏兵。 */
const ESCORT_AMBUSH_ROUND = 2;
/** 每幾輪從最底列補一隻哥布林盜賊。 */
const ESCORT_REINFORCE_EVERY = 3;

/** 這個座位身上的裝備規格；沒裝備回 null。 */
function equipmentOf(state: DndState, seat: number) {
  const info = state.seats[seat];
  // 【聖物腐化】：腐化期間裝備的特殊效果與命中加值整包失效
  // （AC／HP 的 +N 是發裝備當下就算進去的固定值，不在這裡）
  if (info?.corruptedTurns && info.corruptedTurns > 0) return null;
  const equipment = info?.equipment;
  return equipment ? DND_EQUIPMENT_SPEC[equipment.tier] : null;
}

/** 職業基礎命中 + 裝備的命中加值（就是需求說的「敏捷」）。 */
function attackBonusOf(seats: Seats, state: DndState, seat: number, classId: DndClassId): number {
  const info = state.seats[seat];
  const focus = info?.hitBuffTurns ? (info.hitBuffAmount ?? 0) : 0;
  return CLASS_STATS[classId].attackBonus
    + (equipmentOf(state, seat)?.stat ?? 0)
    + (info?.statBonus ?? 0)
    + focus
    + bardAuraOf(seats, state);
}

/** 冒險者現在的有效 AC：棋子上的值 + 大地之歌 + 里拉琴光環。 */
function effectiveAc(seats: Seats, state: DndState, piece: DndPiece, seat: number): number {
  const info = seat >= 0 ? state.seats[seat] : undefined;
  const earth = info?.acBuffTurns ? (info.acBuffAmount ?? 0) : 0;
  return piece.ac + earth + bardAuraOf(seats, state);
}

/** 冒險者這一刀的傷害倍率：進擊之歌。 */
function damageBuffOf(state: DndState, seat: number): number {
  const info = state.seats[seat];
  return info?.dmgBuffTurns ? (info.dmgBuffRatio ?? 0) : 0;
}

/**
 * 護送關的獎勵：依獲救人數隨機挑幾個還活著的隊員發裝備。
 * 5/6/7/8 人 → 1/2/3/4 件；簡單難度不發。
 */
function awardEscortEquipment(
  seats: Seats,
  state: DndState,
  events: LogEvent[],
  rng: () => number,
): void {
  if (state.difficulty === 'easy') {
    events.push({ t: 'dndMessage', message: '（簡單難度不會掉落裝備，想拿裝備請挑一般以上的難度）' } as any);
    return;
  }

  const tier = state.difficulty as Exclude<DndDifficulty, 'easy'>;
  const count = Math.min(4, Math.max(0, state.villagersRescued - 4));
  if (count === 0) return;

  // 還活著、而且還沒有裝備的座位才進抽獎池
  const pool: number[] = [];
  for (let seat = 0; seat < SEAT_COUNT; seat++) {
    const info = state.seats[seat];
    if (info?.alive && !info.equipment) pool.push(seat);
  }

  for (let i = 0; i < count && pool.length > 0; i++) {
    const pick = Math.floor(rng() * pool.length);
    const seat = pool.splice(pick, 1)[0]!;
    const info = state.seats[seat]!;
    const piece = findSeatPiece(seats, state, seat)?.piece;
    const classId = (piece?.classId ?? 'brave') as DndClassId;
    const spec = DND_EQUIPMENT_SPEC[tier];

    info.equipment = { kind: classId, tier } satisfies DndEquipment;
    // 共通加值：防禦、HP（當前與上限一起加）、命中
    info.maxHp += spec.stat;
    info.hp += spec.stat;
    if (piece) {
      piece.maxHp += spec.stat;
      piece.hp += spec.stat;
      piece.ac += spec.stat;
      if (piece.acBase !== undefined) piece.acBase += spec.stat;
    }

    // 【反射盾】：反射比例之外，AC 與 HP 再各加一份（共通加值之上再疊）
    if (classId === 'brave') {
      const bonus = spec.shieldBonus;
      info.maxHp += bonus;
      info.hp += bonus;
      if (piece) {
        piece.maxHp += bonus;
        piece.hp += bonus;
        piece.ac += bonus;
        if (piece.acBase !== undefined) piece.acBase += bonus;
      }
    }

    // 【巨劍·堅韌】：HP 加幾成、AC 加一個固定值。
    // 這兩個都是發裝備當下就算進去的，不隨腐化來回變動。
    if (classId === 'gladiator') {
      const hpGain = Math.round(info.maxHp * spec.toughness);
      info.maxHp += hpGain;
      info.hp += hpGain;
      if (piece) {
        piece.maxHp += hpGain;
        piece.hp += hpGain;
        piece.ac += spec.bladeAc;
        if (piece.acBase !== undefined) piece.acBase += spec.bladeAc;
      }
    }

    if (classId === 'bubble') {
      info.stealth = true;
      if (piece) piece.stealth = true;
    }

    events.push({
      t: 'dndMessage',
      message: `🎁 ${info.name ?? `P${seat + 1}`} 獲得了【${DND_EQUIPMENT_NAME[classId]}】！`
        + `防禦 +${spec.stat}、HP +${spec.stat}、命中 +${spec.stat}；${equipmentEffectText(classId, tier)}`,
    } as any);
  }
}

/** 每件裝備除了共通加值以外的效果，直接寫進戰報，玩家才知道自己拿到什麼。 */
function equipmentEffectText(classId: DndClassId, tier: Exclude<DndDifficulty, 'easy'>): string {
  const spec = DND_EQUIPMENT_SPEC[tier];
  switch (classId) {
    case 'brave':
      return `AC 與 HP 再各 +${spec.shieldBonus}，【鎖鏈】改成把 ${spec.chainRange} 格內的怪物全部拖過來，`
        + `【反射】再 +${Math.round(spec.reflect * 100)}%`;
    case 'tangerine':
      return `【火牆】變成 ${spec.fireWallSize}×${spec.fireWallSize}、每回合多燒 ${spec.fireWallDamage} 點`;
    case 'star':
      return `【神聖治癒】主目標 ${spec.healMain} 點、其他隊員各 ${spec.healSplash} 點，`
        + `【神聖判官】汲取量提升到 ${spec.healSelfOnAttack} 點`;
    case 'gladiator':
      return `【堅韌】HP +${Math.round(spec.toughness * 100)}%、AC +${spec.bladeAc}，`
        + `休息時多回復 ${spec.restBonus} 點，【旋風】倍率提升到 ${spec.whirlwind}`;
    case 'archer':
      return `【連射】在【狙擊】窗口期間每次出手都射 ${spec.sniperShots} 箭，【放血】每回合多扣 ${spec.bleedBonus} 點，`
        + `受擊時 ${Math.round(spec.decoyChance * 100)}% 機率留下一個【殘影】替身`;
    case 'bard':
      return `全隊的 AC／傷害／命中常駐 +${spec.bardAura}，三首歌的效果也各再 +${spec.songBonus}`;
    case 'summoner':
      return `召喚上限 +${spec.summonBonus}，並解鎖更強的隨從`;
    case 'bubble':
      return `普通攻擊不論命中與否都追加「命中骰 ×${spec.diceRatio}」的傷害，`
        + `【撒網】多綁 ${spec.netBonusTurns} 回合、每回合多扣 ${spec.netBonusDamage} 點，`
        + `並獲得【匿蹤】：出手前怪物不會主動找上你，休息一回合就能再隱匿`;
    default:
      return '';
  }
}

/**
 * 盜賊【匿蹤】（【骰子匕首】附帶）：進入／解除／查詢。
 * 座位是來源（換樓層棋子會重生），棋子上的旗標只是給 AI 與前端讀的鏡像。
 */
function setStealth(seats: Seats, state: DndState, seat: number, on: boolean): void {
  const info = state.seats[seat];
  if (!info || info.equipment?.kind !== 'bubble') return;
  info.stealth = on;
  const piece = findSeatPiece(seats, state, seat)?.piece;
  if (piece) piece.stealth = on;
}

/** 這個棋子現在是不是匿蹤中（怪物找目標時要跳過）。 */
function isHidden(seats: Seats, state: DndState, piece: DndPiece): boolean {
  const seat = seatIndexOfPiece(seats, piece);
  // 匿蹤是【骰子匕首】給的，聖物被腐化的期間當然也藏不住
  if (seat !== -1 && state.seats[seat]?.corruptedTurns) return false;
  if (piece.stealth) return true;
  return seat !== -1 && state.seats[seat]?.stealth === true;
}

/** 盜賊【撒網】的射程與拘束回合數。 */
/**
 * 法師的攻擊被動：二選一，各 1/2。
 * 【破魔】AC 掉到七成／【束縛】3 回合不能移動（只定身，不造成持續傷害）。
 */
function magePassive(
  state: DndState,
  mage: DndPiece,
  mr: number,
  mc: number,
  target: { piece: DndPiece; r: number; c: number },
  rng: () => number,
): LogEvent[] {
  const who = mage.name.split(' ')[0];

  // 【衝擊波】：把目標往後推兩格。推人的邏輯跟邪神的彈飛、巨魔的重擊共用同一份。
  if (Math.floor(rng() * 2) === 0) {
    if (!shoveAway(state, { r: mr, c: mc }, target, MAGE_SHOCK_PUSH)) {
      return [{ t: 'dndMessage', kind: 'skill', message: `💢 ${who} 的【衝擊波】撞上了 ${target.piece.name}，但牠身後沒有退路！` } as any];
    }
    pushFx(state, target.piece.id, 'knockback');
    return [{
      t: 'dndMessage', kind: 'skill',
      message: `🌊 ${who} 的【衝擊波】把 ${target.piece.name} 震退了 ${MAGE_SHOCK_PUSH} 格！`,
    } as any];
  }

  const targetPiece = target.piece;

  // 束縛只定身，不像撒網會持續扣血；但盜賊可能先網住了同一隻怪，
  // 蓋掉他的回合數與持續傷害等於幫怪解 debuff，所以只往長的取、傷害留著。
  targetPiece.trappedTurns = Math.max(targetPiece.trappedTurns ?? 0, MAGE_BIND_TURNS);
  targetPiece.netDamage = targetPiece.netDamage ?? 0;
  pushFx(state, targetPiece.id, 'bind');
  return [{
    t: 'dndMessage', kind: 'skill',
    message: `🪢 ${who} 的【束縛】纏住了 ${targetPiece.name}，接下來 ${MAGE_BIND_TURNS} 回合牠無法移動！`,
  } as any];
}

const ROGUE_NET_RANGE = 5;
const ROGUE_NET_TURNS = 3;

/**
 * 這隻怪的位置是不是被網子綁住了。
 * 虛空酋長靠的是瞬間移動而不是雙腳，網子對牠只有持續傷害，擋不住牠的位移。
 */
/**
 * 有沒有虛空之力（放逐／召喚／恐懼＋瞬移，撒網也綁不住位置）。
 * B4 的酋長是固定 id，B6 的大門會一直生出新的，所以旗標與 id 都認。
 */
function hasVoidPowers(piece: DndPiece): boolean {
  return piece.id === 'boss-3' || piece.monsterPassive === 'void';
}

function isRestrained(piece: DndPiece): boolean {
  if (hasVoidPowers(piece)) return false;
  return !!(piece.trappedTurns && piece.trappedTurns > 0);
}

/**
 * 把場上血量歸零的怪從棋盤上清掉。
 * 鬥士【旋風】與弓手【穿刺】會打到主目標以外的怪，那些死亡不會經過
 * 攻擊分支的收屍流程 —— 統一在這裡掃一次，有人倒下才呼叫一次 Boss／樓梯檢查。
 */
function sweepDeadMonsters(seats: Seats, state: DndState, rng: () => number): LogEvent[] {
  const events: LogEvent[] = [];
  let died = false;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = state.board[r]?.[c]?.piece;
      if (piece && piece.type === 'goblin' && piece.hp <= 0) {
        state.board[r]![c]!.piece = null;
        events.push({ t: 'dndMessage', message: `💀 ${piece.name} 倒下了！` } as any);
        died = true;
      }
    }
  }
  if (died) checkAndSpawnBossOrStaircase(seats, state, events, rng);
  return events;
}

/**
 * 弓手【殘影】：帶著【弓箭】的弓手被攻擊時，依機率在身旁生出一個分身。
 * 分身不移動也不攻擊，但怪物會把它算成目標之一 —— 場上同時只會有一個。
 */
function tryArcherDecoy(
  seats: Seats,
  state: DndState,
  victim: { piece: DndPiece; r: number; c: number; seat: number },
  rng: () => number,
): LogEvent[] {
  const events: LogEvent[] = [];
  if (victim.piece.classId !== 'archer' || victim.seat < 0) return events;

  const bow = equipmentOf(state, victim.seat);
  if (!bow) return events;
  if (rng() >= bow.decoyChance) return events;

  // 上限固定 1 個 —— 站著不動的替身不該多到能把弓手圍起來
  if (findPieceOfType(state, 'decoy')) return events;

  const spot = freeCellNextTo(state, victim.r, victim.c);
  if (!spot) return events;

  state.board[spot.r]![spot.c]!.piece = {
    id: `decoy-${victim.seat}-${state.roundCount}-${Math.floor(rng() * 1000)}`,
    type: 'decoy',
    name: `${victim.piece.name.split(' ')[0]} 的殘影`,
    hp: ARCHER_DECOY_HP,
    maxHp: ARCHER_DECOY_HP,
    ac: ARCHER_DECOY_AC,
  };
  pushFx(state, victim.piece.id, 'decoy');
  events.push({
    t: 'dndMessage', kind: 'skill',
    message: `👥 ${victim.piece.name.split(' ')[0]} 的身形一晃，留下了一個【殘影】頂在原地！`,
  } as any);
  return events;
}

/** 找場上第一個指定型別的棋子。 */
function findPieceOfType(state: DndState, type: DndPiece['type']): { piece: DndPiece; r: number; c: number } | null {
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = state.board[r]?.[c]?.piece;
      if (piece?.type === type) return { piece, r, c };
    }
  }
  return null;
}

/** 場上任意一隻可以被打的怪（弓手多餘的箭要找地方去）。 */
function findAnyMonster(state: DndState): { piece: DndPiece; r: number; c: number } | null {
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = state.board[r]?.[c]?.piece;
      if (isHostile(piece) && piece!.hp > 0 && !piece!.invulnerable) {
        return { piece: piece!, r, c };
      }
    }
  }
  return null;
}

/** 召喚術士：基礎召喚數與上限，【召喚書】會把上限往上加。 */
const SUMMON_BASE_CAP = 2;
/**
 * 一層樓最多召喚幾次。上限只擋「同時存在幾隻」，擋不住無限補充 ——
 * 隨從死了再召、死了再召，一層樓下來等於多打了十幾隻怪。次數上限是那道剎車。
 */
const SUMMON_PER_LEVEL = 2;
/** 【惡魔之卵】幾回合後必死。 */
const DOOM_TURNS = 5;
/** 【魅惑】讓怪物漫無目的地遊蕩幾回合。 */
const CHARM_WANDER_TURNS = 2;
/** 【魂體轉化】：隨從的命中與傷害各提升幾成、持續幾輪，外加永久的 HP。 */
const ALLY_TRANSMUTE_RATIO = 0.3;
const ALLY_TRANSMUTE_TURNS = 1;
const ALLY_TRANSMUTE_HP = 2;
/** 洗腦無效的怪：頭目、薩滿、英雄、巨魔。 */
function immuneToCharm(piece: DndPiece): boolean {
  if (piece.id.startsWith('boss-')) return true;
  if (piece.monsterPassive === 'void' || piece.monsterPassive === 'hero' || piece.monsterPassive === 'troll') return true;
  return piece.name.includes('薩滿') || piece.name.includes('Shaman');
}

/** 場上我方的召喚物數量。 */
function allyCount(state: DndState): number {
  let n = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (isAlly(state.board[r]?.[c]?.piece)) n++;
    }
  }
  return n;
}

/**
 * 召喚術士這一次能召出什麼、上限是多少。
 * 沒有【召喚書】時是 2 隻普通哥布林；書會把上限往上加，並解鎖更硬的隨從。
 */
function summonRosterOf(state: DndState, seat: number): { cap: number; roster: MonsterTemplate[] } {
  const spec = equipmentOf(state, seat);
  const bonus = state.seats[seat]?.equipment?.kind === 'summoner' ? (spec?.summonBonus ?? 0) : 0;
  const cap = SUMMON_BASE_CAP + bonus;

  if (bonus >= 3) return { cap, roster: [ELITE_GOBLIN, ELITE_GOBLIN_MAGE, ELITE_GOBLIN_ROGUE] };
  if (bonus === 2) return { cap, roster: [ELITE_GOBLIN, ELITE_GOBLIN_MAGE] };
  if (bonus === 1) return { cap, roster: [ELITE_GOBLIN] };
  return { cap, roster: [PLAIN_GOBLIN] };
}

/**
 * 召喚術士的攻擊被動【墮落低語】：1/5 種下惡魔之卵、1/5 洗腦，其餘什麼都不會發生。
 */
function summonerPassive(
  state: DndState,
  target: DndPiece,
  tr: number,
  tc: number,
  rng: () => number,
): LogEvent[] {
  const events: LogEvent[] = [];
  const roll = Math.floor(rng() * 3);

  // 【洗腦】把牠拉到我方
  if (roll === 0) {
    if (immuneToCharm(target)) {
      events.push({ t: 'dndMessage', kind: 'skill', message: `💢 低語滑過 ${target.name} 的耳邊 —— 牠的意志硬得撬不開。` } as any);
      return events;
    }
    target.ally = true;
    // 換邊之後這一輪不該再照原本的立場動一次
    state.monsterActed.add(target.id);
    pushFx(state, target.id, 'charm');
    events.push({ t: 'dndMessage', kind: 'skill', message: `💞 ${target.name} 的眼神渙散了下來 —— 牠現在站在你們這一邊！` } as any);
    return events;
  }

  // 【魅惑】：牠還在場上，但接下來幾回合只會漫無目的地亂走，不會攻擊任何人
  if (roll === 1) {
    if (target.id.startsWith('boss-')) {
      events.push({ t: 'dndMessage', kind: 'skill', message: `💢 低語在 ${target.name} 腦中散開 —— 頭目連晃都沒晃一下。` } as any);
      return events;
    }
    target.wanderTurns = CHARM_WANDER_TURNS;
    pushFx(state, target.id, 'wander');
    events.push({
      t: 'dndMessage', kind: 'skill',
      message: `😵 ${target.name} 的眼神失焦了 —— 接下來 ${CHARM_WANDER_TURNS} 回合牠只會在原地打轉。`,
    } as any);
    return events;
  }

  // 【魂體轉化】：這一輪隨從打得更兇更準，血量則是永久加上去的。
  // 圖示掛在每一隻隨從身上 —— 三個結果裡只有這個沒有位移也沒有換邊，
  // 不在棋盤上留下痕跡的話，玩家會以為自己從來沒抽到它。
  state.allyRage = ALLY_TRANSMUTE_TURNS;
  let touched = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = state.board[r]?.[c]?.piece;
      if (!isAlly(piece)) continue;
      piece!.maxHp += ALLY_TRANSMUTE_HP;
      piece!.hp += ALLY_TRANSMUTE_HP;
      pushFx(state, piece!.id, 'transmute');
      touched++;
    }
  }
  events.push({
    t: 'dndMessage', kind: 'skill',
    message: `🔺 術士施展【魂體轉化】—— 這一輪隨從的攻擊力與命中率各提高 `
      + `${Math.round(ALLY_TRANSMUTE_RATIO * 100)}%，並永久獲得 ${ALLY_TRANSMUTE_HP} 點 HP`
      + `${touched === 0 ? '（可惜場上一個隨從也沒有）' : ''}！`,
  } as any);
  return events;
}

/** 惡魔之卵的每輪倒數，時間到就當場暴斃。 */
function tickDoom(seats: Seats, state: DndState, rng: () => number): LogEvent[] {
  const events: LogEvent[] = [];
  let died = false;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = state.board[r]?.[c]?.piece;
      if (!piece || piece.type !== 'goblin') continue;
      if (!piece.doomTurns || piece.doomTurns <= 0) continue;

      piece.doomTurns--;
      if (piece.doomTurns > 0) continue;
      state.board[r]![c]!.piece = null;
      events.push({ t: 'dndMessage', kind: 'skill', message: `🥚 ${piece.name} 體內的卵孵化了 —— 牠從裡面被撐開，當場斷氣。` } as any);
      died = true;
    }
  }
  if (died) checkAndSpawnBossOrStaircase(seats, state, events, rng);
  return events;
}

/**
 * 我方怪物（召喚物與被洗腦的）的回合：找最近的敵人，走過去或打下去。
 * 刻意寫得比敵方 AI 笨一點 —— 它們是幫手，不該比玩家還會打。
 */
function runAlliesTurn(seats: Seats, state: DndState, rng: () => number): LogEvent[] {
  const events: LogEvent[] = [];
  const allies: Array<{ piece: DndPiece; r: number; c: number }> = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = state.board[r]?.[c]?.piece;
      if (isAlly(piece)) allies.push({ piece: piece!, r, c });
    }
  }
  if (allies.length === 0) return events;

  for (const ally of allies) {
    const located = findPieceById(state, ally.piece.id);
    if (!located) continue;
    // 這一輪剛被召出來、或剛被洗腦換邊的，先站著 —— 兩邊的紀錄都寫在 monsterActed，
    // endRound 才清掉，所以這裡讀得到。
    if (state.monsterActed.has(located.piece.id)) continue;
    if (isRestrained(located.piece)) continue;
    if (located.piece.stunnedTurns && located.piece.stunnedTurns > 0) {
      located.piece.stunnedTurns--;
      continue;
    }

    // 最近的敵人
    let target: { piece: DndPiece; r: number; c: number } | null = null;
    let best = 9999;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const piece = state.board[r]?.[c]?.piece;
        if (!isHostile(piece) || piece!.invulnerable) continue;
        const dist = Math.abs(located.r - r) + Math.abs(located.c - c);
        if (dist < best) { best = dist; target = { piece: piece!, r, c }; }
      }
    }
    if (!target) continue;

    const range = located.piece.range ?? 1;
    if (best <= range) {
      const roll = Math.floor(rng() * 20) + 1;
      // 【嗜魔鬥志】：術士下令的那一輪，隨從的命中與傷害同時放大
      const raging = state.allyRage > 0;
      const base = located.piece.attackBonus ?? 2;
      const bonus = raging ? Math.round(base * (1 + ALLY_TRANSMUTE_RATIO)) : base;
      if (roll + bonus >= target.piece.ac) {
        let dmg = Math.floor(rng() * (located.piece.dmgDice ?? 6)) + 1;
        if (raging) dmg = Math.max(1, Math.round(dmg * (1 + ALLY_TRANSMUTE_RATIO)));
        target.piece.hp = Math.max(0, target.piece.hp - dmg);
        events.push({
          t: 'dndAttack', player: located.piece.name, target: target.piece.name, roll, hit: true, damage: dmg,
        });
      } else {
        events.push({
          t: 'dndAttack', player: located.piece.name, target: target.piece.name, roll, hit: false, damage: 0,
        });
      }
      continue;
    }

    // 走近一點
    const speed = located.piece.speed ?? 2;
    let cr = located.r;
    let cc = located.c;
    for (let step = 0; step < speed; step++) {
      const dr = Math.sign(target.r - cr);
      const dc = Math.sign(target.c - cc);
      const tryOrder = Math.abs(target.r - cr) > Math.abs(target.c - cc)
        ? [{ r: cr + dr, c: cc }, { r: cr, c: cc + dc }]
        : [{ r: cr, c: cc + dc }, { r: cr + dr, c: cc }];
      let moved = false;
      for (const next of tryOrder) {
        if (!inBounds(next.r, next.c)) continue;
        if (state.board[next.r]?.[next.c]?.piece !== null) continue;
        state.board[cr]![cc]!.piece = null;
        state.board[next.r]![next.c]!.piece = located.piece;
        cr = next.r;
        cc = next.c;
        moved = true;
        break;
      }
      if (!moved) break;
    }
  }

  if (events.length > 0) {
    events.unshift({ t: 'dndMessage', message: '🤝 你們的隨從動了起來。' } as any);
  }
  events.push(...sweepDeadMonsters(seats, state, rng));
  return events;
}

/** 吟遊詩人【進擊之歌】：全隊傷害提升的比例與持續回合。 */
const BARD_MARCH_RATIO = 0.4;
/**
 * 增益的持續回合。
 *
 * 防禦向的【大地之歌】只要 1 —— 它要擋的就是同一輪緊接著的怪物回合，
 * 輪末遞減剛好用完。攻擊向的【進擊之歌】與【專注之歌】給 2：唱歌本身佔掉了
 * 這個人的回合，如果輪末就過期，唱的人自己一次都用不到，只有排在他後面的隊友沾得到光。
 */
const BARD_BUFF_TURNS = 1;
const BARD_OFFENSE_TURNS = 2;
/** 三首即興曲的基礎效果值。 */
const BARD_EARTH_AC = 3;
const BARD_FOCUS_HIT = 2;
const BARD_LIFE_HEAL = 1;

/**
 * 場上有沒有人帶著【里拉琴】—— 有的話全隊 AC／傷害／命中都吃到常駐光環。
 * 回傳光環的點數，沒有就是 0。腐化中的琴不算（equipmentOf 會回 null）。
 */
function bardAuraOf(seats: Seats, state: DndState): number {
  let best = 0;
  for (let seat = 0; seat < SEAT_COUNT; seat++) {
    const info = state.seats[seat];
    if (!info?.alive || info.equipment?.kind !== 'bard') continue;
    const spec = equipmentOf(state, seat);
    if (spec) best = Math.max(best, spec.bardAura);
  }
  return best;
}

/** 這位吟遊詩人的歌要加成多少（【里拉琴】會讓三首歌各再 +N）。 */
function songBonusOf(state: DndState, seat: number): number {
  return state.seats[seat]?.equipment?.kind === 'bard'
    ? (equipmentOf(state, seat)?.songBonus ?? 0)
    : 0;
}

/** 對所有活著的隊員做一件事。 */
function eachLivingSeat(state: DndState, fn: (info: DndSeatInfo, seat: number) => void): void {
  for (let seat = 0; seat < SEAT_COUNT; seat++) {
    const info = state.seats[seat];
    if (info?.alive) fn(info, seat);
  }
}

/**
 * 吟遊詩人的攻擊被動【即興吟唱】：三選一，各 1/3，效果及於全隊。
 * 【大地之歌】AC +3／【專注之歌】命中 +2／【生命之歌】全體回 1 點 HP。
 * 拿到【里拉琴】之後三首歌各再 +N。
 */
function bardPassive(
  seats: Seats,
  state: DndState,
  bard: DndPiece,
  seat: number,
  rng: () => number,
): LogEvent[] {
  const events: LogEvent[] = [];
  const who = bard.name.split(' ')[0];
  const bonus = songBonusOf(state, seat);
  const roll = Math.floor(rng() * 3);

  if (roll === 0) {
    const amount = BARD_EARTH_AC + bonus;
    eachLivingSeat(state, (info) => {
      info.acBuffTurns = BARD_BUFF_TURNS;
      info.acBuffAmount = amount;
    });
    pushFx(state, bard.id, 'song');
    events.push({ t: 'dndMessage', kind: 'skill', message: `🎵 ${who} 唱起【大地之歌】—— 這一輪全隊的 AC +${amount}！` } as any);
    return events;
  }

  if (roll === 1) {
    const amount = BARD_FOCUS_HIT + bonus;
    eachLivingSeat(state, (info) => {
      info.hitBuffTurns = BARD_OFFENSE_TURNS;
      info.hitBuffAmount = amount;
    });
    pushFx(state, bard.id, 'song');
    events.push({ t: 'dndMessage', kind: 'skill', message: `🎵 ${who} 唱起【專注之歌】—— 這一輪全隊的命中 +${amount}！` } as any);
    return events;
  }

  const heal = BARD_LIFE_HEAL + bonus;
  eachLivingSeat(state, (info, idx) => {
    info.hp = Math.min(info.maxHp, info.hp + heal);
    const piece = findSeatPiece(seats, state, idx)?.piece;
    if (piece) piece.hp = info.hp;
  });
  pushFx(state, bard.id, 'song');
  events.push({ t: 'dndMessage', kind: 'skill', message: `🎵 ${who} 唱起【生命之歌】—— 全隊恢復了 ${heal} 點 HP！` } as any);
  return events;
}

/** 鬥士【致命斬殺】的傷害倍率。 */
const GLADIATOR_EXECUTE_RATIO = 1.2;
/** 鬥士【旋風】的基礎倍率（沒有【巨劍】時）。 */
const GLADIATOR_WHIRLWIND_RATIO = 0.5;
/** 鬥士【野蠻衝撞】的射程與傷害。 */
const GLADIATOR_CHARGE_RANGE = 5;
const GLADIATOR_CHARGE_DAMAGE = 5;
/**
 * 弓手【狙擊】：發動後幾回合內無視射程，而且每次普攻會連射（帶【弓箭】時）。
 * 技能本身不造成傷害 —— 它買的是那段窗口。
 */
const SNIPE_TURNS = 6;
/** 弓手【放血】持續幾回合，每回合扣 1 點。 */
const ARCHER_BLEED_TURNS = 3;
/** 弓手【殘影】分身的素質（比照法師）。 */
const ARCHER_DECOY_HP = 16;
const ARCHER_DECOY_AC = 10;

/**
 * 鬥士的攻擊被動：只有命中時才有意義，因為兩個效果都吃這一刀的傷害數字。
 * 1/2【致命斬殺】把這一刀放大 1.2 倍（回傳新的傷害值），
 * 1/2【旋風】對自己周圍 8 格的怪各補一次半刀。
 *
 * 回傳的 damage 是「要真正寫進目標 HP 的傷害」——【致命斬殺】必須在扣血之前算完。
 */
function gladiatorPassive(
  state: DndState,
  seat: number,
  gladiator: DndPiece,
  gr: number,
  gc: number,
  targetId: string,
  damage: number,
  rng: () => number,
): { damage: number; events: LogEvent[] } {
  const events: LogEvent[] = [];
  const who = gladiator.name.split(' ')[0];

  if (Math.floor(rng() * 2) === 0) {
    const boosted = Math.ceil(damage * GLADIATOR_EXECUTE_RATIO);
    pushFx(state, gladiator.id, 'execute');
    events.push({
      t: 'dndMessage', kind: 'skill',
      message: `🩸 ${who} 抓住破綻發動【致命斬殺】，這一擊的傷害提升到 ${boosted} 點！`,
    } as any);
    return { damage: boosted, events };
  }

  // 【旋風】：連斜角一起掃，但不打自己也不打剛才那個目標以外的隊友
  const ratio = equipmentOf(state, seat)?.whirlwind ?? GLADIATOR_WHIRLWIND_RATIO;
  const splash = Math.max(1, Math.round(damage * ratio));
  const hit: string[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = gr + dr;
      const c = gc + dc;
      const piece = state.board[r]?.[c]?.piece;
      // 主目標的傷害另外算，旋風不重複打它
      if (!isHostile(piece) || piece!.id === targetId || piece!.invulnerable) continue;
      piece!.hp = Math.max(0, piece!.hp - splash);
      hit.push(piece!.name);
    }
  }

  if (hit.length === 0) {
    events.push({ t: 'dndMessage', kind: 'skill', message: `🌀 ${who} 揮出【旋風】，但周圍沒有其他敵人。` } as any);
    return { damage, events };
  }

  pushFx(state, gladiator.id, 'whirlwind');
  events.push({
    t: 'dndMessage', kind: 'skill',
    message: `🌀 ${who} 的【旋風】橫掃周圍 ${hit.length} 隻敵人，各造成 ${splash} 點傷害！（${hit.join('、')}）`,
  } as any);
  return { damage, events };
}

/**
 * 弓手的攻擊被動：跟盜賊／法師一樣，揮空也會發動。
 * 1/2【放血】掛 3 回合的持續傷害，1/2【穿刺】貫穿到目標正後方那一格的怪。
 */
function archerPassive(
  state: DndState,
  seat: number,
  archer: DndPiece,
  ar: number,
  ac: number,
  target: { piece: DndPiece; r: number; c: number },
  damage: number,
  rng: () => number,
): LogEvent[] {
  const events: LogEvent[] = [];
  const who = archer.name.split(' ')[0];

  if (Math.floor(rng() * 2) === 0) {
    // 每回合流多少跟著射出這一箭的人的【弓箭】走，記在傷口上而不是算全域常數 ——
    // 場上可能同時有帶弓與沒帶弓的弓手，兩道傷口不該混為一談
    const bleed = 1 + (equipmentOf(state, seat)?.bleedBonus ?? 0);
    target.piece.bleedTurns = ARCHER_BLEED_TURNS;
    target.piece.bleedDamage = bleed;
    pushFx(state, target.piece.id, 'bleed');
    events.push({
      t: 'dndMessage', kind: 'skill',
      message: `🩸 ${who} 的箭撕開了 ${target.piece.name} 的血管 —— 接下來 ${ARCHER_BLEED_TURNS} 回合牠每回合流失 ${bleed} 點 HP！`,
    } as any);
    return events;
  }

  // 【穿刺】：沿著「弓手 → 目標」的方向再往前一格。
  // 這一箭本來就沒射中的話，後面那隻自然也不會受傷。
  if (damage <= 0) {
    events.push({ t: 'dndMessage', kind: 'skill', message: `➶ ${who} 的箭擦身而過，力道不足以貫穿到後方。` } as any);
    return events;
  }

  const dr = Math.sign(target.r - ar);
  const dc = Math.sign(target.c - ac);
  if (dr === 0 && dc === 0) return events;
  const behind = state.board[target.r + dr]?.[target.c + dc]?.piece;
  if (!behind || !isHostile(behind) || behind.invulnerable) {
    events.push({ t: 'dndMessage', kind: 'skill', message: `➶ ${who} 的箭貫穿而過，但後方沒有第二個目標。` } as any);
    return events;
  }

  const pierce = Math.max(1, damage);
  behind.hp = Math.max(0, behind.hp - pierce);
  pushFx(state, behind.id, 'pierce');
  events.push({
    t: 'dndMessage', kind: 'skill',
    message: `➶ ${who} 的【穿刺】一箭貫穿，後方的 ${behind.name} 也吃到 ${pierce} 點傷害！`,
  } as any);
  return events;
}

/** 騎士被動【反射】彈回去的比例：實際吃到的傷害的 1/3。 */
const WARRIOR_REFLECT_RATIO = 1 / 3;

/** 牧師 NPC 的補血門檻：隊友血量低於這個比例就先補血再說 */
const NPC_HEAL_THRESHOLD = 0.7;
/**
 * NPC 的撤退門檻：血量低於這個比例就退開找牧師，不再往前衝；
 * 補過 70% 就自己回去打怪。刻意跟牧師的補血門檻同一個數字 ——
 * 「牧師願意救的人」與「會自己退回來的人」是同一批，兩邊才不會互相錯過。
 */
const NPC_RETREAT_RATIO = NPC_HEAL_THRESHOLD;
/** 牧師【神聖治癒】的射程與治療量，真人與 NPC 共用 */
const CLERIC_HEAL_RANGE = 3;
const CLERIC_HEAL_AMOUNT = 4;

/**
 * 盜賊的攻擊被動：命中時二選一，各 1/2。
 * 【破甲】AC 掉到六成／【削弱】造成的傷害掉到六成，兩者都持續 2 回合。
 * 重複命中是刷新回合數，不會疊加 —— AC 一律從 acBase 重算。
 */
function roguePassive(state: DndState, rogue: DndPiece, target: DndPiece, rng: () => number): LogEvent[] {
  const who = rogue.name.split(' ')[0];

  if (Math.floor(rng() * 2) === 0) {
    target.acBase ??= target.ac;
    target.ac = Math.max(1, Math.round(target.acBase * DEBUFF_RATIO));
    target.acDebuffTurns = DEBUFF_TURNS;
    pushFx(state, target.id, 'acDown');
    return [
      {
        t: 'dndMessage', kind: 'skill',
        message: `🗡️ ${who} 的匕首劃開了 ${target.name} 的護甲，AC 降到 ${target.ac}（${DEBUFF_TURNS} 回合）！`,
      } as any,
    ];
  }

  target.atkDebuffTurns = DEBUFF_TURNS;
  pushFx(state, target.id, 'weaken');
  return [
    {
      t: 'dndMessage', kind: 'skill',
      message: `🩸 ${who} 割開了 ${target.name} 的肌腱，牠的傷害只剩六成（${DEBUFF_TURNS} 回合）！`,
    } as any,
  ];
}

const FIRE_WALL_TURNS = 2;
const FIRE_WALL_DAMAGE = 3;
const FIRE_WALL_RANGE = 3;

/**
 * 法師【火牆】：以指定格為中心拉出一道 3 格的直線火牆，方向與施法方向垂直
 * （擋路才叫牆）。超出棋盤的那一段就不生成。
 */
function castFireWall(
  state: DndState,
  pr: number,
  pc: number,
  tr: number,
  tc: number,
  seat: number,
): number {
  const spec = equipmentOf(state, seat);
  // 【魔法珠】把一條 3 格的牆撐成 N×N 的火場，傷害也跟著加
  const cells: Array<{ r: number; c: number }> = [];
  if (spec) {
    for (let dr = 0; dr < spec.fireWallSize; dr++) {
      for (let dc = 0; dc < spec.fireWallSize; dc++) {
        cells.push({ r: tr + dr, c: tc + dc });
      }
    }
  } else {
    const alongRow = Math.abs(tr - pr) >= Math.abs(tc - pc);
    cells.push(
      ...(alongRow
        ? [{ r: tr, c: tc - 1 }, { r: tr, c: tc }, { r: tr, c: tc + 1 }]
        : [{ r: tr - 1, c: tc }, { r: tr, c: tc }, { r: tr + 1, c: tc }]),
    );
  }

  const dmg = FIRE_WALL_DAMAGE + (spec?.fireWallDamage ?? 0);

  let placed = 0;
  for (const cell of cells) {
    if (!inBounds(cell.r, cell.c)) continue;
    const existing = state.fireWalls.find((wall) => wall.r === cell.r && wall.c === cell.c);
    if (existing) {
      existing.turns = FIRE_WALL_TURNS; // 疊在同一格只是續燒
      existing.dmg = Math.max(existing.dmg, dmg);
      // 蓋在分身的邪火上就是把它壓過去 —— 沒有重設的話，法師自己放的牆
      // 會繼續掛著 hostile，反過來燒自己的隊伍。
      existing.hostile = false;
    } else {
      state.fireWalls.push({ r: cell.r, c: cell.c, turns: FIRE_WALL_TURNS, dmg });
    }
    placed++;
  }
  return placed;
}

/**
 * 每回合結算火牆：燒站在裡面的怪物，然後倒數，燒完就熄。
 * 只燒怪物 —— 火牆不會誤傷隊友。
 */
function burnFireWalls(seats: Seats, state: DndState): LogEvent[] {
  const events: LogEvent[] = [];
  if (state.fireWalls.length === 0) return events;

  for (const wall of state.fireWalls) {
    const cell = state.board[wall.r]?.[wall.c];
    const piece = cell?.piece;
    if (!piece) continue;
    // 敵方（分身）鋪的牆燒冒險者，我方的燒怪物
    const burns = wall.hostile ? piece.type === 'player' : isHostile(piece);
    if (!burns || piece.invulnerable) continue;

    piece.hp = Math.max(0, piece.hp - wall.dmg);
    // 燒到的是冒險者的話要把血同步回座位。少了這行，隊伍面板會顯示舊血量，
    // 而吟遊詩人的【生命之歌】以 seats 的 hp 為準往回寫，等於把火焰傷害整個退還。
    if (piece.type === 'player') {
      const burnedSeat = seatIndexOfPiece(seats, piece);
      const burnedInfo = burnedSeat === -1 ? null : state.seats[burnedSeat];
      if (burnedInfo) burnedInfo.hp = piece.hp;
    }
    events.push({
      t: 'dndMessage', kind: 'skill',
      message: `🔥 ${piece.name} 站在火牆裡，被燒掉 ${wall.dmg} 點 HP！`,
    } as any);
    if (piece.hp <= 0 && cell) {
      if (piece.type === 'player') {
        const seat = seatIndexOfPiece(seats, piece);
        if (seat !== -1 && state.seats[seat]) state.seats[seat]!.alive = false;
      }
      cell.piece = null;
      events.push({ t: 'dndMessage', kind: 'skill', message: `🔥 ${piece.name} 被火牆燒成了灰燼！` } as any);
    }
  }

  for (const wall of state.fireWalls) wall.turns--;
  state.fireWalls = state.fireWalls.filter((wall) => wall.turns > 0);
  return events;
}

/** 怪物身上的減益倒數。跟火牆一樣是每輪結算一次。 */
function tickMonsterDebuffs(state: DndState): void {
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = state.board[r]?.[c]?.piece;
      if (!piece || piece.type !== 'goblin') continue;

      if (piece.acDebuffTurns && piece.acDebuffTurns > 0) {
        piece.acDebuffTurns--;
        if (piece.acDebuffTurns === 0 && piece.acBase !== undefined) {
          piece.ac = piece.acBase;
          piece.acBase = undefined;
        }
      }
      if (piece.atkDebuffTurns && piece.atkDebuffTurns > 0) {
        piece.atkDebuffTurns--;
      }
    }
  }
}

/**
 * 虛空酋長的攻擊被動：命中時三選一，各 1/3。
 * 【放逐】離場 1 回合後回到原地／【召喚】叫出一隻哥布林法師／【恐懼】兩回合移動方向顛倒。
 */
function voidChiefPassive(
  state: DndState,
  victim: { piece: DndPiece; r: number; c: number; seat: number },
  rng: () => number,
): LogEvent[] {
  const events: LogEvent[] = [];
  const seatInfo = state.seats[victim.seat];
  if (!seatInfo) return events;

  const who = victim.piece.name.split(' ')[0];
  const roll = Math.floor(rng() * 3);

  if (roll === 0) {
    seatInfo.banishedTurns = 1;
    seatInfo.banishCell = { r: victim.r, c: victim.c };
    seatInfo.piece = victim.piece;
    const cell = state.board[victim.r]?.[victim.c];
    if (cell && cell.piece?.id === victim.piece.id) cell.piece = null;
    pushFx(state, victim.piece.id, 'banish');
    events.push({ t: 'dndMessage', kind: 'skill', message: `🌌 虛空酋長張開裂隙，${who} 被放逐了 1 回合！` } as any);
    return events;
  }

  if (roll === 1) {
    const mage = spawnMonster(state, makeGoblin(`m-mage-void-${Date.now()}-${Math.floor(rng() * 1000)}`, GOBLIN_MAGE));
    if (placeNear(state, victim.r, victim.c, mage)) {
      pushFx(state, mage.id, 'summon');
      events.push({ t: 'dndMessage', kind: 'skill', message: `🧿 虛空酋長的低語喚出了一隻哥布林法師！` } as any);
    }
    return events;
  }

  seatInfo.fearTurns = 2;
  pushFx(state, victim.piece.id, 'fear');
  events.push({ t: 'dndMessage', kind: 'skill', message: `😱 ${who} 陷入【恐懼】，接下來 2 回合的移動方向會完全顛倒！` } as any);
  return events;
}

/**
 * 隊伍裡還有沒有「活著的」真人冒險者。
 * 沒有的話（單人魔王模式、或真人全倒只剩 NPC 隊友）NPC 必須自己下樓 ——
 * 否則清完一層之後整隊會站在樓梯旁邊，永遠不會進到下一層。
 *
 * 一定要看 alive：陣亡的真人 `seats[seat]` 還留著 playerId（只有離開房間才會清成 null），
 * 只判斷「有沒有人坐在那」的話，魔王模式下真人一死整局就會卡在同一層無限空轉。
 */
function partyHasHuman(seats: Seats, state: DndState): boolean {
  for (let seat = 0; seat < SEAT_COUNT; seat++) {
    const info = state.seats[seat];
    if (seats[seat] && info?.alive && !info.isNpc) return true;
  }
  return false;
}

/**
 * 這個座位的角色現在站在哪。真人座位找 `p-<playerId>`，NPC 座位找 `npc-<seat>`；
 * 角色被放逐離場時回 null。
 */
function findSeatPiece(
  seats: Seats,
  state: DndState,
  seat: number,
): { piece: DndPiece; r: number; c: number } | null {
  const playerId = seats[seat] ?? null;
  for (let r = 0; r < BOARD_SIZE; r++) {
    const row = state.board[r];
    if (!row) continue;
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = row[c]?.piece;
      if (!piece || piece.type !== 'player') continue;
      if (playerId ? piece.playerId === playerId : piece.id === `npc-${seat}`) {
        return { piece, r, c };
      }
    }
  }
  return null;
}

/** 棋子對應的座位：真人看 playerId，NPC 隊友看 `npc-<seat>` 的編號。 */
function seatIndexOfPiece(seats: Seats, piece: DndPiece): number {
  if (piece.playerId) return seats.indexOf(piece.playerId);
  if (piece.id.startsWith('npc-')) return parseInt(piece.id.split('-')[1]!, 10);
  return -1;
}

/**
 * 騎士的攻擊被動：命中時三選一，各 1/3。
 * 【暈眩】停一回合／【擊退】推開 2 格／【極限防禦】下一輪受到的單次傷害壓到 2 以內。
 */
function warriorPassive(
  seats: Seats,
  state: DndState,
  warrior: DndPiece,
  target: DndPiece,
  tr: number,
  tc: number,
  wr: number,
  wc: number,
  rng: () => number,
): LogEvent[] {
  const events: LogEvent[] = [];
  const who = warrior.name.split(' ')[0];
  const roll = Math.floor(rng() * 3);

  if (roll === 0) {
    target.stunnedTurns = 1;
    pushFx(state, target.id, 'stun');
    events.push({ t: 'dndMessage', kind: 'skill', message: `💫 ${who} 的重擊震暈了 ${target.name}，牠下一回合無法行動！` } as any);
    return events;
  }

  if (roll === 1) {
    const dr = Math.sign(tr - wr);
    const dc = Math.sign(tc - wc);
    let landedR = tr;
    let landedC = tc;
    // 一格一格往後推，撞到邊界或別的棋子就停在前一格
    for (let step = 0; step < 2; step++) {
      const nr = landedR + dr;
      const nc = landedC + dc;
      if (!inBounds(nr, nc) || state.board[nr]?.[nc]?.piece !== null) break;
      landedR = nr;
      landedC = nc;
    }

    if (landedR === tr && landedC === tc) {
      events.push({ t: 'dndMessage', kind: 'skill', message: `💢 ${who} 想擊退 ${target.name}，但牠身後沒有退路！` } as any);
      return events;
    }

    state.board[tr]![tc]!.piece = null;
    state.board[landedR]![landedC]!.piece = target;
    pushFx(state, target.id, 'knockback');
    events.push({ t: 'dndMessage', kind: 'skill', message: `💥 ${who} 一記盾擊，把 ${target.name} 擊退了！` } as any);
    return events;
  }

  const seatIndex = seatIndexOfPiece(seats, warrior);
  const seatInfo = seatIndex === -1 ? undefined : state.seats[seatIndex];
  if (seatInfo) {
    seatInfo.damageCapTurns = 1;
    seatInfo.damageCap = 2;
    pushFx(state, warrior.id, 'guard');
    events.push({ t: 'dndMessage', kind: 'skill', message: `🛡️ ${who} 進入【極限防禦】，下一回合受到的每次傷害都不會超過 2 點！` } as any);
  }
  return events;
}

function findEmptyCellNearCenter(state: DndState): DndCellView | null {
  const candidates = [
    { r: 7, c: 7 }, { r: 7, c: 8 }, { r: 8, c: 7 }, { r: 8, c: 8 },
    { r: 6, c: 7 }, { r: 6, c: 8 }, { r: 9, c: 7 }, { r: 9, c: 8 },
    { r: 7, c: 6 }, { r: 8, c: 6 }, { r: 7, c: 9 }, { r: 8, c: 9 }
  ];
  for (const pos of candidates) {
    const cell = state.board[pos.r]?.[pos.c];
    if (cell && cell.piece === null) {
      return cell;
    }
  }
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = state.board[r]?.[c];
      if (cell && cell.piece === null) {
        return cell;
      }
    }
  }
  return null;
}

/** 打碎一個祭壇：全隊的聖物腐化 RELIC_CORRUPT_TURNS 回合。 */
function corruptRelics(seats: Seats, state: DndState, events: LogEvent[]): void {
  let any = false;
  for (let seat = 0; seat < SEAT_COUNT; seat++) {
    const info = state.seats[seat];
    if (!info?.alive || !info.equipment) continue;
    // +1 是因為打碎祭壇的那一輪結束時就會先扣掉一格 —— 多給一格，
    // 玩家實際被壓制的才是完整的 RELIC_CORRUPT_TURNS 輪
    info.corruptedTurns = RELIC_CORRUPT_TURNS + 1;
    // info.piece 只有被放逐離場時才有值，特效要掛在棋盤上的那個棋子
    const piece = findSeatPiece(seats, state, seat)?.piece;
    if (piece) pushFx(state, piece.id, 'corrupt');
    any = true;
  }
  if (any) {
    events.push({
      t: 'dndMessage',
      message: `🕳️ 祭壇碎裂的瞬間噴出穢氣 —— 【聖物腐化】！接下來 ${RELIC_CORRUPT_TURNS} 回合，全隊裝備的特殊效果與命中加值全部失效！`,
    } as any);
  }
}

/** 祭壇被打碎：從棋盤移除、計數、觸發腐化，全破就等 checkDndGameOver 收尾。 */
function breakAltar(
  seats: Seats,
  state: DndState,
  altar: { piece: DndPiece; r: number; c: number },
  events: LogEvent[],
): void {
  const cell = state.board[altar.r]?.[altar.c];
  if (cell && cell.piece?.id === altar.piece.id) cell.piece = null;
  state.altarsDestroyed++;
  pushFx(state, altar.piece.id, 'altarBreak');
  events.push({
    t: 'dndMessage',
    message: `💥 ${altar.piece.name} 應聲碎裂！門後的嘶吼變得更大聲了。（${state.altarsDestroyed}/${ALTAR_COUNT}）`,
  } as any);
  corruptRelics(seats, state, events);
  if (state.altarsDestroyed >= ALTAR_COUNT) {
    events.push({ t: 'dndMessage', message: '🌌 四座祭壇全滅 —— 異世界大門在轟鳴中閉合了！' } as any);
  }
}

/**
 * 玩家把一個目標打到 0 的收尾。祭壇走碎裂流程，怪物走原本的清場 → 生 Boss／樓梯。
 */
function resolveTargetDeath(
  seats: Seats,
  state: DndState,
  target: DndPiece,
  tr: number,
  tc: number,
  events: LogEvent[],
  rng: () => number,
): void {
  if (target.type === 'altar') {
    breakAltar(seats, state, { piece: target, r: tr, c: tc }, events);
    return;
  }
  const cell = state.board[tr]?.[tc];
  if (cell && cell.piece?.id === target.id) cell.piece = null;
  checkAndSpawnBossOrStaircase(seats, state, events, rng);
}

/** 場上還立著的祭壇。 */
function altarsOnBoard(state: DndState): Array<{ piece: DndPiece; r: number; c: number }> {
  const found: Array<{ piece: DndPiece; r: number; c: number }> = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = state.board[r]?.[c]?.piece;
      if (piece?.type === 'altar') found.push({ piece, r, c });
    }
  }
  return found;
}

/**
 * B6 每輪的援軍：每 3 輪每個祭壇各吐一隻怪，每 5 輪補一隻虛空酋長（同時只會有一隻）。
 * 護送關的 escortReinforcements 是同一個位置、同一種寫法。
 */
function gateReinforcements(state: DndState, rng: () => number): LogEvent[] {
  const events: LogEvent[] = [];
  const altars = altarsOnBoard(state);

  if (state.roundCount > 0 && state.roundCount % GATE_SPAWN_EVERY === 0 && altars.length > 0) {
    let spawned = 0;
    altars.forEach((altar, idx) => {
      const template = GATE_MONSTER_POOL[Math.floor(rng() * GATE_MONSTER_POOL.length)]!;
      const piece = spawnMonster(state, makeGoblin(`m-gate-${state.roundCount}-${idx}`, template));
      if (placeNear(state, altar.r, altar.c, piece)) spawned++;
    });
    if (spawned > 0) {
      events.push({ t: 'dndMessage', message: `🌌 祭壇同時亮起，異世界又推出了 ${spawned} 隻爪牙！` } as any);
    }
  }

  if (state.roundCount > 0 && state.roundCount % GATE_CHIEF_EVERY === 0) {
    const chiefAlive = state.gateChiefId !== null && findPieceById(state, state.gateChiefId) !== null;
    if (!chiefAlive) {
      const id = `boss-3-gate-${state.roundCount}`;
      const chief = spawnMonster(state, {
        id, type: 'goblin', name: 'Void Chief (虛空酋長)',
        hp: 80, maxHp: 80, ac: 15, monsterPassive: 'void',
      });
      const cell = findEmptyCellNearCenter(state);
      if (cell) {
        cell.piece = chief;
        state.gateChiefId = id;
        events.push({ t: 'dndMessage', message: '👑 裂隙撕開 —— 又一位虛空酋長從門的另一側踏了進來！打倒牠會讓全隊變強。' } as any);
      }
    }
  }

  return events;
}

/** 打倒大門的虛空酋長：全隊所有數值 +1，可以一直疊。 */
function empowerParty(seats: Seats, state: DndState, events: LogEvent[]): void {
  for (let seat = 0; seat < SEAT_COUNT; seat++) {
    const info = state.seats[seat];
    if (!info?.alive) continue;
    info.statBonus = (info.statBonus ?? 0) + 1;
    info.maxHp += 1;
    info.hp = Math.min(info.maxHp, info.hp + 1);
    const piece = findSeatPiece(seats, state, seat)?.piece;
    if (piece) {
      piece.maxHp += 1;
      piece.hp = info.hp;
      piece.ac += 1;
      if (piece.acBase !== undefined) piece.acBase += 1;
      pushFx(state, piece.id, 'empower');
    }
  }
  events.push({
    t: 'dndMessage',
    message: '⬆️ 虛空酋長倒下，牠身上的力量湧向了你們 —— 全隊 HP、防禦、命中各 +1！',
  } as any);
}

/** B6 這一層總共有幾個祭壇（其他層是 0），給前端的進度 HUD 用。 */
export function altarsTotalOf(state: DndState): number {
  return state.level === GATE_LEVEL ? ALTAR_COUNT : 0;
}

export function checkAndSpawnBossOrStaircase(seats: Seats, state: DndState, events: LogEvent[], rng: () => number) {
  // 護送關的結束條件是村民、異界大門的是祭壇 —— 兩層都不走清怪→Boss→樓梯這條路
  if (state.level === ESCORT_LEVEL || state.level === GATE_LEVEL) return;

  // B5：信徒被清掉 3/4 之後邪神才現身，不必等到全部清光
  if (state.level === 5 && !state.bossSpawned && state.godMinionTotal > 0) {
    if (countMinions(state) > Math.floor(state.godMinionTotal / 4)) return;

    state.bossSpawned = true;
    const bossCell = findEmptyCellNearCenter(state);
    if (bossCell) {
      bossCell.piece = spawnMonster(state, {
        id: 'boss-5', type: 'goblin', name: 'Goblin Evil God (哥布林邪神)',
        hp: 120, maxHp: 120, ac: 16, attackBonus: 5, dmgDice: 10,
      });
      events.push({ t: 'dndMessage', message: '🕯️ 剩下的信徒跪伏在地 —— 哥布林邪神睜開了眼睛。' } as any);
      events.push(...summonGodCopies(seats, state, rng));
    }
    return;
  }

  let goblinCount = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (isHostile(state.board[r]?.[c]?.piece)) {
        goblinCount++;
      }
    }
  }

  if (goblinCount > 0) return;

  if (!state.bossSpawned) {
    state.bossSpawned = true;
    
    if (state.level === 1) {
      const bossCell = findEmptyCellNearCenter(state);
      if (bossCell) {
        bossCell.piece = spawnMonster(state, { id: 'boss-1', type: 'goblin', name: 'Goblin Warlord (督軍)', hp: 35, maxHp: 35, ac: 12 });
        events.push({ t: 'dndMessage', message: '⚠️ 震耳欲聾的咆哮聲響起，Goblin Warlord (督軍) 降臨了！' } as any);
      }
    } else if (state.level === 2) {
      const bossCell = findEmptyCellNearCenter(state);
      if (bossCell) {
        bossCell.piece = spawnMonster(state, { id: 'boss-2', type: 'goblin', name: 'Goblin High Shaman (大薩滿)', hp: 50, maxHp: 50, ac: 13 });
        events.push({ t: 'dndMessage', message: '⚠️ 詭異的法陣亮起，Goblin High Shaman (大薩滿) 親自下場戰鬥！' } as any);
      }
    } else if (state.level === 4) {
      const bossCell = findEmptyCellNearCenter(state);
      if (bossCell) {
        const boss = spawnMonster(state, { id: 'boss-3', type: 'goblin', name: 'Void Chief (虛空酋長)', hp: 80, maxHp: 80, ac: 15 });
        bossCell.piece = boss;
        events.push({ t: 'dndMessage', message: '👑 終極魔王 Void Chief (虛空酋長) 降臨王座！' } as any);
      }
    }
    return;
  }
  
  if (state.level >= MAX_LEVEL) return;

  let hasStair = false;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (state.board[r]?.[c]?.piece?.type === 'staircase') {
        hasStair = true;
        break;
      }
    }
  }

  if (!hasStair) {
    const stairCell = findEmptyCellNearCenter(state);
    if (stairCell) {
      stairCell.piece = {
        id: 'staircase',
        type: 'staircase',
        name: '樓梯 (Stairs)',
        hp: 0,
        maxHp: 0,
        ac: 0,
      };
      events.push({ t: 'dndMessage', message: '🪜 隨著 Boss 倒下，通往下一層的樓梯出現了！' } as any);
    }
  }
}

function transitionToNextLevel(
  seats: Seats,
  state: DndState,
  triggeringPlayerName: string,
  rng: () => number
): LogEvent[] {
  const events: LogEvent[] = [];
  state.level++;

  for (let idx = 0; idx < 4; idx++) {
    const seatInfo = state.seats[idx];
    if (seatInfo && seatInfo.alive) {
      const maxHp = seatInfo.maxHp;
      seatInfo.hp = Math.min(maxHp, seatInfo.hp + Math.floor(maxHp * 0.5));
    }
    // 召喚次數逐層重置
    if (seatInfo) seatInfo.summonsUsed = 0;
  }

  const alivePlayers: { piece: DndPiece; seatIndex: number }[] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = state.board[r]?.[c]?.piece;
      if (piece && piece.type === 'player') {
        let seatIndex = -1;
        if (piece.playerId) {
          seatIndex = seats.indexOf(piece.playerId);
        } else if (piece.id.startsWith('npc-')) {
          seatIndex = parseInt(piece.id.split('-')[1]!, 10);
        }
        if (seatIndex !== -1 && state.seats[seatIndex]?.alive) {
          piece.hp = state.seats[seatIndex]!.hp;
          alivePlayers.push({ piece, seatIndex });
        }
      }
    }
  }

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (state.board[r]?.[c]) {
        state.board[r]![c]!.piece = null;
        state.board[r]![c]!.trapTriggered = false;
      }
    }
  }

  const starts = [
    { r: 15, c: 6 },
    { r: 15, c: 7 },
    { r: 15, c: 8 },
    { r: 15, c: 9 },
  ];

  alivePlayers.forEach(({ piece, seatIndex }) => {
    const start = starts[seatIndex] || { r: 0, c: 0 };
    const cell = state.board[start.r]?.[start.c];
    if (cell) {
      cell.piece = piece;
    }
  });

  let monsterSpawns: Array<{ r: number; c: number; name: string; hp: number; ac: number }> = [];
  if (state.level === 2) {
    monsterSpawns = [
      { r: 3, c: 3, name: 'Goblin A', hp: 16, ac: 11 },
      { r: 3, c: 12, name: 'Goblin B', hp: 16, ac: 11 },
      { r: 8, c: 3, name: 'Goblin C', hp: 16, ac: 11 },
      { r: 8, c: 12, name: 'Goblin D', hp: 16, ac: 11 },
      { r: 5, c: 7, name: 'Goblin E', hp: 16, ac: 11 },
      { r: 5, c: 8, name: 'Goblin F', hp: 16, ac: 11 },
    ];
  } else if (state.level === 5) {
    // 邪神的信徒：比 B4 的精銳再硬一階，開場只有他們，邪神還沒現身
    monsterSpawns = [
      { r: 2, c: 2, name: 'Goblin Zealot A', hp: 26, ac: 14 },
      { r: 2, c: 7, name: 'Goblin Zealot B', hp: 26, ac: 14 },
      { r: 2, c: 13, name: 'Goblin Zealot C', hp: 26, ac: 14 },
      { r: 5, c: 4, name: 'Goblin Zealot D', hp: 26, ac: 14 },
      { r: 5, c: 11, name: 'Goblin Zealot E', hp: 26, ac: 14 },
      { r: 7, c: 7, name: 'Goblin Zealot F', hp: 26, ac: 14 },
      { r: 7, c: 8, name: 'Goblin Zealot G', hp: 26, ac: 14 },
      { r: 9, c: 3, name: 'Goblin Zealot H', hp: 26, ac: 14 },
      { r: 9, c: 12, name: 'Goblin Zealot I', hp: 26, ac: 14 },
      { r: 4, c: 8, name: 'Goblin Zealot J', hp: 26, ac: 14 },
      { r: 6, c: 2, name: 'Goblin Zealot K', hp: 26, ac: 14 },
      { r: 6, c: 13, name: 'Goblin Zealot L', hp: 26, ac: 14 },
    ];
  } else if (state.level === 4) {
    monsterSpawns = [
      { r: 2, c: 2, name: 'Elite Goblin A', hp: 20, ac: 12 },
      { r: 2, c: 13, name: 'Elite Goblin B', hp: 20, ac: 12 },
      { r: 10, c: 2, name: 'Elite Goblin C', hp: 20, ac: 12 },
      { r: 10, c: 13, name: 'Elite Goblin D', hp: 20, ac: 12 },
      { r: 6, c: 5, name: 'Elite Goblin E', hp: 20, ac: 12 },
      { r: 6, c: 10, name: 'Elite Goblin F', hp: 20, ac: 12 },
      { r: 4, c: 7, name: 'Elite Goblin G', hp: 20, ac: 12 },
      { r: 4, c: 8, name: 'Elite Goblin H', hp: 20, ac: 12 },
    ];
  }

  monsterSpawns.forEach((spawn, idx) => {
    const cell = state.board[spawn.r]?.[spawn.c];
    if (cell) {
      cell.piece = spawnMonster(state, {
        id: `m-${idx}`,
        type: 'goblin',
        name: spawn.name,
        hp: spawn.hp,
        maxHp: spawn.hp,
        ac: spawn.ac,
      });
    }
  });

  // 護送關的怪物是第 2 輪才以伏兵的形式出現，這裡不先鋪
  if (state.level === ESCORT_LEVEL) {
    spawnVillagers(state);
    state.roundCount = 0;
  }

  // B6 異世界大門：四座祭壇 + 一批菁英守衛。之後每 3 輪祭壇自己會吐怪。
  if (state.level === GATE_LEVEL) {
    state.roundCount = 0;
    state.altarsDestroyed = 0;
    state.gateChiefId = null;

    const altarSpots = [{ r: 3, c: 3 }, { r: 3, c: 12 }, { r: 12, c: 3 }, { r: 12, c: 12 }];
    altarSpots.forEach((spot, idx) => {
      const cell = state.board[spot.r]?.[spot.c];
      if (cell) {
        cell.piece = {
          id: `altar-${idx}`,
          type: 'altar',
          name: `異界祭壇 ${idx + 1}`,
          hp: ALTAR_HP,
          maxHp: ALTAR_HP,
          ac: ALTAR_AC,
        };
      }
    });

    const garrison: Array<{ spot: { r: number; c: number }; template: MonsterTemplate }> = [
      { spot: { r: 5, c: 5 }, template: ELITE_GOBLIN_ROGUE },
      { spot: { r: 5, c: 10 }, template: ELITE_GOBLIN_ROGUE },
      { spot: { r: 10, c: 7 }, template: ELITE_GOBLIN_ROGUE },
      { spot: { r: 2, c: 7 }, template: ELITE_GOBLIN_MAGE },
      { spot: { r: 2, c: 8 }, template: ELITE_GOBLIN_MAGE },
      { spot: { r: 6, c: 13 }, template: ELITE_GOBLIN_MAGE },
      { spot: { r: 4, c: 2 }, template: GOBLIN_SHAMAN },
      { spot: { r: 4, c: 13 }, template: GOBLIN_SHAMAN },
      { spot: { r: 7, c: 6 }, template: GOBLIN_HERO },
      { spot: { r: 7, c: 9 }, template: GOBLIN_HERO },
      { spot: { r: 9, c: 8 }, template: TROLL },
    ];
    garrison.forEach(({ spot, template }, idx) => {
      placeNear(state, spot.r, spot.c, spawnMonster(state, makeGoblin(`m-gate-guard-${idx}`, template)));
    });
  }

  // B2 起加派哥布林盜賊（一次衝 5 格），B4 再疊上哥布林法師（隔 3 格放法術）
  // 第 6 層有自己的編成，不吃這兩段
  if (state.level >= 2 && state.level !== ESCORT_LEVEL && state.level !== GATE_LEVEL) {
    const rogueSpots = [{ r: 7, c: 2 }, { r: 7, c: 13 }, { r: 9, c: 7 }];
    rogueSpots.forEach((spot, idx) => {
      placeNear(state, spot.r, spot.c, spawnMonster(state, makeGoblin(`m-rogue-${idx}`, GOBLIN_ROGUE)));
    });
  }
  if (state.level >= 4 && state.level !== GATE_LEVEL) {
    const mageSpots = [{ r: 2, c: 7 }, { r: 2, c: 8 }, { r: 5, c: 12 }];
    mageSpots.forEach((spot, idx) => {
      placeNear(state, spot.r, spot.c, spawnMonster(state, makeGoblin(`m-mage-${idx}`, GOBLIN_MAGE)));
    });
  }

  // 全部雜兵都鋪好之後才記總數 —— 信徒、盜賊、法師都算，
  // 「清掉 3/4 邪神才現身」是以整批守衛為準
  state.godMinionTotal = state.level === 5 ? countMinions(state) : 0;

  spawnTraps(state, 8, rng);
  state.fireWalls = [];
  state.bossSpawned = false;
  state.finalPhase = false;

  events.push({ t: 'dndLevelUp', level: state.level });
  return events;
}

function onPlayerMoveToCell(
  seats: Seats,
  state: DndState,
  playerPiece: DndPiece,
  tr: number,
  tc: number,
  hadStaircase: boolean,
  rng: () => number
): LogEvent[] {
  const events: LogEvent[] = [];

  const trapIdx = state.traps.findIndex((t) => t.r === tr && t.c === tc && !t.triggered);
  if (trapIdx !== -1) {
    state.traps[trapIdx]!.triggered = true;

    let seatIndex = -1;
    if (playerPiece.playerId) {
      seatIndex = seats.indexOf(playerPiece.playerId);
    } else if (playerPiece.id.startsWith('npc-')) {
      seatIndex = parseInt(playerPiece.id.split('-')[1]!, 10);
    }

    if (seatIndex !== -1 && state.seats[seatIndex]) {
      state.seats[seatIndex]!.banishedTurns = 2;
      state.seats[seatIndex]!.piece = JSON.parse(JSON.stringify(playerPiece));
    }

    const cell = state.board[tr]?.[tc];
    if (cell) {
      cell.trapTriggered = true;
      cell.piece = null;
    }

    events.push({
      t: 'dndMessage',
      message: `🌀 ${playerPiece.name.split(' ')[0]} 踩中陷阱，被吸入異空間放逐 2 回合！`,
    } as any);

    return events;
  }

  if (hadStaircase) {
    const transitionEvents = transitionToNextLevel(seats, state, playerPiece.name, rng);
    events.push(...transitionEvents);
  }

  return events;
}

export function dealDnd(
  seats: Seats,
  characterIds?: Record<PlayerId, DndClassId>,
  difficulty: DndDifficulty = 'normal',
  bossSeat: number | null = null,
  npcController: PlayerId | null = null,
  rng: () => number = Math.random,
  /** 空位要補什麼職業的 NPC；沒指定的位置照舊隨機抽（且避開已經有人選的職業）。 */
  npcClasses: Array<DndClassId | null> = [],
): DndState {
  const board: DndCellView[][] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    const row: DndCellView[] = [];
    for (let c = 0; c < BOARD_SIZE; c++) {
      row.push({ r, c, piece: null });
    }
    board.push(row);
  }

  const stateSeats: Record<number, DndSeatInfo> = {};

  const starts = [
    { r: 15, c: 6 },
    { r: 15, c: 7 },
    { r: 15, c: 8 },
    { r: 15, c: 9 },
  ];

  const usedClasses = new Set<DndClassId>();
  for (let seatIndex = 0; seatIndex < 4; seatIndex++) {
    const playerId = seats[seatIndex];
    if (playerId && characterIds?.[playerId]) {
      usedClasses.add(characterIds[playerId]);
    }
  }

  for (let seatIndex = 0; seatIndex < 4; seatIndex++) {
    const playerId = seats[seatIndex];
    const pos = starts[seatIndex] || { r: 0, c: 0 };
    
    let classId: DndClassId;
    if (playerId && characterIds?.[playerId]) {
      classId = characterIds[playerId];
    } else if (npcClasses[seatIndex]) {
      // 房主指定了這個空位的職業。指定就照辦，不管跟別人重不重複 ——
      // 想開四個牧師是他的自由。
      classId = npcClasses[seatIndex]!;
      usedClasses.add(classId);
    } else {
      const availableClasses = ALL_CLASSES.filter(c => !usedClasses.has(c));
      if (availableClasses.length > 0) {
        const randomIndex = Math.floor(rng() * availableClasses.length);
        classId = availableClasses[randomIndex]!;
      } else {
        classId = 'brave';
      }
      usedClasses.add(classId);
    }

    const stats = CLASS_STATS[classId];

    if (playerId) {
      const piece: DndPiece = {
        id: `p-${playerId}`,
        type: 'player',
        playerId,
        name: `${stats.name}`,
        hp: stats.hp,
        maxHp: stats.hp,
        ac: stats.ac,
        classId,
      };
      const targetCell = board[pos.r]?.[pos.c];
      if (targetCell) {
        targetCell.piece = piece;
      }
      stateSeats[seatIndex] = { hp: stats.hp, maxHp: stats.hp, alive: true, isNpc: false, name: `${stats.name}`, classId };
    } else {
      const npcName = `NPC ${stats.name}`;
      const piece: DndPiece = {
        id: `npc-${seatIndex}`,
        type: 'player',
        name: npcName,
        hp: stats.hp,
        maxHp: stats.hp,
        ac: stats.ac,
        classId,
      };
      const targetCell = board[pos.r]?.[pos.c];
      if (targetCell) {
        targetCell.piece = piece;
      }
      stateSeats[seatIndex] = { hp: stats.hp, maxHp: stats.hp, alive: true, isNpc: true, name: npcName, classId };
    }
  }

  const monsterSpawns = [
    { r: 4, c: 4, name: 'Goblin A', hp: 14, ac: 11 },
    { r: 4, c: 11, name: 'Goblin B', hp: 14, ac: 11 },
    { r: 8, c: 4, name: 'Goblin C', hp: 14, ac: 11 },
    { r: 8, c: 11, name: 'Goblin D', hp: 14, ac: 11 },
    { r: 6, c: 7, name: 'Goblin E', hp: 14, ac: 11 },
    { r: 6, c: 8, name: 'Goblin F', hp: 14, ac: 11 },
  ];

  monsterSpawns.forEach((spawn, idx) => {
    const targetCell = board[spawn.r]?.[spawn.c];
    if (targetCell) {
      targetCell.piece = scaleMonster({
        id: `m-${idx}`,
        type: 'goblin',
        name: spawn.name,
        hp: spawn.hp,
        maxHp: spawn.hp,
        ac: spawn.ac,
      }, difficulty);
    }
  });

  // 開局的回合一定要落在真人座位上。座位有可能開天窗（開局前坐 0 號的人離開，
  // removeMember 是把 seats[0] 設成 null 而不是往前壓），這時 nextActiveDndSeat 只看
  // stateSeats.alive 會照樣回 0 —— 那是 NPC 座位，沒有人送得出動作、autoActDnd 又回 null，
  // 房間會卡在 45 秒空轉的計時器上永遠開不了局。
  let turnSeat = SEAT_COUNT;
  for (let seat = 0; seat < SEAT_COUNT; seat++) {
    if (seats[seat] && stateSeats[seat]?.alive) {
      turnSeat = seat;
      break;
    }
  }
  if (turnSeat === SEAT_COUNT) turnSeat = nextActiveDndSeat(seats, -1, stateSeats);

  const state: DndState = {
    board,
    turnSeat,
    turnDeadline: Date.now() + TURN_MS,
    over: false,
    seats: stateSeats,
    ranking: [],
    level: 1,
    traps: [],
    fireWalls: [],
    bossSpawned: false,
    turnHasMoved: false,
    finalPhase: false,
    difficulty,
    bossSeat,
    npcController,
    won: false,
    roundCount: 0,
    villagersRescued: 0,
    villagersLost: 0,
    godWindow: 0,
    godPhase2: false,
    godMinionTotal: 0,
    phase: 'party',
    monsterMoved: new Set(),
    monsterActed: new Set(),
    fx: [],
    altarsDestroyed: 0,
    gateChiefId: null,
    allyRage: 0,
  };

  spawnTraps(state, 8, rng);
  return state;
}

export function nextActiveDndSeat(seats: Seats, currentSeat: number, stateSeats: Record<number, DndSeatInfo>): number {
  for (let step = 1; step <= 4; step++) {
    const seat = (currentSeat + step) % 4;
    const seatInfo = stateSeats[seat];
    if (seatInfo?.alive && (!seatInfo.banishedTurns || seatInfo.banishedTurns <= 0)) {
      return seat;
    }
  }
  return currentSeat;
}

/**
 * 一輪的前半：放逐倒數與回場、火牆燒人。
 * 跟後半拆開的理由是中間那段「怪物行動」可能由魔王玩家接管，要能停在中間等他輸入。
 */
/** 弓手【放血】的每輪結算：流血的怪各扣 1 點，扣到 0 就收屍。 */
function bleedMonsters(seats: Seats, state: DndState, rng: () => number): LogEvent[] {
  const events: LogEvent[] = [];
  let died = false;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = state.board[r]?.[c]?.piece;
      if (!piece || piece.type !== 'goblin') continue;
      if (!piece.bleedTurns || piece.bleedTurns <= 0) continue;

      piece.bleedTurns--;
      if (piece.invulnerable) continue;
      const bleed = piece.bleedDamage ?? 1;
      piece.hp = Math.max(0, piece.hp - bleed);
      events.push({ t: 'dndMessage', kind: 'skill', message: `💧 ${piece.name} 的傷口還在流血，失去了 ${bleed} 點 HP！` } as any);
      if (piece.hp <= 0) {
        state.board[r]![c]!.piece = null;
        events.push({ t: 'dndMessage', kind: 'skill', message: `💀 ${piece.name} 流血過多倒下了！` } as any);
        died = true;
      }
    }
  }
  if (died) checkAndSpawnBossOrStaircase(seats, state, events, rng);
  return events;
}

function beginRound(seats: Seats, state: DndState, rng: () => number, events: LogEvent[]) {
  state.roundCount++;
  events.push(...bleedMonsters(seats, state, rng));
  events.push(...tickDoom(seats, state, rng));
  if (state.level === ESCORT_LEVEL) {
    events.push(...escortReinforcements(state, rng));
  }
  if (state.level === GATE_LEVEL) {
    events.push(...gateReinforcements(state, rng));
  }

  // 【震懾】與分身的【撒網】都是在上一輪的怪物回合掛上去的，倒數必須跟放逐一樣
  // 放在回合開頭 —— 擺在 endRound 的話會在同一個 processRoundEnd 裡就被扣回 0，
  // 玩家一個回合都沒被跳過，暈眩等於完全沒有效果。
  for (let idx = 0; idx < SEAT_COUNT; idx++) {
    const seatInfo = state.seats[idx];
    if (!seatInfo) continue;
    if (seatInfo.stunnedTurns && seatInfo.stunnedTurns > 0) seatInfo.stunnedTurns--;
    if (seatInfo.restrainedTurns && seatInfo.restrainedTurns > 0) seatInfo.restrainedTurns--;
  }

  for (let idx = 0; idx < 4; idx++) {
    const seatInfo = state.seats[idx];
    if (seatInfo && seatInfo.alive && seatInfo.banishedTurns && seatInfo.banishedTurns > 0) {
      seatInfo.banishedTurns--;
      if (seatInfo.banishedTurns === 0 && seatInfo.piece) {
        // 虛空酋長的【放逐】會記下原本站的位置，回來時就回到原地；
        // 陷阱放逐沒有記位置（是被吸進異空間），回場中央。
        const origin = seatInfo.banishCell;
        const originCell = origin ? state.board[origin.r]?.[origin.c] : undefined;
        const cell = originCell?.piece === null ? originCell : findEmptyCellNearCenter(state);
        seatInfo.piece.hp = seatInfo.hp; // 離場期間血量以座位為準
        if (cell) {
          cell.piece = seatInfo.piece;
        } else {
          for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
              if (!state.board[r]?.[c]?.piece) {
                state.board[r]![c]!.piece = seatInfo.piece;
                break;
              }
            }
          }
        }
        events.push({ t: 'dndMessage', kind: 'skill', message: `🌀 ${seatInfo.piece.name.split(' ')[0]} 從異空間回歸戰場！` } as any);
        seatInfo.piece = undefined;
        seatInfo.banishCell = undefined;
      }
    }
  }

  // 火牆先燒再讓怪物行動：規則是「站在火牆裡面每回合扣 3」，
  // 等牠們走完才結算的話，被蓋在火牆下的怪只要抬腳就一點傷都不用吃。
  events.push(...burnFireWalls(seats, state));

  // 撒網的持續傷害。放在這裡而不是怪物 AI 裡，是因為被網住的怪仍然會行動
  // （只是不能移動），有魔王時牠也可能由魔王親自指揮 —— 扣血擺在回合開頭
  // 才保證「一輪剛好扣一次」。倒數則要留到 endRound，見那裡的說明。
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = state.board[r]?.[c]?.piece;
      if (!piece || piece.type !== 'goblin') continue;
      if (!piece.trappedTurns || piece.trappedTurns <= 0) continue;
      if (piece.invulnerable) continue;

      const netDmg = piece.netDamage ?? 1;
      piece.hp = Math.max(0, piece.hp - netDmg);
      events.push({
        t: 'dndMessage', kind: 'skill',
        message: `🕸️ ${piece.name} 被網子纏住，原地掙扎並受到 ${netDmg} 點傷害！`,
      } as any);
      if (piece.hp <= 0) {
        state.board[r]![c]!.piece = null;
        events.push({ t: 'dndMessage', kind: 'skill', message: `🕸️ ${piece.name} 力竭倒在網中！` } as any);
      }
    }
  }

  // 網子或火牆有可能剛好清掉這一層最後一隻怪，補一次判定才不會卡在「沒怪也沒樓梯」。
  // 但這裡是一輪的開頭，補生出來的 Boss 如果跟著同一輪的怪物回合一起動，
  // 冒險者連反應的機會都沒有（原本的判定在 endRound，牠要下一輪才下場）。
  // 所以剛降臨的怪一律記成「這一輪已經行動過」：AI 會跳過牠，魔王也指揮不動牠。
  let goblinsBefore = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (isHostile(state.board[r]?.[c]?.piece)) goblinsBefore++;
    }
  }
  checkAndSpawnBossOrStaircase(seats, state, events, rng);
  if (goblinsBefore === 0) {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const piece = state.board[r]?.[c]?.piece;
        if (piece?.type === 'goblin') state.monsterActed.add(piece.id);
      }
    }
  }
}

/** 一輪的後半：減益倒數、玩家身上的增益倒數、補一次 Boss／樓梯判定。 */
function endRound(seats: Seats, state: DndState, rng: () => number, events: LogEvent[]) {
  if (state.level === ESCORT_LEVEL) {
    events.push(...moveVillagers(state));
    resolveEscortLevel(seats, state, events, rng);
  }

  if (state.level === 5) {
    events.push(...updateEvilGod(seats, state, rng));
  }

  if (state.level === GATE_LEVEL) {
    // 怪物的死亡處理散在攻擊、反射、判官、火牆好幾處，與其每一處都掛鉤子，
    // 不如在這裡看牠還在不在棋盤上 —— 不在就是這一輪被打死了。
    if (state.gateChiefId !== null && findPieceById(state, state.gateChiefId) === null) {
      state.gateChiefId = null;
      empowerParty(seats, state, events);
    }
    for (let idx = 0; idx < SEAT_COUNT; idx++) {
      const info = state.seats[idx];
      if (!info?.corruptedTurns || info.corruptedTurns <= 0) continue;
      info.corruptedTurns--;
      if (info.corruptedTurns === 0) {
        events.push({
          t: 'dndMessage', kind: 'skill',
          message: `✨ ${info.name?.split(' ')[0] ?? `P${idx + 1}`} 的聖物洗去了穢氣，效果恢復了！`,
        } as any);
      }
    }
  }

  // 隨從的鬥志只撐這一輪，等牠們動完才遞減
  if (state.allyRage > 0) state.allyRage--;

  // 減益要撐過怪物回合才遞減，這樣【削弱】才會真的作用在牠那次攻擊上
  tickMonsterDebuffs(state);

  // 網子的倒數跟減益同理，要撐過怪物回合才遞減：beginRound 先扣血，怪物回合讀到的
  // 還是「仍被網住」，這樣 ROGUE_NET_TURNS 回合就是實打實的 N 次扣血 + N 輪動不了。
  // 在 beginRound 就遞減的話最後一輪會扣了血卻還能走，變成只綁得住 N-1 輪。
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = state.board[r]?.[c]?.piece;
      if (piece?.type === 'goblin' && piece.trappedTurns && piece.trappedTurns > 0) {
        piece.trappedTurns--;
      }
    }
  }

  // 【極限防禦】保護的就是上面這個怪物回合，所以要等它跑完才遞減；
  // 【恐懼】則是綁玩家自己的回合，跟放逐一樣一輪扣一格。
  for (let idx = 0; idx < SEAT_COUNT; idx++) {
    const seatInfo = state.seats[idx];
    if (!seatInfo) continue;
    if (seatInfo.damageCapTurns && seatInfo.damageCapTurns > 0) {
      seatInfo.damageCapTurns--;
      if (seatInfo.damageCapTurns === 0) seatInfo.damageCap = undefined;
    }
    // 吟遊詩人的三首歌都只撐一輪，跟極限防禦一樣要熬過怪物回合才遞減
    if (seatInfo.dmgBuffTurns && seatInfo.dmgBuffTurns > 0) {
      seatInfo.dmgBuffTurns--;
      if (seatInfo.dmgBuffTurns === 0) seatInfo.dmgBuffRatio = undefined;
    }
    if (seatInfo.acBuffTurns && seatInfo.acBuffTurns > 0) {
      seatInfo.acBuffTurns--;
      if (seatInfo.acBuffTurns === 0) seatInfo.acBuffAmount = undefined;
    }
    if (seatInfo.hitBuffTurns && seatInfo.hitBuffTurns > 0) {
      seatInfo.hitBuffTurns--;
      if (seatInfo.hitBuffTurns === 0) seatInfo.hitBuffAmount = undefined;
    }
    // 【狙擊】的窗口
    if (seatInfo.sniperTurns && seatInfo.sniperTurns > 0) {
      seatInfo.sniperTurns--;
      if (seatInfo.sniperTurns === 0) {
        events.push({
          t: 'dndMessage', kind: 'skill',
          message: `🎯 ${seatInfo.name?.split(' ')[0] ?? `P${idx + 1}`} 的弓弦鬆了下來 —— 【狙擊】的視野收了回來。`,
        } as any);
      }
    }
    if (seatInfo.fearTurns && seatInfo.fearTurns > 0) {
      seatInfo.fearTurns--;
      if (seatInfo.fearTurns === 0) {
        events.push({
          t: 'dndMessage', kind: 'skill',
          message: `😮‍💨 ${seatInfo.name?.split(' ')[0] ?? `P${idx + 1}`} 擺脫了【恐懼】，行動恢復正常。`,
        } as any);
      }
    }
  }

  // 怪物也可能死在自己的回合裡（被撒網纏住持續扣血、或被火牆燒死），那些路徑沒有經過玩家的
  // 擊殺判定，這裡補一次檢查，否則這層會變成「沒有怪、也沒有 Boss／樓梯」的死局。
  checkAndSpawnBossOrStaircase(seats, state, events, rng);

  // 魔王的指令紀錄只在一輪之內有效（beginRound 補生的怪也是靠它擋下來的），
  // 一輪結算完就清空。這裡是每條路徑都會經過的收尾，所以擺在這裡而不是各自清。
  state.monsterMoved.clear();
  state.monsterActed.clear();
}

/**
 * 受困／暈眩的怪物本來就沒得選，魔王回合一開始就直接替牠們結算掉，
 * 並記進 monsterActed —— 魔王不能拿牠們來行動，AI 之後也不會再處理一次。
 */
function autoResolveHelplessMonsters(state: DndState): LogEvent[] {
  const events: LogEvent[] = [];

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = state.board[r]?.[c]?.piece;
      if (!piece || piece.type !== 'goblin') continue;

      if (piece.stunnedTurns && piece.stunnedTurns > 0) {
        piece.stunnedTurns--;
        state.monsterActed.add(piece.id);
        events.push({ t: 'dndMessage', message: `💫 ${piece.name} 還暈著，這一輪動不了。` } as any);
      }
    }
  }

  return events;
}

/**
 * 魔王結束怪物回合：沒被他指揮過的怪交給原本的 AI 打完，
 * 跑完後半段結算，再把回合交還給冒險者。逾時代打走的也是這條。
 */
function finishBossTurn(
  seats: Seats,
  state: DndState,
  events: LogEvent[],
  rng: () => number,
): DndApplyResult {
  events.push(...runAlliesTurn(seats, state, rng));
  events.push(...runMonstersTurn(seats, state, rng));
  endRound(seats, state, rng, events); // monsterMoved／monsterActed 由 endRound 清掉
  state.phase = 'party';

  const result = checkDndGameOver(seats, state);
  if (result.over) {
    state.over = true;
    state.won = result.won;
    state.ranking = result.ranking;
    events.push({ t: 'dndOver', won: result.won });
    return { ok: true, events };
  }

  // 魔王的回合是卡在座位環接縫上的，接回來就從座位 0 重新往下找，
  // 而且這一輪已經結算過了，不能在同一個接縫再算一次。
  return advanceParty(seats, state, SEAT_COUNT - 1, events, rng, true);
}

/** 沒有魔王時的完整一輪：前半 → 怪物 AI → 後半。 */
function processRoundEnd(seats: Seats, state: DndState, rng: () => number, events: LogEvent[]) {
  beginRound(seats, state, rng, events);
  events.push({ t: 'dndMonsterTurn' }); // 戰報上的分隔線，要排在怪物的動作前面
  events.push(...runAlliesTurn(seats, state, rng));
  events.push(...runMonstersTurn(seats, state, rng));
  endRound(seats, state, rng, events);
}

export type DndApplyResult =
  | { ok: true; events: LogEvent[] }
  | { ok: false; error: DndError };

export function applyDndAction(
  seats: Seats,
  state: DndState,
  playerId: PlayerId,
  action: DndAction,
  rng: () => number = Math.random,
): DndApplyResult {
  if (state.over) return { ok: false, error: 'GAME_NOT_RUNNING' };

  const activeSeat = state.turnSeat;
  // 座位的主人自己送，或是 NPC 座位由指定的代打者（房主）送，兩種都放行
  const seatOwner = seats[activeSeat] ?? null;
  const npcSeatByController =
    seatOwner === null &&
    state.seats[activeSeat]?.isNpc === true &&
    state.npcController === playerId;
  if (seatOwner !== playerId && !npcSeatByController) {
    return { ok: false, error: 'NOT_YOUR_TURN' };
  }

  // 技能特效只代表「剛剛這一次」，所以每次行動先歸零。
  // 要在輪次檢查之後 —— 不然別人手快點一下，就把上一手的技能圖示從所有人的畫面上抹掉。
  state.fx = [];

  if (
    action.kind === 'bossMove' ||
    action.kind === 'bossAttack' ||
    action.kind === 'bossHold' ||
    action.kind === 'bossEnd'
  ) {
    return applyBossAction(seats, state, action, rng);
  }
  // 魔王沒有棋子，冒險者的動作對他一律無效
  if (state.phase === 'boss') return { ok: false, error: 'NOT_BOSS_TURN' };

  const acting = findSeatPiece(seats, state, activeSeat);
  if (!acting) return { ok: false, error: 'BAD_ACTION' };
  let { r: pr, c: pc } = acting;
  const playerPiece = acting.piece;

  const events: LogEvent[] = [];

  let currentAction = action;
  if (action.kind === 'turnCombo') {
    // 終結動作要先驗證再套用移動：移動（甚至換層）已經寫進 state 之後才回錯誤的話，
    // handlers 會直接 return 不廣播，客戶端會停在舊棋盤、伺服器卻已經前進了一層。
    if (!action.action) return { ok: false, error: 'BAD_ACTION' };

    if (action.move) {
      if (state.turnHasMoved) return { ok: false, error: 'ALREADY_MOVED' };
      const wanted = fearedTarget(state, activeSeat, pr, pc, action.move.r, action.move.c);
      const tr = wanted.r;
      const tc = wanted.c;
      if (wanted.feared) {
        events.push({ t: 'dndMessage', kind: 'skill', message: `😱 ${playerPiece.name.split(' ')[0]} 被【恐懼】支配，朝著反方向踉蹌走去！` } as any);
      }

      const classId = playerPiece.classId || 'brave';
      const maxMove = DND_CLASS_MOVE[classId as DndClassId] ?? 1;
      if ((state.seats[activeSeat]?.restrainedTurns ?? 0) > 0) {
        return { ok: false, error: 'PLAYER_RESTRAINED' };
      }
      const dist = Math.abs(pr - tr) + Math.abs(pc - tc);
      // dist === 0 要擋掉：來源格與目標格會是同一格，先寫入再清空等於把角色從棋盤上抹掉
      if (dist === 0 || dist > maxMove) return { ok: false, error: 'INVALID_CELL' };

      const targetCell = state.board[tr]?.[tc];
      const sourceCell = state.board[pr]?.[pc];

      if (!targetCell || !sourceCell) return { ok: false, error: 'INVALID_CELL' };
      if (targetCell.piece !== null && targetCell.piece.type !== 'staircase') {
        return { ok: false, error: 'CELL_OCCUPIED' };
      }

      const destHadStaircase = targetCell.piece?.type === 'staircase';
      targetCell.piece = playerPiece;
      sourceCell.piece = null;

      events.push({ t: 'dndMove', player: playerPiece.name, dir: 'moveTo' } as any);
      const postEvents = onPlayerMoveToCell(seats, state, playerPiece, tr, tc, destHadStaircase, rng);
      events.push(...postEvents);

      state.turnHasMoved = true;
      pr = tr;
      pc = tc;

      if (movementInterrupted(state, activeSeat, postEvents)) {
        // 換層（棋盤重置）或踩到陷阱被放逐（角色離場）之後，pr/pc 與 targetId 全部失效，
        // 這回合的終結動作直接跳過，照常收尾交棒。
        return finishDndTurn(seats, state, activeSeat, 'move', events, rng);
      }
    }

    currentAction = action.action;
  }

  const kind = currentAction.kind;
  const dir = currentAction.dir;
  const targetId = currentAction.targetId;

  if (kind === 'move' || kind === 'moveTo') {
    if (state.turnHasMoved) return { ok: false, error: 'ALREADY_MOVED' };
    // 被分身撒網纏住就不能移動。這裡是「單獨按移動」的路徑，跟 turnCombo 裡
    // 那一份是兩條獨立的入口，漏掉這邊等於網子只擋得住「移動＋攻擊」的組合技。
    if ((state.seats[activeSeat]?.restrainedTurns ?? 0) > 0) {
      return { ok: false, error: 'PLAYER_RESTRAINED' };
    }

    let tr = pr;
    let tc = pc;

    if (kind === 'move') {
      if (!dir) return { ok: false, error: 'BAD_ACTION' };
      if (dir === 'up') tr--;
      else if (dir === 'down') tr++;
      else if (dir === 'left') tc--;
      else if (dir === 'right') tc++;
    } else {
      if (currentAction.r === undefined || currentAction.c === undefined) return { ok: false, error: 'BAD_ACTION' };
      tr = currentAction.r;
      tc = currentAction.c;
      const classId = playerPiece.classId || 'brave';
      const maxMove = DND_CLASS_MOVE[classId as DndClassId] ?? 1;
      const dist = Math.abs(pr - tr) + Math.abs(pc - tc);
      if (dist > maxMove || dist === 0) return { ok: false, error: 'INVALID_CELL' };
    }

    const wanted = fearedTarget(state, activeSeat, pr, pc, tr, tc);
    tr = wanted.r;
    tc = wanted.c;
    if (wanted.feared) {
      events.push({ t: 'dndMessage', kind: 'skill', message: `😱 ${playerPiece.name.split(' ')[0]} 被【恐懼】支配，朝著反方向踉蹌走去！` } as any);
    }

    const targetCell = state.board[tr]?.[tc];
    const sourceCell = state.board[pr]?.[pc];

    if (!targetCell || !sourceCell) {
      return { ok: false, error: 'INVALID_CELL' };
    }

    if (targetCell.piece !== null && targetCell.piece.type !== 'staircase') {
      return { ok: false, error: 'CELL_OCCUPIED' };
    }

    const destHadStaircase = targetCell.piece?.type === 'staircase';

    targetCell.piece = playerPiece;
    sourceCell.piece = null;

    events.push({ t: 'dndMove', player: playerPiece.name, dir: dir ?? 'moveTo' });

    const postEvents = onPlayerMoveToCell(seats, state, playerPiece, tr, tc, destHadStaircase, rng);
    events.push(...postEvents);

    state.turnHasMoved = true;

    if (movementInterrupted(state, activeSeat, postEvents)) {
      // 角色已離場或棋盤已重置，這回合不可能再做任何事，直接收尾交棒 ——
      // 留著回合給一個不在棋盤上的人，autoActDnd 會永遠找不到棋子而空轉。
      return finishDndTurn(seats, state, activeSeat, 'move', events, rng);
    }

    const moveOverCheck = checkDndGameOver(seats, state);
    if (moveOverCheck.over) {
      state.over = true;
      state.won = moveOverCheck.won;
      state.ranking = moveOverCheck.ranking;
      events.push({ t: 'dndOver', won: moveOverCheck.won });
    }

    return { ok: true, events };
  } else if (kind === 'attack') {
    if (!targetId) return { ok: false, error: 'BAD_ACTION' };

    let tr = -1, tc = -1;
    let targetPiece: DndPiece | null = null;
    for (let r = 0; r < BOARD_SIZE; r++) {
      const row = state.board[r];
      if (!row) continue;
      for (let c = 0; c < BOARD_SIZE; c++) {
        const piece = row[c]?.piece;
        if (piece && piece.id === targetId) {
          tr = r;
          tc = c;
          targetPiece = piece;
          break;
        }
      }
    }

    if (!targetPiece) return { ok: false, error: 'TARGET_NOT_FOUND' };
    // 只能打怪。少了這道檢查，客戶端送一個隊友或樓梯的 id 過來就會真的扣血：
    // 隊友的棋子被打到 0 會從棋盤上被清掉，但 state.seats 的 hp/alive 完全沒同步，
    // 那位玩家從此送不出任何動作，checkDndGameOver 也永遠當他還活著、判不出結束。
    if (targetPiece.type !== 'goblin' && targetPiece.type !== 'altar') {
      return { ok: false, error: 'TARGET_NOT_FOUND' };
    }
    // 自己的隨從不是目標
    if (targetPiece.ally) return { ok: false, error: 'TARGET_NOT_FOUND' };
    if (targetPiece.invulnerable) return { ok: false, error: 'TARGET_INVULNERABLE' };

    const classId = playerPiece.classId || 'brave';
    const maxRange = DND_CLASS_RANGE[classId as DndClassId] ?? 1;
    const dist = Math.abs(pr - tr) + Math.abs(pc - tc);
    // 【狙擊】開著的時候，弓手打得到地圖上的任何一格
    const sniperOpen = classId === 'archer' && (state.seats[activeSeat]?.sniperTurns ?? 0) > 0;
    if (dist > maxRange && !sniperOpen) return { ok: false, error: 'TARGET_OUT_OF_RANGE' };

    // 【匿蹤】：出手就現身。要擺在所有檢查之後 —— 打不到的目標會回錯誤、事件被丟掉，
    // 但狀態改動不會跟著回滾，站得太前面的話一次無效點擊就白白現身。
    if (state.seats[activeSeat]?.stealth) {
      setStealth(seats, state, activeSeat, false);
      events.push({ t: 'dndMessage', kind: 'skill', message: `🗡️ ${playerPiece.name.split(' ')[0]} 從陰影中撲出 —— 【匿蹤】解除！` } as any);
    }

    const stats = CLASS_STATS[classId as DndClassId];
    const roll = Math.floor(rng() * 20) + 1;
    const hitBonus = attackBonusOf(seats, state, activeSeat, classId as DndClassId);

    const isFirstRogueHit = classId === 'bubble' && !targetPiece.damagedByRogue;
    const isHit = isFirstRogueHit ? true : roll + hitBonus >= targetPiece.ac;
    // 【骰子匕首】：命中骰乘上比例當追加傷害，揮空一樣照打
    const daggerSpec = classId === 'bubble' ? equipmentOf(state, activeSeat) : null;
    const daggerDamage = daggerSpec ? Math.round(roll * daggerSpec.diceRatio) : 0;

    // 這一刀真正造成的傷害。弓手的【穿刺】要拿它當貫穿的力道，
    // 所以要在 isHit 分支外面宣告。
    let damageDealt = 0;

    if (isHit) {
      const dmgRoll = Math.floor(rng() * stats.dmgDice) + 1;
      let damage = dmgRoll + stats.dmgFlat + daggerDamage + bardAuraOf(seats, state);
      // 【進擊之歌】：這一輪全隊的傷害都放大
      const march = damageBuffOf(state, activeSeat);
      if (march > 0) damage = Math.round(damage * (1 + march));

      if (classId === 'bubble') {
        if (!targetPiece.damagedByRogue) {
          targetPiece.damagedByRogue = true;
        }
      }

      // 鬥士的被動吃這一刀的傷害數字，所以要在扣血之前結算：
      // 【致命斬殺】放大傷害、【旋風】拿這個數字去掃周圍。揮空時不發動（傷害是 0）。
      if (classId === 'gladiator' && targetPiece.type === 'goblin') {
        const swing = gladiatorPassive(
          state, activeSeat, playerPiece, pr, pc, targetPiece.id, damage, rng,
        );
        damage = swing.damage;
        events.push(...swing.events);
      }

      targetPiece.hp = Math.max(0, targetPiece.hp - damage);
      damageDealt = damage;

      if (targetPiece.id === 'boss-1') {
        let cloneCount = 0;
        for (let r = 0; r < BOARD_SIZE; r++) {
          for (let c = 0; c < BOARD_SIZE; c++) {
            if (state.board[r]?.[c]?.piece?.id.startsWith('boss-1-clone')) {
              cloneCount++;
            }
          }
        }
        if (cloneCount < 7) {
          const adj = [
            { r: tr - 1, c: tc }, { r: tr + 1, c: tc },
            { r: tr, c: tc - 1 }, { r: tr, c: tc + 1 }
          ];
          for (const pos of adj) {
            const cell = state.board[pos.r]?.[pos.c];
            if (cell && cell.piece === null) {
              cell.piece = {
                id: `boss-1-clone-${Date.now()}-${Math.floor(rng()*1000)}`,
                type: 'goblin',
                name: 'Warlord (分身)',
                hp: Math.ceil(targetPiece.maxHp / 2),
                maxHp: Math.ceil(targetPiece.maxHp / 2),
                ac: Math.ceil(targetPiece.ac * (2 / 3))
              };
              events.push({ t: 'dndMessage', message: `👥 Goblin Warlord 受到攻擊，分裂出了一隻分身！` } as any);
              break;
            }
          }
        }
      }

      if (classId === 'star') {
        let bestTargetPiece: DndPiece | null = null;
        let lowestRatio = 1.1;

        for (let r = 0; r < BOARD_SIZE; r++) {
          for (let c = 0; c < BOARD_SIZE; c++) {
            const piece = state.board[r]?.[c]?.piece;
            if (piece && piece.type === 'player') {
              let seatIdx = -1;
              if (piece.playerId) {
                seatIdx = seats.indexOf(piece.playerId);
              } else if (piece.id.startsWith('npc-')) {
                seatIdx = parseInt(piece.id.split('-')[1]!, 10);
              }
              if (seatIdx !== -1 && state.seats[seatIdx]?.alive) {
                const ratio = piece.hp / piece.maxHp;
                if (ratio < lowestRatio) {
                  lowestRatio = ratio;
                  bestTargetPiece = piece;
                }
              }
            }
          }
        }

        if (bestTargetPiece) {
          const healAmt = 1;
          bestTargetPiece.hp = Math.min(bestTargetPiece.maxHp, bestTargetPiece.hp + healAmt);
          
          let targetSeatIdx = -1;
          if (bestTargetPiece.playerId) {
            targetSeatIdx = seats.indexOf(bestTargetPiece.playerId);
          } else if (bestTargetPiece.id.startsWith('npc-')) {
            targetSeatIdx = parseInt(bestTargetPiece.id.split('-')[1]!, 10);
          }
          if (targetSeatIdx !== -1 && state.seats[targetSeatIdx]) {
            state.seats[targetSeatIdx]!.hp = bestTargetPiece.hp;
          }

          events.push({
            t: 'dndAttack',
            player: playerPiece.name,
            target: bestTargetPiece.name,
            roll: 0,
            hit: true,
            damage: -healAmt,
          });
        }
      }

      events.push({
        t: 'dndAttack',
        player: playerPiece.name,
        target: targetPiece.name,
        roll,
        hit: true,
        damage,
      });

      // 複製騎士的分身也會反射 —— 照著你的模樣捏出來的，當然連反射一起抄
      if (targetPiece.copyClass === 'brave' && playerPiece.hp > 0) {
        const bounced = Math.round(damage * WARRIOR_REFLECT_RATIO);
        if (bounced > 0) {
          playerPiece.hp = Math.max(0, playerPiece.hp - bounced);
          if (state.seats[activeSeat]) state.seats[activeSeat]!.hp = playerPiece.hp;
          events.push({
            t: 'dndMessage', kind: 'skill',
            message: `🪞 ${targetPiece.name} 把 ${bounced} 點傷害原封不動彈了回來！`,
          } as any);
          if (playerPiece.hp <= 0) {
            if (state.seats[activeSeat]) state.seats[activeSeat]!.alive = false;
            const selfCell = state.board[pr]?.[pc];
            if (selfCell && selfCell.piece?.id === playerPiece.id) selfCell.piece = null;
          }
        }
      }

      if (targetPiece.hp <= 0) {
        resolveTargetDeath(seats, state, targetPiece, tr, tc, events, rng);
      } else {
        events.push(...checkBossFinalPhase(state, rng));
      }
      // 【旋風】掃到的怪可能已經倒下，這裡一起收
      if (classId === 'gladiator') events.push(...sweepDeadMonsters(seats, state, rng));
    } else if (daggerDamage > 0) {
      // 【骰子匕首】：這一刀揮空了，但匕首上的骰子照樣咬下一塊肉
      // （特效掛在揮刀的人身上，讓玩家知道傷害是哪來的）
      targetPiece.hp = Math.max(0, targetPiece.hp - daggerDamage);
      events.push({
        t: 'dndAttack',
        player: playerPiece.name,
        target: targetPiece.name,
        roll,
        hit: true,
        damage: daggerDamage,
      });
      events.push({
        t: 'dndMessage', kind: 'skill',
        message: `🎲 ${playerPiece.name.split(' ')[0]} 揮空了，但【骰子匕首】仍劃出 ${daggerDamage} 點傷害！`,
      } as any);

      if (targetPiece.hp <= 0) {
        resolveTargetDeath(seats, state, targetPiece, tr, tc, events, rng);
      }
    } else {
      events.push({
        t: 'dndAttack',
        player: playerPiece.name,
        target: targetPiece.name,
        roll,
        hit: false,
        damage: 0,
      });
    }

    // 職業被動：不論這一刀有沒有砍中都會發動，只要目標還站著。
    // （屍體不需要暈眩，也不該被擊退，所以死掉就不跑）
    if (targetPiece.type === 'goblin' && targetPiece.hp > 0 && findPieceById(state, targetPiece.id)) {
      const tNow = findPieceById(state, targetPiece.id)!;
      if (classId === 'brave') {
        events.push(...warriorPassive(seats, state, playerPiece, targetPiece, tNow.r, tNow.c, pr, pc, rng));
      } else if (classId === 'archer') {
        // 揮空的箭沒有貫穿的力道，穿刺傳 0 進去（放血照樣會發動）
        events.push(...archerPassive(state, activeSeat, playerPiece, pr, pc, tNow, isHit ? damageDealt : 0, rng));
        // 穿刺可能把後面那隻打死，順手收屍
        events.push(...sweepDeadMonsters(seats, state, rng));
      } else if (classId === 'bard') {
        events.push(...bardPassive(seats, state, playerPiece, activeSeat, rng));
      } else if (classId === 'summoner') {
        events.push(...summonerPassive(state, tNow.piece, tNow.r, tNow.c, rng));
      } else if (classId === 'bubble') {
        events.push(...roguePassive(state, playerPiece, targetPiece, rng));
      } else if (classId === 'tangerine') {
        events.push(...magePassive(state, playerPiece, pr, pc, tNow, rng));
      }
    }

    /*
     * 【狙擊】窗口期間的連射。
     *
     * 第一箭走上面那條一般流程（命中骰、傷害、被動全部照舊），剩下的箭在這裡補 ——
     * 把整段攻擊包成迴圈會動到督軍分裂、判官汲取那幾段跟「一次攻擊」綁在一起的邏輯，
     * 補在後面是風險最小的做法。每一箭各自擲命中、各自算傷害，也各自可能觸發放血與穿刺。
     */
    if (classId === 'archer' && sniperOpen) {
      const extra = (equipmentOf(state, activeSeat)?.sniperShots ?? 1) - 1;
      for (let i = 0; i < extra; i++) {
        const victim = findPieceById(state, targetPiece.id);
        if (!victim || !isHostile(victim.piece) || victim.piece.hp <= 0) break;
        if (victim.piece.invulnerable) break;

        const extraRoll = Math.floor(rng() * 20) + 1;
        const extraHit = extraRoll + hitBonus >= victim.piece.ac;
        let extraDamage = 0;
        if (extraHit) {
          extraDamage = Math.floor(rng() * stats.dmgDice) + 1 + stats.dmgFlat + bardAuraOf(seats, state);
          const extraMarch = damageBuffOf(state, activeSeat);
          if (extraMarch > 0) extraDamage = Math.round(extraDamage * (1 + extraMarch));
          victim.piece.hp = Math.max(0, victim.piece.hp - extraDamage);
        }
        events.push({
          t: 'dndAttack',
          player: playerPiece.name,
          target: victim.piece.name,
          roll: extraRoll,
          hit: extraHit,
          damage: extraDamage,
        });

        const still = findPieceById(state, targetPiece.id);
        if (still && still.piece.hp > 0) {
          events.push(...archerPassive(state, activeSeat, playerPiece, pr, pc, still, extraDamage, rng));
        }
        events.push(...sweepDeadMonsters(seats, state, rng));
      }
    }

    // 【神聖判官】：自己回血，目標扣掉等量的血。【法杖】把汲取量提升到 2/3/4。
    if (classId === 'star' && playerPiece.hp > 0 && targetPiece.type === 'goblin') {
      const drain = equipmentOf(state, activeSeat)?.healSelfOnAttack ?? 1;
      const victim = findPieceById(state, targetPiece.id);
      pushFx(state, playerPiece.id, 'judge');

      playerPiece.hp = Math.min(playerPiece.maxHp, playerPiece.hp + drain);
      if (state.seats[activeSeat]) state.seats[activeSeat]!.hp = playerPiece.hp;

      if (victim && !victim.piece.invulnerable) {
        victim.piece.hp = Math.max(0, victim.piece.hp - drain);
        events.push({
          t: 'dndMessage', kind: 'skill',
          message: `⚖️ ${playerPiece.name.split(' ')[0]} 的【神聖判官】從 ${victim.piece.name} 身上汲取了 ${drain} 點生命。`,
        } as any);

        if (victim.piece.hp <= 0) {
          const cell = state.board[victim.r]?.[victim.c];
          if (cell && cell.piece?.id === victim.piece.id) cell.piece = null;
          checkAndSpawnBossOrStaircase(seats, state, events, rng);
        }
      } else {
        events.push({
          t: 'dndMessage', kind: 'skill',
          message: `🙏 ${playerPiece.name.split(' ')[0]} 的信仰之力湧現，補充了自己 ${drain} 點 HP。`,
        } as any);
      }
    }
  } else if (kind === 'rest') {
    // 【巨劍】讓鬥士靠休息回得更快；腐化期間 equipmentOf 回 null，自動退回 1 點
    const restBonus = playerPiece.classId === 'gladiator'
      ? (equipmentOf(state, activeSeat)?.restBonus ?? 0)
      : 0;
    const restHeal = 1 + restBonus;
    playerPiece.hp = Math.min(playerPiece.maxHp, playerPiece.hp + restHeal);
    if (state.seats[activeSeat]) {
      state.seats[activeSeat]!.hp = playerPiece.hp;
    }
    events.push({ t: 'dndMessage', message: `🏕️ ${playerPiece.name.split(' ')[0]} 選擇原地休息，恢復了 ${restHeal} 點 HP。` } as any);
    // 【匿蹤】：停手一回合就重新藏起來
    if (state.seats[activeSeat]?.equipment?.kind === 'bubble' && !state.seats[activeSeat]?.stealth) {
      setStealth(seats, state, activeSeat, true);
      pushFx(state, playerPiece.id, 'stealth');
      events.push({ t: 'dndMessage', kind: 'skill', message: `🌫️ ${playerPiece.name.split(' ')[0]} 隱沒進陰影裡 —— 【匿蹤】恢復了。` } as any);
    }

  } else if (kind === 'skill') {
    const classId = playerPiece.classId || 'brave';

    const cd = state.seats[activeSeat]?.skillCooldown;
    if (cd && cd > 0) return { ok: false, error: 'SKILL_ON_COOLDOWN' };

    if (classId === 'star') { 
      if (!targetId) return { ok: false, error: 'BAD_ACTION' };
      let tr = -1, tc = -1, targetPiece: DndPiece | null = null;
      
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          const piece = state.board[r]?.[c]?.piece;
          if (piece && piece.id === targetId && piece.type === 'player') {
            tr = r; tc = c; targetPiece = piece;
          }
        }
      }
      if (!targetPiece) return { ok: false, error: 'TARGET_NOT_FOUND' };
      
      const dist = Math.abs(pr - tr) + Math.abs(pc - tc);
      if (dist > CLERIC_HEAL_RANGE) return { ok: false, error: 'TARGET_OUT_OF_RANGE' };

      const staff = equipmentOf(state, activeSeat);
      const healAmt = staff?.healMain ?? CLERIC_HEAL_AMOUNT;
      targetPiece.hp = Math.min(targetPiece.maxHp, targetPiece.hp + healAmt);
      
      let tSeatIdx = -1;
      if (targetPiece.playerId) tSeatIdx = seats.indexOf(targetPiece.playerId);
      else if (targetPiece.id.startsWith('npc-')) tSeatIdx = parseInt(targetPiece.id.split('-')[1]!, 10);
      
      if (tSeatIdx !== -1 && state.seats[tSeatIdx]) {
        state.seats[tSeatIdx]!.hp = targetPiece.hp;
      }
      events.push({ t: 'dndMessage', kind: 'skill', message: `✨ ${playerPiece.name.split(' ')[0]} 施放治癒術，恢復了 ${targetPiece.name.split(' ')[0]} ${healAmt} 點 HP！` } as any);

      // 【法杖】：主目標以外的隊員也一起回血
      if (staff && staff.healSplash > 0) {
        for (let seat = 0; seat < SEAT_COUNT; seat++) {
          const info = state.seats[seat];
          if (!info?.alive) continue;
          const ally = findSeatPiece(seats, state, seat)?.piece;
          if (!ally || ally.id === targetPiece.id) continue;
          ally.hp = Math.min(ally.maxHp, ally.hp + staff.healSplash);
          info.hp = ally.hp;
        }
        events.push({
          t: 'dndMessage', kind: 'skill',
          message: `🔮 法杖的光芒擴散開來，其他隊員各恢復了 ${staff.healSplash} 點 HP！`,
        } as any);
      }
      
    } else if (classId === 'bubble') {
      // 【撒網】：對 5 格內的一隻怪物撒網把牠拘束住
      if (!targetId) return { ok: false, error: 'BAD_ACTION' };
      const netted = findPieceById(state, targetId);
      if (!netted || !isHostile(netted.piece)) return { ok: false, error: 'TARGET_NOT_FOUND' };

      const dist = Math.abs(pr - netted.r) + Math.abs(pc - netted.c);
      if (dist > ROGUE_NET_RANGE) return { ok: false, error: 'TARGET_OUT_OF_RANGE' };

      // 【骰子匕首】讓網子綁得更久、燒得更痛
      const daggerNet = equipmentOf(state, activeSeat);
      const netTurns = ROGUE_NET_TURNS + (daggerNet?.netBonusTurns ?? 0);
      const netDamage = 1 + (daggerNet?.netBonusDamage ?? 0);
      netted.piece.trappedTurns = netTurns;
      netted.piece.netDamage = netDamage;
      pushFx(state, netted.piece.id, 'net');
      // 撒網一樣是出手，藏不住
      if (state.seats[activeSeat]?.stealth) {
        setStealth(seats, state, activeSeat, false);
        events.push({ t: 'dndMessage', kind: 'skill', message: `🗡️ ${playerPiece.name.split(' ')[0]} 出手撒網，【匿蹤】解除！` } as any);
      }

      // 虛空酋長靠瞬移，網子綁不住牠的位置（isRestrained 的例外），戰報別謊報「被釘在原地」
      const rogueName = playerPiece.name.split(' ')[0];
      events.push({
        t: 'dndMessage', kind: 'skill',
        message: isRestrained(netted.piece)
          ? `🕸️ ${rogueName} 撒出羅網纏住 ${netted.piece.name}，接下來 ${netTurns} 回合牠被釘在原地，每回合扣 ${netDamage} 點 HP！`
          : `🕸️ ${rogueName} 撒出羅網纏住 ${netted.piece.name}，但牠一個瞬移就掙開了 —— 接下來 ${netTurns} 回合每回合仍會扣 ${netDamage} 點 HP！`,
      } as any);

    } else if (classId === 'brave') {
      const shield = equipmentOf(state, activeSeat);
      const chainReach = shield ? shield.chainRange : 3;

      // 鎖鏈也可以拉隊友（把後排拖回身邊、或把快死的人拉離火線），
      // 但一次只拉一個人 —— 指定隊友時就走單體分支，不會順便把怪物一起捲過來。
      const ally = targetId && targetId !== playerPiece.id
        ? findPieceById(state, targetId)
        : null;
      if (ally && ally.piece.type === 'player') {
        const dist = Math.abs(pr - ally.r) + Math.abs(pc - ally.c);
        if (dist > chainReach) return { ok: false, error: 'TARGET_OUT_OF_RANGE' };

        const spot = freeCellNextTo(state, pr, pc);
        const who = playerPiece.name.split(' ')[0];
        if (!spot) {
          events.push({ t: 'dndMessage', kind: 'skill', message: `⛓️ ${who} 施放【鎖鏈】，但周圍沒有空間可以把 ${ally.piece.name} 拉過來！` } as any);
        } else {
          state.board[spot.r]![spot.c]!.piece = ally.piece;
          state.board[ally.r]![ally.c]!.piece = null;
          pushFx(state, ally.piece.id, 'chain');
          events.push({ t: 'dndMessage', kind: 'skill', message: `⛓️ ${who} 甩出【鎖鏈】，把隊友 ${ally.piece.name} 拉到了自己身旁！` } as any);
        }

      } else if (shield) {
        // 【反射盾】把鎖鏈從單體改成範圍：把 chainRange 內的怪全部拖到身邊，
        // 由近到遠拉，身旁沒位置就停手。
        const haul: Array<{ piece: DndPiece; r: number; c: number; dist: number }> = [];
        for (let r = 0; r < BOARD_SIZE; r++) {
          for (let c = 0; c < BOARD_SIZE; c++) {
            const piece = state.board[r]?.[c]?.piece;
            if (!piece || piece.type !== 'goblin') continue;
            const dist = Math.abs(pr - r) + Math.abs(pc - c);
            if (dist > 0 && dist <= shield.chainRange) haul.push({ piece, r, c, dist });
          }
        }
        haul.sort((a, b) => a.dist - b.dist);

        const pulled: string[] = [];
        for (const mon of haul) {
          const spot = freeCellNextTo(state, pr, pc);
          if (!spot) break;
          const from = state.board[mon.r]?.[mon.c];
          const to = state.board[spot.r]?.[spot.c];
          if (!from || !to) continue;
          to.piece = mon.piece;
          from.piece = null;
          pushFx(state, mon.piece.id, 'chain');
          pulled.push(mon.piece.name);
        }

        if (pulled.length === 0) {
          events.push({ t: 'dndMessage', kind: 'skill', message: `⛓️ ${playerPiece.name.split(' ')[0]} 揮出【鎖鏈】，但範圍內沒有怪物、或身旁已經沒有空間了！` } as any);
        } else {
          events.push({
            t: 'dndMessage', kind: 'skill',
            message: `⛓️ ${playerPiece.name.split(' ')[0]} 的【反射盾】共鳴，鎖鏈把 ${pulled.length} 隻怪物一起拖到了身邊！（${pulled.join('、')}）`,
          } as any);
        }
      } else {
        if (!targetId) return { ok: false, error: 'BAD_ACTION' };
        let tr = -1, tc = -1, targetMonster: DndPiece | null = null;
        for (let r = 0; r < BOARD_SIZE; r++) {
          for (let c = 0; c < BOARD_SIZE; c++) {
            const p = state.board[r]?.[c]?.piece;
            if (p && p.id === targetId && isHostile(p)) {
              tr = r; tc = c; targetMonster = p;
            }
          }
        }
        if (!targetMonster) return { ok: false, error: 'TARGET_NOT_FOUND' };

        const dist = Math.abs(pr - tr) + Math.abs(pc - tc);
        if (dist > chainReach) return { ok: false, error: 'TARGET_OUT_OF_RANGE' };

        const pullCell = freeCellNextTo(state, pr, pc);
        if (!pullCell) {
          events.push({ t: 'dndMessage', kind: 'skill', message: `⛓️ ${playerPiece.name.split(' ')[0]} 施放【鎖鏈】，但周圍沒有空間可以將怪物拉過來！` } as any);
        } else {
          const oldMonsterCell = state.board[tr]?.[tc];
          const newMonsterCell = state.board[pullCell.r]?.[pullCell.c];
          if (oldMonsterCell && newMonsterCell) {
            newMonsterCell.piece = targetMonster;
            oldMonsterCell.piece = null;
            pushFx(state, targetMonster.id, 'chain');
            events.push({ t: 'dndMessage', kind: 'skill', message: `⛓️ ${playerPiece.name.split(' ')[0]} 揮出【鎖鏈】，將 ${targetMonster.name} 強行拉到身旁！` } as any);
          }
        }
      }

    } else if (classId === 'gladiator') {
      // 【野蠻衝撞】：衝到 5 格內目標的身旁，造成固定傷害並暈眩一回合
      if (!targetId) return { ok: false, error: 'BAD_ACTION' };
      const found = findPieceById(state, targetId);
      if (!found || !isHostile(found.piece)) return { ok: false, error: 'TARGET_NOT_FOUND' };
      if (found.piece.invulnerable) return { ok: false, error: 'TARGET_INVULNERABLE' };

      const dist = Math.abs(pr - found.r) + Math.abs(pc - found.c);
      if (dist > GLADIATOR_CHARGE_RANGE) return { ok: false, error: 'TARGET_OUT_OF_RANGE' };

      const who = playerPiece.name.split(' ')[0];
      // 衝到目標旁邊的空格；四周都滿就原地施放，傷害與暈眩照給
      const landing = freeCellNextTo(state, found.r, found.c);
      if (landing) {
        state.board[pr]![pc]!.piece = null;
        state.board[landing.r]![landing.c]!.piece = playerPiece;
        pr = landing.r;
        pc = landing.c;
        events.push({ t: 'dndMessage', kind: 'skill', message: `🐗 ${who} 低身撞開人群，衝到了 ${found.piece.name} 面前！` } as any);
      } else {
        events.push({ t: 'dndMessage', kind: 'skill', message: `🐗 ${who} 想衝上去，但 ${found.piece.name} 周圍已經沒有空位了！` } as any);
      }

      found.piece.hp = Math.max(0, found.piece.hp - GLADIATOR_CHARGE_DAMAGE);
      found.piece.stunnedTurns = 1;
      pushFx(state, found.piece.id, 'stun');
      events.push({
        t: 'dndAttack',
        player: playerPiece.name,
        target: found.piece.name,
        roll: 0,
        hit: true,
        damage: GLADIATOR_CHARGE_DAMAGE,
      });
      events.push({
        t: 'dndMessage', kind: 'skill',
        message: `💥 【野蠻衝撞】撞得 ${found.piece.name} 頭昏眼花 —— ${GLADIATOR_CHARGE_DAMAGE} 點傷害，下一回合無法行動！`,
      } as any);

      if (found.piece.hp <= 0) {
        events.push(...sweepDeadMonsters(seats, state, rng));
      }

    } else if (classId === 'archer') {
      // 【狙擊】：不選目標、不造成傷害 —— 買的是接下來那段窗口。
      // 多給一格是因為發動的這一輪結束時會先扣掉一格，玩家實際享受到的才是完整的 SNIPE_TURNS 輪。
      const info = state.seats[activeSeat];
      if (info) info.sniperTurns = SNIPE_TURNS + 1;
      pushFx(state, playerPiece.id, 'snipe');
      events.push({
        t: 'dndMessage',
        message: `🎯 ${playerPiece.name.split(' ')[0]} 架起弓、屏住呼吸 —— 接下來 ${SNIPE_TURNS} 回合，`
          + `地圖上任何一個角落都在射程之內`
          + `${(equipmentOf(state, activeSeat)?.sniperShots ?? 1) > 1
            ? `，而且每次出手都會連射 ${equipmentOf(state, activeSeat)!.sniperShots} 箭` : ''}！`,
      } as any);

    } else if (classId === 'bard') {
      // 【進擊之歌】：這一輪全隊的傷害都放大，冷卻 2 回合
      const bonus = songBonusOf(state, activeSeat);
      const ratio = BARD_MARCH_RATIO + bonus / 10;
      eachLivingSeat(state, (info) => {
        info.dmgBuffTurns = BARD_OFFENSE_TURNS;
        info.dmgBuffRatio = ratio;
      });
      pushFx(state, playerPiece.id, 'song');
      events.push({
        t: 'dndMessage', kind: 'skill',
        message: `🎺 ${playerPiece.name.split(' ')[0]} 奏起【進擊之歌】—— 這一輪全隊的傷害提高 ${Math.round(ratio * 100)}%！`,
      } as any);

    } else if (classId === 'summoner') {
      // 【魔物召喚】：召出替你作戰的隨從，總數不超過上限
      const used = state.seats[activeSeat]?.summonsUsed ?? 0;
      if (used >= SUMMON_PER_LEVEL) {
        return { ok: false, error: 'SUMMON_EXHAUSTED' };
      }

      const { cap, roster } = summonRosterOf(state, activeSeat);
      const room = cap - allyCount(state);
      if (room <= 0) {
        return { ok: false, error: 'SUMMON_LIMIT' };
      }

      const wanted = Math.min(SUMMON_BASE_CAP, room);
      const born: string[] = [];
      for (let i = 0; i < wanted; i++) {
        const template = roster[Math.floor(rng() * roster.length)]!;
        // 刻意不走 spawnMonster：召喚物一律用模板的原始數值，不吃難度縮放。
        // 難度該讓敵人變硬，不該連你自己的隨從一起變硬 —— 那樣地獄難度反而更好打。
        const minion = makeGoblin(
          `ally-${activeSeat}-${state.roundCount}-${i}-${Math.floor(rng() * 1000)}`,
          template,
        );
        minion.ally = true;
        // 召出來的這一輪先站著，不然等於多打一輪
        state.monsterActed.add(minion.id);
        if (placeNear(state, pr, pc, minion)) born.push(minion.name);
      }

      if (born.length === 0) return { ok: false, error: 'INVALID_CELL' };
      if (state.seats[activeSeat]) state.seats[activeSeat]!.summonsUsed = used + 1;
      pushFx(state, playerPiece.id, 'summon');
      events.push({
        t: 'dndMessage', kind: 'skill',
        message: `🌑 ${playerPiece.name.split(' ')[0]} 撕開地面，喚出了 ${born.length} 隻隨從！`
          + `（${born.join('、')}）這一層還能再召喚 ${SUMMON_PER_LEVEL - used - 1} 次。`,
      } as any);

    } else if (classId === 'tangerine') {
      // 【火牆】對地施放：指定 3 格內的一格，拉出一道與施法方向垂直的 3 格火牆
      if (currentAction.r === undefined || currentAction.c === undefined) {
        return { ok: false, error: 'BAD_ACTION' };
      }
      const tr = currentAction.r;
      const tc = currentAction.c;
      if (!inBounds(tr, tc)) return { ok: false, error: 'INVALID_CELL' };

      const dist = Math.abs(pr - tr) + Math.abs(pc - tc);
      if (dist > FIRE_WALL_RANGE) return { ok: false, error: 'TARGET_OUT_OF_RANGE' };

      const placed = castFireWall(state, pr, pc, tr, tc, activeSeat);
      if (placed === 0) return { ok: false, error: 'INVALID_CELL' };

      events.push({
        t: 'dndMessage', kind: 'skill',
        message: `🔥 ${playerPiece.name.split(' ')[0]} 燃起一道 ${placed} 格【火牆】，站在裡面的怪物每回合會被燒掉 ${FIRE_WALL_DAMAGE} 點 HP，持續 ${FIRE_WALL_TURNS} 回合！`,
      } as any);
    } else {
      return { ok: false, error: 'BAD_ACTION' };
    }
  } else {
    return { ok: false, error: 'BAD_ACTION' };
  }

  return finishDndTurn(seats, state, activeSeat, kind, events, rng);
}

/**
 * 中了虛空酋長【恐懼】的話，移動目標會以自己為中心鏡射到反方向 ——
 * 玩家想往上走就會往下走。鏡射後的格子照樣要過邊界與佔用檢查。
 */
function fearedTarget(
  state: DndState,
  seat: number,
  pr: number,
  pc: number,
  tr: number,
  tc: number,
): { r: number; c: number; feared: boolean } {
  // 一律看「正在行動的座位」，不能查送出動作的人 —— 代打 NPC 時那是操作者自己的座位，
  // 會拿他的【恐懼】去鏡射 NPC 的移動（或反過來讓中了恐懼的 NPC 走得好好的）。
  const fear = state.seats[seat]?.fearTurns ?? 0;
  if (!fear) return { r: tr, c: tc, feared: false };
  return { r: pr - (tr - pr), c: pc - (tc - pc), feared: true };
}

/**
 * 魔王的指令。一隻怪一輪可以「移動一次 + 攻擊一次」，跟玩家的「移動 → 終結動作」同一個節奏：
 * bossMove 記進 monsterMoved（只擋再次移動），bossAttack／bossHold 記進 monsterActed
 * （這隻怪這一輪就結束了）。這比 AI 的「打得到就打，打不到才走」強一階，是刻意的。
 * 沒被指揮過的怪在 bossEnd 時由原本的 AI 接手。
 */
function applyBossAction(
  seats: Seats,
  state: DndState,
  action: DndAction,
  rng: () => number,
): DndApplyResult {
  if (state.phase !== 'boss') return { ok: false, error: 'NOT_BOSS_TURN' };

  const events: LogEvent[] = [];

  if (action.kind === 'bossEnd') {
    return finishBossTurn(seats, state, events, rng);
  }

  if (!action.monsterId) return { ok: false, error: 'BAD_ACTION' };
  const found = findPieceById(state, action.monsterId);
  if (!found || found.piece.type !== 'goblin') return { ok: false, error: 'MONSTER_NOT_FOUND' };
  // 攻擊＝結束這隻怪的回合，之後不能再移動也不能再攻擊
  if (state.monsterActed.has(found.piece.id)) {
    return { ok: false, error: 'MONSTER_ALREADY_ACTED' };
  }
  // 【魅惑】的怪不聽指揮 —— 連待命都不行，要讓牠掉進 runMonstersTurn 的亂晃分支，
  // 不然魔王模式下魅惑等於沒有效果，而且 wanderTurns 永遠不會倒數。
  if (found.piece.wanderTurns && found.piece.wanderTurns > 0) {
    return { ok: false, error: 'MONSTER_CHARMED' };
  }

  const mon = { piece: found.piece, r: found.r, c: found.c };

  // 待命：這隻怪這一輪就到此為止。旁邊沒有人可以打的時候要有這個出口，
  // 不然魔王只剩「結束整個回合」一條路可走。
  if (action.kind === 'bossHold') {
    state.monsterActed.add(mon.piece.id);
    events.push({ t: 'dndMessage', message: `🛑 ${mon.piece.name} 原地待命。` } as any);
    return { ok: true, events };
  }

  if (action.kind === 'bossMove') {
    if (isRestrained(mon.piece)) {
      return { ok: false, error: 'MONSTER_RESTRAINED' };
    }
    if (state.monsterMoved.has(mon.piece.id)) {
      return { ok: false, error: 'MONSTER_ALREADY_MOVED' };
    }
    if (action.r === undefined || action.c === undefined) return { ok: false, error: 'BAD_ACTION' };
    const tr = action.r;
    const tc = action.c;
    if (!inBounds(tr, tc)) return { ok: false, error: 'INVALID_CELL' };

    const dist = Math.abs(mon.r - tr) + Math.abs(mon.c - tc);
    if (dist === 0 || dist > (mon.piece.speed ?? 2)) return { ok: false, error: 'INVALID_CELL' };

    const targetCell = state.board[tr]?.[tc];
    const sourceCell = state.board[mon.r]?.[mon.c];
    if (!targetCell || !sourceCell) return { ok: false, error: 'INVALID_CELL' };
    if (targetCell.piece !== null) return { ok: false, error: 'CELL_OCCUPIED' };

    targetCell.piece = mon.piece;
    sourceCell.piece = null;
    state.monsterMoved.add(mon.piece.id);

    events.push({ t: 'dndMove', player: mon.piece.name, dir: 'moveTo' } as any);
    return { ok: true, events };
  }

  // bossAttack
  if (!action.targetId) return { ok: false, error: 'BAD_ACTION' };
  const victim = findPieceById(state, action.targetId);
  if (!victim) return { ok: false, error: 'TARGET_NOT_FOUND' };
  // 村民也是合法目標 —— 只認 player 的話，護送關碰上魔王模式就變成白送：
  // 怪物全由魔王親自指揮（AI 的村民索敵根本不會跑），而他又一個村民都打不到。
  const isVillager = victim.piece.type === 'villager';
  if (!isVillager && victim.piece.type !== 'player') return { ok: false, error: 'TARGET_NOT_FOUND' };

  const seat = isVillager ? -1 : seatIndexOfPiece(seats, victim.piece);
  if (!isVillager && (seat === -1 || !state.seats[seat]?.alive)) {
    return { ok: false, error: 'TARGET_NOT_FOUND' };
  }

  const range = mon.piece.range ?? (hasVoidPowers(mon.piece) ? 2 : 1);
  const dist = Math.abs(mon.r - victim.r) + Math.abs(mon.c - victim.c);
  if (dist > range) return { ok: false, error: 'TARGET_OUT_OF_RANGE' };

  state.monsterActed.add(mon.piece.id);
  events.push(
    ...resolveMonsterAttack(seats, state, mon, { piece: victim.piece, r: victim.r, c: victim.c, seat }, rng),
  );

  const over = checkDndGameOver(seats, state);
  if (over.over) {
    state.over = true;
    state.won = over.won;
    state.ranking = over.ranking;
    events.push({ t: 'dndOver', won: over.won });
  }
  return { ok: true, events };
}

/**
 * 移動之後這回合還能不能繼續？
 * 換層（棋盤整個重置）或踩中陷阱被放逐（角色從棋盤上移除）都會讓後續動作失去依據。
 */
function movementInterrupted(
  state: DndState,
  seat: number,
  moveEvents: LogEvent[],
): boolean {
  if (moveEvents.some((event) => event.t === 'dndLevelUp')) return true;
  // 看行動中的座位而不是送出動作的人：代打 NPC 時，踩到陷阱被放逐的是 NPC，
  // 查操作者自己的座位會回「沒事」，接著就會拿一顆已經離場的棋子繼續打完終結動作 ——
  // 畫面上就是那個座位卡住，只能等 45 秒讀秒結束。
  const banished = state.seats[seat]?.banishedTurns;
  return !!(banished && banished > 0);
}

/**
 * 收尾：技能冷卻 → 勝負判定 → 推進到下一位真人玩家（途中自動跑 NPC 與怪物回合）。
 *
 * 繞圈判定一定要用「走了幾步」，不能拿座位編號比大小。舊寫法是
 * `nextSeat <= activeSeat` 才結算一輪，但 nextActiveDndSeat 會跳過死亡／放逐的座位，
 * 起始座位一旦被跳過，這個比較就永遠不成立 —— 回合結算（放逐倒數、怪物回合）整個
 * 不執行，放逐永遠不到期，NPC 便會在同一次動作裡連跑上百個回合，
 * 一口氣把三層樓打完（玩家回報的「打完一樓自動跑到三樓」就是這個）。
 */
function finishDndTurn(
  seats: Seats,
  state: DndState,
  activeSeat: number,
  kind: DndAction['kind'] | undefined,
  events: LogEvent[],
  rng: () => number,
): DndApplyResult {
  // 冷卻要記在「剛行動的座位」上，不能查送出動作的人 —— 代打 NPC 時
  // seats.indexOf(playerId) 指的是操作者自己的座位，會變成 NPC 的技能永遠沒有冷卻，
  // 而操作者自己的冷卻卻被 NPC 的行動亂設亂扣。
  const selfInfo = state.seats[activeSeat];
  if (selfInfo) {
    if (kind === 'skill') {
      const piece = findSeatPiece(seats, state, activeSeat)?.piece;
      selfInfo.skillCooldown = SKILL_COOLDOWN[piece?.classId ?? 'brave'] ?? 1;
    } else {
      const cd = selfInfo.skillCooldown;
      if (cd && cd > 0) selfInfo.skillCooldown = cd - 1;
    }
  }

  const settleGameOver = (): boolean => {
    const result = checkDndGameOver(seats, state);
    if (!result.over) return false;
    state.over = true;
    state.won = result.won;
    state.ranking = result.ranking;
    events.push({ t: 'dndOver', won: result.won });
    return true;
  };

  if (settleGameOver()) return { ok: true, events };

  return advanceParty(seats, state, activeSeat, events, rng, false);
}

/**
 * 從 cursor 開始往下找可以行動的座位：NPC 就地代打，找到真人就交棒。
 * 繞過座位環的接縫代表一輪結束 —— 沒有魔王時直接跑完整輪結算，
 * 有魔王時只跑前半段然後把回合交給魔王，等他指揮完怪物再從這裡接回來。
 */
function advanceParty(
  seats: Seats,
  state: DndState,
  fromSeat: number,
  events: LogEvent[],
  rng: () => number,
  roundEndDone: boolean,
): DndApplyResult {
  const settleGameOver = (): boolean => {
    const result = checkDndGameOver(seats, state);
    if (!result.over) return false;
    state.over = true;
    state.won = result.won;
    state.ranking = result.ranking;
    events.push({ t: 'dndOver', won: result.won });
    return true;
  };

  let cursor = fromSeat;
  let laps = 0;
  let handOff = -1;
  let skipRoundEnd = roundEndDone;

  while (!state.over && laps < MAX_ROUND_LAPS) {
    cursor = (cursor + 1) % SEAT_COUNT;

    // 指標從最後一個座位繞回 0 ＝ 一輪結束：放逐倒數遞減一格，怪物行動一次。
    // 結算點必須是座位環的接縫，不是「離起始座位幾步」—— 用步數的話，
    // 座位 1 行動、座位 0 也是真人時會在第 3 步就交棒出去，怪物永遠輪不到。
    if (cursor === 0) {
      if (skipRoundEnd) {
        // 魔王剛打完的那一輪已經結算過了，這一圈不要再算一次
        skipRoundEnd = false;
      } else if (state.bossSeat !== null) {
        laps++;
        beginRound(seats, state, rng, events);
        if (settleGameOver()) break;
        events.push(...autoResolveHelplessMonsters(state));
        state.phase = 'boss';
        state.turnSeat = state.bossSeat;
        state.turnDeadline = Date.now() + TURN_MS;
        state.turnHasMoved = false;
        events.push({ t: 'dndMonsterTurn' });
        return { ok: true, events }; // 停在這裡等魔王輸入
      } else {
        laps++;
        processRoundEnd(seats, state, rng, events);
        if (settleGameOver()) break;
      }
    }

    const seatInfo = state.seats[cursor];
    if (!seatInfo || !seatInfo.alive) continue;
    if (seatInfo.banishedTurns && seatInfo.banishedTurns > 0) continue;
    if (seatInfo.stunnedTurns && seatInfo.stunnedTurns > 0) continue;

    if (seatInfo.isNpc && !state.npcController) {
      state.turnSeat = cursor;
      events.push(...runNpcTurn(seats, state, cursor, rng));
      if (settleGameOver()) break;
      continue;
    }

    // 真人座位，或是交給房主代打的 NPC 座位
    handOff = cursor;
    break;
  }

  if (state.over) return { ok: true, events };

  if (handOff === -1) {
    // 跑滿上限都找不到能行動的真人。回合絕對不能丟給 NPC 座位 ——
    // 那個座位的 seats[i] 是 null，autoActDnd 會回 null，房間會每 45 秒空轉一次、
    // 永遠不會結束。這裡直接判定冒險失敗。
    state.over = true;
    state.won = false;
    state.ranking = rankDndSeats(seats, state);
    events.push({ t: 'dndOver', won: false });
    return { ok: true, events };
  }

  state.turnSeat = handOff;
  state.turnDeadline = Date.now() + TURN_MS;
  state.turnHasMoved = false;
  return { ok: true, events };
}

/**
 * 一隻怪物打一位冒險者的完整結算：命中骰、難度乘數、盜賊【削弱】、騎士【極限防禦】上限、
 * 騎士【反射】、法師受擊【閃現退避】、死亡處理、虛空酋長的攻擊被動。
 *
 * 怪物 AI 與魔王玩家的 bossAttack 共用這一份 —— 兩邊各寫一份傷害公式一定會漂移。
 */
function resolveMonsterAttack(
  seats: Seats,
  state: DndState,
  mon: { piece: DndPiece; r: number; c: number },
  target: { piece: DndPiece; r: number; c: number; seat: number },
  rng: () => number,
): LogEvent[] {
  const events: LogEvent[] = [];
    const hitTarget = target;

    const isShaman = mon.piece.name.includes('薩滿') || mon.piece.name.includes('Shaman');
    const attackBonus =
      mon.piece.attackBonus ?? (hasVoidPowers(mon.piece) ? 5 : isShaman ? 2 : 1);
    const dmgDice = mon.piece.dmgDice ?? (hasVoidPowers(mon.piece) ? 10 : 6);

    const roll = Math.floor(rng() * 20) + 1;
    const isHit = roll + attackBonus >= effectiveAc(seats, state, hitTarget.piece, hitTarget.seat);

    if (isHit) {
      const baseDmg = Math.floor(rng() * dmgDice) + 1;
      let dmg = Math.round(baseDmg * 1.3);

      // 難度乘數吃在傷害上（HP 與 AC 是生怪時就縮放好的）
      dmg = Math.max(1, Math.round(dmg * DND_DIFFICULTY_MULTIPLIER[state.difficulty]));

      // 盜賊被動【削弱】：這隻怪的輸出只剩六成
      if (mon.piece.atkDebuffTurns && mon.piece.atkDebuffTurns > 0) {
        dmg = Math.max(1, Math.round(dmg * DEBUFF_RATIO));
      }

      const playerSeat = state.seats[hitTarget.seat];
      // 騎士被動【極限防禦】：這一輪受到的每一次傷害都被壓到上限以內
      if (playerSeat?.damageCapTurns && playerSeat.damageCapTurns > 0) {
        const cap = playerSeat.damageCap ?? 2;
        if (dmg > cap) {
          dmg = cap;
          events.push({
            t: 'dndMessage', kind: 'skill',
            message: `🛡️ ${hitTarget.piece.name.split(' ')[0]} 的【極限防禦】擋下了大部分衝擊，只受到 ${cap} 點傷害！`,
          } as any);
        }
      }

      hitTarget.piece.hp = Math.max(0, hitTarget.piece.hp - dmg);
      if (playerSeat) {
        playerSeat.hp = hitTarget.piece.hp;
      }

      events.push({
        t: 'dndAttack',
        player: mon.piece.name,
        target: hitTarget.piece.name,
        roll,
        hit: true,
        damage: dmg,
      });

      // 騎士被動【反射】：把實際吃到的傷害彈 1/3 回去給攻擊者。
      // 這是常駐的，所以「輪到自己之前」被打幾次就反射幾次。
      if (hitTarget.piece.classId === 'brave') {
        // 【反射盾】疊加在基礎的 1/3 上
        const shield = hitTarget.seat >= 0 ? (equipmentOf(state, hitTarget.seat)?.reflect ?? 0) : 0;
        const reflected = mon.piece.invulnerable ? 0 : Math.round(dmg * (WARRIOR_REFLECT_RATIO + shield));
        if (reflected > 0) {
          mon.piece.hp = Math.max(0, mon.piece.hp - reflected);
          pushFx(state, hitTarget.piece.id, 'reflect');
          events.push({
            t: 'dndMessage', kind: 'skill',
            message: `🪞 ${hitTarget.piece.name.split(' ')[0]} 的【反射】把 ${reflected} 點傷害彈回 ${mon.piece.name} 身上！`,
          } as any);

          if (mon.piece.hp <= 0) {
            const monCell = state.board[mon.r]?.[mon.c];
            if (monCell && monCell.piece?.id === mon.piece.id) monCell.piece = null;
            events.push({ t: 'dndMessage', kind: 'skill', message: `💥 ${mon.piece.name} 被自己的攻擊反噬倒下了！` } as any);
            checkAndSpawnBossOrStaircase(seats, state, events, rng);
          }
        }
      }

      if (hitTarget.piece.classId === 'tangerine' && hitTarget.piece.hp > 0) {
        const dr = Math.sign(hitTarget.r - mon.r);
        const dc = Math.sign(hitTarget.c - mon.c);

        const retreatMoves = [
          { r: hitTarget.r + dr * 2, c: hitTarget.c + dc * 2 },
          { r: hitTarget.r + dc * 2, c: hitTarget.c + dr * 2 },
          { r: hitTarget.r - dc * 2, c: hitTarget.c - dr * 2 },
          { r: hitTarget.r + dr, c: hitTarget.c + dc },
          { r: hitTarget.r - dc, c: hitTarget.c + dr },
          { r: hitTarget.r + dc, c: hitTarget.c - dr },
        ];

        for (const rm of retreatMoves) {
          if (rm.r >= 0 && rm.r < BOARD_SIZE && rm.c >= 0 && rm.c < BOARD_SIZE) {
            const targetCell = state.board[rm.r]?.[rm.c];
            if (targetCell && targetCell.piece === null) {
              targetCell.piece = hitTarget.piece;
              const srcCell = state.board[hitTarget.r]?.[hitTarget.c];
              if (srcCell) srcCell.piece = null;
              events.push({ t: 'dndMessage', kind: 'skill', message: `✨ ${hitTarget.piece.name.split(' ')[0]} 受擊後發動【閃現退避】，向後移動！` } as any);
              hitTarget.r = rm.r;
              hitTarget.c = rm.c;
              break;
            }
          }
        }
      }

      if (hitTarget.piece.hp <= 0) {
        if (playerSeat) {
          playerSeat.alive = false;
        }
        if (hitTarget.piece.type === 'villager') {
          state.villagersLost++;
          events.push({ t: 'dndMessage', kind: 'skill', message: `☠️ ${hitTarget.piece.name} 倒下了…` } as any);
        }
        const playerCell = state.board[hitTarget.r]?.[hitTarget.c];
        if (playerCell && playerCell.piece?.id === hitTarget.piece.id) {
          playerCell.piece = null;
        }
      } else if (hasVoidPowers(mon.piece) && mon.piece.hp > 0) {
        events.push(...voidChiefPassive(state, hitTarget, rng));
      } else if (mon.piece.id === 'boss-5' && mon.piece.hp > 0) {
        events.push(...evilGodPassive(state, mon, hitTarget, rng));
      } else if (mon.piece.monsterPassive && mon.piece.hp > 0) {
        events.push(...b6MonsterPassive(state, mon, hitTarget, rng));
      }
    } else {
      events.push({
        t: 'dndAttack',
        player: mon.piece.name,
        target: hitTarget.piece.name,
        roll,
        hit: false,
        damage: 0,
      });
    }

    // 弓手【殘影】：被攻擊就有機會留下替身，命中與否都算
    if (hitTarget.piece.type === 'player' && hitTarget.piece.hp > 0) {
      events.push(...tryArcherDecoy(seats, state, hitTarget, rng));
    }

  return events;
}

function runMonstersTurn(seats: Seats, state: DndState, rng: () => number): LogEvent[] {
  const events: LogEvent[] = [];

  const monsters: { piece: DndPiece; r: number; c: number }[] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    const row = state.board[r];
    if (!row) continue;
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = row[c]?.piece;
      // 魔王已經親自指揮過的怪物（移動過或攻擊過）不再由 AI 動一次
      const commanded = piece && (state.monsterActed.has(piece.id) || state.monsterMoved.has(piece.id));
      if (isHostile(piece) && !commanded) {
        monsters.push({ piece: piece!, r, c });
      }
    }
  }

  monsters.forEach((mon) => {
    // 位置是迴圈開始前一次掃出來的，但這一輪中間有很多事會搬動棋子
    // （邪神的錯位／彈飛、騎士的擊退與鎖鏈、奪舍…）。動手前先照 id 重新定位，
    // 不然會拿著過期的座標去寫棋盤，把站在那一格的人直接覆蓋掉。
    const located = findPieceById(state, mon.piece.id);
    if (!located) return; // 已經死了或被移出棋盤
    mon.r = located.r;
    mon.c = located.c;

    // 被網住的怪只是被釘在原地：照樣會攻擊、薩滿照樣會治療與召喚，只是不能移動。
    // 持續傷害與倒數已經在 beginRound 結算過了。
    const netted = isRestrained(mon.piece);

    if (mon.piece.stunnedTurns && mon.piece.stunnedTurns > 0) {
      mon.piece.stunnedTurns--;
      return;
    }

    // 【魅惑】：還站在敵方那一邊，但腦子已經不在了 —— 隨機晃一步，不攻擊任何人
    if (mon.piece.wanderTurns && mon.piece.wanderTurns > 0) {
      mon.piece.wanderTurns--;
      if (!netted) {
        const dirs4 = [{ dr: -1, dc: 0 }, { dr: 1, dc: 0 }, { dr: 0, dc: -1 }, { dr: 0, dc: 1 }];
        const pick = dirs4[Math.floor(rng() * dirs4.length)]!;
        const nr = mon.r + pick.dr;
        const nc = mon.c + pick.dc;
        if (inBounds(nr, nc) && state.board[nr]?.[nc]?.piece === null) {
          state.board[mon.r]![mon.c]!.piece = null;
          state.board[nr]![nc]!.piece = mon.piece;
          mon.r = nr;
          mon.c = nc;
          events.push({ t: 'dndMove', player: mon.piece.name, dir: 'wander' } as any);
        }
      }
      return;
    }

    if (hasVoidPowers(mon.piece)) {
      // 頭目挑瞬移目標時，跟一般怪一樣會被村民、殘影、被洗腦的隨從騙過去 ——
      // 只認 type 'player' 的話，弓手的【殘影】對頭目等於不存在。
      const alivePlayers: { piece: DndPiece; r: number; c: number }[] = [];
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          const p = state.board[r]?.[c]?.piece;
          if (!p) continue;
          if (p.type === 'villager' || p.type === 'decoy' || isAlly(p)) {
            alivePlayers.push({ piece: p, r, c });
            continue;
          }
          if (p.type === 'player' && !isHidden(seats, state, p)) {
            let seat = -1;
            if (p.playerId) seat = seats.indexOf(p.playerId);
            else if (p.id.startsWith('npc-')) seat = parseInt(p.id.split('-')[1]!, 10);
            if (seat !== -1 && state.seats[seat]?.alive) {
              alivePlayers.push({ piece: p, r, c });
            }
          }
        }
      }

      if (alivePlayers.length > 0) {
        const victim = alivePlayers[Math.floor(rng() * alivePlayers.length)]!;
        const adj = [
          { r: victim.r - 1, c: victim.c }, { r: victim.r + 1, c: victim.c },
          { r: victim.r, c: victim.c - 1 }, { r: victim.r, c: victim.c + 1 },
        ];
        let jumpCell: { r: number; c: number } | null = null;
        for (const pos of adj) {
          if (pos.r >= 0 && pos.r < BOARD_SIZE && pos.c >= 0 && pos.c < BOARD_SIZE) {
            const cell = state.board[pos.r]?.[pos.c];
            if (cell && cell.piece === null) {
              jumpCell = pos;
              break;
            }
          }
        }

        if (jumpCell) {
          const oldCell = state.board[mon.r]?.[mon.c];
          const newCell = state.board[jumpCell.r]?.[jumpCell.c];
          if (oldCell && newCell) {
            newCell.piece = mon.piece;
            oldCell.piece = null;
            mon.r = jumpCell.r;
            mon.c = jumpCell.c;
            events.push({ t: 'dndMessage', kind: 'skill', message: `⚡ 虛空酋長瞬移到了 ${victim.piece.name.split(' ')[0]} 身旁準備突襲！` } as any);
          }
        }
      }
    }

    // 邪神分身會用被複製職業的招式 —— 你們有多強，分身就有多難纏
    if (mon.piece.copyClass) {
      const used = runCopySkill(seats, state, mon, rng);
      if (used.length > 0) {
        events.push(...used);
        return;
      }
    }

    if (mon.piece.name.includes('薩滿') || mon.piece.name.includes('Shaman')) {
      const isHeal = monsters.length >= 12 || rng() < 0.5;
      
      if (isHeal) {
        let targetGoblinToHeal: { piece: DndPiece; r: number; c: number } | null = null;
        let minHealDist = 9999;
        
        for (const otherMon of monsters) {
          if (otherMon.piece.id !== mon.piece.id && otherMon.piece.hp < otherMon.piece.maxHp) {
            const dist = Math.abs(mon.r - otherMon.r) + Math.abs(mon.c - otherMon.c);
            if (dist <= 3 && dist < minHealDist) {
              minHealDist = dist;
              targetGoblinToHeal = otherMon;
            }
          }
        }

        if (targetGoblinToHeal) {
          const healAmt = 3;
          targetGoblinToHeal.piece.hp = Math.min(targetGoblinToHeal.piece.maxHp, targetGoblinToHeal.piece.hp + healAmt);
          events.push({
            t: 'dndAttack',
            player: mon.piece.name,
            target: targetGoblinToHeal.piece.name,
            roll: 0,
            hit: true,
            damage: -healAmt,
          });
          return; 
        }
      } else {
        const adj = [
          { r: mon.r - 1, c: mon.c }, { r: mon.r + 1, c: mon.c },
          { r: mon.r, c: mon.c - 1 }, { r: mon.r, c: mon.c + 1 }
        ];
        for (const pos of adj) {
          const cell = state.board[pos.r]?.[pos.c];
          if (cell && cell.piece === null) {
            cell.piece = spawnMonster(state, {
              id: `m-summon-${Date.now()}-${Math.floor(rng()*1000)}`,
              type: 'goblin',
              name: 'Goblin (召喚物)',
              hp: 14, maxHp: 14, ac: 11
            });
            events.push({ t: 'dndMessage', kind: 'skill', message: `🪄 大薩滿揮舞法杖，召喚了一隻哥布林！` } as any);
            return; 
          }
        }
      }
    }

    let targetPlayer: { piece: DndPiece; r: number; c: number; seat: number } | null = null;
    let minDist = 9999;

    for (let r = 0; r < BOARD_SIZE; r++) {
      const row = state.board[r];
      if (!row) continue;
      for (let c = 0; c < BOARD_SIZE; c++) {
        const piece = row[c]?.piece;
        // 村民也是目標 —— 不然護送關的村民會一路無傷走到頂，這關就沒有張力
        // 村民、殘影、被召喚／洗腦的隨從都沒有座位，怪物照樣會把它們當成目標
        if (piece && (piece.type === 'villager' || piece.type === 'decoy' || isAlly(piece))) {
          const dist = Math.abs(mon.r - r) + Math.abs(mon.c - c);
          if (dist < minDist) {
            minDist = dist;
            targetPlayer = { piece, r, c, seat: -1 };
          }
          continue;
        }
        if (piece && piece.type === 'player') {
          // 【匿蹤】中的盜賊不在怪物的視野裡 —— 直接跳過，牠會去找別人
          if (isHidden(seats, state, piece)) continue;
          let seat = -1;
          if (piece.playerId) {
            seat = seats.indexOf(piece.playerId);
          } else if (piece.id.startsWith('npc-')) {
            seat = parseInt(piece.id.split('-')[1]!, 10);
          }

          if (seat !== -1 && state.seats[seat]?.alive) {
            const dist = Math.abs(mon.r - r) + Math.abs(mon.c - c);
            if (dist < minDist) {
              minDist = dist;
              targetPlayer = { piece, r, c, seat };
            }
          }
        }
      }
    }

    if (!targetPlayer) return;

    const attackRange = mon.piece.range ?? (hasVoidPowers(mon.piece) ? 2 : 1);

    if (minDist <= attackRange) {
      events.push(...resolveMonsterAttack(seats, state, mon, targetPlayer, rng));
    } else if (!netted) {
      // 哥布林盜賊靠 speed 一次衝 5 格，其餘怪物照舊 2 格
      const steps = mon.piece.speed ?? 2;
      for (let s = 0; s < steps; s++) {
        const moves = [
          { r: mon.r - 1, c: mon.c, dir: 'up' },
          { r: mon.r + 1, c: mon.c, dir: 'down' },
          { r: mon.r, c: mon.c - 1, dir: 'left' },
          { r: mon.r, c: mon.c + 1, dir: 'right' },
        ];

        let bestMove: { r: number; c: number; dir: string } | null = null;
        let bestDist = Math.abs(mon.r - targetPlayer.r) + Math.abs(mon.c - targetPlayer.c);

        for (const move of moves) {
          if (move.r >= 0 && move.r < BOARD_SIZE && move.c >= 0 && move.c < BOARD_SIZE) {
            const targetCell = state.board[move.r]?.[move.c];
            if (targetCell && targetCell.piece === null) {
              const d = Math.abs(move.r - targetPlayer.r) + Math.abs(move.c - targetPlayer.c);
              if (d < bestDist) {
                bestDist = d;
                bestMove = move;
              }
            }
          }
        }

        if (bestMove) {
          const targetCell = state.board[bestMove.r]?.[bestMove.c];
          const sourceCell = state.board[mon.r]?.[mon.c];
          if (targetCell && sourceCell) {
            targetCell.piece = mon.piece;
            sourceCell.piece = null;
            mon.r = bestMove.r;
            mon.c = bestMove.c;
            events.push({ t: 'dndMove', player: mon.piece.name, dir: bestMove.dir });
          }
        } else {
          break;
        }
      }
    }
  });

  return events;
}

/** 名次：活著的血量高者在前。勝負兩種結局都用同一套排法。 */
function rankDndSeats(seats: Seats, state: DndState): PlayerId[] {
  return seats
    .filter((id): id is PlayerId => id !== null)
    .sort((a, b) => {
      const hpA = state.seats[seats.indexOf(a)]?.hp ?? 0;
      const hpB = state.seats[seats.indexOf(b)]?.hp ?? 0;
      return hpB - hpA;
    });
}

export function checkDndGameOver(seats: Seats, state: DndState): { over: boolean; won: boolean; ranking: PlayerId[] } {
  let aliveCount = 0;
  let aliveHumans = 0;
  for (let idx = 0; idx < SEAT_COUNT; idx++) {
    const seatInfo = state.seats[idx];
    if (!seatInfo?.alive) continue;
    aliveCount++;
    // 「還有人能送出動作」才算數：真人自己的座位，或是有房主代打的 NPC 座位。
    // 房主一人操作全隊時，他本人的角色倒下不該直接判輸 —— 剩下的 NPC 他照樣操作得動。
    if (seatInfo.isNpc ? state.npcController !== null : !!seats[idx]) aliveHumans++;
  }

  let goblinCount = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    const row = state.board[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      const piece = row[c]?.piece;
      if (isHostile(piece)) {
        goblinCount++;
      }
    }
  }

  // 有魔王坐鎮時，隊伍可以全部是 NPC（單人魔王模式）——那一局照樣分得出勝負；
  // 沒有魔王的話，隊伍裡沒有真人就等於沒有人能送出動作。
  const partyPlayable = state.bossSeat !== null ? aliveCount > 0 : aliveHumans > 0;

  // 異界大門：怪永遠補得完，過關看的是四座祭壇拆光了沒
  if (state.level === GATE_LEVEL) {
    if (state.altarsDestroyed >= ALTAR_COUNT && partyPlayable) {
      return { over: true, won: true, ranking: rankDndSeats(seats, state) };
    }
  } else if (goblinCount === 0 && partyPlayable) {
    // 護送關要救村民，清光伏兵不算過關
    if (state.level < MAX_LEVEL || state.level === ESCORT_LEVEL) {
      return { over: false, won: false, ranking: [] };
    }
    return { over: true, won: true, ranking: rankDndSeats(seats, state) };
  }

  // 全隊陣亡（魔王獲勝），或沒有魔王、真人也全滅只剩 NPC 隊友（沒有人能再送出動作）
  if (aliveCount === 0 || (aliveHumans === 0 && state.bossSeat === null)) {
    return { over: true, won: false, ranking: rankDndSeats(seats, state) };
  }

  return { over: false, won: false, ranking: [] };
}

/**
 * 開局的第一次推進。`dealDnd` 把回合指到第一個活著的座位，但那個座位可能是 NPC ——
 * 單人魔王模式下四個位置全是 NPC，沒人踢第一腳的話房間會停在 NPC 座位空轉。
 * 回傳要寫進戰報的事件；正常情況（第一棒就是真人冒險者）回空陣列。
 */
export function openingDndTurn(
  seats: Seats,
  state: DndState,
  rng: () => number = Math.random,
): LogEvent[] {
  const seatInfo = state.seats[state.turnSeat];
  const humanHolds =
    state.turnSeat < SEAT_COUNT && !!seats[state.turnSeat] && !seatInfo?.isNpc;
  if (humanHolds) return [];

  const events: LogEvent[] = [];
  // 從座位環的尾巴進場，第一步就落在座位 0，而且這一輪還不該結算（大家都還沒動過）
  advanceParty(seats, state, SEAT_COUNT - 1, events, rng, true);
  return events;
}

export function autoActDnd(
  seats: Seats,
  state: DndState,
  rng: () => number = Math.random,
): DndApplyResult | null {
  const activeSeat = state.turnSeat;

  // 魔王掛機：等同按下「結束回合」，剩下的怪由 AI 打完，房間不會卡在他身上
  if (state.phase === 'boss') {
    return finishBossTurn(seats, state, [], rng);
  }

  const playerId = seats[activeSeat];

  // 停在 NPC 座位上（代打者掛機，或是他中途離開房間讓 npcController 被清掉）：
  // 這一回合交回 AI，然後照常推進。這裡**不能**再要求 npcController 還在 ——
  // 代打者剛離開時回合就正好卡在 NPC 座位上的話，下面會回 null，
  // handlers 只會每 45 秒重掛一次計時器，房間永遠不會再往前走。
  if (!playerId && state.seats[activeSeat]?.isNpc) {
    const events: LogEvent[] = runNpcTurn(seats, state, activeSeat, rng);
    return advanceParty(seats, state, activeSeat, events, rng, false);
  }

  if (!playerId) return null;

  const playerPiece = findSeatPiece(seats, state, activeSeat)?.piece ?? null;

  if (!playerPiece) {
    // 角色不在棋盤上（放逐中）。不能什麼都不做就回 null ——
    // handlers 會重新掛一個 45 秒計時器，房間會停在這個座位上永遠空轉。
    return finishDndTurn(seats, state, activeSeat, 'rest', [], rng);
  }

  return applyDndAction(seats, state, playerId, { kind: 'rest' }, rng);
}

/**
 * 有人離開這一局。回傳要寫進戰報的事件 —— 魔王中離時會代打完整整一輪怪物行動
 * （攻擊、陣亡、火牆燒死怪、Boss／樓梯生成都在裡面），丟掉的話冒險者會看到血條無聲無息地掉。
 */
export function removePlayerFromDnd(seats: Seats, state: DndState, playerId: PlayerId): LogEvent[] {
  const events: LogEvent[] = [];
  const seatIndex = seats.indexOf(playerId);
  if (seatIndex === -1) return events;

  // 魔王中離：怪物退回全自動，如果剛好停在他的回合就替他把這一輪打完
  if (state.bossSeat !== null && seatIndex === state.bossSeat) {
    seats[seatIndex] = null;
    state.bossSeat = null;
    if (state.phase === 'boss') {
      finishBossTurn(seats, state, events, Math.random);
    }
    state.phase = 'party';
    state.monsterMoved.clear();
    state.monsterActed.clear();
    return events;
  }

  if (state.seats[seatIndex]) {
    state.seats[seatIndex].alive = false;
  }

  for (let r = 0; r < BOARD_SIZE; r++) {
    const row = state.board[r];
    if (!row) continue;
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = row[c]?.piece;
      if (piece && piece.type === 'player' && piece.playerId === playerId) {
        row[c]!.piece = null;
        break;
      }
    }
  }

  seats[seatIndex] = null;

  // 代打者走了，NPC 隊友退回 AI 自動行動
  if (state.npcController === playerId) state.npcController = null;

  const activePlayers = seats.filter((id): id is PlayerId => id !== null);
  if (activePlayers.length === 0) {
    state.over = true;
    state.won = false;
    return events;
  }

  if (state.turnSeat === seatIndex) {
    // 只能交給「還在線上、活著、沒被放逐」的真人座位。交給 NPC 座位的話
    // seats[i] 是 null，autoActDnd 找不到人代打，房間會每 45 秒空轉一次。
    let handOff = -1;
    for (let step = 1; step <= SEAT_COUNT; step++) {
      const seat = (seatIndex + step) % SEAT_COUNT;
      const seatInfo = state.seats[seat];
      if (!seats[seat] || !seatInfo?.alive) continue;
      if (seatInfo.banishedTurns && seatInfo.banishedTurns > 0) continue;
      handOff = seat;
      break;
    }

    if (handOff === -1) {
      state.over = true;
      state.won = false;
      state.ranking = rankDndSeats(seats, state);
      return events;
    }

    state.turnSeat = handOff;
    state.turnDeadline = Date.now() + TURN_MS;
    state.turnHasMoved = false;
  }

  return events;
}

function runNpcTurn(seats: Seats, state: DndState, npcSeat: number, rng: () => number): LogEvent[] {
  const events: LogEvent[] = [];
  const npcInfo = state.seats[npcSeat];
  if (!npcInfo || !npcInfo.alive) return [];

  const npcId = `npc-${npcSeat}`;
  const npcName = npcInfo.name || `NPC ${npcSeat + 1}`;

  let pr = -1, pc = -1;
  let npcPiece: DndPiece | null = null;
  for (let r = 0; r < BOARD_SIZE; r++) {
    const row = state.board[r];
    if (!row) continue;
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = row[c]?.piece;
      if (piece && piece.id === npcId) {
        pr = r;
        pc = c;
        npcPiece = piece;
        break;
      }
    }
  }

  if (!npcPiece) return [];

  const dirs = [
    { dr: -1, dc: 0, dir: 'up' },
    { dr: 1, dc: 0, dir: 'down' },
    { dr: 0, dc: -1, dir: 'left' },
    { dr: 0, dc: 1, dir: 'right' },
  ];

  const classId = npcPiece.classId || 'brave';
  // 【狙擊】開著的時候，NPC 弓手一樣打得到整張地圖
  const sniperOpen = classId === 'archer' && (npcInfo.sniperTurns ?? 0) > 0;
  const maxRange = sniperOpen ? BOARD_SIZE * 2 : (DND_CLASS_RANGE[classId as DndClassId] ?? 1);
  // 「該不該走近」一律看職業本來的射程。狙擊窗口把 maxRange 撐到整張地圖，
  // 拿它當門檻的話弓手會在窗口開著的六輪（到期又立刻重開）站在原地不跟隊伍走。
  const walkRange = DND_CLASS_RANGE[classId as DndClassId] ?? 1;

  /**
   * 受傷的 NPC 會撤退，而不是繼續往前送。
   *
   * 血量掉到門檻以下時：有牧師就往牧師身邊靠（牧師的 AI 會優先救血量低於 70% 的隊友），
   * 沒有牧師就往遠離怪物的方向退，然後原地休息。回傳 true 代表這一回合用掉了。
   */
  const tryNpcRetreat = (): boolean => {
    if (npcPiece.hp / Math.max(1, npcPiece.maxHp) > NPC_RETREAT_RATIO) return false;

    // 一步一步走，每一步都重新定位 —— 中途可能踩到陷阱或掉進別的結算
    const stepTo = (want: (r: number, c: number) => number, budget: number) => {
      for (let step = 0; step < budget; step++) {
        let best: { r: number; c: number; dir: string } | null = null;
        let bestScore = want(pr, pc);
        for (const d of dirs) {
          const nr = pr + d.dr;
          const nc = pc + d.dc;
          if (!inBounds(nr, nc)) continue;
          if (state.board[nr]?.[nc]?.piece !== null) continue;
          const score = want(nr, nc);
          if (score < bestScore) {
            bestScore = score;
            best = { r: nr, c: nc, dir: d.dir };
          }
        }
        if (!best) break;
        if (!backendApplyMove(seats, state, npcPiece, best, false, rng, events)) break;
        const moved = findPieceById(state, npcPiece.id);
        if (!moved) return false;
        pr = moved.r;
        pc = moved.c;
      }
      return true;
    };

    const moveRange = DND_CLASS_MOVE[classId] ?? 1;

    // 找還活著的牧師隊友（不算自己）
    let healer: { r: number; c: number } | null = null;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const piece = state.board[r]?.[c]?.piece;
        if (!piece || piece.type !== 'player' || piece.id === npcPiece.id) continue;
        if (piece.classId !== 'star') continue;
        const seat = seatIndexOfPiece(seats, piece);
        if (seat === -1 || !state.seats[seat]?.alive) continue;
        healer = { r, c };
      }
    }

    const who = npcName.split(' ')[0];
    if (healer) {
      const dist = Math.abs(pr - healer.r) + Math.abs(pc - healer.c);
      if (dist > 1) {
        if (!stepTo((r, c) => Math.abs(r - healer!.r) + Math.abs(c - healer!.c), moveRange)) return true;
        events.push({ t: 'dndMessage', message: `🩹 ${who} 傷得不輕，退到牧師身邊。` } as any);
      }
    } else {
      // 沒有牧師：往離怪物遠一點的地方退（分數取負的距離，越遠分數越低）
      let foe: { r: number; c: number } | null = null;
      let near = 9999;
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          if (!isHostile(state.board[r]?.[c]?.piece)) continue;
          const dist = Math.abs(pr - r) + Math.abs(pc - c);
          if (dist < near) { near = dist; foe = { r, c }; }
        }
      }
      if (foe) {
        if (!stepTo((r, c) => -(Math.abs(r - foe!.r) + Math.abs(c - foe!.c)), moveRange)) return true;
        events.push({ t: 'dndMessage', message: `🩹 ${who} 撐不住了，退開幾步喘口氣。` } as any);
      }
    }

    // 退完就地休息，把血補一點回來
    const restBonus = classId === 'gladiator' ? (equipmentOf(state, npcSeat)?.restBonus ?? 0) : 0;
    const heal = 1 + restBonus;
    npcPiece.hp = Math.min(npcPiece.maxHp, npcPiece.hp + heal);
    npcInfo.hp = npcPiece.hp;
    events.push({ t: 'dndMessage', message: `🏕️ ${who} 原地休息，恢復了 ${heal} 點 HP。` } as any);
    return true;
  };

  /**
   * NPC 的主動技能。原本只有牧師會放，其他七個職業一律只會普攻 ——
   * 等於隊友身上有一半的設計是關掉的。
   *
   * 這裡刻意寫得比真人保守（條件不成立就退回普攻），而且所有數字都讀跟玩家同一組常數，
   * 不然平衡調整只會改到一邊。回傳 true 代表技能放掉了，這一回合就到此為止。
   */
  const tryNpcSkill = (): boolean => {
    // 場上一隻敵人都沒有就別放技能。沒有這道閘門，召喚術士會在清完場之後
    // 站在原地繼續召喚，隊伍永遠走不到樓梯。
    if (!findAnyMonster(state)) return false;

    const cooldown = npcInfo.skillCooldown ?? 0;
    if (cooldown > 0) {
      npcInfo.skillCooldown = cooldown - 1;
      return false;
    }

    const nearest = (range: number, filter: (p: DndPiece) => boolean = () => true) => {
      let best: { piece: DndPiece; r: number; c: number; dist: number } | null = null;
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          const piece = state.board[r]?.[c]?.piece;
          if (!isHostile(piece) || piece!.invulnerable || !filter(piece!)) continue;
          const dist = Math.abs(pr - r) + Math.abs(pc - c);
          if (dist <= range && (!best || dist < best.dist)) best = { piece: piece!, r, c, dist };
        }
      }
      return best;
    };
    const spend = () => { npcInfo.skillCooldown = SKILL_COOLDOWN[classId] ?? 1; };
    const who = npcName.split(' ')[0];

    // 騎士【鎖鏈】：把搆不到的怪拉到臉上，這樣同一輪就打得到
    if (classId === 'brave') {
      const target = nearest(3, (p) => true);
      if (!target || target.dist <= maxRange) return false;
      const spot = freeCellNextTo(state, pr, pc);
      if (!spot) return false;
      state.board[target.r]![target.c]!.piece = null;
      state.board[spot.r]![spot.c]!.piece = target.piece;
      pushFx(state, target.piece.id, 'chain');
      events.push({ t: 'dndMessage', kind: 'skill', message: `⛓️ ${who} 揮出【鎖鏈】，將 ${target.piece.name} 強行拉到身旁！` } as any);
      spend();
      return true;
    }

    // 鬥士【野蠻衝撞】：衝到目標旁邊，造成固定傷害並暈眩
    if (classId === 'gladiator') {
      const target = nearest(GLADIATOR_CHARGE_RANGE);
      if (!target || target.dist <= 1) return false;
      const landing = freeCellNextTo(state, target.r, target.c);
      if (landing) {
        state.board[pr]![pc]!.piece = null;
        state.board[landing.r]![landing.c]!.piece = npcPiece;
        pr = landing.r;
        pc = landing.c;
      }
      target.piece.hp = Math.max(0, target.piece.hp - GLADIATOR_CHARGE_DAMAGE);
      target.piece.stunnedTurns = 1;
      pushFx(state, target.piece.id, 'stun');
      events.push({
        t: 'dndAttack', player: npcName, target: target.piece.name,
        roll: 0, hit: true, damage: GLADIATOR_CHARGE_DAMAGE,
      });
      events.push({ t: 'dndMessage', kind: 'skill', message: `🐗 ${who} 一記【野蠻衝撞】撞上了 ${target.piece.name}！` } as any);
      events.push(...sweepDeadMonsters(seats, state, rng));
      spend();
      return true;
    }

    // 盜賊【撒網】：釘住還沒被網住、而且還搆不到的怪
    if (classId === 'bubble') {
      const target = nearest(ROGUE_NET_RANGE, (p) => !p.trappedTurns);
      if (!target || target.dist <= maxRange) return false;
      const dagger = equipmentOf(state, npcSeat);
      target.piece.trappedTurns = ROGUE_NET_TURNS + (dagger?.netBonusTurns ?? 0);
      target.piece.netDamage = 1 + (dagger?.netBonusDamage ?? 0);
      pushFx(state, target.piece.id, 'net');
      events.push({ t: 'dndMessage', kind: 'skill', message: `🕸️ ${who} 撒出羅網纏住了 ${target.piece.name}！` } as any);
      spend();
      return true;
    }

    // 弓手【狙擊】：窗口還沒開、而且場上有搆不到的怪就開起來
    if (classId === 'archer') {
      if ((npcInfo.sniperTurns ?? 0) > 0) return false;
      const outOfReach = !nearest(maxRange);
      if (!outOfReach) return false;
      npcInfo.sniperTurns = SNIPE_TURNS + 1;
      pushFx(state, npcPiece.id, 'snipe');
      events.push({
        t: 'dndMessage', kind: 'skill',
        message: `🎯 ${who} 架起弓 —— 接下來 ${SNIPE_TURNS} 回合，地圖上任何一個角落都在射程之內！`,
      } as any);
      spend();
      return true;
    }

    // 法師【火牆】：至少要燒得到兩隻才值得放
    if (classId === 'tangerine') {
      let bestSpot: { r: number; c: number; hits: number } | null = null;
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          if (Math.abs(pr - r) + Math.abs(pc - c) > FIRE_WALL_RANGE) continue;
          let hits = 0;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (isHostile(state.board[r + dr]?.[c + dc]?.piece)) hits++;
            }
          }
          if (hits >= 2 && (!bestSpot || hits > bestSpot.hits)) bestSpot = { r, c, hits };
        }
      }
      if (!bestSpot) return false;
      const placed = castFireWall(state, pr, pc, bestSpot.r, bestSpot.c, npcSeat);
      if (placed === 0) return false;
      events.push({ t: 'dndMessage', kind: 'skill', message: `🔥 ${who} 燃起一道【火牆】，擋在 ${bestSpot.hits} 隻敵人腳下！` } as any);
      spend();
      return true;
    }

    // 吟遊詩人【進擊之歌】：附近有兩隻以上的怪，值得替全隊開一輪增傷
    if (classId === 'bard') {
      let near = 0;
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          if (isHostile(state.board[r]?.[c]?.piece) && Math.abs(pr - r) + Math.abs(pc - c) <= 6) near++;
        }
      }
      if (near < 2) return false;
      const ratio = BARD_MARCH_RATIO + songBonusOf(state, npcSeat) / 10;
      eachLivingSeat(state, (info) => {
        info.dmgBuffTurns = BARD_OFFENSE_TURNS;
        info.dmgBuffRatio = ratio;
      });
      pushFx(state, npcPiece.id, 'song');
      events.push({
        t: 'dndMessage', kind: 'skill',
        message: `🎺 ${who} 奏起【進擊之歌】—— 全隊的傷害提高 ${Math.round(ratio * 100)}%！`,
      } as any);
      spend();
      return true;
    }

    // 召喚術士【魔物召喚】：一層兩次，能召就召
    if (classId === 'summoner') {
      const used = npcInfo.summonsUsed ?? 0;
      if (used >= SUMMON_PER_LEVEL) return false;
      const { cap, roster } = summonRosterOf(state, npcSeat);
      if (cap - allyCount(state) <= 0) return false;

      let born = 0;
      for (let i = 0; i < Math.min(SUMMON_BASE_CAP, cap - allyCount(state)); i++) {
        const template = roster[Math.floor(rng() * roster.length)]!;
        const minion = makeGoblin(`ally-${npcSeat}-${state.roundCount}-${i}-${Math.floor(rng() * 1000)}`, template);
        minion.ally = true;
        state.monsterActed.add(minion.id);
        if (placeNear(state, pr, pc, minion)) born++;
      }
      if (born === 0) return false;
      npcInfo.summonsUsed = used + 1;
      pushFx(state, npcPiece.id, 'summon');
      events.push({ t: 'dndMessage', kind: 'skill', message: `🌑 ${who} 撕開地面，喚出了 ${born} 隻隨從！` } as any);
      spend();
      return true;
    }

    return false;
  };

  // 牧師 NPC 以奶量優先：只要 3 格內有隊友掉到 70% 以下，這回合就補血不打人。
  // 冷卻跟真人牧師一樣是 1 回合，才不會變成無限治療機。
  if (classId === 'star') {
    const cooldown = npcInfo.skillCooldown ?? 0;
    if (cooldown > 0) {
      npcInfo.skillCooldown = cooldown - 1;
    } else {
      let woundedAlly: DndPiece | null = null;
      let lowestRatio = NPC_HEAL_THRESHOLD;

      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          const piece = state.board[r]?.[c]?.piece;
          if (!piece || piece.type !== 'player') continue;
          if (Math.abs(pr - r) + Math.abs(pc - c) > CLERIC_HEAL_RANGE) continue;

          const allySeat = seatIndexOfPiece(seats, piece);
          if (allySeat === -1 || !state.seats[allySeat]?.alive) continue;

          const ratio = piece.hp / piece.maxHp;
          if (ratio < lowestRatio) {
            lowestRatio = ratio;
            woundedAlly = piece;
          }
        }
      }

      if (woundedAlly) {
        woundedAlly.hp = Math.min(woundedAlly.maxHp, woundedAlly.hp + CLERIC_HEAL_AMOUNT);
        const allySeat = seatIndexOfPiece(seats, woundedAlly);
        if (allySeat !== -1 && state.seats[allySeat]) {
          state.seats[allySeat]!.hp = woundedAlly.hp;
        }
        npcInfo.skillCooldown = 1;
        events.push({
          t: 'dndAttack',
          player: npcName,
          target: woundedAlly.name,
          roll: 0,
          hit: true,
          damage: -CLERIC_HEAL_AMOUNT,
        });
        events.push({
          t: 'dndMessage', kind: 'skill',
          message: `✨ ${npcName.split(' ')[0]} 見 ${woundedAlly.name.split(' ')[0]} 傷勢過重，優先施放了治癒術！`,
        } as any);
        return events;
      }
    }
  }

  // 順序：先看要不要撤退（血快沒了就別再談輸出），再看要不要放技能
  if (tryNpcRetreat()) return events;
  if (classId !== 'star' && tryNpcSkill()) return events;

  // 目標掃描做成函式：移動之前掃一次、走完之後再掃一次。
  // 只掃一次的話 NPC 永遠只打得到「站著不動就搆得到」的怪 —— 走過去那一輪不會出手。
  // 回傳而不是改外面的變數：TypeScript 追不進 closure，改外面的話後面全部會被 narrow 成 never。
  const scanTarget = (): { piece: DndPiece; r: number; c: number } | null => {
    let best: { piece: DndPiece; r: number; c: number } | null = null;
    let bestFoe = false;
    let minGdist = 9999;

    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const cell = state.board[r]?.[c];
        if (!cell?.piece || cell.piece.invulnerable) continue;
        // B6 的祭壇也是打擊目標 —— 不然四個位置都是 NPC 的時候永遠拆不掉，這一層會卡死。
        // 怪物永遠優先：祭壇只有在還沒選到任何怪的時候才會被挑走
        const foe = isHostile(cell.piece);
        if (!foe && cell.piece.type !== 'altar') continue;
        const dist = Math.abs(pr - r) + Math.abs(pc - c);
        if (dist > maxRange) continue;
        const better = foe ? (dist < minGdist || !bestFoe) : (dist < minGdist && best === null);
        if (better) {
          minGdist = dist;
          bestFoe = foe;
          best = { piece: cell.piece, r, c };
        }
      }
    }
    return best;
  };

  let found = scanTarget();

  // 目標還在正常射程外就先走近（走完 scanTarget 會再掃一次，這一輪照樣射得到），
  // 不然狙擊窗口一開，下面那段移動就再也不會執行。
  if (found && sniperOpen && Math.abs(pr - found.r) + Math.abs(pc - found.c) > walkRange) {
    found = null;
  }

  // 射程內沒東西打就先走過去。走幾格照職業的移動力，不是固定一格 ——
  // 盜賊能衝 6 格卻跟法師一樣一輪挪一步，那條移動力等於沒有意義。
  if (!found) {
    let targetMon: { piece: DndPiece; r: number; c: number } | null = null;
    let minDist = 9999;
    let targetIsStairs = false;

    let stairsPos: { r: number; c: number } | null = null;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (state.board[r]?.[c]?.piece?.type === 'staircase') {
          stairsPos = { r, c };
          break;
        }
      }
    }

    if (stairsPos) {
      minDist = Math.abs(pr - stairsPos.r) + Math.abs(pc - stairsPos.c);
      targetMon = { piece: state.board[stairsPos.r]![stairsPos.c]!.piece!, r: stairsPos.r, c: stairsPos.c };
      targetIsStairs = true;
    } else {
      for (let r = 0; r < BOARD_SIZE; r++) {
        const row = state.board[r];
        if (!row) continue;
        for (let c = 0; c < row.length; c++) {
          const piece = row[c]?.piece;
          if (isHostile(piece)) {
            const dist = Math.abs(pr - r) + Math.abs(pc - c);
            if (dist < minDist) {
              minDist = dist;
              targetMon = { piece: piece!, r, c };
            }
          }
        }
      }
      // 場上沒有怪（B6 兩波之間會有空檔）就往最近的祭壇走
      if (!targetMon) {
        for (const altar of altarsOnBoard(state)) {
          const dist = Math.abs(pr - altar.r) + Math.abs(pc - altar.c);
          if (dist < minDist) {
            minDist = dist;
            targetMon = altar;
          }
        }
      }
    }

    if (targetMon) {
      // 走幾格照職業的移動力。原本固定一格，等於盜賊的 6 格移動完全沒有意義，
      // 而且離得稍遠的 NPC 要走好幾輪才碰得到怪，看起來就像整支隊伍在發呆。
      const moveRange = DND_CLASS_MOVE[classId] ?? 1;
      // NPC 隊友會走向樓梯但不會踏上去 —— 什麼時候下樓是真人玩家的決定。
      // 例外：隊伍裡沒有真人（單人魔王模式）時得由 NPC 自己下樓，不然會卡在這一層。
      const npcMayDescend = targetIsStairs && !partyHasHuman(seats, state);

      for (let step = 0; step < moveRange; step++) {
        const here = Math.abs(pr - targetMon.r) + Math.abs(pc - targetMon.c);
        // 進得了射程就停下來，剩下的步數留著 —— 再往前只是白白貼臉
        if (!targetIsStairs && here <= walkRange) break;

        let bestMove: { r: number; c: number; dir: string } | null = null;
        let bestDist = here;
        for (const d of dirs) {
          const nr = pr + d.dr;
          const nc = pc + d.dc;
          const targetCell = state.board[nr]?.[nc];
          if (targetCell && (targetCell.piece === null
              || (npcMayDescend && targetCell.piece.type === 'staircase'))) {
            const dist = Math.abs(nr - targetMon.r) + Math.abs(nc - targetMon.c);
            if (dist < bestDist) {
              bestDist = dist;
              bestMove = { r: nr, c: nc, dir: d.dir };
            }
          }
        }
        if (!bestMove) break; // 四面都堵住了
        if (!backendApplyMove(seats, state, npcPiece, bestMove, targetIsStairs, rng, events)) break;

        // 這一步可能踩到陷阱被放逐、或是踏上樓梯換層 —— 兩種情況棋盤都已經不是原來那張了
        const moved = findPieceById(state, npcPiece.id);
        if (!moved) return events;
        pr = moved.r;
        pc = moved.c;
      }
    }
    found = scanTarget();
  }

  if (found) {
    const targetGoblin = found.piece;
    const targetR = found.r;
    const targetC = found.c;
    const stats = CLASS_STATS[classId];
    const roll = Math.floor(rng() * 20) + 1;
    const isHit = roll + attackBonusOf(seats, state, npcSeat, classId) >= targetGoblin.ac;
    const npcDagger = classId === 'bubble' ? equipmentOf(state, npcSeat) : null;
    const npcDaggerDamage = npcDagger ? Math.round(roll * npcDagger.diceRatio) : 0;

    if (isHit) {
      const dmgRoll = Math.floor(rng() * stats.dmgDice) + 1;
      let damage = dmgRoll + stats.dmgFlat + npcDaggerDamage + bardAuraOf(seats, state);
      const npcMarch = damageBuffOf(state, npcSeat);
      if (npcMarch > 0) damage = Math.round(damage * (1 + npcMarch));
      targetGoblin.hp = Math.max(0, targetGoblin.hp - damage);

      if (classId === 'star') {
        let bestTargetPiece: DndPiece | null = null;
        let lowestRatio = 1.1;

        for (let r = 0; r < BOARD_SIZE; r++) {
          for (let c = 0; c < BOARD_SIZE; c++) {
            const piece = state.board[r]?.[c]?.piece;
            if (piece && piece.type === 'player') {
              let seatIdx = -1;
              if (piece.playerId) {
                seatIdx = seats.indexOf(piece.playerId);
              } else if (piece.id.startsWith('npc-')) {
                seatIdx = parseInt(piece.id.split('-')[1]!, 10);
              }
              if (seatIdx !== -1 && state.seats[seatIdx]?.alive) {
                const ratio = piece.hp / piece.maxHp;
                if (ratio < lowestRatio) {
                  lowestRatio = ratio;
                  bestTargetPiece = piece;
                }
              }
            }
          }
        }

        if (bestTargetPiece) {
          const healAmt = 1;
          bestTargetPiece.hp = Math.min(bestTargetPiece.maxHp, bestTargetPiece.hp + healAmt);
          
          let targetSeatIdx = -1;
          if (bestTargetPiece.playerId) {
            targetSeatIdx = seats.indexOf(bestTargetPiece.playerId);
          } else if (bestTargetPiece.id.startsWith('npc-')) {
            targetSeatIdx = parseInt(bestTargetPiece.id.split('-')[1]!, 10);
          }
          if (targetSeatIdx !== -1 && state.seats[targetSeatIdx]) {
            state.seats[targetSeatIdx]!.hp = bestTargetPiece.hp;
          }

          events.push({
            t: 'dndAttack',
            player: npcName,
            target: bestTargetPiece.name,
            roll: 0,
            hit: true,
            damage: -healAmt,
          });
        }
      }

      events.push({
        t: 'dndAttack',
        player: npcName,
        target: targetGoblin.name,
        roll,
        hit: true,
        damage,
      });

      if (targetGoblin.hp <= 0) {
        resolveTargetDeath(seats, state, targetGoblin, targetR, targetC, events, rng);
      } else if (targetGoblin.type === 'goblin') {
        events.push(...checkBossFinalPhase(state, rng));
        // 被動是職業能力，NPC 隊友也一樣會觸發
        if (classId === 'brave') {
          events.push(...warriorPassive(seats, state, npcPiece, targetGoblin, targetR, targetC, pr, pc, rng));
        } else if (classId === 'bubble') {
          events.push(...roguePassive(state, npcPiece, targetGoblin, rng));
        }
      }
    } else if (npcDaggerDamage > 0) {
      // 【骰子匕首】揮空也照打 —— NPC 盜賊跟真人走同一條規則
      targetGoblin.hp = Math.max(0, targetGoblin.hp - npcDaggerDamage);
      events.push({
        t: 'dndAttack',
        player: npcName,
        target: targetGoblin.name,
        roll,
        hit: true,
        damage: npcDaggerDamage,
      });
      if (targetGoblin.hp <= 0) {
        const targetCell = state.board[targetR]?.[targetC];
        if (targetCell) targetCell.piece = null;
        checkAndSpawnBossOrStaircase(seats, state, events, rng);
      }
    } else {
      events.push({
        t: 'dndAttack',
        player: npcName,
        target: targetGoblin.name,
        roll,
        hit: false,
        damage: 0,
      });
    }

    /*
     * 【狙擊】窗口期間的連射。真人那條在 applyDndAction 裡，NPC 這條是同一套規則的複寫 ——
     * 少了它，同一把【地獄之弓】在 NPC 手上一輪只射一箭，開窗口那一輪等於白費。
     * 第一箭走上面的一般流程，剩下的箭補在這裡，各自擲命中、各自算傷害。
     */
    if (classId === 'archer' && (equipmentOf(state, npcSeat)?.sniperShots ?? 1) > 1 && sniperOpen) {
      const extra = (equipmentOf(state, npcSeat)?.sniperShots ?? 1) - 1;
      for (let i = 0; i < extra; i++) {
        const victim = findPieceById(state, targetGoblin.id);
        if (!victim || !isHostile(victim.piece) || victim.piece.hp <= 0) break;
        if (victim.piece.invulnerable) break;

        const extraRoll = Math.floor(rng() * 20) + 1;
        const extraHit = extraRoll + attackBonusOf(seats, state, npcSeat, classId) >= victim.piece.ac;
        let extraDamage = 0;
        if (extraHit) {
          extraDamage = Math.floor(rng() * stats.dmgDice) + 1 + stats.dmgFlat + bardAuraOf(seats, state);
          const extraMarch = damageBuffOf(state, npcSeat);
          if (extraMarch > 0) extraDamage = Math.round(extraDamage * (1 + extraMarch));
          victim.piece.hp = Math.max(0, victim.piece.hp - extraDamage);
        }
        events.push({
          t: 'dndAttack',
          player: npcName,
          target: victim.piece.name,
          roll: extraRoll,
          hit: extraHit,
          damage: extraDamage,
        });
        events.push(...sweepDeadMonsters(seats, state, rng));
      }
    }
  }

  return events;
}

function backendApplyMove(
  seats: Seats,
  state: DndState,
  piece: DndPiece,
  bestMove: { r: number; c: number; dir: string } | null,
  targetIsStairs: boolean,
  rng: () => number,
  events: LogEvent[]
): boolean {
  if (!bestMove) return false;
  let pr = -1, pc = -1;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (state.board[r]?.[c]?.piece?.id === piece.id) {
        pr = r;
        pc = c;
      }
    }
  }
  if (pr === -1) return false;

  const targetCell = state.board[bestMove.r]?.[bestMove.c];
  const sourceCell = state.board[pr]?.[pc];
  if (targetCell && sourceCell) {
    // 第二道防線：只有真人操作的角色能踏上樓梯觸發換層，
    // 除非這支隊伍根本沒有真人（單人魔王模式）。
    const destHadStaircase =
      targetCell.piece?.type === 'staircase' &&
      (!piece.id.startsWith('npc-') || !partyHasHuman(seats, state));
    targetCell.piece = piece;
    sourceCell.piece = null;
    events.push({ t: 'dndMove', player: piece.name, dir: bestMove.dir });
    
    const postEvents = onPlayerMoveToCell(seats, state, piece, bestMove.r, bestMove.c, destHadStaircase, rng);
    events.push(...postEvents);
    return true;
  }
  return false;
}