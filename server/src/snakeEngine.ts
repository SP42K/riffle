import {
  DEFAULT_SNAKE_OPTIONS,
  SNAKE_BULLET_AMMO,
  SNAKE_BULLET_MAX_TRAVEL,
  SNAKE_BULLET_SPEED,
  SNAKE_CORPSE_FOOD_GROWTH,
  SNAKE_CORPSE_FOOD_SCORE,
  SNAKE_DASH_CHARGE_MS,
  SNAKE_DASH_COOLDOWN_MS,
  SNAKE_DASH_STEPS,
  SNAKE_DIRECTIONS,
  SNAKE_FOOD_COUNT,
  SNAKE_FOOD_GROWTH,
  SNAKE_FOOD_SCORE,
  SNAKE_GRID_SIZE,
  SNAKE_ITEM_CONFIG,
  SNAKE_ITEM_COUNT,
  SNAKE_ITEM_DURATION_MS,
  SNAKE_ITEM_KINDS,
  SNAKE_ITEM_SLOTS,
  SNAKE_LIVES,
  SNAKE_MAGNET_DURATION_MS,
  SNAKE_MINE_BONUS_SCORE,
  SNAKE_MINE_GAP_MS,
  SNAKE_MINE_GROWTH,
  SNAKE_MINE_LIVE_MS,
  SNAKE_MINE_TELEGRAPH_MS,
  SNAKE_RESPAWN_MS,
  SNAKE_START_DELAY_MS,
  type PlayerId,
  type SnakeCell,
  type SnakeDirection,
  type SnakeInventorySlot,
  type SnakeItemKind,
  type SnakeOptions,
} from 'shared';
import type { Seats } from './gameEngine.js';
import type { TurnBased } from './turnBased.js';

interface Snake {
  playerId: PlayerId;
  seat: number;
  body: SnakeCell[]; // body[0] 是頭；重生閃爍中只有一格（重生點），徹底出局時為空陣列
  dir: SnakeDirection;
  /** 玩家最近一次按下的方向，下一拍才套用；180° 反向會在套用時被忽略。 */
  pendingDir: SnakeDirection;
  /** 剩餘命數。0 代表徹底出局，不會再重生。unlimitedLives 開著時這個數字不會變動。 */
  lives: number;
  /** 非 null 表示正在重生閃爍中（幽靈狀態，不參與碰撞），這個時間到了才正式復活。 */
  respawnAt: number | null;
  score: number;
  /** 吃到果實還沒長完的節數：一拍只能長 1 節，吃一次多節的果實要分好幾拍慢慢補上尾巴不砍掉。 */
  growthPending: number;
  /** 道具欄，最多 SNAKE_ITEM_SLOTS 格；空白鍵永遠用掉 index 0。 */
  inventory: SnakeInventorySlot[];
  speedUntil: number | null;
  shieldUntil: number | null;
  reversedUntil: number | null;
  magnetUntil: number | null;
  /** 非 null 表示按了 X 正在原地凍結充能，這個時間點到了才會鎖定方向開始衝刺。 */
  dashChargeUntil: number | null;
  /** 衝刺期間鎖定的方向；不在衝刺中時為 null，不受 pendingDir 影響。 */
  dashDir: SnakeDirection | null;
  /** >0 代表這拍是衝刺移動的一步：撞到別人身體會截斷，而不是自己死。 */
  dashStepsRemaining: number;
  /** 下次可以再按 X 的時間戳；null 代表現在就可以按。 */
  dashCooldownUntil: number | null;
}

interface ItemPickup {
  cell: SnakeCell;
  kind: SnakeItemKind;
}

/** 用掉道具但還沒真的生效的那段等待期（SNAKE_ITEM_CONFIG.activationDelayMs 驅動）。 */
interface PendingItemEffect {
  applyAt: number;
  kind: SnakeItemKind;
  actorSeat: number;
}

interface Mine {
  seat: number;
  cell: SnakeCell;
  /** 這個時間之前是預警閃爍，還不會生效（吃不到也害不死人）。 */
  telegraphUntil: number;
  /** 過了這個時間還沒人動它，就自然消失。 */
  expiresAt: number;
}

/** 飛行中的子彈：目前位置、方向，跟已經飛了幾格（超過上限就消失）。 */
interface Bullet {
  shooterSeat: number;
  cell: SnakeCell;
  dir: SnakeDirection;
  traveled: number;
}

export interface SnakeState extends TurnBased {
  /** 貪吃蛇沒有「輪到誰」，這兩個惰性欄位讓它照樣滿足 TurnBased —— 房間層的計時器不必為它分支。 */
  turnSeat: -1;
  turnDeadline: 0;
  over: boolean;
  width: number;
  height: number;
  /** 建房時決定、中途不會變的規則開關（穿牆／無限命／頭對頭模式／截斷／大地圖）。 */
  options: SnakeOptions;
  food: SnakeCell[];
  /** 蛇死亡或被截斷時，身體隔一節掉落的屍體果實；吃到只加 1 分、長 1 節。 */
  corpseFood: SnakeCell[];
  snakes: Map<PlayerId, Snake>;
  /** 場上的道具點；options.items 關著的話恆為空陣列，也不會生成新的。 */
  items: ItemPickup[];
  /** 飛行中的子彈；options.items 關著的話恆為空陣列。 */
  bullets: Bullet[];
  /** 用掉但還在延遲期、還沒真的生效的道具效果。 */
  pendingEffects: PendingItemEffect[];
  mine: Mine | null;
  /** 地雷消失後的空窗截止時間；null 表示現在就可以生成下一顆（沒有正在倒數的空窗）。 */
  mineGapUntil: number | null;
  /** 固定的座位輪值順序，生地雷果實時依序往下找，跳過已經徹底出局的人。 */
  mineRotation: number[];
  mineRotationIndex: number;
  /** 徹底出局的順序，先出局的在前；分數同分時拿來當 tie-break（晚出局排前面）。 */
  deaths: PlayerId[];
  /** 依分數由高到低排；只有 over 時才有值。 */
  ranking: PlayerId[];
  /** 開局倒數的截止時間戳（ms）。在這之前 tick 不會真的推進棋盤，只是讓大家看清楚出生位置。 */
  startAt: number;
  /** unlimitedLives 開著時，這個時間戳到了就強制結束比分數；沒開無限命則恆為 null。 */
  timeLimitAt: number | null;
  /**
   * 真正推進過棋盤的刻度數。偶數刻度＝一般速度的蛇（含子彈飛行、磁鐵吸果實）真正動作的時機；
   * 加速中的蛇不管奇偶都會動，等於兩倍速。見 SNAKE_TICK_MS 的說明。
   */
  tickCount: number;
}

