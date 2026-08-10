import { TURN_MS, DND_BOSS_SEAT, DND_DIFFICULTY_MULTIPLIER, type DndDifficulty, type PlayerId, type DndAction, type DndCellView, type DndSeatInfo, type DndPiece, type LogEvent, type DownstairsCharacterId } from 'shared';

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
  fireWalls: Array<{ r: number; c: number; turns: number }>;
  bossSpawned: boolean;
  turnHasMoved: boolean;
  /** B3 的虛空酋長是否已經在 1/4 血時召回一、二樓的 Boss（只會發動一次） */
  finalPhase: boolean;
  /** 難度，開局時定案。乘數同時吃在怪物的 HP、傷害與 AC 上。 */
  difficulty: DndDifficulty;
  /** 操控怪物的玩家座位（固定是 DND_BOSS_SEAT）；null 代表沒人當魔王，怪物全自動。 */
  bossSeat: number | null;
  /** 這一局是不是打贏了。over 為 false 時沒有意義。 */
  won: boolean;
  /** 現在輪到冒險者還是魔王。沒有魔王時恆為 'party'。 */
  phase: 'party' | 'boss';
  /** 這一輪已經用掉「移動」的怪物 id。 */
  monsterMoved: Set<string>;
  /** 這一輪已經用掉「行動」（攻擊／自動結算）的怪物 id —— 對牠來說這輪結束了。 */
  monsterActed: Set<string>;
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
  | 'MONSTER_RESTRAINED';

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
};

export const BOARD_SIZE = 16;

/** 座位固定 4 個（沒人坐的由 NPC 隊友補上），回合推進的繞圈判定一律以它為準。 */
const SEAT_COUNT = 4;

/**
 * 一次玩家動作最多推進幾「輪」。放逐最長 2 輪就會到期，正常情況一兩輪內
 * 就會找到下一位可行動的真人；跑滿代表全隊都動不了，直接判定冒險失敗。
 */
const MAX_ROUND_LAPS = 12;

export const CLASS_STATS: Record<DownstairsCharacterId, { name: string; hp: number; ac: number; attackBonus: number; dmgDice: number; dmgFlat: number; description: string }> = {
  brave: { name: 'Warrior (戰士)', hp: 24, ac: 14, attackBonus: 4, dmgDice: 8, dmgFlat: 2, description: '前線坦攻。【鎖鏈】：將3格內的怪物拉到身旁。【反射】：受擊時把 1/3 傷害彈回攻擊者！ (移動2格)' },
  bubble: { name: 'Rogue (盜賊)', hp: 18, ac: 12, attackBonus: 5, dmgDice: 6, dmgFlat: 4, description: '突襲刺客，極高機動。【撒網】：把 5 格內的一隻怪物釘在原地 3 回合（牠仍能攻擊；虛空酋長靠瞬移不受影響）(移動5格)' },
  tangerine: { name: 'Mage (法師)', hp: 16, ac: 10, attackBonus: 3, dmgDice: 10, dmgFlat: 2, description: '遠程爆發，高傷害 (移動1格)' },
  star: { name: 'Cleric (牧師)', hp: 20, ac: 12, attackBonus: 3, dmgDice: 6, dmgFlat: 2, description: '神聖判官，攻擊時治癒隊友 (移動1格)' },
};

const ALL_CLASSES: DownstairsCharacterId[] = ['brave', 'bubble', 'tangerine', 'star'];

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

