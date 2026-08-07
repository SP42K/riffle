import {
  SNAKE_DIRECTIONS,
  SNAKE_FOOD_COUNT,
  SNAKE_GRID_SIZE,
  SNAKE_LIVES,
  SNAKE_MINE_BONUS_SCORE,
  SNAKE_MINE_GAP_MS,
  SNAKE_MINE_LIVE_MS,
  SNAKE_MINE_TELEGRAPH_MS,
  SNAKE_RESPAWN_MS,
  SNAKE_START_DELAY_MS,
  type PlayerId,
  type SnakeCell,
  type SnakeDirection,
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
  /** 剩餘命數。0 代表徹底出局，不會再重生。 */
  lives: number;
  /** 非 null 表示正在重生閃爍中（幽靈狀態，不參與碰撞），這個時間到了才正式復活。 */
  respawnAt: number | null;
  score: number;
}

interface Mine {
  seat: number;
  cell: SnakeCell;
  /** 這個時間之前是預警閃爍，還不會生效（吃不到也害不死人）。 */
  telegraphUntil: number;
  /** 過了這個時間還沒人動它，就自然消失。 */
  expiresAt: number;
}

export interface SnakeState extends TurnBased {
  /** 貪吃蛇沒有「輪到誰」，這兩個惰性欄位讓它照樣滿足 TurnBased —— 房間層的計時器不必為它分支。 */
  turnSeat: -1;
  turnDeadline: 0;
  over: boolean;
  width: number;
  height: number;
  food: SnakeCell[];
  snakes: Map<PlayerId, Snake>;
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

/** 四個角落的出生點，往盤面內側斜對角延伸三節，彼此離得夠遠不會一開局就撞在一起。 */
function spawnFor(seat: number, width: number, height: number): { head: SnakeCell; dir: SnakeDirection } {
  const configs: Array<{ head: SnakeCell; dir: SnakeDirection }> = [
    { head: { x: 2, y: 2 }, dir: 'right' },
    { head: { x: width - 3, y: 2 }, dir: 'left' },
    { head: { x: 2, y: height - 3 }, dir: 'right' },
    { head: { x: width - 3, y: height - 3 }, dir: 'left' },
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

/** 場上所有蛇身（含重生閃爍中的那一格）＋現有果實＋地雷佔用的格子。找空格用的共用底料。 */
function occupiedByBoard(state: SnakeState, opts: { includeMine?: boolean } = {}): Set<string> {
  const occupied = new Set<string>();
  for (const snake of state.snakes.values()) {
    if (snake.lives <= 0) continue;
    for (const cell of snake.body) occupied.add(cellKey(cell));
  }
  for (const cell of state.food) occupied.add(cellKey(cell));
  if (opts.includeMine !== false && state.mine) occupied.add(cellKey(state.mine.cell));
  return occupied;
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

/** 重生用：找一個安全空格，順便挑一個往前走不會馬上撞牆的方向。 */
function findSafeRespawn(
  state: SnakeState,
  rng: () => number,
): { cell: SnakeCell; dir: SnakeDirection } | null {
  const occupied = occupiedByBoard(state);
  for (let attempt = 0; attempt < 200; attempt++) {
    const cell = { x: Math.floor(rng() * state.width), y: Math.floor(rng() * state.height) };
    if (occupied.has(cellKey(cell))) continue;
    const safeDirs = SNAKE_DIRECTIONS.filter((d) =>
      inBounds({ x: cell.x + DELTA[d].x, y: cell.y + DELTA[d].y }, state.width, state.height),
    );
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
    });
  }

  const state: SnakeState = {
    turnSeat: -1,
    turnDeadline: 0,
    over: false,
    width,
    height,
    food: [],
    snakes,
    mine: null,
    mineGapUntil: null,
    mineRotation: [...snakes.values()].map((s) => s.seat).sort((a, b) => a - b),
    mineRotationIndex: 0,
    deaths: [],
    ranking: [],
    startAt: Date.now() + SNAKE_START_DELAY_MS,
  };

  for (let i = 0; i < SNAKE_FOOD_COUNT; i++) {
    const cell = spawnFood(state, rng);
    if (cell) state.food.push(cell);
  }

  return state;
}

/** 玩家按方向鍵：只更新輸入緩衝，實際套用與碰撞判定都在 tick 才發生。 */
export function setSnakeDirection(state: SnakeState, playerId: PlayerId, dir: SnakeDirection): void {
  if (!SNAKE_DIRECTIONS.includes(dir)) return;
  const snake = state.snakes.get(playerId);
  if (snake && snake.lives > 0 && snake.respawnAt === null) snake.pendingDir = dir;
}

/** 還在遊戲裡、這拍真的會移動的蛇：有命、而且不在重生閃爍中。 */
function movingEligible(state: SnakeState): Snake[] {
  return [...state.snakes.values()].filter((s) => s.lives > 0 && s.respawnAt === null);
}

/**
 * 只要還有人有命在（含正在重生閃爍中），就不能結束——最後一人也要玩到他自己死為止；
 * 但如果只剩他一人、而且分數已經追不上（等於或超過所有已出局玩家），勝負已經確定，
 * 就不用再讓他一個人耗下去，直接收尾。
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

  state.over = true;
  // 分數高的排前面；同分的話晚出局的排前面 —— 還沒死過（提前收尾的存活者）視為比任何人都晚
  const deathRank = (id: PlayerId) => {
    const index = state.deaths.indexOf(id);
    return index === -1 ? Number.POSITIVE_INFINITY : index;
  };
  state.ranking = [...state.snakes.keys()].sort((a, b) => {
    const scoreDiff = state.snakes.get(b)!.score - state.snakes.get(a)!.score;
    if (scoreDiff !== 0) return scoreDiff;
    return deathRank(b) - deathRank(a);
  });
  return true;
}

export type SnakeEvent =
  | { t: 'respawn'; player: PlayerId }
  | { t: 'death'; player: PlayerId }
  | { t: 'mine'; player: PlayerId }
  | { t: 'over'; ranking: PlayerId[] };

/** 死掉一次：還有命就進入重生倒數，命用完就徹底出局。 */
function killSnake(state: SnakeState, snake: Snake, rng: () => number, events: SnakeEvent[]): void {
  snake.lives -= 1;
  if (snake.lives <= 0) {
    snake.body = [];
    snake.respawnAt = null;
    state.deaths.push(snake.playerId);
    events.push({ t: 'death', player: snake.playerId });
    return;
  }

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
 * 一拍。除了原本的移動與碰撞，這一版還要處理：
 * 0. 重生倒數到了的蛇正式復活（幽靈狀態結束，變回真的 3 節蛇身）
 * 1. 地雷果實的生命週期（過期消失／被埋在蛇身下就算消失／空窗結束補下一顆）
 * 2. 存活蛇的移動、頭對頭、碰撞判定跟原本一樣，只是額外疊加「踩到地雷」的結果：
 *    本人的顏色 → 加分加長；別人的顏色 → 跟撞牆撞身體一樣算死亡（會走 killSnake 判斷重生或出局）
 */
export function tickSnake(state: SnakeState, rng: () => number = Math.random): SnakeEvent[] {
  const events: SnakeEvent[] = [];
  if (state.over) return events;
  const now = Date.now();

  // 0. 重生倒數結束的蛇，正式復活 —— 身體在死掉當下就已經是完整 3 節了，這裡只要解除幽靈狀態
  for (const snake of state.snakes.values()) {
    if (snake.respawnAt !== null && now >= snake.respawnAt) {
      snake.respawnAt = null;
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

  const candidateDir = new Map<Snake, SnakeDirection>();
  const candidateHead = new Map<Snake, SnakeCell>();
  for (const snake of living) {
    const dir = snake.pendingDir === OPPOSITE[snake.dir] ? snake.dir : snake.pendingDir;
    candidateDir.set(snake, dir);
    const delta = DELTA[dir];
    candidateHead.set(snake, { x: snake.body[0]!.x + delta.x, y: snake.body[0]!.y + delta.y });
  }

  const stalled = new Set<Snake>();

  // (a) 候選新頭落在同一格的蛇，這拍全部彈開
  const headCount = new Map<string, number>();
  for (const head of candidateHead.values()) {
    const key = cellKey(head);
    headCount.set(key, (headCount.get(key) ?? 0) + 1);
  }
  for (const snake of living) {
    if ((headCount.get(cellKey(candidateHead.get(snake)!)) ?? 0) >= 2) stalled.add(snake);
  }

  // (b) 交換位置：A 移向 B 現在的頭、B 也移向 A 現在的頭，兩條蛇交叉穿過彼此
  for (let i = 0; i < living.length; i++) {
    for (let j = i + 1; j < living.length; j++) {
      const a = living[i]!;
      const b = living[j]!;
      const aTargetsB = cellKey(candidateHead.get(a)!) === cellKey(b.body[0]!);
      const bTargetsA = cellKey(candidateHead.get(b)!) === cellKey(a.body[0]!);
      if (aTargetsB && bTargetsA) {
        stalled.add(a);
        stalled.add(b);
      }
    }
  }

  const moving = living.filter((s) => !stalled.has(s));

  // 這一拍會不會長長：吃到一般果實，或吃到自己顏色的地雷果實，都算 —— 尾巴要不要讓開看這個
  const foodKeys = new Set(state.food.map(cellKey));
  const ownMineHit = (snake: Snake, head: SnakeCell): boolean =>
    liveMine !== null && liveMine.seat === snake.seat && cellKey(head) === cellKey(liveMine.cell);
  const willGrow = new Map<Snake, boolean>();
  for (const snake of moving) {
    const head = candidateHead.get(snake)!;
    willGrow.set(snake, foodKeys.has(cellKey(head)) || ownMineHit(snake, head));
  }

  // 所有存活蛇（含彈開的、含重生閃爍中的不算）目前佔用的格子；會移動又沒長長的蛇，尾巴這格算讓出來
  const occupied = new Set<string>();
  for (const snake of living) {
    const skipTailIndex = moving.includes(snake) && !willGrow.get(snake) ? snake.body.length - 1 : -1;
    snake.body.forEach((cell, index) => {
      if (index !== skipTailIndex) occupied.add(cellKey(cell));
    });
  }

  const dead = new Set<Snake>();
  for (const snake of moving) {
    const head = candidateHead.get(snake)!;
    if (!inBounds(head, state.width, state.height) || occupied.has(cellKey(head))) {
      dead.add(snake);
      continue;
    }
    // 踩到別人顏色、已經生效的地雷果實 —— 跟撞牆撞身體一樣算死亡
    if (liveMine && cellKey(head) === cellKey(liveMine.cell) && liveMine.seat !== snake.seat) {
      dead.add(snake);
    }
  }

  // 套用移動：彈開的蛇原地不動、方向不變；存活且沒撞到的蛇才真的往前
  for (const snake of moving) {
    if (dead.has(snake)) continue;
    snake.dir = candidateDir.get(snake)!;
    const head = candidateHead.get(snake)!;
    snake.body.unshift(head);

    if (liveMine && ownMineHit(snake, head)) {
      snake.score += SNAKE_MINE_BONUS_SCORE;
      events.push({ t: 'mine', player: snake.playerId });
      state.mine = null;
      state.mineGapUntil = now + SNAKE_MINE_GAP_MS;
    } else if (foodKeys.has(cellKey(head))) {
      snake.score += 1;
      state.food = state.food.filter((f) => cellKey(f) !== cellKey(head));
      const replacement = spawnFood(state, rng);
      if (replacement) state.food.push(replacement);
    } else {
      snake.body.pop();
    }
  }

  // 別人顏色的地雷害死人：地雷跟著一起消失，進入空窗（吃掉/害死人/自然過期，時機不同但空窗長度一律一樣）
  if (liveMine) {
    const killedByMine = [...dead].some(
      (s) => cellKey(candidateHead.get(s)!) === cellKey(liveMine.cell) && liveMine.seat !== s.seat,
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