const DELTA: Record<SnakeDirection, SnakeCell> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const OPPOSITE: Record<SnakeDirection, SnakeDirection> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
};

/**
 * 六個出生點，四個角落 + 上下邊各一個，往盤面內側延伸三節，彼此離得夠遠不會一開局就撞在一起。
 * 只有 2~4 人時只用得到前四個角落，跟原本的行為一樣。
 */
function spawnFor(seat: number, width: number, height: number): { head: SnakeCell; dir: SnakeDirection } {
  const configs: Array<{ head: SnakeCell; dir: SnakeDirection }> = [
    { head: { x: 2, y: 2 }, dir: 'right' },
    { head: { x: width - 3, y: 2 }, dir: 'left' },
    { head: { x: 2, y: height - 3 }, dir: 'right' },
    { head: { x: width - 3, y: height - 3 }, dir: 'left' },
    { head: { x: Math.floor(width / 2), y: 2 }, dir: 'down' },
    { head: { x: Math.floor(width / 2), y: height - 3 }, dir: 'up' },
  ];
  return configs[seat % configs.length]!;
}

function bodyFrom(head: SnakeCell, dir: SnakeDirection, length: number): SnakeCell[] {
  // 蛇身往「前進方向」的反方向延伸，出生時不會咬到自己
  const back = OPPOSITE[dir];
  const step = DELTA[back];
  const body: SnakeCell[] = [];
  for (let i = 0; i < length; i++) {
    body.push({ x: head.x + step.x * i, y: head.y + step.y * i });
  }
  return body;
}

function cellKey(cell: SnakeCell): string {
  return `${cell.x},${cell.y}`;
}

function inBounds(cell: SnakeCell, width: number, height: number): boolean {
  return cell.x >= 0 && cell.x < width && cell.y >= 0 && cell.y < height;
}

/** 穿牆模式下把座標繞回棋盤內；一般模式原樣傳回，是否出界交給 inBounds 判斷。 */
function wrapIfNeeded(cell: SnakeCell, state: SnakeState): SnakeCell {
  if (!state.options.wraparound) return cell;
  const wrap = (v: number, max: number) => ((v % max) + max) % max;
  return { x: wrap(cell.x, state.width), y: wrap(cell.y, state.height) };
}

/** 場上所有蛇身（含重生閃爍中的那一格）＋現有果實＋地雷＋道具點佔用的格子。找空格用的共用底料。 */
function occupiedByBoard(state: SnakeState, opts: { includeMine?: boolean } = {}): Set<string> {
  const occupied = new Set<string>();
  for (const snake of state.snakes.values()) {
    if (snake.lives <= 0) continue;
    for (const cell of snake.body) occupied.add(cellKey(cell));
  }
  for (const cell of state.food) occupied.add(cellKey(cell));
  for (const cell of state.corpseFood) occupied.add(cellKey(cell));
  for (const item of state.items) occupied.add(cellKey(item.cell));
  if (opts.includeMine !== false && state.mine) occupied.add(cellKey(state.mine.cell));
  return occupied;
}

/** 隨機挑一種道具、隨機找一個空格。棋盤夠大，找不到就放棄這次補位。 */
function spawnItem(state: SnakeState, rng: () => number): ItemPickup | null {
  const occupied = occupiedByBoard(state);
  for (let attempt = 0; attempt < 200; attempt++) {
    const cell = { x: Math.floor(rng() * state.width), y: Math.floor(rng() * state.height) };
    if (occupied.has(cellKey(cell))) continue;
    const kind = SNAKE_ITEM_KINDS[Math.floor(rng() * SNAKE_ITEM_KINDS.length)]!;
    return { cell, kind };
  }
  return null;
}

/** 隨機找一個沒有蛇身、也沒有果實/地雷的格子。棋盤夠大，找不到就放棄這次補位。 */
function spawnFood(state: SnakeState, rng: () => number): SnakeCell | null {
  const occupied = occupiedByBoard(state);
  for (let attempt = 0; attempt < 200; attempt++) {
    const cell = { x: Math.floor(rng() * state.width), y: Math.floor(rng() * state.height) };
    if (!occupied.has(cellKey(cell))) return cell;
  }
  return null;
}

/** 重生用：找一個安全空格，順便挑一個往前走不會馬上撞牆的方向（穿牆模式下任何方向都安全）。 */
function findSafeRespawn(
  state: SnakeState,
  rng: () => number,
): { cell: SnakeCell; dir: SnakeDirection } | null {
  const occupied = occupiedByBoard(state);
  for (let attempt = 0; attempt < 200; attempt++) {
    const cell = { x: Math.floor(rng() * state.width), y: Math.floor(rng() * state.height) };
    if (occupied.has(cellKey(cell))) continue;
    // 重生一落地就是完整 3 節（bodyFrom 往 dir 反方向延伸），所以要驗證整條身體，不能只看單一方向；
    // 同時也要驗證頭再往 dir 方向多走一步不會出界，不然閃爍一結束、下一拍馬上自己撞牆而死
    const safeDirs = state.options.wraparound
      ? SNAKE_DIRECTIONS
      : SNAKE_DIRECTIONS.filter((d) => {
          const body = bodyFrom(cell, d, 3);
          if (!body.every((c) => inBounds(c, state.width, state.height))) return false;
          const forward = { x: cell.x + DELTA[d].x, y: cell.y + DELTA[d].y };
          return inBounds(forward, state.width, state.height);
        });
    if (safeDirs.length === 0) continue;
    const dir = safeDirs[Math.floor(rng() * safeDirs.length)]!;
    return { cell, dir };
  }
  return null;
}