function makeGoblin(
  id: string,
  template: typeof GOBLIN_ROGUE | typeof GOBLIN_MAGE,
): DndPiece {
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
const DEBUFF_RATIO = 0.6;

/** 盜賊【撒網】的射程與拘束回合數。 */
const ROGUE_NET_RANGE = 5;
const ROGUE_NET_TURNS = 3;

/**
 * 這隻怪的位置是不是被網子綁住了。
 * 虛空酋長靠的是瞬間移動而不是雙腳，網子對牠只有持續傷害，擋不住牠的位移。
 */
function isRestrained(piece: DndPiece): boolean {
  if (piece.id === 'boss-3') return false;
  return !!(piece.trappedTurns && piece.trappedTurns > 0);
}

/** 戰士被動【反射】彈回去的比例：實際吃到的傷害的 1/3。 */
const WARRIOR_REFLECT_RATIO = 1 / 3;

/** 牧師 NPC 的補血門檻：隊友血量低於這個比例就先補血再說 */
const NPC_HEAL_THRESHOLD = 0.7;
/** 牧師【神聖治癒】的射程與治療量，真人與 NPC 共用 */
const CLERIC_HEAL_RANGE = 3;
const CLERIC_HEAL_AMOUNT = 4;

/**
 * 盜賊的攻擊被動：命中時二選一，各 1/2。
 * 【破甲】AC 掉到六成／【削弱】造成的傷害掉到六成，兩者都持續 2 回合。
 * 重複命中是刷新回合數，不會疊加 —— AC 一律從 acBase 重算。
 */
function roguePassive(rogue: DndPiece, target: DndPiece, rng: () => number): LogEvent[] {
  const who = rogue.name.split(' ')[0];

  if (Math.floor(rng() * 2) === 0) {
    target.acBase ??= target.ac;
    target.ac = Math.max(1, Math.round(target.acBase * DEBUFF_RATIO));
    target.acDebuffTurns = DEBUFF_TURNS;
    return [
      {
        t: 'dndMessage',
        message: `🗡️ ${who} 的匕首劃開了 ${target.name} 的護甲，AC 降到 ${target.ac}（${DEBUFF_TURNS} 回合）！`,
      } as any,
    ];
  }

  target.atkDebuffTurns = DEBUFF_TURNS;
  return [
    {
      t: 'dndMessage',
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
function castFireWall(state: DndState, pr: number, pc: number, tr: number, tc: number): number {
  const alongRow = Math.abs(tr - pr) >= Math.abs(tc - pc);
  const cells = alongRow
    ? [{ r: tr, c: tc - 1 }, { r: tr, c: tc }, { r: tr, c: tc + 1 }]
    : [{ r: tr - 1, c: tc }, { r: tr, c: tc }, { r: tr + 1, c: tc }];

  let placed = 0;
  for (const cell of cells) {
    if (!inBounds(cell.r, cell.c)) continue;
    const existing = state.fireWalls.find((wall) => wall.r === cell.r && wall.c === cell.c);
    if (existing) {
      existing.turns = FIRE_WALL_TURNS; // 疊在同一格只是續燒
    } else {
      state.fireWalls.push({ r: cell.r, c: cell.c, turns: FIRE_WALL_TURNS });
    }
    placed++;
  }
  return placed;
}

/**
 * 每回合結算火牆：燒站在裡面的怪物，然後倒數，燒完就熄。
 * 只燒怪物 —— 火牆不會誤傷隊友。
 */
function burnFireWalls(state: DndState): LogEvent[] {
  const events: LogEvent[] = [];
  if (state.fireWalls.length === 0) return events;

  for (const wall of state.fireWalls) {
    const cell = state.board[wall.r]?.[wall.c];
    const piece = cell?.piece;
    if (!piece || piece.type !== 'goblin') continue;

    piece.hp = Math.max(0, piece.hp - FIRE_WALL_DAMAGE);
    events.push({
      t: 'dndMessage',
      message: `🔥 ${piece.name} 站在火牆裡，被燒掉 ${FIRE_WALL_DAMAGE} 點 HP！`,
    } as any);
    if (piece.hp <= 0 && cell) {
      cell.piece = null;
      events.push({ t: 'dndMessage', message: `🔥 ${piece.name} 被火牆燒成了灰燼！` } as any);
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
    events.push({ t: 'dndMessage', message: `🌌 虛空酋長張開裂隙，${who} 被放逐了 1 回合！` } as any);
    return events;
  }

  if (roll === 1) {
    const mage = spawnMonster(state, makeGoblin(`m-mage-void-${Date.now()}-${Math.floor(rng() * 1000)}`, GOBLIN_MAGE));
    if (placeNear(state, victim.r, victim.c, mage)) {
      events.push({ t: 'dndMessage', message: `🧿 虛空酋長的低語喚出了一隻哥布林法師！` } as any);
    }
    return events;
  }

  seatInfo.fearTurns = 2;
  events.push({ t: 'dndMessage', message: `😱 ${who} 陷入【恐懼】，接下來 2 回合的移動方向會完全顛倒！` } as any);
  return events;
}

/**
 * 隊伍裡還有沒有真人操作的冒險者。
 * 沒有的話（單人魔王模式）NPC 必須自己下樓 —— 否則清完一層之後整隊會站在樓梯旁邊，
 * 永遠不會進到下一層。
 */
function partyHasHuman(seats: Seats, state: DndState): boolean {
  for (let seat = 0; seat < SEAT_COUNT; seat++) {
    if (seats[seat] && !state.seats[seat]?.isNpc) return true;
  }
  return false;
}

/** 棋子對應的座位：真人看 playerId，NPC 隊友看 `npc-<seat>` 的編號。 */
function seatIndexOfPiece(seats: Seats, piece: DndPiece): number {
  if (piece.playerId) return seats.indexOf(piece.playerId);
  if (piece.id.startsWith('npc-')) return parseInt(piece.id.split('-')[1]!, 10);
  return -1;
}

/**
 * 戰士的攻擊被動：命中時三選一，各 1/3。
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
    events.push({ t: 'dndMessage', message: `💫 ${who} 的重擊震暈了 ${target.name}，牠下一回合無法行動！` } as any);
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
      events.push({ t: 'dndMessage', message: `💢 ${who} 想擊退 ${target.name}，但牠身後沒有退路！` } as any);
      return events;
    }

    state.board[tr]![tc]!.piece = null;
    state.board[landedR]![landedC]!.piece = target;
    events.push({ t: 'dndMessage', message: `💥 ${who} 一記盾擊，把 ${target.name} 擊退了！` } as any);
    return events;
  }

  const seatIndex = seatIndexOfPiece(seats, warrior);
  const seatInfo = seatIndex === -1 ? undefined : state.seats[seatIndex];
  if (seatInfo) {
    seatInfo.damageCapTurns = 1;
    seatInfo.damageCap = 2;
    events.push({ t: 'dndMessage', message: `🛡️ ${who} 進入【極限防禦】，下一回合受到的每次傷害都不會超過 2 點！` } as any);
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

export function checkAndSpawnBossOrStaircase(seats: Seats, state: DndState, events: LogEvent[], rng: () => number) {
  let goblinCount = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (state.board[r]?.[c]?.piece?.type === 'goblin') {
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
    } else if (state.level === 3) {
      const bossCell = findEmptyCellNearCenter(state);
      if (bossCell) {
        const boss = spawnMonster(state, { id: 'boss-3', type: 'goblin', name: 'Void Chief (虛空酋長)', hp: 80, maxHp: 80, ac: 15 });
        bossCell.piece = boss;
        events.push({ t: 'dndMessage', message: '👑 終極魔王 Void Chief (虛空酋長) 降臨王座！' } as any);
      }
    }
    return;
  }
  
  if (state.level >= 3) return;

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
  } else if (state.level === 3) {
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

  // B2 起加派哥布林盜賊（一次衝 5 格），B3 再疊上哥布林法師（隔 3 格放法術）
  if (state.level >= 2) {
    const rogueSpots = [{ r: 7, c: 2 }, { r: 7, c: 13 }, { r: 9, c: 7 }];
    rogueSpots.forEach((spot, idx) => {
      placeNear(state, spot.r, spot.c, spawnMonster(state, makeGoblin(`m-rogue-${idx}`, GOBLIN_ROGUE)));
    });
  }
  if (state.level >= 3) {
    const mageSpots = [{ r: 2, c: 7 }, { r: 2, c: 8 }, { r: 5, c: 12 }];
    mageSpots.forEach((spot, idx) => {
      placeNear(state, spot.r, spot.c, spawnMonster(state, makeGoblin(`m-mage-${idx}`, GOBLIN_MAGE)));
    });
  }

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
  characterIds?: Record<PlayerId, DownstairsCharacterId>,
  difficulty: DndDifficulty = 'normal',
  bossSeat: number | null = null,
  rng: () => number = Math.random,
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

  const usedClasses = new Set<DownstairsCharacterId>();
  for (let seatIndex = 0; seatIndex < 4; seatIndex++) {
    const playerId = seats[seatIndex];
    if (playerId && characterIds?.[playerId]) {
      usedClasses.add(characterIds[playerId]);
    }
  }

  for (let seatIndex = 0; seatIndex < 4; seatIndex++) {
    const playerId = seats[seatIndex];
    const pos = starts[seatIndex] || { r: 0, c: 0 };
    
    let classId: DownstairsCharacterId;
    if (playerId && characterIds?.[playerId]) {
      classId = characterIds[playerId];
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
      stateSeats[seatIndex] = { hp: stats.hp, maxHp: stats.hp, alive: true, isNpc: false, name: `${stats.name}` };
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
      stateSeats[seatIndex] = { hp: stats.hp, maxHp: stats.hp, alive: true, isNpc: true, name: npcName };
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
    won: false,
    phase: 'party',
    monsterMoved: new Set(),
    monsterActed: new Set(),
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
function beginRound(seats: Seats, state: DndState, rng: () => number, events: LogEvent[]) {
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
        events.push({ t: 'dndMessage', message: `🌀 ${seatInfo.piece.name.split(' ')[0]} 從異空間回歸戰場！` } as any);
        seatInfo.piece = undefined;
        seatInfo.banishCell = undefined;
      }
    }
  }

  // 火牆先燒再讓怪物行動：規則是「站在火牆裡面每回合扣 3」，
  // 等牠們走完才結算的話，被蓋在火牆下的怪只要抬腳就一點傷都不用吃。
  events.push(...burnFireWalls(state));

  // 撒網的持續傷害與倒數。放在這裡而不是怪物 AI 裡，是因為被網住的怪
  // 仍然會行動（只是不能移動），有魔王時牠也可能由魔王親自指揮 ——
  // 結算擺在回合開頭才保證「一輪剛好扣一次」。
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = state.board[r]?.[c]?.piece;
      if (!piece || piece.type !== 'goblin') continue;
      if (!piece.trappedTurns || piece.trappedTurns <= 0) continue;

      piece.hp = Math.max(0, piece.hp - 1);
      piece.trappedTurns--;
      events.push({
        t: 'dndMessage',
        message: `🕸️ ${piece.name} 被網子纏住，原地掙扎並受到 1 點傷害！`,
      } as any);
      if (piece.hp <= 0) {
        state.board[r]![c]!.piece = null;
        events.push({ t: 'dndMessage', message: `🕸️ ${piece.name} 力竭倒在網中！` } as any);
      }
    }
  }

  // 網子或火牆有可能剛好清掉這一層最後一隻怪，補一次判定才不會卡在「沒怪也沒樓梯」
  checkAndSpawnBossOrStaircase(seats, state, events, rng);
}

/** 一輪的後半：減益倒數、玩家身上的增益倒數、補一次 Boss／樓梯判定。 */
function endRound(seats: Seats, state: DndState, rng: () => number, events: LogEvent[]) {
  // 減益要撐過怪物回合才遞減，這樣【削弱】才會真的作用在牠那次攻擊上
  tickMonsterDebuffs(state);

  // 【極限防禦】保護的就是上面這個怪物回合，所以要等它跑完才遞減；
  // 【恐懼】則是綁玩家自己的回合，跟放逐一樣一輪扣一格。
  for (let idx = 0; idx < SEAT_COUNT; idx++) {
    const seatInfo = state.seats[idx];
    if (!seatInfo) continue;
    if (seatInfo.damageCapTurns && seatInfo.damageCapTurns > 0) {
      seatInfo.damageCapTurns--;
      if (seatInfo.damageCapTurns === 0) seatInfo.damageCap = undefined;
    }
    if (seatInfo.fearTurns && seatInfo.fearTurns > 0) {
      seatInfo.fearTurns--;
      if (seatInfo.fearTurns === 0) {
        events.push({
          t: 'dndMessage',
          message: `😮‍💨 ${seatInfo.name?.split(' ')[0] ?? `P${idx + 1}`} 擺脫了【恐懼】，行動恢復正常。`,
        } as any);
      }
    }
  }

  // 怪物也可能死在自己的回合裡（被撒網纏住持續扣血、或被火牆燒死），那些路徑沒有經過玩家的
  // 擊殺判定，這裡補一次檢查，否則這層會變成「沒有怪、也沒有 Boss／樓梯」的死局。
  checkAndSpawnBossOrStaircase(seats, state, events, rng);
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
  events.push(...runMonstersTurn(seats, state, rng));
  endRound(seats, state, rng, events);
  state.monsterMoved.clear();
  state.monsterActed.clear();
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
  if (seats[activeSeat] !== playerId) return { ok: false, error: 'NOT_YOUR_TURN' };

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

  let pr = -1, pc = -1;
  let playerPiece: DndPiece | null = null;
  for (let r = 0; r < BOARD_SIZE; r++) {
    const row = state.board[r];
    if (!row) continue;
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = row[c]?.piece;
      if (piece && piece.type === 'player' && piece.playerId === playerId) {
        pr = r;
        pc = c;
        playerPiece = piece;
        break;
      }
    }
  }

  if (!playerPiece) return { ok: false, error: 'BAD_ACTION' };

  const events: LogEvent[] = [];

  let currentAction = action;
  if (action.kind === 'turnCombo') {
    // 終結動作要先驗證再套用移動：移動（甚至換層）已經寫進 state 之後才回錯誤的話，
    // handlers 會直接 return 不廣播，客戶端會停在舊棋盤、伺服器卻已經前進了一層。
    if (!action.action) return { ok: false, error: 'BAD_ACTION' };

    if (action.move) {
      if (state.turnHasMoved) return { ok: false, error: 'ALREADY_MOVED' };
      const wanted = fearedTarget(seats, state, playerId, pr, pc, action.move.r, action.move.c);
      const tr = wanted.r;
      const tc = wanted.c;
      if (wanted.feared) {
        events.push({ t: 'dndMessage', message: `😱 ${playerPiece.name.split(' ')[0]} 被【恐懼】支配，朝著反方向踉蹌走去！` } as any);
      }

      const classId = playerPiece.classId || 'brave';
      const maxMove = classId === 'bubble' ? 5 : (classId === 'brave' ? 2 : 1);
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

      if (movementInterrupted(seats, state, playerId, postEvents)) {
        // 換層（棋盤重置）或踩到陷阱被放逐（角色離場）之後，pr/pc 與 targetId 全部失效，
        // 這回合的終結動作直接跳過，照常收尾交棒。
        return finishDndTurn(seats, state, playerId, activeSeat, 'move', events, rng);
      }
    }

    currentAction = action.action;
  }

  const kind = currentAction.kind;
  const dir = currentAction.dir;
  const targetId = currentAction.targetId;

  if (kind === 'move' || kind === 'moveTo') {
    if (state.turnHasMoved) return { ok: false, error: 'ALREADY_MOVED' };

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
      const maxMove = classId === 'bubble' ? 5 : (classId === 'brave' ? 2 : 1);
      const dist = Math.abs(pr - tr) + Math.abs(pc - tc);
      if (dist > maxMove || dist === 0) return { ok: false, error: 'INVALID_CELL' };
    }

    const wanted = fearedTarget(seats, state, playerId, pr, pc, tr, tc);
    tr = wanted.r;
    tc = wanted.c;
    if (wanted.feared) {
      events.push({ t: 'dndMessage', message: `😱 ${playerPiece.name.split(' ')[0]} 被【恐懼】支配，朝著反方向踉蹌走去！` } as any);
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

    if (movementInterrupted(seats, state, playerId, postEvents)) {
      // 角色已離場或棋盤已重置，這回合不可能再做任何事，直接收尾交棒 ——
      // 留著回合給一個不在棋盤上的人，autoActDnd 會永遠找不到棋子而空轉。
      return finishDndTurn(seats, state, playerId, activeSeat, 'move', events, rng);
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
    if (targetPiece.type !== 'goblin') return { ok: false, error: 'TARGET_NOT_FOUND' };

    const classId = playerPiece.classId || 'brave';
    const maxRange = classId === 'tangerine' ? 3 : 1;
    const dist = Math.abs(pr - tr) + Math.abs(pc - tc);
    if (dist > maxRange) return { ok: false, error: 'TARGET_OUT_OF_RANGE' };

    const stats = CLASS_STATS[classId];
    const roll = Math.floor(rng() * 20) + 1;
    
    const isFirstRogueHit = classId === 'bubble' && !targetPiece.damagedByRogue;
    const isHit = isFirstRogueHit ? true : roll + stats.attackBonus >= targetPiece.ac;

    if (isHit) {
      const dmgRoll = Math.floor(rng() * stats.dmgDice) + 1;
      let damage = dmgRoll + stats.dmgFlat;

      if (classId === 'bubble') {
        if (!targetPiece.damagedByRogue) {
          targetPiece.damagedByRogue = true;
        }
      }

      targetPiece.hp = Math.max(0, targetPiece.hp - damage);

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

      if (targetPiece.hp <= 0) {
        const targetCell = state.board[tr]?.[tc];
        if (targetCell) {
          targetCell.piece = null;
        }
        checkAndSpawnBossOrStaircase(seats, state, events, rng);
      } else {
        events.push(...checkBossFinalPhase(state, rng));
        // 被動要在死亡判定之後才跑：屍體不需要暈眩，也不該被擊退
        if (classId === 'brave') {
          events.push(...warriorPassive(seats, state, playerPiece, targetPiece, tr, tc, pr, pc, rng));
        } else if (classId === 'bubble') {
          events.push(...roguePassive(playerPiece, targetPiece, rng));
        }
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

    if (classId === 'star' && playerPiece.hp > 0) {
      playerPiece.hp = Math.min(playerPiece.maxHp, playerPiece.hp + 1);
      const selfSeatIdx = seats.indexOf(playerId);
      if (selfSeatIdx !== -1 && state.seats[selfSeatIdx]) {
        state.seats[selfSeatIdx]!.hp = playerPiece.hp;
      }
      events.push({ t: 'dndMessage', message: `🙏 ${playerPiece.name.split(' ')[0]} 的信仰之力湧現，補充了自己 1 點 HP。` } as any);
    }
  } else if (kind === 'rest') {
    playerPiece.hp = Math.min(playerPiece.maxHp, playerPiece.hp + 1);
    const seatIdx = seats.indexOf(playerId);
    if (seatIdx !== -1 && state.seats[seatIdx]) {
      state.seats[seatIdx]!.hp = playerPiece.hp;
    }
    events.push({ t: 'dndMessage', message: `🏕️ ${playerPiece.name.split(' ')[0]} 選擇原地休息，恢復了 1 點 HP。` } as any);

  } else if (kind === 'skill') {
    const classId = playerPiece.classId || 'brave';

    const selfSeatForCooldown = seats.indexOf(playerId);
    if (selfSeatForCooldown !== -1) {
      const cd = state.seats[selfSeatForCooldown]?.skillCooldown;
      if (cd && cd > 0) return { ok: false, error: 'SKILL_ON_COOLDOWN' };
    }

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

      const healAmt = CLERIC_HEAL_AMOUNT;
      targetPiece.hp = Math.min(targetPiece.maxHp, targetPiece.hp + healAmt);
      
      let tSeatIdx = -1;
      if (targetPiece.playerId) tSeatIdx = seats.indexOf(targetPiece.playerId);
      else if (targetPiece.id.startsWith('npc-')) tSeatIdx = parseInt(targetPiece.id.split('-')[1]!, 10);
      
      if (tSeatIdx !== -1 && state.seats[tSeatIdx]) {
        state.seats[tSeatIdx]!.hp = targetPiece.hp;
      }
      events.push({ t: 'dndMessage', message: `✨ ${playerPiece.name.split(' ')[0]} 施放治癒術，恢復了 ${targetPiece.name.split(' ')[0]} ${healAmt} 點 HP！` } as any);
      
    } else if (classId === 'bubble') {
      // 【撒網】：對 5 格內的一隻怪物撒網把牠拘束住
      if (!targetId) return { ok: false, error: 'BAD_ACTION' };
      const netted = findPieceById(state, targetId);
      if (!netted || netted.piece.type !== 'goblin') return { ok: false, error: 'TARGET_NOT_FOUND' };

      const dist = Math.abs(pr - netted.r) + Math.abs(pc - netted.c);
      if (dist > ROGUE_NET_RANGE) return { ok: false, error: 'TARGET_OUT_OF_RANGE' };

      netted.piece.trappedTurns = ROGUE_NET_TURNS;
      events.push({
        t: 'dndMessage',
        message: `🕸️ ${playerPiece.name.split(' ')[0]} 撒出羅網纏住 ${netted.piece.name}，接下來 ${ROGUE_NET_TURNS} 回合牠被釘在原地並持續受傷！`,
      } as any);

    } else if (classId === 'brave') {
      if (!targetId) return { ok: false, error: 'BAD_ACTION' };
      let tr = -1, tc = -1, targetMonster: DndPiece | null = null;
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          const p = state.board[r]?.[c]?.piece;
          if (p && p.id === targetId && p.type === 'goblin') {
            tr = r; tc = c; targetMonster = p;
          }
        }
      }
      if (!targetMonster) return { ok: false, error: 'TARGET_NOT_FOUND' };

      const dist = Math.abs(pr - tr) + Math.abs(pc - tc);
      if (dist > 3) return { ok: false, error: 'TARGET_OUT_OF_RANGE' };

      const adj = [
        { r: pr - 1, c: pc }, { r: pr + 1, c: pc },
        { r: pr, c: pc - 1 }, { r: pr, c: pc + 1 }
      ];
      const openCells = adj.filter((pos) => {
        if (pos.r < 0 || pos.r >= BOARD_SIZE || pos.c < 0 || pos.c >= BOARD_SIZE) return false;
        return state.board[pos.r]?.[pos.c]?.piece === null;
      });
      const pullCell = openCells[0] ?? null;

      if (!pullCell) {
        events.push({ t: 'dndMessage', message: `⛓️ ${playerPiece.name.split(' ')[0]} 施放【鎖鏈】，但周圍沒有空間可以將怪物拉過來！` } as any);
      } else {
        const oldMonsterCell = state.board[tr]?.[tc];
        const newMonsterCell = state.board[pullCell.r]?.[pullCell.c];
        if (oldMonsterCell && newMonsterCell) {
          newMonsterCell.piece = targetMonster;
          oldMonsterCell.piece = null;
          events.push({ t: 'dndMessage', message: `⛓️ ${playerPiece.name.split(' ')[0]} 揮出【鎖鏈】，將 ${targetMonster.name} 強行拉到身旁！` } as any);
        }
      }

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

      const placed = castFireWall(state, pr, pc, tr, tc);
      if (placed === 0) return { ok: false, error: 'INVALID_CELL' };

      events.push({
        t: 'dndMessage',
        message: `🔥 ${playerPiece.name.split(' ')[0]} 燃起一道 ${placed} 格【火牆】，站在裡面的怪物每回合會被燒掉 ${FIRE_WALL_DAMAGE} 點 HP，持續 ${FIRE_WALL_TURNS} 回合！`,
      } as any);
    } else {
      return { ok: false, error: 'BAD_ACTION' };
    }
  } else {
    return { ok: false, error: 'BAD_ACTION' };
  }

  return finishDndTurn(seats, state, playerId, activeSeat, kind, events, rng);
}

/**
 * 中了虛空酋長【恐懼】的話，移動目標會以自己為中心鏡射到反方向 ——
 * 玩家想往上走就會往下走。鏡射後的格子照樣要過邊界與佔用檢查。
 */
function fearedTarget(
  seats: Seats,
  state: DndState,
  playerId: PlayerId,
  pr: number,
  pc: number,
  tr: number,
  tc: number,
): { r: number; c: number; feared: boolean } {
  const seatIndex = seats.indexOf(playerId);
  const fear = seatIndex === -1 ? 0 : (state.seats[seatIndex]?.fearTurns ?? 0);
  if (!fear) return { r: tr, c: tc, feared: false };
  return { r: pr - (tr - pr), c: pc - (tc - pc), feared: true };
}

/**
 * 魔王的指令。一隻怪一輪只能做一件事 —— 移動或攻擊，跟 AI 完全一致
 * （runMonstersTurn 是「打得到就打，打不到才走」），這樣手動指揮不會平白變強。
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
  if (!victim || victim.piece.type !== 'player') return { ok: false, error: 'TARGET_NOT_FOUND' };

  const seat = seatIndexOfPiece(seats, victim.piece);
  if (seat === -1 || !state.seats[seat]?.alive) return { ok: false, error: 'TARGET_NOT_FOUND' };

  const range = mon.piece.range ?? (mon.piece.id === 'boss-3' ? 2 : 1);
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
  seats: Seats,
  state: DndState,
  playerId: PlayerId,
  moveEvents: LogEvent[],
): boolean {
  if (moveEvents.some((event) => event.t === 'dndLevelUp')) return true;
  const seatIndex = seats.indexOf(playerId);
  if (seatIndex === -1) return false;
  const banished = state.seats[seatIndex]?.banishedTurns;
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
  playerId: PlayerId,
  activeSeat: number,
  kind: DndAction['kind'] | undefined,
  events: LogEvent[],
  rng: () => number,
): DndApplyResult {
  const selfSeatIdx = seats.indexOf(playerId);
  const selfInfo = selfSeatIdx === -1 ? undefined : state.seats[selfSeatIdx];
  if (selfInfo) {
    if (kind === 'skill') {
      selfInfo.skillCooldown = 1;
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

    if (seatInfo.isNpc) {
      state.turnSeat = cursor;
      events.push(...runNpcTurn(seats, state, cursor, rng));
      if (settleGameOver()) break;
      continue;
    }

    handOff = cursor; // 找到下一位真人玩家，交出回合
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
 * 一隻怪物打一位冒險者的完整結算：命中骰、難度乘數、盜賊【削弱】、戰士【極限防禦】上限、
 * 戰士【反射】、法師受擊【閃現退避】、死亡處理、虛空酋長的攻擊被動。
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
      mon.piece.attackBonus ?? (mon.piece.id === 'boss-3' ? 5 : isShaman ? 2 : 1);
    const dmgDice = mon.piece.dmgDice ?? (mon.piece.id === 'boss-3' ? 10 : 6);

    const roll = Math.floor(rng() * 20) + 1;
    const isHit = roll + attackBonus >= hitTarget.piece.ac;

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
      // 戰士被動【極限防禦】：這一輪受到的每一次傷害都被壓到上限以內
      if (playerSeat?.damageCapTurns && playerSeat.damageCapTurns > 0) {
        const cap = playerSeat.damageCap ?? 2;
        if (dmg > cap) {
          dmg = cap;
          events.push({
            t: 'dndMessage',
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

      // 戰士被動【反射】：把實際吃到的傷害彈 1/3 回去給攻擊者。
      // 這是常駐的，所以「輪到自己之前」被打幾次就反射幾次。
      if (hitTarget.piece.classId === 'brave') {
        const reflected = Math.round(dmg * WARRIOR_REFLECT_RATIO);
        if (reflected > 0) {
          mon.piece.hp = Math.max(0, mon.piece.hp - reflected);
          events.push({
            t: 'dndMessage',
            message: `🪞 ${hitTarget.piece.name.split(' ')[0]} 的【反射】把 ${reflected} 點傷害彈回 ${mon.piece.name} 身上！`,
          } as any);

          if (mon.piece.hp <= 0) {
            const monCell = state.board[mon.r]?.[mon.c];
            if (monCell && monCell.piece?.id === mon.piece.id) monCell.piece = null;
            events.push({ t: 'dndMessage', message: `💥 ${mon.piece.name} 被自己的攻擊反噬倒下了！` } as any);
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
              events.push({ t: 'dndMessage', message: `✨ ${hitTarget.piece.name.split(' ')[0]} 受擊後發動【閃現退避】，向後移動！` } as any);
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
        const playerCell = state.board[hitTarget.r]?.[hitTarget.c];
        if (playerCell && playerCell.piece?.id === hitTarget.piece.id) {
          playerCell.piece = null;
        }
      } else if (mon.piece.id === 'boss-3' && mon.piece.hp > 0) {
        events.push(...voidChiefPassive(state, hitTarget, rng));
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
      if (piece && piece.type === 'goblin' && !commanded) {
        monsters.push({ piece, r, c });
      }
    }
  }

  monsters.forEach((mon) => {
    // 被網住的怪只是被釘在原地：照樣會攻擊、薩滿照樣會治療與召喚，只是不能移動。
    // 持續傷害與倒數已經在 beginRound 結算過了。
    const netted = isRestrained(mon.piece);

    if (mon.piece.stunnedTurns && mon.piece.stunnedTurns > 0) {
      mon.piece.stunnedTurns--;
      return;
    }

    if (mon.piece.id === 'boss-3') {
      const alivePlayers: { piece: DndPiece; r: number; c: number }[] = [];
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          const p = state.board[r]?.[c]?.piece;
          if (p && p.type === 'player') {
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
            events.push({ t: 'dndMessage', message: `⚡ 虛空酋長瞬移到了 ${victim.piece.name.split(' ')[0]} 身旁準備突襲！` } as any);
          }
        }
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
            events.push({ t: 'dndMessage', message: `🪄 大薩滿揮舞法杖，召喚了一隻哥布林！` } as any);
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
        if (piece && piece.type === 'player') {
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

    const attackRange = mon.piece.range ?? (mon.piece.id === 'boss-3' ? 2 : 1);

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
    // NPC 隊友不算「還有人能操作」——沒有真人活著的話沒有人能送出動作
    if (!seatInfo.isNpc && seats[idx]) aliveHumans++;
  }

  let goblinCount = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    const row = state.board[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      const piece = row[c]?.piece;
      if (piece && piece.type === 'goblin') {
        goblinCount++;
      }
    }
  }

  // 有魔王坐鎮時，隊伍可以全部是 NPC（單人魔王模式）——那一局照樣分得出勝負；
  // 沒有魔王的話，隊伍裡沒有真人就等於沒有人能送出動作。
  const partyPlayable = state.bossSeat !== null ? aliveCount > 0 : aliveHumans > 0;

  if (goblinCount === 0 && partyPlayable) {
    if (state.level < 3) {
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

export function autoActDnd(seats: Seats, state: DndState): DndApplyResult | null {
  const activeSeat = state.turnSeat;

  // 魔王掛機：等同按下「結束回合」，剩下的怪由 AI 打完，房間不會卡在他身上
  if (state.phase === 'boss') {
    return finishBossTurn(seats, state, [], Math.random);
  }

  const playerId = seats[activeSeat];
  if (!playerId) return null;

  let playerPiece: DndPiece | null = null;
  for (let r = 0; r < BOARD_SIZE; r++) {
    const row = state.board[r];
    if (!row) continue;
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = row[c]?.piece;
      if (piece && piece.type === 'player' && piece.playerId === playerId) {
        playerPiece = piece;
        break;
      }
    }
  }

  if (!playerPiece) {
    // 角色不在棋盤上（放逐中）。不能什麼都不做就回 null ——
    // handlers 會重新掛一個 45 秒計時器，房間會停在這個座位上永遠空轉。
    return finishDndTurn(seats, state, playerId, activeSeat, 'rest', [], Math.random);
  }

  return applyDndAction(seats, state, playerId, { kind: 'rest' });
}

export function removePlayerFromDnd(seats: Seats, state: DndState, playerId: PlayerId): void {
  const seatIndex = seats.indexOf(playerId);
  if (seatIndex === -1) return;

  // 魔王中離：怪物退回全自動，如果剛好停在他的回合就替他把這一輪打完
  if (state.bossSeat !== null && seatIndex === state.bossSeat) {
    seats[seatIndex] = null;
    state.bossSeat = null;
    if (state.phase === 'boss') {
      finishBossTurn(seats, state, [], Math.random);
    }
    state.phase = 'party';
    state.monsterMoved.clear();
    state.monsterActed.clear();
    return;
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

  const activePlayers = seats.filter((id): id is PlayerId => id !== null);
  if (activePlayers.length === 0) {
    state.over = true;
    state.won = false;
    return;
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
      return;
    }

    state.turnSeat = handOff;
    state.turnDeadline = Date.now() + TURN_MS;
    state.turnHasMoved = false;
  }
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
  const maxRange = classId === 'tangerine' ? 3 : 1;

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
          t: 'dndMessage',
          message: `✨ ${npcName.split(' ')[0]} 見 ${woundedAlly.name.split(' ')[0]} 傷勢過重，優先施放了治癒術！`,
        } as any);
        return events;
      }
    }
  }

  let targetGoblin: DndPiece | null = null;
  let targetR = -1, targetC = -1;
  let minGdist = 9999;

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = state.board[r]?.[c];
      if (cell && cell.piece && cell.piece.type === 'goblin') {
        const dist = Math.abs(pr - r) + Math.abs(pc - c);
        if (dist <= maxRange && dist < minGdist) {
          minGdist = dist;
          targetGoblin = cell.piece;
          targetR = r;
          targetC = c;
        }
      }
    }
  }

  if (targetGoblin) {
    const stats = CLASS_STATS[classId];
    const roll = Math.floor(rng() * 20) + 1;
    const isHit = roll + stats.attackBonus >= targetGoblin.ac;

    if (isHit) {
      const dmgRoll = Math.floor(rng() * stats.dmgDice) + 1;
      const damage = dmgRoll + stats.dmgFlat;
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
        const targetCell = state.board[targetR]?.[targetC];
        if (targetCell) {
          targetCell.piece = null;
        }
        checkAndSpawnBossOrStaircase(seats, state, events, rng);
      } else {
        events.push(...checkBossFinalPhase(state, rng));
        // 被動是職業能力，NPC 隊友也一樣會觸發
        if (classId === 'brave') {
          events.push(...warriorPassive(seats, state, npcPiece, targetGoblin, targetR, targetC, pr, pc, rng));
        } else if (classId === 'bubble') {
          events.push(...roguePassive(npcPiece, targetGoblin, rng));
        }
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
  } else {
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
          if (piece && piece.type === 'goblin') {
            const dist = Math.abs(pr - r) + Math.abs(pc - c);
            if (dist < minDist) {
              minDist = dist;
              targetMon = { piece, r, c };
            }
          }
        }
      }
    }

    if (targetMon) {
      let bestMove: { r: number; c: number; dir: string } | null = null;
      let bestDist = minDist;

      for (const d of dirs) {
        const nr = pr + d.dr;
        const nc = pc + d.dc;
        const targetCell = state.board[nr]?.[nc];
        // NPC 隊友會走向樓梯但不會踏上去 —— 什麼時候下樓是真人玩家的決定。
        // 例外：隊伍裡沒有真人（單人魔王模式）時得由 NPC 自己下樓，不然會卡在這一層。
        const npcMayDescend = targetIsStairs && !partyHasHuman(seats, state);
        if (targetCell && (targetCell.piece === null
            || (npcMayDescend && targetCell.piece.type === 'staircase'))) {
          const dist = Math.abs(nr - targetMon.r) + Math.abs(nc - targetMon.c);
          if (dist < bestDist) {
            bestDist = dist;
            bestMove = { r: nr, c: nc, dir: d.dir };
          }
        }
      }

      if (backendApplyMove(seats, state, npcPiece, bestMove, targetIsStairs, rng, events)) {
        // moved
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