/** 下一顆地雷果實要輪到哪個座位：依固定輪值順序往後找，跳過已經徹底出局的人。 */
function nextMineSeat(state: SnakeState): number | null {
  const rotation = state.mineRotation;
  for (let i = 0; i < rotation.length; i++) {
    const idx = (state.mineRotationIndex + i) % rotation.length;
    const seat = rotation[idx]!;
    const snake = [...state.snakes.values()].find((s) => s.seat === seat);
    if (snake && snake.lives > 0) {
      state.mineRotationIndex = (idx + 1) % rotation.length;
      return seat;
    }
  }
  return null;
}

function spawnMine(state: SnakeState, rng: () => number): Mine | null {
  const seat = nextMineSeat(state);
  if (seat === null) return null;

  const occupied = occupiedByBoard(state, { includeMine: false });
  for (let attempt = 0; attempt < 200; attempt++) {
    const cell = { x: Math.floor(rng() * state.width), y: Math.floor(rng() * state.height) };
    if (occupied.has(cellKey(cell))) continue;
    const now = Date.now();
    return {
      seat,
      cell,
      telegraphUntil: now + SNAKE_MINE_TELEGRAPH_MS,
      expiresAt: now + SNAKE_MINE_TELEGRAPH_MS + SNAKE_MINE_LIVE_MS,
    };
  }
  return null;
}

export function initSnake(
  seats: Seats,
  rng: () => number = Math.random,
  width: number = SNAKE_GRID_SIZE,
  height: number = SNAKE_GRID_SIZE,
  options: SnakeOptions = DEFAULT_SNAKE_OPTIONS,
): SnakeState {
  const snakes = new Map<PlayerId, Snake>();
  for (const [seat, playerId] of seats.entries()) {
    if (!playerId) continue;
    const { head, dir } = spawnFor(seat, width, height);
    snakes.set(playerId, {
      playerId,
      seat,
      body: bodyFrom(head, dir, 3),
      dir,
      pendingDir: dir,
      lives: SNAKE_LIVES,
      respawnAt: null,
      score: 0,
      growthPending: 0,
      inventory: [],
      speedUntil: null,
      shieldUntil: null,
      reversedUntil: null,
      magnetUntil: null,
      dashChargeUntil: null,
      dashDir: null,
      dashStepsRemaining: 0,
      dashCooldownUntil: null,
    });
  }

  const startAt = Date.now() + SNAKE_START_DELAY_MS;
  const state: SnakeState = {
    turnSeat: -1,
    turnDeadline: 0,
    over: false,
    width,
    height,
    options,
    food: [],
    corpseFood: [],
    snakes,
    items: [],
    bullets: [],
    pendingEffects: [],
    mine: null,
    mineGapUntil: null,
    mineRotation: [...snakes.values()].map((s) => s.seat).sort((a, b) => a - b),
    mineRotationIndex: 0,
    deaths: [],
    ranking: [],
    startAt,
    timeLimitAt: options.unlimitedLives ? startAt + options.unlimitedLivesTimeLimitSec * 1_000 : null,
    tickCount: 0,
  };

  for (let i = 0; i < SNAKE_FOOD_COUNT; i++) {
    const cell = spawnFood(state, rng);
    if (cell) state.food.push(cell);
  }
  if (options.items) {
    for (let i = 0; i < SNAKE_ITEM_COUNT; i++) {
      const item = spawnItem(state, rng);
      if (item) state.items.push(item);
    }
  }

  return state;
}

/**
 * 玩家按方向鍵：只更新輸入緩衝，實際套用與碰撞判定都在 tick 才發生。
 * 被「反轉」道具影響時，這裡就把方向反過來存，之後的 180 度反向判斷不必再管反轉這件事。
 */
export function setSnakeDirection(state: SnakeState, playerId: PlayerId, dir: SnakeDirection): void {
  if (!SNAKE_DIRECTIONS.includes(dir)) return;
  const snake = state.snakes.get(playerId);
  if (!snake || snake.lives <= 0 || snake.respawnAt !== null) return;
  const reversed = snake.reversedUntil !== null && snake.reversedUntil > Date.now();
  snake.pendingDir = reversed ? OPPOSITE[dir] : dir;
}

/** 真正套用一個道具效果——不管是立即生效還是延遲期滿之後才生效，都走這裡。 */
function applyItemEffect(
  state: SnakeState,
  actor: Snake,
  kind: SnakeItemKind,
  rng: () => number,
  events: SnakeEvent[],
): void {
  const now = Date.now();
  switch (kind) {
    case 'speed':
      actor.speedUntil = now + SNAKE_ITEM_DURATION_MS;
      break;
    case 'shield':
      actor.shieldUntil = now + SNAKE_ITEM_DURATION_MS;
      break;
    case 'magnet':
      actor.magnetUntil = now + SNAKE_MAGNET_DURATION_MS;
      break;
    case 'reverse':
      for (const other of state.snakes.values()) {
        if (other !== actor && other.lives > 0) other.reversedUntil = now + SNAKE_ITEM_DURATION_MS;
      }
      break;
    case 'bullet':
      fireBullet(state, actor);
      break;
  }
}

/**
 * 用掉道具欄第一格（空白鍵觸發）。子彈是唯一會「用了還留著」的道具——扣一發，
 * 發數歸零才真的從欄位移除；其他道具一用就整格清空。
 * SNAKE_ITEM_CONFIG 裡 activationDelayMs > 0 的道具不會立刻生效，
 * 而是排進 pendingEffects，等 tick 跑到那個時間點才真的套用——給其他人一點反應時間。
 */
export function useSnakeItem(state: SnakeState, playerId: PlayerId, rng: () => number): SnakeEvent[] {
  const events: SnakeEvent[] = [];
  const snake = state.snakes.get(playerId);
  if (!snake || snake.lives <= 0 || snake.respawnAt !== null) return events;
  const slot = snake.inventory[0];
  if (!slot) return events;

  // 延遲道具只在「用掉的當下」公告一次（給大家反應時間）；生效那一刻不會再公告一次。
  // 立即道具反過來：用掉跟生效是同一瞬間，公告就代表生效了。
  const config = SNAKE_ITEM_CONFIG[slot.kind];
  if (config.activationDelayMs > 0) {
    state.pendingEffects.push({
      applyAt: Date.now() + config.activationDelayMs,
      kind: slot.kind,
      actorSeat: snake.seat,
    });
  } else {
    applyItemEffect(state, snake, slot.kind, rng, events);
  }
  if (config.announce) events.push({ t: 'item', player: playerId, item: slot.kind });

  if (slot.kind === 'bullet' && slot.ammo && slot.ammo > 1) {
    slot.ammo -= 1;
  } else {
    snake.inventory.shift();
  }
  return events;
}

/**
 * 開槍：從頭部往目前朝向生成一顆看得見的飛行子彈，實際移動與命中判定留給 tick 的
 * 「子彈飛行」步驟逐拍處理（子彈飛得比蛇快，一拍要走 SNAKE_BULLET_SPEED 格，
 * 沒辦法在生成當下就瞬間解算完，得跟其他移動一樣按拍推進）。
 */
function fireBullet(state: SnakeState, shooter: Snake): void {
  state.bullets.push({ shooterSeat: shooter.seat, cell: { ...shooter.body[0]! }, dir: shooter.dir, traveled: 0 });
}

/**
 * 一拍內把所有飛行中的子彈往前推進 SNAKE_BULLET_SPEED 格（比蛇的一般速度快兩倍），
 * 逐格檢查：飛出邊界就消失（不論有沒有開穿牆模式，子彈不會繞到對面繼續飛）；
 * 打到任何一節身體（不限頭部）就跟衝刺一樣用 severBody 從那一節整段截斷，
 * 護盾擋下的話子彈直接消失、不生效；沒打中人就繼續飛，
 * 累積飛行距離超過上限也會消失（保險用，正常情況下出界就已經先結束了）。
 */
function advanceBullets(state: SnakeState, rng: () => number, events: SnakeEvent[]): void {
  if (state.bullets.length === 0) return;
  const now = Date.now();
  const survivors: Bullet[] = [];
  for (const bullet of state.bullets) {
    let cell = bullet.cell;
    let stopped = false;
    for (let step = 0; step < SNAKE_BULLET_SPEED && !stopped; step++) {
      const next = { x: cell.x + DELTA[bullet.dir].x, y: cell.y + DELTA[bullet.dir].y };
      bullet.traveled += 1;
      // 子彈不論有沒有開穿牆模式，飛出邊界就直接消失——不繞到對面繼續飛
      if (!inBounds(next, state.width, state.height)) {
        stopped = true;
        break;
      }
      cell = next;
      for (const target of state.snakes.values()) {
        if (target.seat === bullet.shooterSeat || target.lives <= 0 || target.respawnAt !== null) continue;
        const index = target.body.findIndex((c) => cellKey(c) === cellKey(cell));
        if (index === -1) continue;
        stopped = true;
        const shielded = target.shieldUntil !== null && target.shieldUntil > now;
        if (!shielded) {
          const shooter = [...state.snakes.values()].find((s) => s.seat === bullet.shooterSeat);
          severBody(state, target, index);
          if (shooter) events.push({ t: 'cut', attacker: shooter.playerId, victim: target.playerId });
          if (target.body.length === 0) killSnake(state, target, rng, events);
        }
        break;
      }
    }
    bullet.cell = cell;
    if (!stopped && bullet.traveled < SNAKE_BULLET_MAX_TRAVEL) survivors.push(bullet);
  }
  state.bullets = survivors;
}

/**
 * 按 X：觸發衝刺截斷技能。房間沒開 cutting 選項、還在冷卻、或已經在充能/衝刺中都不會有反應。
 * 只把狀態設成「開始充能」，真正鎖定方向、開始位移是 tick 到了 dashChargeUntil 才做的事。
 */
export function useSnakeDash(state: SnakeState, playerId: PlayerId): SnakeEvent[] {
  const events: SnakeEvent[] = [];
  if (!state.options.cutting) return events;
  const snake = state.snakes.get(playerId);
  if (!snake || snake.lives <= 0 || snake.respawnAt !== null) return events;
  if (snake.dashChargeUntil !== null || snake.dashStepsRemaining > 0) return events;
  const now = Date.now();
  if (snake.dashCooldownUntil !== null && snake.dashCooldownUntil > now) return events;

  snake.dashChargeUntil = now + SNAKE_DASH_CHARGE_MS;
  snake.dashCooldownUntil = now + SNAKE_DASH_COOLDOWN_MS;
  events.push({ t: 'dash', player: playerId });
  return events;
}

/** 這一拍還會不會被判定碰撞（活著、不在重生閃爍中）——包含正在充能凍結的蛇，凍結的身體照樣擋人。 */
function movingEligible(state: SnakeState): Snake[] {
  return [...state.snakes.values()].filter((s) => s.lives > 0 && s.respawnAt === null);
}

/**
 * 這一拍真的會嘗試移動的蛇：movingEligible 再扣掉正在充能凍結（原地不動）的，
 * 剩下的要嘛是「加速中」或「衝刺位移中」（兩者都是不管奇偶刻度都動，等於兩倍速），
 * 要嘛只在一般刻度（normalTick）才動——衝刺本身固定用這個兩倍速衝出去，不管有沒有
 * 另外吃到加速道具都一樣快，兩者同時生效也不會疊加得更快。
 */
function activeMovers(state: SnakeState, eligible: Snake[], normalTick: boolean): Snake[] {
  const now = Date.now();
  return eligible.filter((s) => {
    if (s.dashChargeUntil !== null) return false;
    const dashing = s.dashStepsRemaining > 0;
    const speedBoosted = s.speedUntil !== null && s.speedUntil > now;
    return dashing || speedBoosted || normalTick;
  });
}

/**
 * 排名用的最終分數＝永久分數（吃果實/地雷果實累積，score 欄位）＋目前身體長度。
 * 已經徹底出局的蛇 body 是空陣列，所以這個公式對她們來說跟純看 score 完全一樣；
 * 差別只在「還活著」的蛇——身體越長，代表吃得越多、撐得越久，結算時要算進去。
 */
function finalScoreOf(snake: Snake): number {
  return snake.score + snake.body.length;
}

/** 結算排名並標記結束。最終分數高的排前面，同分先比永久分數，再同分晚出局的排前面。 */
function rankAndFinish(state: SnakeState): void {
  state.over = true;
  const deathRank = (id: PlayerId) => {
    const index = state.deaths.indexOf(id);
    return index === -1 ? Number.POSITIVE_INFINITY : index;
  };
  state.ranking = [...state.snakes.keys()].sort((a, b) => {
    const snakeA = state.snakes.get(a)!;
    const snakeB = state.snakes.get(b)!;
    const finalDiff = finalScoreOf(snakeB) - finalScoreOf(snakeA);
    if (finalDiff !== 0) return finalDiff;
    const scoreDiff = snakeB.score - snakeA.score;
    if (scoreDiff !== 0) return scoreDiff;
    return deathRank(b) - deathRank(a);
  });
}

/**
 * 只要還有人有命在（含正在重生閃爍中），就不能結束——最後一人也要玩到他自己死為止；
 * 但如果只剩他一人、而且永久分數已經追不上（等於或超過所有已出局玩家），勝負已經確定，
 * 就不用再讓他一個人耗下去，直接收尾。這裡刻意只比永久分數、不算存活者目前的身體長度——
 * 身體長度是活人才有的暫時狀態，還會變（甚至歸零），拿來當「提前收尾」的判斷依據不夠穩；
 * 真正收尾時 rankAndFinish 才會把身體長度算進最終名次。
 * unlimitedLives 開著時沒有人會出局，這個函式恆為 false，這種玩法改用 state.timeLimitAt
 * （見 tickSnake）強制結束，不靠這裡的出局判斷。
 */
function finishIfDone(state: SnakeState): boolean {
  const remaining = [...state.snakes.values()].filter((s) => s.lives > 0);
  const eliminated = [...state.snakes.values()].filter((s) => s.lives <= 0);

  let done = remaining.length === 0;
  if (!done && remaining.length === 1 && eliminated.length > 0) {
    const survivor = remaining[0]!;
    const maxEliminatedScore = Math.max(...eliminated.map((s) => s.score));
    done = survivor.score >= maxEliminatedScore;
  }
  if (!done) return false;
  rankAndFinish(state);
  return true;
}

export type SnakeEvent =
  | { t: 'respawn'; player: PlayerId }
  | { t: 'death'; player: PlayerId }
  | { t: 'mine'; player: PlayerId }
  | { t: 'food'; player: PlayerId }
  | { t: 'cut'; attacker: PlayerId; victim: PlayerId }
  | { t: 'item'; player: PlayerId; item: SnakeItemKind }
  /** 按下 X 開始充能（衝刺截斷技能的預警）。 */
  | { t: 'dash'; player: PlayerId }
  | { t: 'over'; ranking: PlayerId[] };

/**
 * 死掉不管是徹底出局還是重生，身上的道具效果、道具欄、衝刺狀態都重新歸零——
 * 不會帶著加速/護盾/子彈/衝刺充能或冷卻復活。
 */
function clearItemState(snake: Snake): void {
  snake.growthPending = 0;
  snake.inventory = [];
  snake.speedUntil = null;
  snake.shieldUntil = null;
  snake.reversedUntil = null;
  snake.magnetUntil = null;
  snake.dashChargeUntil = null;
  snake.dashDir = null;
  snake.dashStepsRemaining = 0;
  snake.dashCooldownUntil = null;
}

/**
 * 蛇身隔一節（index 0、2、4...）掉落變成屍體果實（吃到只加 1 分長 1 節），其餘直接消失——
 * 死亡與截斷共用同一條「隔一節」規則，只是觸發時機不同（死亡：整條身體；截斷：被截掉的那一段）。
 */
function dropAlternatingAsFood(state: SnakeState, cells: readonly SnakeCell[]): void {
  cells.forEach((cell, i) => {
    if (i % 2 === 0) state.corpseFood.push({ ...cell });
  });
}

/** 死掉一次：命用完（或沒開無限命）就徹底出局，否則進入重生倒數。 */
function killSnake(state: SnakeState, snake: Snake, rng: () => number, events: SnakeEvent[]): void {
  // 不管接下來是重生還是徹底出局，死掉那一刻的身體都留下一半變果實——
  // 如果這條蛇是被截斷到 0 節才觸發死亡，這裡的 body 已經是空陣列，等於沒事發生，不會重複掉落
  dropAlternatingAsFood(state, snake.body);
  clearItemState(snake);
  const willRespawn = state.options.unlimitedLives || snake.lives > 1;
  if (!willRespawn) {
    snake.lives = 0;
    snake.body = [];
    snake.respawnAt = null;
    state.deaths.push(snake.playerId);
    events.push({ t: 'death', player: snake.playerId });
    return;
  }
  if (!state.options.unlimitedLives) snake.lives -= 1;

  const spot = findSafeRespawn(state, rng);
  if (!spot) {
    // 找不到安全格的極端情況（棋盤被塞滿）：沒辦法重生，當作命也用完了
    snake.lives = 0;
    snake.body = [];
    snake.respawnAt = null;
    state.deaths.push(snake.playerId);
    events.push({ t: 'death', player: snake.playerId });
    return;
  }

  // 閃爍期間就顯示完整 3 節，玩家才看得出頭在哪、準備往哪走 —— 幽靈狀態靠 respawnAt 標記，不靠身體長度
  snake.body = bodyFrom(spot.cell, spot.dir, 3);
  snake.dir = spot.dir;
  snake.pendingDir = spot.dir;
  snake.respawnAt = Date.now() + SNAKE_RESPAWN_MS;
  events.push({ t: 'respawn', player: snake.playerId });
}

/**
 * 把某條蛇從 index 開始的身體整段截斷：截下來的段落裡，隔一節（第 1、3、5...節）變成
 * 可以吃的果實，其餘直接消失。截斷到只剩 0 節的話，由呼叫端負責讓那條蛇也走一次死亡流程。
 */
function severBody(state: SnakeState, victim: Snake, index: number): void {
  const removed = victim.body.slice(index);
  victim.body = victim.body.slice(0, index);
  dropAlternatingAsFood(state, removed);
}

/**
 * 一拍（一個刻度，SNAKE_TICK_MS 間隔）。除了原本的移動與碰撞，這一版還要處理 SnakeOptions
 * 帶來的分支：
 * 0. 重生倒數到了的蛇正式復活（幽靈狀態結束）；衝刺充能到了的蛇鎖定方向開始位移
 * 1. 地雷果實的生命週期（過期消失／被埋在蛇身下就算消失／空窗結束補下一顆）
 * 2. 頭對頭：bounce 彈開不動；clash 兩邊都算死亡（走 killSnake）
 * 3. 撞到別人身體：只有正在衝刺的那 SNAKE_DASH_STEPS 拍才會截斷對方（隔一節變果實），其餘情況一律算自己死
 * 4. 撞牆：wraparound 開著就從對面繞出來，不會死；關著才跟原本一樣算死亡
 * 5. unlimitedLives 開著時，state.timeLimitAt 時間到了就強制結束、依最終分數排名
 * 6. 加速：不是一次跳兩格，而是靠奇偶刻度讓加速中的蛇兩倍頻率地真正移動一格，
 *    子彈飛行／磁鐵吸果實則反過來只在一般刻度動，維持原本的實際速度不被刻度變密影響
 */
export function tickSnake(state: SnakeState, rng: () => number = Math.random): SnakeEvent[] {
  const events: SnakeEvent[] = [];
  if (state.over) return events;
  const now = Date.now();
  if (now < state.startAt) return events; // 開局倒數還沒結束，棋盤原地不動、也不生地雷

  if (state.timeLimitAt !== null && now >= state.timeLimitAt) {
    rankAndFinish(state);
    events.push({ t: 'over', ranking: state.ranking.slice() });
    return events;
  }

  // 偶數刻度＝一般速度的動作（一般蛇的移動、子彈飛行、磁鐵吸果實）真正發生的時機，維持減半 SNAKE_TICK_MS
  // 之前的實際速度；加速中的蛇兩種刻度都會動，見 activeMovers。
  const normalTick = state.tickCount % 2 === 0;
  state.tickCount += 1;

  // 0. 重生倒數結束的蛇，正式復活 —— 身體在死掉當下就已經是完整 3 節了，這裡只要解除幽靈狀態
  for (const snake of state.snakes.values()) {
    if (snake.respawnAt !== null && now >= snake.respawnAt) {
      snake.respawnAt = null;
    }
  }

  // 0.3 衝刺充能結束：鎖定目前朝向、開始接下來 SNAKE_DASH_STEPS 拍的位移
  for (const snake of state.snakes.values()) {
    if (snake.dashChargeUntil !== null && now >= snake.dashChargeUntil) {
      snake.dashChargeUntil = null;
      snake.dashDir = snake.dir;
      snake.dashStepsRemaining = SNAKE_DASH_STEPS;
    }
  }

  // 0.5 用掉但還在延遲期的道具，時間到了才真的生效（例如反轉：先警告，晚一點半才反過來）
  if (state.pendingEffects.length > 0) {
    const ready = state.pendingEffects.filter((p) => now >= p.applyAt);
    if (ready.length > 0) {
      state.pendingEffects = state.pendingEffects.filter((p) => now < p.applyAt);
      for (const p of ready) {
        const actor = [...state.snakes.values()].find((s) => s.seat === p.actorSeat);
        if (actor && actor.lives > 0) applyItemEffect(state, actor, p.kind, rng, events);
      }
    }
  }

  // 0.6 飛行中的子彈往前推進，逐格判定撞牆／截斷／護盾擋下——只在一般刻度動，維持原本的實際飛行速度，
  // 不會因為刻度變密而跟著變快
  if (normalTick) advanceBullets(state, rng, events);

  // 0.7 磁鐵生效中：場上果實每拍往吸引者的頭靠近一格（避免疊到蛇身，撞到就不吸這顆）——
  // 一樣只在一般刻度動，維持原本的吸引速度
  if (normalTick) {
    for (const snake of state.snakes.values()) {
      if (snake.lives <= 0 || snake.respawnAt !== null) continue;
      if (snake.magnetUntil === null || snake.magnetUntil <= now) continue;
      const head = snake.body[0]!;
      const bodyCells = occupiedByBoard(state, { includeMine: false });
      state.food = state.food.map((food) => {
        const dx = Math.sign(head.x - food.x);
        const dy = Math.sign(head.y - food.y);
        if (dx === 0 && dy === 0) return food;
        const next = { x: food.x + dx, y: food.y + dy };
        return bodyCells.has(cellKey(next)) ? food : next;
      });
    }
  }

  // 1. 地雷果實生命週期：被蛇身蓋住、或是活過了生效期沒人動它，都算消失，進入空窗
  if (state.mine) {
    const buried = [...state.snakes.values()].some(
      (s) => s.lives > 0 && s.body.some((c) => cellKey(c) === cellKey(state.mine!.cell)),
    );
    if (buried || now >= state.mine.expiresAt) {
      state.mine = null;
      state.mineGapUntil = now + SNAKE_MINE_GAP_MS;
    }
  }
  if (!state.mine && (state.mineGapUntil === null || now >= state.mineGapUntil)) {
    const spawned = spawnMine(state, rng);
    if (spawned) {
      state.mine = spawned;
      state.mineGapUntil = null;
    }
  }
  // 地雷還在預警閃爍中的話，這拍不生效——誰都吃不到，也害不死人
  const liveMine = state.mine && now >= state.mine.telegraphUntil ? state.mine : null;

  const living = movingEligible(state);
  if (living.length === 0) {
    if (finishIfDone(state)) events.push({ t: 'over', ranking: state.ranking.slice() });
    return events;
  }
  // 充能凍結中的蛇不會嘗試移動，但身體還在 living 裡佔著位置，照樣會擋到別人；
  // 一般速度的蛇這拍如果輪不到牠（不是一般刻度）也不會嘗試移動，理由同上
  const movers = activeMovers(state, living, normalTick);
  if (movers.length === 0) return events; // 這拍沒有任何蛇真的要動，沒有位移可以判定

  // 每個真的會動的蛇這拍都只走一格——加速的「快」現在是靠 activeMovers 讓它奇偶刻度都能動來實現，
  // 不是一次跳兩格，所以這裡不必再分 1 格/2 格兩種算法，也不會再有跳過中間格不判定的問題
  const candidateDir = new Map<Snake, SnakeDirection>();
  const candidateHead = new Map<Snake, SnakeCell>();
  for (const snake of movers) {
    const dashing = snake.dashStepsRemaining > 0;
    // 衝刺中鎖定按下 X 那刻的方向，不理會之後的方向鍵輸入
    const dir = dashing
      ? snake.dashDir!
      : snake.pendingDir === OPPOSITE[snake.dir]
        ? snake.dir
        : snake.pendingDir;
    candidateDir.set(snake, dir);
    const delta = DELTA[dir];
    const head = snake.body[0]!;
    candidateHead.set(snake, wrapIfNeeded({ x: head.x + delta.x, y: head.y + delta.y }, state));
  }

  // 頭對頭偵測（同格 或 交換位置），跟碰撞模式無關，兩種偵測方式都一樣——充能凍結中的蛇沒有候選頭，不會參與
  const headOnHead = new Set<Snake>();
  const headCount = new Map<string, number>();
  for (const head of candidateHead.values()) {
    const key = cellKey(head);
    headCount.set(key, (headCount.get(key) ?? 0) + 1);
  }
  for (const snake of movers) {
    if ((headCount.get(cellKey(candidateHead.get(snake)!)) ?? 0) >= 2) headOnHead.add(snake);
  }
  for (let i = 0; i < movers.length; i++) {
    for (let j = i + 1; j < movers.length; j++) {
      const a = movers[i]!;
      const b = movers[j]!;
      const aTargetsB = cellKey(candidateHead.get(a)!) === cellKey(b.body[0]!);
      const bTargetsA = cellKey(candidateHead.get(b)!) === cellKey(a.body[0]!);
      if (aTargetsB && bTargetsA) {
        headOnHead.add(a);
        headOnHead.add(b);
      }
    }
  }

  const dead = new Set<Snake>();
  let stalled: Set<Snake>;
  if (state.options.headOnCollision === 'clash') {
    stalled = new Set();
    for (const snake of headOnHead) dead.add(snake);
  } else {
    stalled = headOnHead;
  }

  const moving = movers.filter((s) => !stalled.has(s) && !dead.has(s));

  // 這一拍會不會長長：吃到一般果實、吃到屍體果實、吃到自己顏色的地雷果實、或還在消化之前吃下的成長佇列，都算
  // —— 尾巴要不要讓開看這個（漏算 growthPending 的話，還在慢慢長身體的蛇會被誤判成尾巴已經讓開）
  const foodKeys = new Set(state.food.map(cellKey));
  const corseFoodKeys = new Set(state.corpseFood.map(cellKey));
  const ownMineHit = (snake: Snake, head: SnakeCell): boolean =>
    liveMine !== null && liveMine.seat === snake.seat && cellKey(head) === cellKey(liveMine.cell);
  const willGrow = new Map<Snake, boolean>();
  for (const snake of moving) {
    const head = candidateHead.get(snake)!;
    willGrow.set(snake, foodKeys.has(cellKey(head)) || corseFoodKeys.has(cellKey(head)) || ownMineHit(snake, head) || snake.growthPending > 0);
  }

  // 每一格目前屬於哪條蛇的第幾節；會移動又沒長長的蛇，尾巴那格算讓出來（撞牆/彈開的蛇不算，原地不動）
  const cellOwner = new Map<string, { snake: Snake; index: number }>();
  for (const snake of living) {
    const skipTailIndex = moving.includes(snake) && !willGrow.get(snake) ? snake.body.length - 1 : -1;
    snake.body.forEach((cell, index) => {
      if (index !== skipTailIndex) cellOwner.set(cellKey(cell), { snake, index });
    });
  }

  const cuts: Array<{ attacker: Snake; victim: Snake; index: number }> = [];
  for (const snake of moving) {
    const head = candidateHead.get(snake)!;
    if (!state.options.wraparound && !inBounds(head, state.width, state.height)) {
      dead.add(snake);
      continue;
    }
    if (liveMine && cellKey(head) === cellKey(liveMine.cell) && liveMine.seat !== snake.seat) {
      dead.add(snake); // 踩到別人顏色、已經生效的地雷果實 —— 跟撞牆撞身體一樣算死亡
      continue;
    }
    const owner = cellOwner.get(cellKey(head));
    if (!owner) continue; // 沒撞到任何身體，安全
    const victimShielded = owner.snake.shieldUntil !== null && owner.snake.shieldUntil > now;
    const dashing = snake.dashStepsRemaining > 0;
    if (owner.snake === snake) {
      dead.add(snake); // 咬到自己，衝刺截斷不適用於自己
    } else if (dashing && !victimShielded) {
      cuts.push({ attacker: snake, victim: owner.snake, index: owner.index });
    } else {
      dead.add(snake); // 撞到別人身體：沒在衝刺、或對方正好有護盾擋著，一律算自己死
    }
  }

  // 先把所有截斷結算掉：攻擊者沒事，被截的蛇身體變短，截光了就跟著記進死亡名單
  for (const cut of cuts) {
    severBody(state, cut.victim, cut.index);
    events.push({ t: 'cut', attacker: cut.attacker.playerId, victim: cut.victim.playerId });
    if (cut.victim.body.length === 0) dead.add(cut.victim);
  }

  // 套用移動：彈開的蛇原地不動、方向不變；存活且沒撞到的蛇（含截斷別人的攻擊者）才真的往前
  for (const snake of moving) {
    if (dead.has(snake)) continue;
    snake.dir = candidateDir.get(snake)!;
    const head = candidateHead.get(snake)!;
    snake.body.unshift(head);

    // 吃到的果實不是一拍長完：這拍先靠 unshift+不砍尾巴長 1 節，剩下的節數塞進 growthPending，
    // 之後每拍沒吃到新東西就先消化這個佇列（繼續不砍尾巴），佇列空了才恢復正常砍尾巴
    if (liveMine && ownMineHit(snake, head)) {
      snake.score += SNAKE_MINE_BONUS_SCORE;
      snake.growthPending += SNAKE_MINE_GROWTH - 1;
      events.push({ t: 'mine', player: snake.playerId });
      state.mine = null;
      state.mineGapUntil = now + SNAKE_MINE_GAP_MS;
    } else if (state.food.some((f) => cellKey(f) === cellKey(head))) {
      snake.score += SNAKE_FOOD_SCORE;
      snake.growthPending += SNAKE_FOOD_GROWTH - 1;
      state.food = state.food.filter((f) => cellKey(f) !== cellKey(head));
      const replacement = spawnFood(state, rng);
      if (replacement) state.food.push(replacement);
      events.push({ t: 'food', player: snake.playerId });
    } else if (state.corpseFood.some((f) => cellKey(f) === cellKey(head))) {
      // 屍體果實：只加 1 分、長 1 節（growthPending 加 0，靠 unshift 本身長那 1 節就夠了）
      snake.score += SNAKE_CORPSE_FOOD_SCORE;
      snake.growthPending += SNAKE_CORPSE_FOOD_GROWTH - 1;
      state.corpseFood = state.corpseFood.filter((f) => cellKey(f) !== cellKey(head));
      events.push({ t: 'food', player: snake.playerId });
    } else if (snake.growthPending > 0) {
      snake.growthPending -= 1;
    } else {
      snake.body.pop();
    }

    // 撿到道具：道具欄還有空位才收得進去，滿了就直接浪費掉（照樣消失，只是沒效果）
    const pickedItem = state.items.find((item) => cellKey(item.cell) === cellKey(head));
    if (pickedItem) {
      state.items = state.items.filter((item) => item !== pickedItem);
      if (snake.inventory.length < SNAKE_ITEM_SLOTS) {
        snake.inventory.push(
          pickedItem.kind === 'bullet' ? { kind: 'bullet', ammo: SNAKE_BULLET_AMMO } : { kind: pickedItem.kind },
        );
      }
      const replacement = spawnItem(state, rng);
      if (replacement) state.items.push(replacement);
    }

    // 衝刺位移用掉一拍；SNAKE_DASH_STEPS 拍走完就解除鎖定方向，之後照方向鍵輸入正常轉向
    if (snake.dashStepsRemaining > 0) {
      snake.dashStepsRemaining -= 1;
      if (snake.dashStepsRemaining === 0) snake.dashDir = null;
    }
  }

  // 別人顏色的地雷害死人：地雷跟著一起消失，進入空窗（吃掉/害死人/自然過期，時機不同但空窗長度一律一樣）
  if (liveMine) {
    const killedByMine = [...dead].some(
      (s) => candidateHead.has(s) && cellKey(candidateHead.get(s)!) === cellKey(liveMine.cell) && liveMine.seat !== s.seat,
    );
    if (killedByMine) {
      state.mine = null;
      state.mineGapUntil = now + SNAKE_MINE_GAP_MS;
    }
  }

  for (const snake of dead) killSnake(state, snake, rng, events);

  if (finishIfDone(state)) events.push({ t: 'over', ranking: state.ranking.slice() });
  return events;
}

/** 玩家中途離開房間：不管還有幾條命，直接徹底出局——沒人操控的重生沒有意義。 */
export function removePlayerFromSnake(state: SnakeState, playerId: PlayerId): SnakeEvent[] {
  const events: SnakeEvent[] = [];
  const snake = state.snakes.get(playerId);
  if (!snake || snake.lives <= 0 || state.over) return events;

  dropAlternatingAsFood(state, snake.body);
  snake.lives = 0;
  snake.body = [];
  snake.respawnAt = null;
  state.deaths.push(playerId);
  events.push({ t: 'death', player: playerId });

  // 這個人的地雷果實再也不會有人認領，直接收掉、進入空窗
  if (state.mine && state.mine.seat === snake.seat) {
    state.mine = null;
    state.mineGapUntil = Date.now() + SNAKE_MINE_GAP_MS;
  }

  if (finishIfDone(state)) events.push({ t: 'over', ranking: state.ranking.slice() });
  return events;
}
