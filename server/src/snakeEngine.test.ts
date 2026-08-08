import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SNAKE_OPTIONS,
  SNAKE_DASH_STEPS,
  SNAKE_FOOD_GROWTH,
  SNAKE_FOOD_SCORE,
  SNAKE_LIVES,
  SNAKE_MINE_BONUS_SCORE,
  SNAKE_MINE_GROWTH,
  SNAKE_START_DELAY_MS,
  type SnakeCell,
  type SnakeDirection,
  type SnakeOptions,
} from 'shared';
import type { Seats } from './gameEngine.js';
import {
  initSnake,
  removePlayerFromSnake,
  setSnakeDirection,
  tickSnake,
  useSnakeDash,
  type SnakeState,
} from './snakeEngine.js';

const ID = (i: number) => String.fromCharCode(97 + i);

/** count 條蛇的乾淨局面，用固定 rng 讓出生點以外的隨機（補果實/重生點/地雷）可預期。 */
function board(count: number, width = 20, height = 20): { seats: Seats; state: SnakeState } {
  const seats: Seats = Array.from({ length: count }, (_, i) => ID(i));
  const state = initSnake(seats, () => 0.5, width, height);
  state.startAt = 0; // 直接從「已經開打」起跳；開局倒數本身另外測，不然每個 case 都在空轉
  return { seats, state };
}

/** 直接把某條蛇擺到想測的位置，繞過出生點配置。 */
function place(
  state: SnakeState,
  playerId: string,
  body: readonly SnakeCell[],
  dir: SnakeDirection,
  pendingDir: SnakeDirection = dir,
): void {
  const snake = state.snakes.get(playerId)!;
  snake.body = body.map((c) => ({ ...c }));
  snake.dir = dir;
  snake.pendingDir = pendingDir;
}

function livesOf(state: SnakeState, playerId: string): number {
  return state.snakes.get(playerId)!.lives;
}

function isRespawning(state: SnakeState, playerId: string): boolean {
  return state.snakes.get(playerId)!.respawnAt !== null;
}

/** 照腳本吐值的 rng；用完最後一個就一直重複它，方便鎖定某一次隨機抽選的結果。 */
function scriptedRng(values: readonly number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)]!;
}

/** 讓某條蛇只剩一條命，這樣下一次碰撞就會直接徹底出局，方便測試單純的碰撞判定。 */
function setOneLifeLeft(state: SnakeState, playerId: string): void {
  state.snakes.get(playerId)!.lives = 1;
}

/**
 * 「一次真的會動」的完整刻度：SNAKE_TICK_MS 減半之後，一般速度的蛇只在偶數刻度移動，
 * 所以測試裡想要「跟以前一樣，呼叫一次 tickSnake 就等於一般蛇動一格」的地方，改呼叫這個——
 * 跑滿一個奇偶週期（2 次原始 tick），語意等同舊版的一次 tickSnake()。只針對「想測一般速度蛇
 * 連續移動」的既有測試用；新加的加速/轉彎測試需要看單一刻度的行為，直接呼叫 tickSnake()。
 */
function advanceRealTick(state: SnakeState, rng?: () => number) {
  const first = rng ? tickSnake(state, rng) : tickSnake(state);
  const second = rng ? tickSnake(state, rng) : tickSnake(state);
  return [...first, ...second];
}

/** 跟 board() 一樣，但可以指定非預設的 SnakeOptions（時限/截斷/穿牆等測試要用）。 */
function boardWithOptions(
  count: number,
  options: Partial<SnakeOptions>,
  width = 10,
  height = 10,
): { seats: Seats; state: SnakeState } {
  const seats: Seats = Array.from({ length: count }, (_, i) => ID(i));
  const state = initSnake(seats, () => 0.5, width, height, { ...DEFAULT_SNAKE_OPTIONS, ...options });
  state.startAt = 0;
  return { seats, state };
}

describe('貪吃蛇：碰撞判定（設定只剩一條命，碰撞就直接徹底出局）', () => {
  it('撞牆就出局，其他存活的蛇不受影響', () => {
    const { state } = board(3, 10, 10);
    setOneLifeLeft(state, 'a');
    // a 面朝左貼著左邊界，下一拍會撞牆
    place(state, 'a', [{ x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 5 }], 'left');
    place(state, 'b', [{ x: 8, y: 8 }, { x: 7, y: 8 }, { x: 6, y: 8 }], 'right');
    place(state, 'c', [{ x: 8, y: 1 }, { x: 7, y: 1 }, { x: 6, y: 1 }], 'right');
    state.food = [];

    const events = tickSnake(state);

    expect(livesOf(state, 'a')).toBe(0);
    expect(livesOf(state, 'b')).toBe(SNAKE_LIVES);
    expect(livesOf(state, 'c')).toBe(SNAKE_LIVES);
    expect(events).toContainEqual({ t: 'death', player: 'a' });
    expect(state.over).toBe(false); // b、c 都還有命，局還沒結束
  });

  it('撞到自己的身體就出局（咬到中段，不是尾巴那格）', () => {
    const { state } = board(3);
    setOneLifeLeft(state, 'a');
    // a 繞成一個 2x2 迴圈，頭朝右走會咬到自己的中段（body[3]），不是尾巴（body[5]）
    place(
      state,
      'a',
      [
        { x: 5, y: 5 }, // 頭
        { x: 5, y: 4 },
        { x: 6, y: 4 },
        { x: 6, y: 5 }, // 頭往右走會踩到這格
        { x: 6, y: 6 },
        { x: 5, y: 6 }, // 尾巴
      ],
      'up',
      'right',
    );
    place(state, 'b', [{ x: 15, y: 15 }, { x: 14, y: 15 }, { x: 13, y: 15 }], 'right');
    place(state, 'c', [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }], 'up');
    state.food = [];

    tickSnake(state);

    expect(livesOf(state, 'a')).toBe(0);
  });

  it('撞到別人的身體（非尾巴）就出局', () => {
    const { state } = board(3);
    setOneLifeLeft(state, 'a');
    place(state, 'a', [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }], 'right');
    // b 的中段剛好擋在 a 前進方向上
    place(state, 'b', [{ x: 8, y: 4 }, { x: 6, y: 6 }, { x: 6, y: 5 }, { x: 8, y: 6 }], 'up');
    place(state, 'c', [{ x: 15, y: 15 }, { x: 14, y: 15 }, { x: 13, y: 15 }], 'right');
    state.food = [];

    tickSnake(state);

    expect(livesOf(state, 'a')).toBe(0);
    expect(livesOf(state, 'b')).toBe(SNAKE_LIVES); // b 自己沒有移入危險格，不受影響
  });
});

describe('貪吃蛇：頭對頭', () => {
  it('兩個頭衝進同一格：都不死、這拍不前進、方向不變', () => {
    const { state } = board(3);
    // a 往右、b 往左，候選新頭都是 (6,5)
    place(state, 'a', [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }], 'right');
    place(state, 'b', [{ x: 7, y: 5 }, { x: 8, y: 5 }, { x: 9, y: 5 }], 'left');
    place(state, 'c', [{ x: 15, y: 15 }, { x: 14, y: 15 }, { x: 13, y: 15 }], 'right');
    state.food = [];
    const aBodyBefore = state.snakes.get('a')!.body.map((c) => ({ ...c }));
    const bBodyBefore = state.snakes.get('b')!.body.map((c) => ({ ...c }));

    const events = tickSnake(state);

    expect(livesOf(state, 'a')).toBe(SNAKE_LIVES);
    expect(livesOf(state, 'b')).toBe(SNAKE_LIVES);
    expect(state.snakes.get('a')!.body).toEqual(aBodyBefore);
    expect(state.snakes.get('b')!.body).toEqual(bBodyBefore);
    expect(state.snakes.get('a')!.dir).toBe('right');
    expect(state.snakes.get('b')!.dir).toBe('left');
    expect(events).toEqual([]);
  });

  it('三條蛇的頭同時衝進同一格，三條都彈開', () => {
    const { state } = board(3);
    place(state, 'a', [{ x: 5, y: 6 }, { x: 5, y: 7 }, { x: 5, y: 8 }], 'up');
    place(state, 'b', [{ x: 4, y: 5 }, { x: 3, y: 5 }, { x: 2, y: 5 }], 'right');
    place(state, 'c', [{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }], 'left');
    state.food = [];

    tickSnake(state);

    expect(livesOf(state, 'a')).toBe(SNAKE_LIVES);
    expect(livesOf(state, 'b')).toBe(SNAKE_LIVES);
    expect(livesOf(state, 'c')).toBe(SNAKE_LIVES);
  });

  it('正面對衝互換位置也算頭對頭：兩條蛇都不死、都不前進', () => {
    const { state } = board(3);
    place(state, 'a', [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }], 'right');
    place(state, 'b', [{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }], 'left');
    place(state, 'c', [{ x: 15, y: 15 }, { x: 14, y: 15 }, { x: 13, y: 15 }], 'right');
    state.food = [];
    const aBodyBefore = state.snakes.get('a')!.body.map((c) => ({ ...c }));
    const bBodyBefore = state.snakes.get('b')!.body.map((c) => ({ ...c }));

    const events = tickSnake(state);

    expect(livesOf(state, 'a')).toBe(SNAKE_LIVES);
    expect(livesOf(state, 'b')).toBe(SNAKE_LIVES);
    expect(state.snakes.get('a')!.body).toEqual(aBodyBefore);
    expect(state.snakes.get('b')!.body).toEqual(bBodyBefore);
    expect(events).toEqual([]);
  });
});

describe('貪吃蛇：移動與果實', () => {
  it('180 度反向輸入被忽略，維持原方向前進', () => {
    const { state } = board(3);
    place(state, 'a', [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }], 'right', 'left');
    place(state, 'b', [{ x: 15, y: 15 }, { x: 14, y: 15 }, { x: 13, y: 15 }], 'right');
    place(state, 'c', [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }], 'up');
    state.food = [];

    tickSnake(state);

    const a = state.snakes.get('a')!;
    expect(a.dir).toBe('right');
    expect(a.body[0]).toEqual({ x: 6, y: 5 }); // 往右走，不是往左
    expect(a.lives).toBe(SNAKE_LIVES);
  });

  it('吃到果實：分好幾拍長完（總共 SNAKE_FOOD_GROWTH 節），一次拿 SNAKE_FOOD_SCORE 分，原地的果實被吃掉', () => {
    const { state } = board(3);
    place(state, 'a', [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }], 'right');
    place(state, 'b', [{ x: 15, y: 15 }, { x: 14, y: 15 }, { x: 13, y: 15 }], 'right');
    place(state, 'c', [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }], 'up');
    state.food = [{ x: 6, y: 5 }]; // a 往右走的下一格正好有果實

    tickSnake(state);

    const a = state.snakes.get('a')!;
    expect(a.score).toBe(SNAKE_FOOD_SCORE);
    expect(a.body).toHaveLength(4); // 這一拍先長 1 節，剩下的節數排進成長佇列，之後幾拍慢慢長完
    expect(a.body[0]).toEqual({ x: 6, y: 5 });
    expect(state.food.some((f) => f.x === 6 && f.y === 5)).toBe(false);

    // 接下來沒吃到新東西，尾巴照樣不砍，直到佇列消化完、總共長到 3+SNAKE_FOOD_GROWTH 節
    state.food = [];
    for (let i = 0; i < SNAKE_FOOD_GROWTH - 1; i++) advanceRealTick(state);
    expect(a.body).toHaveLength(3 + SNAKE_FOOD_GROWTH);
    expect(a.score).toBe(SNAKE_FOOD_SCORE); // 分數只在吃到當下加一次，之後長身體不會重複加分

    // 佇列消化完了，下一個真實刻度恢復正常砍尾巴，長度不再變化
    advanceRealTick(state);
    expect(a.body).toHaveLength(3 + SNAKE_FOOD_GROWTH);
  });

  it('沒吃到果實就正常前進：頭加一節、尾巴砍掉一節，長度不變', () => {
    const { state } = board(3);
    place(state, 'a', [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }], 'right');
    place(state, 'b', [{ x: 15, y: 15 }, { x: 14, y: 15 }, { x: 13, y: 15 }], 'right');
    place(state, 'c', [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }], 'up');
    state.food = [];

    tickSnake(state);

    const a = state.snakes.get('a')!;
    expect(a.body).toHaveLength(3);
    expect(a.body).toEqual([{ x: 6, y: 5 }, { x: 5, y: 5 }, { x: 4, y: 5 }]);
  });
});

describe('貪吃蛇：開局倒數', () => {
  // 這一段不能用 board()，它為了讓其他測試直接開打會把 startAt 歸零
  const counting = () => initSnake([ID(0), ID(1)], () => 0.5, 20, 20);

  it('initSnake 把 startAt 設在現在起 SNAKE_START_DELAY_MS 之後，讓房間層可以延後真正開始 tick', () => {
    const before = Date.now();
    const state = counting();
    const after = Date.now();

    expect(state.startAt).toBeGreaterThanOrEqual(before + SNAKE_START_DELAY_MS);
    expect(state.startAt).toBeLessThanOrEqual(after + SNAKE_START_DELAY_MS);
  });

  it('倒數還沒結束就 tick：棋盤完全不動，也不吐任何事件', () => {
    const state = counting();
    const bodiesBefore = [...state.snakes.values()].map((s) => JSON.stringify(s.body));
    const foodBefore = JSON.stringify(state.food);

    const events = tickSnake(state);

    expect(events).toEqual([]);
    expect([...state.snakes.values()].map((s) => JSON.stringify(s.body))).toEqual(bodiesBefore);
    expect(JSON.stringify(state.food)).toBe(foodBefore);
    expect(state.mine).toBeNull(); // 倒數期間也不生地雷
  });
});

describe('貪吃蛇：雙命與重生', () => {
  it('第一次死掉還有命：進入重生倒數，body 是完整 3 節，不算徹底出局', () => {
    const { state } = board(3, 10, 10);
    place(state, 'a', [{ x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 5 }], 'left');
    place(state, 'b', [{ x: 8, y: 8 }, { x: 7, y: 8 }, { x: 6, y: 8 }], 'right');
    place(state, 'c', [{ x: 8, y: 1 }, { x: 7, y: 1 }, { x: 6, y: 1 }], 'right');
    state.food = [];

    const events = tickSnake(state);

    const a = state.snakes.get('a')!;
    expect(a.lives).toBe(SNAKE_LIVES - 1);
    expect(a.body).toHaveLength(3); // 閃爍期間就顯示完整 3 節，看得出頭在哪、準備往哪走
    expect(isRespawning(state, 'a')).toBe(true);
    expect(events).toContainEqual({ t: 'respawn', player: 'a' });
    expect(events.some((e) => e.t === 'death')).toBe(false); // 還沒到徹底出局
  });

  it('重生倒數時間到，下一拍正式復活成 3 節蛇身，並解除幽靈狀態', () => {
    // 直接手動擺成「幽靈倒數剛好到期」的狀態，不靠撞牆死一次再隨機重生——
    // 隨機重生點可能靠近其他蛇，下一拍移動時剛好撞上純屬運氣，跟這裡要驗證的「甦醒」行為無關，
    // 那個風險已經在別的測試（重生點靠邊時...）用 scriptedRng 專門測過邊界情況了。
    const { state } = board(3, 10, 10);
    const a = state.snakes.get('a')!;
    a.lives = SNAKE_LIVES - 1;
    a.body = [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 5, y: 7 }];
    a.dir = 'up';
    a.pendingDir = 'up';
    a.respawnAt = Date.now() - 1; // 倒數剛好到期，這拍要正式復活
    place(state, 'b', [{ x: 8, y: 8 }, { x: 7, y: 8 }, { x: 6, y: 8 }], 'right');
    place(state, 'c', [{ x: 8, y: 1 }, { x: 7, y: 1 }, { x: 6, y: 1 }], 'right');
    state.food = [];

    tickSnake(state);

    expect(isRespawning(state, 'a')).toBe(false);
    expect(a.body.length).toBeGreaterThanOrEqual(3);
  });

  it('重生閃爍中的幽靈不參與碰撞：其他蛇經過同一格，雙方都不會事', () => {
    const { state } = board(2, 10, 10);
    // 手動把 a 設成正在重生閃爍中，位置在 (5,5)
    const a = state.snakes.get('a')!;
    a.lives = SNAKE_LIVES - 1;
    a.body = [{ x: 5, y: 5 }];
    a.respawnAt = Date.now() + 10_000; // 還在倒數中，不會這拍復活
    a.dir = 'up';
    a.pendingDir = 'up';

    // b 往右走，直接穿過 a 的幽靈格 (5,5)
    place(state, 'b', [{ x: 4, y: 5 }, { x: 3, y: 5 }, { x: 2, y: 5 }], 'right');
    state.food = [];

    tickSnake(state);

    expect(livesOf(state, 'b')).toBe(SNAKE_LIVES); // b 沒事
    expect(state.snakes.get('b')!.body[0]).toEqual({ x: 5, y: 5 }); // b 正常移動穿過去
    expect(isRespawning(state, 'a')).toBe(true); // a 還在閃爍，沒被影響
  });

  it('第二次死亡（命用完）才算徹底出局：body 清空、不會再重生', () => {
    const { state } = board(2, 10, 10);
    setOneLifeLeft(state, 'a'); // 只剩一條命，這次死掉就是最後一次
    place(state, 'a', [{ x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 5 }], 'left');
    place(state, 'b', [{ x: 5, y: 5 }, { x: 5, y: 4 }, { x: 5, y: 3 }], 'down');
    state.food = [];

    const events = tickSnake(state);

    const a = state.snakes.get('a')!;
    expect(a.lives).toBe(0);
    expect(a.body).toEqual([]);
    expect(isRespawning(state, 'a')).toBe(false);
    expect(events).toContainEqual({ t: 'death', player: 'a' });
    expect(events.some((e) => e.t === 'respawn')).toBe(false);
  });

  it('setSnakeDirection 對重生閃爍中的蛇沒有作用（沒有身體可以操控）', () => {
    const { state } = board(2);
    const a = state.snakes.get('a')!;
    a.respawnAt = Date.now() + 10_000;
    a.pendingDir = 'up';

    setSnakeDirection(state, 'a', 'down');

    expect(state.snakes.get('a')!.pendingDir).toBe('up'); // 沒被改動
  });

  it('重生點靠邊時，整條蛇身仍然全部落在盤內（不是只有頭合法）', () => {
    const { state } = board(2, 10, 10);
    state.food = [];
    state.mineGapUntil = Date.now() + 10_000_000; // 這一拍不生地雷，rng 只被重生點消費
    // 重生點抽到 (1,1)：往下／往右的話身體會長到 y=-1 / x=-1 去，只有往上／往左放得下
    const rng = scriptedRng([0.1, 0.1, 0.99]); // x, y, 然後挑「最後一個」可用方向
    place(state, 'a', [{ x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 5 }], 'left'); // 下一拍撞左牆
    place(state, 'b', [{ x: 8, y: 8 }, { x: 7, y: 8 }, { x: 6, y: 8 }], 'right');

    tickSnake(state, rng);

    const a = state.snakes.get('a')!;
    expect(isRespawning(state, 'a')).toBe(true);
    expect(a.body).toHaveLength(3);
    expect(a.body.filter((c) => c.x < 0 || c.y < 0 || c.x >= 10 || c.y >= 10)).toEqual([]);
  });
});

describe('貪吃蛇：結局（只要還有人有命在就不結束，排名依分數排）', () => {
  it('兩人局，一人耗完兩條命後，另一人還活著就不算結束', () => {
    const { state } = board(2, 10, 10);
    setOneLifeLeft(state, 'a');
    state.snakes.get('a')!.score = 3; // 比 b 的分數高，確保不會觸發「勝負已定」提前收尾
    place(state, 'a', [{ x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 5 }], 'left');
    place(state, 'b', [{ x: 5, y: 5 }, { x: 5, y: 4 }, { x: 5, y: 3 }], 'down');
    state.food = [];

    const events = tickSnake(state);

    expect(livesOf(state, 'a')).toBe(0);
    expect(livesOf(state, 'b')).toBe(SNAKE_LIVES);
    expect(state.over).toBe(false); // b 還有命在，剩他一人也要玩到他也死光才結束
    expect(events.some((e) => e.t === 'over')).toBe(false);
  });

  it('最後一人也耗完兩條命，整局才真正結束；排名依分數高低，不看死亡順序', () => {
    const { state } = board(2, 10, 10);
    state.snakes.get('a')!.score = 2; // a 分數比較低，但活得比較久
    state.snakes.get('b')!.score = 9; // b 分數比較高，但先出局
    setOneLifeLeft(state, 'a');
    setOneLifeLeft(state, 'b');

    // b 先撞牆出局
    place(state, 'a', [{ x: 5, y: 5 }, { x: 5, y: 4 }, { x: 5, y: 3 }], 'down');
    place(state, 'b', [{ x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 5 }], 'left');
    advanceRealTick(state);
    expect(livesOf(state, 'b')).toBe(0);
    expect(state.over).toBe(false); // a 還活著

    // a 接著也撞牆出局，這下兩人都沒命了，整局結束
    place(state, 'a', [{ x: 0, y: 6 }, { x: 1, y: 6 }, { x: 2, y: 6 }], 'left');
    const events = advanceRealTick(state);

    expect(livesOf(state, 'a')).toBe(0);
    expect(state.over).toBe(true);
    // b 分數比較高，雖然先出局，排名還是在 a 前面
    expect(state.ranking).toEqual(['b', 'a']);
    expect(events).toContainEqual({ t: 'over', ranking: ['b', 'a'] });
  });

  it('只剩一人時，若分數已經追不上（等於或超過已出局的人），勝負已定，直接提前結束，不用等他也死', () => {
    const { state } = board(2, 10, 10);
    state.snakes.get('a')!.score = 10; // 存活者分數已經領先
    state.snakes.get('b')!.score = 4;
    setOneLifeLeft(state, 'b');
    place(state, 'a', [{ x: 5, y: 5 }, { x: 5, y: 4 }, { x: 5, y: 3 }], 'down'); // 安全位置，這拍不會死
    place(state, 'b', [{ x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 5 }], 'left'); // 撞牆出局

    const events = tickSnake(state);

    expect(livesOf(state, 'b')).toBe(0);
    expect(livesOf(state, 'a')).toBe(SNAKE_LIVES); // a 沒死，命還在
    expect(state.over).toBe(true); // 但勝負已定，直接收尾
    expect(state.ranking).toEqual(['a', 'b']);
    expect(events).toContainEqual({ t: 'over', ranking: ['a', 'b'] });
  });

  it('分數同分時，晚出局的排前面', () => {
    const { state } = board(2, 10, 10);
    state.snakes.get('a')!.score = 5;
    state.snakes.get('b')!.score = 5;
    setOneLifeLeft(state, 'a');
    setOneLifeLeft(state, 'b');

    place(state, 'a', [{ x: 5, y: 5 }, { x: 5, y: 4 }, { x: 5, y: 3 }], 'down');
    place(state, 'b', [{ x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 5 }], 'left');
    tickSnake(state); // b 先出局

    place(state, 'a', [{ x: 0, y: 6 }, { x: 1, y: 6 }, { x: 2, y: 6 }], 'left');
    tickSnake(state); // a 也出局，結束（本來就已經同分提前收尾，這裡讓 a 也死一次確認流程一致）

    expect(state.over).toBe(true);
    expect(state.ranking).toEqual(['a', 'b']); // 同分時晚出局（a）排前面
  });

  it('中途離開房間的玩家：不管剩幾條命，直接徹底出局，不會進入重生', () => {
    const { state } = board(2);
    // 離開的 a 分數比留下的 b 高，確保「b 分數追不上」不會誤觸發提前收尾
    state.snakes.get('a')!.score = 5;
    const events = removePlayerFromSnake(state, 'a');

    const a = state.snakes.get('a')!;
    expect(a.lives).toBe(0);
    expect(a.body).toEqual([]);
    expect(isRespawning(state, 'a')).toBe(false);
    // b 還有命在（離開只影響離開的人），剩他一人也要玩到他自己死光才算結束
    expect(state.over).toBe(false);
    expect(events).toContainEqual({ t: 'death', player: 'a' });
    expect(events.some((e) => e.t === 'over')).toBe(false);
  });

  it('中途離開房間：如果對方也已經沒命了，這一走就會真正結束整局', () => {
    const { state } = board(2);
    setOneLifeLeft(state, 'b');
    state.snakes.get('b')!.lives = 0; // b 已經徹底出局（例如剛好也死光）
    state.deaths.push('b');
    state.snakes.get('a')!.score = 4;

    const events = removePlayerFromSnake(state, 'a');

    expect(state.over).toBe(true);
    expect(state.ranking).toEqual(['a', 'b']); // a 分數比較高排前面
    expect(events).toContainEqual({ t: 'over', ranking: ['a', 'b'] });
  });
});

describe('貪吃蛇：地雷果實', () => {
  it('生成後進入預警閃爍：這段期間本人吃不到、別人也不會被害死', () => {
    const { state } = board(2, 10, 10);
    state.mine = { seat: 1, cell: { x: 6, y: 5 }, telegraphUntil: Date.now() + 10_000, expiresAt: Date.now() + 15_000 };
    state.mineGapUntil = null;
    // a（座位 0，不是地雷主人）往右走，正好走到地雷格
    place(state, 'a', [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }], 'right');
    place(state, 'b', [{ x: 15, y: 15 }, { x: 14, y: 15 }, { x: 13, y: 15 }], 'right');
    state.food = [];

    const events = tickSnake(state);

    expect(livesOf(state, 'a')).toBe(SNAKE_LIVES); // 預警中，走過去沒事
    expect(state.mine).not.toBeNull(); // 地雷還在，沒被觸發
    expect(events.some((e) => e.t === 'mine' || e.t === 'death')).toBe(false);
  });

  it('生效期間，別人顏色的地雷會害死人（依剩餘命數判斷重生或出局），地雷立刻消失進入空窗', () => {
    const { state } = board(2, 10, 10);
    setOneLifeLeft(state, 'a');
    state.mine = { seat: 1, cell: { x: 6, y: 5 }, telegraphUntil: Date.now() - 1, expiresAt: Date.now() + 5_000 };
    state.mineGapUntil = null;
    place(state, 'a', [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }], 'right');
    place(state, 'b', [{ x: 15, y: 15 }, { x: 14, y: 15 }, { x: 13, y: 15 }], 'right');
    state.food = [];

    const events = tickSnake(state);

    expect(livesOf(state, 'a')).toBe(0);
    expect(events).toContainEqual({ t: 'death', player: 'a' });
    expect(state.mine).toBeNull();
    expect(state.mineGapUntil).not.toBeNull();
  });

  it('生效期間，本人吃到自己顏色的地雷：加分＋加長，地雷消失進入空窗', () => {
    const { state } = board(2, 10, 10);
    const a = state.snakes.get('a')!;
    const scoreBefore = a.score;
    state.mine = { seat: a.seat, cell: { x: 6, y: 5 }, telegraphUntil: Date.now() - 1, expiresAt: Date.now() + 5_000 };
    state.mineGapUntil = null;
    place(state, 'a', [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }], 'right');
    place(state, 'b', [{ x: 15, y: 15 }, { x: 14, y: 15 }, { x: 13, y: 15 }], 'right');
    state.food = [];

    const events = tickSnake(state);

    expect(a.score).toBe(scoreBefore + SNAKE_MINE_BONUS_SCORE);
    expect(a.body).toHaveLength(4); // 跟吃到普通果實一樣加長一節
    expect(events).toContainEqual({ t: 'mine', player: 'a' });
    expect(state.mine).toBeNull();
    expect(state.mineGapUntil).not.toBeNull();
  });

  it('過期沒人動它就自然消失，進入空窗；空窗結束後補下一個座位顏色的地雷', () => {
    const { state } = board(2, 10, 10);
    state.mine = { seat: 0, cell: { x: 6, y: 5 }, telegraphUntil: Date.now() - 5_000, expiresAt: Date.now() - 1 };
    state.mineGapUntil = null;
    // 這顆地雷是座位 0 的，模擬它是透過 spawnMine 生出來的，輪值指標已經往後推到 1
    state.mineRotationIndex = 1;
    // 兩條蛇都走去別的地方，不去踩地雷格
    place(state, 'a', [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }], 'up');
    place(state, 'b', [{ x: 15, y: 15 }, { x: 14, y: 15 }, { x: 13, y: 15 }], 'right');
    state.food = [];

    tickSnake(state);
    expect(state.mine).toBeNull();
    expect(state.mineGapUntil).not.toBeNull();

    // 空窗還沒結束，這時不會生出新的
    tickSnake(state);
    expect(state.mine).toBeNull();

    // 空窗結束後，下一拍應該補上輪值的下一顆（座位 0 剛用過，換座位 1）
    state.mineGapUntil = Date.now() - 1;
    tickSnake(state);
    expect(state.mine).not.toBeNull();
    expect(state.mine!.seat).toBe(1);
  });

  it('輪值會跳過已經徹底出局的座位', () => {
    const { state } = board(3, 10, 10);
    state.mineRotation = [0, 1, 2];
    state.mineRotationIndex = 1; // 下一顆本來要輪到座位 1
    state.snakes.get('b')!.lives = 0; // 座位 1（b）已經出局
    state.mine = null;
    state.mineGapUntil = null;

    // 三條蛇都待在安全位置，這拍不會撞到剛生出來的地雷
    place(state, 'a', [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }], 'up');
    place(state, 'b', [{ x: 15, y: 15 }, { x: 14, y: 15 }, { x: 13, y: 15 }], 'right');
    place(state, 'c', [{ x: 9, y: 9 }, { x: 9, y: 10 }, { x: 9, y: 11 }], 'up');
    state.food = [];

    tickSnake(state);

    expect(state.mine).not.toBeNull();
    expect(state.mine!.seat).toBe(2); // 跳過已出局的座位 1，輪到座位 2
  });
});

describe('貪吃蛇：無限命時限', () => {
  it('時限一到就強制結束，用「永久分數＋身體長度」排名', () => {
    const { state } = boardWithOptions(2, { unlimitedLives: true, unlimitedLivesTimeLimitSec: 30 });
    state.snakes.get('a')!.score = 2; // 最終分數 2+3=5
    state.snakes.get('b')!.score = 3; // 最終分數 3+3=6，排前面
    place(state, 'a', [{ x: 5, y: 5 }, { x: 5, y: 4 }, { x: 5, y: 3 }], 'down');
    place(state, 'b', [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }], 'up');
    state.food = [];
    state.timeLimitAt = Date.now() - 1; // 時間已經到了

    const events = tickSnake(state);

    expect(state.over).toBe(true);
    expect(state.ranking).toEqual(['b', 'a']);
    expect(events).toContainEqual({ t: 'over', ranking: ['b', 'a'] });
  });

  it('最終分數同分時，比永久分數（身體長度不算數）', () => {
    const { state } = boardWithOptions(2, { unlimitedLives: true, unlimitedLivesTimeLimitSec: 30 });
    state.snakes.get('a')!.score = 2; // 最終分數 2+4=6
    state.snakes.get('b')!.score = 3; // 最終分數 3+3=6，同分但永久分數比較高，排前面
    place(state, 'a', [{ x: 5, y: 5 }, { x: 5, y: 4 }, { x: 5, y: 3 }, { x: 5, y: 2 }], 'down');
    place(state, 'b', [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }], 'up');
    state.food = [];
    state.timeLimitAt = Date.now() - 1;

    tickSnake(state);

    expect(state.ranking).toEqual(['b', 'a']);
  });

  it('時限還沒到就正常運作，不會提前結束', () => {
    const { state } = boardWithOptions(2, { unlimitedLives: true, unlimitedLivesTimeLimitSec: 30 });
    place(state, 'a', [{ x: 5, y: 5 }, { x: 5, y: 4 }, { x: 5, y: 3 }], 'down');
    place(state, 'b', [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }], 'up');
    state.food = [];
    state.timeLimitAt = Date.now() + 10_000;

    tickSnake(state);

    expect(state.over).toBe(false);
  });
});

describe('貪吃蛇：衝刺截斷技能（X 鍵）', () => {
  it('房間沒開截斷選項時，按 X 完全沒有作用', () => {
    const { state } = boardWithOptions(2, { cutting: false });
    const events = useSnakeDash(state, 'a');

    expect(events).toEqual([]);
    expect(state.snakes.get('a')!.dashChargeUntil).toBeNull();
  });

  it('按 X 進入充能：充能期間原地凍結，不會前進', () => {
    const { state } = boardWithOptions(2, { cutting: true });
    place(state, 'a', [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }], 'right');
    place(state, 'b', [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }], 'down');
    state.food = [];

    const dashEvents = useSnakeDash(state, 'a');
    expect(dashEvents).toContainEqual({ t: 'dash', player: 'a' });
    expect(state.snakes.get('a')!.dashChargeUntil).not.toBeNull();

    const bodyBefore = JSON.stringify(state.snakes.get('a')!.body);
    tickSnake(state); // 還在充能中（500ms 還沒過），這拍不會移動
    expect(JSON.stringify(state.snakes.get('a')!.body)).toBe(bodyBefore);
  });

  it('冷卻時間內不能再按 X', () => {
    const { state } = boardWithOptions(2, { cutting: true });
    useSnakeDash(state, 'a');
    const cooldownAfterFirst = state.snakes.get('a')!.dashCooldownUntil;

    const secondEvents = useSnakeDash(state, 'a');

    expect(secondEvents).toEqual([]);
    expect(state.snakes.get('a')!.dashCooldownUntil).toBe(cooldownAfterFirst);
  });

  it('充能結束後鎖定方向衝刺，撞進對方身體會截斷（不是自己死）', () => {
    const { state } = boardWithOptions(2, { cutting: true });
    place(state, 'a', [{ x: 2, y: 5 }, { x: 1, y: 5 }, { x: 0, y: 5 }], 'right');
    // b 頭朝上、身體正確地拖在下方（自己這拍會往上走，不會自撞，也不會跟 a 頭對頭交換位置）；
    // a 衝刺第一步剛好踩上 b 的頭
    place(state, 'b', [{ x: 3, y: 5 }, { x: 3, y: 6 }, { x: 3, y: 7 }], 'up');
    state.food = [];

    useSnakeDash(state, 'a');
    state.snakes.get('a')!.dashChargeUntil = Date.now() - 1; // 這拍充能剛好結束，馬上進入衝刺第一步

    const events = tickSnake(state);

    const a = state.snakes.get('a')!;
    const b = state.snakes.get('b')!;
    expect(events).toContainEqual({ t: 'cut', attacker: 'a', victim: 'b' });
    expect(a.lives).toBe(SNAKE_LIVES); // 攻擊者沒事
    expect(a.body[0]).toEqual({ x: 3, y: 5 }); // 衝刺第一步落在 b 的頭
    // 從頭（index 0）整段截斷＝body 砍到 0 節，等同這條蛇當場死一次；因為還有命，killSnake 在同一拍
    // 內就把她放回重生倒數，body 又補回完整 3 節幽靈——用「少了一條命、進入重生」驗證確實被砍
    expect(b.lives).toBe(SNAKE_LIVES - 1);
    expect(isRespawning(state, 'b')).toBe(true);
    expect(a.dashStepsRemaining).toBe(SNAKE_DASH_STEPS - 1); // 3 拍衝刺用掉第一拍
  });

  it('衝刺撞到有護盾的身體：護盾擋下截斷，攻擊者自己死', () => {
    const { state } = boardWithOptions(2, { cutting: true });
    setOneLifeLeft(state, 'a');
    place(state, 'a', [{ x: 2, y: 5 }, { x: 1, y: 5 }, { x: 0, y: 5 }], 'right');
    place(state, 'b', [{ x: 3, y: 5 }, { x: 3, y: 6 }, { x: 3, y: 7 }], 'up');
    state.food = [];
    state.snakes.get('b')!.shieldUntil = Date.now() + 10_000;

    useSnakeDash(state, 'a');
    state.snakes.get('a')!.dashChargeUntil = Date.now() - 1;

    const events = tickSnake(state);

    expect(events.some((e) => e.t === 'cut')).toBe(false);
    expect(state.snakes.get('a')!.lives).toBe(0); // 攻擊者自己死了（唯一一條命用完，徹底出局）
    expect(state.snakes.get('b')!.body).toHaveLength(3); // b 完全沒事
  });

  it('沒有衝刺、單純撞到別人身體：一律算自己死，即使房間開著截斷選項', () => {
    const { state } = boardWithOptions(2, { cutting: true });
    setOneLifeLeft(state, 'a');
    place(state, 'a', [{ x: 2, y: 5 }, { x: 1, y: 5 }, { x: 0, y: 5 }], 'right');
    place(state, 'b', [{ x: 3, y: 5 }, { x: 3, y: 4 }, { x: 3, y: 3 }], 'up');
    state.food = [];

    const events = tickSnake(state); // a 沒按過 X，正常移動撞進 b 的頭部

    expect(events.some((e) => e.t === 'cut')).toBe(false);
    expect(state.snakes.get('a')!.lives).toBe(0);
  });
});

describe('貪吃蛇：死亡掉落果實', () => {
  it('撞牆死掉：身體隔一節（index 0,2...）掉落變成果實，其餘消失', () => {
    const { state } = board(2, 10, 10);
    setOneLifeLeft(state, 'a');
    // 撞牆出局，死掉當下身體是這 4 節
    place(state, 'a', [{ x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 5 }, { x: 3, y: 5 }], 'left');
    place(state, 'b', [{ x: 8, y: 8 }, { x: 7, y: 8 }, { x: 6, y: 8 }], 'right');
    state.food = [];

    tickSnake(state);

    expect(livesOf(state, 'a')).toBe(0);
    expect(state.food).toContainEqual({ x: 0, y: 5 });
    expect(state.food).toContainEqual({ x: 2, y: 5 });
    expect(state.food.some((f) => f.x === 1 && f.y === 5)).toBe(false);
    expect(state.food.some((f) => f.x === 3 && f.y === 5)).toBe(false);
  });

  it('中途離開房間也一樣掉落果實', () => {
    const { state } = board(2, 10, 10);
    place(state, 'a', [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 5, y: 7 }, { x: 5, y: 8 }], 'up');
    state.food = [];

    removePlayerFromSnake(state, 'a');

    expect(state.food).toContainEqual({ x: 5, y: 5 });
    expect(state.food).toContainEqual({ x: 5, y: 7 });
    expect(state.food.some((f) => f.x === 5 && f.y === 6)).toBe(false);
    expect(state.food.some((f) => f.x === 5 && f.y === 8)).toBe(false);
  });
});

describe('貪吃蛇：子彈飛行', () => {
  it('子彈每拍飛 SNAKE_BULLET_SPEED 格，撞到身體任何一節（不限頭部）就截斷', () => {
    const { state } = board(2, 10, 10);
    place(state, 'a', [{ x: 0, y: 5 }, { x: 0, y: 4 }, { x: 0, y: 3 }], 'right');
    place(state, 'b', [{ x: 4, y: 5 }, { x: 5, y: 5 }, { x: 6, y: 5 }], 'up');
    state.food = [];
    const aSeat = state.snakes.get('a')!.seat;
    state.bullets = [{ shooterSeat: aSeat, cell: { x: 1, y: 5 }, dir: 'right', traveled: 0 }];

    const events1 = advanceRealTick(state);
    // 第一個真實刻度飛兩格 (1,5)→(3,5)，還沒追上 b（b 這時候身體在 x=4,5,6 附近）
    expect(events1.some((e) => e.t === 'cut')).toBe(false);

    const events2 = advanceRealTick(state);
    // 第二個真實刻度再飛兩格，追上並打中 b 的身體，截斷成功
    expect(events2).toContainEqual({ t: 'cut', attacker: 'a', victim: 'b' });
  });

  it('子彈打到護盾會被擋下：不截斷，子彈直接消失', () => {
    const { state } = board(2, 10, 10);
    place(state, 'a', [{ x: 0, y: 5 }, { x: 0, y: 4 }, { x: 0, y: 3 }], 'right');
    place(state, 'b', [{ x: 4, y: 5 }, { x: 4, y: 6 }, { x: 4, y: 7 }], 'down');
    state.food = [];
    state.snakes.get('b')!.shieldUntil = Date.now() + 10_000;
    const aSeat = state.snakes.get('a')!.seat;
    state.bullets = [{ shooterSeat: aSeat, cell: { x: 2, y: 5 }, dir: 'right', traveled: 0 }];

    const events = tickSnake(state);

    expect(events.some((e) => e.t === 'cut')).toBe(false);
    expect(state.bullets).toHaveLength(0); // 子彈打到護盾就消失，不會繼續飛
    expect(state.snakes.get('b')!.body).toHaveLength(3); // b 完全沒事
  });

  it('子彈飛出邊界（沒開穿牆）就消失，不會留在場上', () => {
    const { state } = board(2, 10, 10);
    place(state, 'a', [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }], 'right');
    place(state, 'b', [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 5, y: 7 }], 'up');
    state.food = [];
    const aSeat = state.snakes.get('a')!.seat;
    state.bullets = [{ shooterSeat: aSeat, cell: { x: 8, y: 5 }, dir: 'right', traveled: 0 }];

    tickSnake(state); // (8,5)→(9,5)→(10,5) 出界

    expect(state.bullets).toHaveLength(0);
  });
});

describe('貪吃蛇：地雷果實成長佇列', () => {
  it('吃到自己顏色的地雷：分好幾拍長完 SNAKE_MINE_GROWTH 節', () => {
    const { state } = board(2); // 預設 20x20，之後要連續往右走快 10 拍，10x10 的小盤會撞牆
    const a = state.snakes.get('a')!;
    state.mine = { seat: a.seat, cell: { x: 6, y: 5 }, telegraphUntil: Date.now() - 1, expiresAt: Date.now() + 5_000 };
    state.mineGapUntil = null;
    place(state, 'a', [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }], 'right');
    place(state, 'b', [{ x: 15, y: 15 }, { x: 14, y: 15 }, { x: 13, y: 15 }], 'right');
    state.food = [];

    tickSnake(state);
    expect(a.score).toBe(SNAKE_MINE_BONUS_SCORE);
    expect(a.body).toHaveLength(4); // 這一拍先長 1 節

    for (let i = 0; i < SNAKE_MINE_GROWTH - 1; i++) advanceRealTick(state);
    expect(a.body).toHaveLength(3 + SNAKE_MINE_GROWTH); // 佇列消化完，總共長了 SNAKE_MINE_GROWTH 節
  });
});

describe('貪吃蛇：加速（逐拍真的移動一格，不是一次跳兩格）', () => {
  it('加速中的蛇兩種刻度都會動；沒加速的蛇只在偶數刻度動，奇數刻度原地不動', () => {
    const { state } = board(2);
    place(state, 'a', [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }], 'right');
    place(state, 'b', [{ x: 5, y: 10 }, { x: 4, y: 10 }, { x: 3, y: 10 }], 'right');
    state.food = [];
    state.snakes.get('a')!.speedUntil = Date.now() + 10_000; // 只有 a 加速

    tickSnake(state); // 刻度 0（偶）：兩條都動
    expect(state.snakes.get('a')!.body[0]).toEqual({ x: 6, y: 5 });
    expect(state.snakes.get('b')!.body[0]).toEqual({ x: 6, y: 10 });

    tickSnake(state); // 刻度 1（奇）：只有加速中的 a 動，b 原地不動
    expect(state.snakes.get('a')!.body[0]).toEqual({ x: 7, y: 5 });
    expect(state.snakes.get('b')!.body[0]).toEqual({ x: 6, y: 10 });

    tickSnake(state); // 刻度 2（偶）：b 輪到它動了
    expect(state.snakes.get('b')!.body[0]).toEqual({ x: 7, y: 10 });
  });

  it('加速時可以逐格轉彎：不是鎖死方向一次跳兩格，兩個刻度之間的新輸入會生效', () => {
    const { state } = board(2);
    place(state, 'a', [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }], 'right');
    place(state, 'b', [{ x: 15, y: 15 }, { x: 14, y: 15 }, { x: 13, y: 15 }], 'right');
    state.food = [];
    state.snakes.get('a')!.speedUntil = Date.now() + 10_000;

    tickSnake(state); // 第一格往右
    expect(state.snakes.get('a')!.body[0]).toEqual({ x: 6, y: 5 });

    setSnakeDirection(state, 'a', 'down'); // 模擬玩家在這一瞬間按下轉向
    tickSnake(state); // 第二格應該往下轉，不是繼續往右跳到 (7,5)
    expect(state.snakes.get('a')!.body[0]).toEqual({ x: 6, y: 6 });
  });

  it('加速中途那一格的果實/身體/牆壁都會真的判定，不會直接跳過去', () => {
    const { state } = board(2, 10, 10);
    place(state, 'a', [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }], 'right');
    place(state, 'b', [{ x: 8, y: 8 }, { x: 7, y: 8 }, { x: 6, y: 8 }], 'right');
    state.food = [{ x: 6, y: 5 }]; // 就在下一步，不是兩步之外
    state.snakes.get('a')!.speedUntil = Date.now() + 10_000;

    tickSnake(state);

    const a = state.snakes.get('a')!;
    expect(a.body[0]).toEqual({ x: 6, y: 5 }); // 吃到了，沒有跳過去
    expect(a.score).toBe(SNAKE_FOOD_SCORE);
    expect(state.food.some((f) => f.x === 6 && f.y === 5)).toBe(false);
  });

  it('衝刺不疊加加速：即使同時加速中，衝刺速度跟只加速一樣快，不會更快', () => {
    const { state } = boardWithOptions(2, { cutting: true });
    place(state, 'a', [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }], 'right');
    place(state, 'b', [{ x: 15, y: 15 }, { x: 14, y: 15 }, { x: 13, y: 15 }], 'right');
    state.food = [];
    const a = state.snakes.get('a')!;
    a.speedUntil = Date.now() + 10_000;
    useSnakeDash(state, 'a');
    a.dashChargeUntil = Date.now() - 1; // 充能剛好結束

    tickSnake(state); // 刻度 0（偶）：解除充能、開始衝刺第一步
    expect(a.body[0]).toEqual({ x: 6, y: 5 });
    expect(a.dashStepsRemaining).toBe(SNAKE_DASH_STEPS - 1);

    tickSnake(state); // 刻度 1（奇）：衝刺本身就是兩倍速，這拍照樣會動——跟只吃加速道具速度一樣，不會疊加更快
    expect(a.body[0]).toEqual({ x: 7, y: 5 });
    expect(a.dashStepsRemaining).toBe(SNAKE_DASH_STEPS - 2);
  });

  it('衝刺是真的爆發位移：每個刻度都動，不用等偶數刻度，連續 SNAKE_DASH_STEPS 拍後恢復一般速度', () => {
    const { state } = boardWithOptions(2, { cutting: true });
    place(state, 'a', [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }], 'right');
    place(state, 'b', [{ x: 15, y: 15 }, { x: 14, y: 15 }, { x: 13, y: 15 }], 'right');
    state.food = [];
    const a = state.snakes.get('a')!;
    useSnakeDash(state, 'a');
    a.dashChargeUntil = Date.now() - 1;

    for (let i = 0; i < SNAKE_DASH_STEPS; i++) tickSnake(state);

    expect(a.body[0]).toEqual({ x: 5 + SNAKE_DASH_STEPS, y: 5 });
    expect(a.dashStepsRemaining).toBe(0);
    expect(a.dashDir).toBeNull();

    // 衝刺用完、沒開加速道具：恢復成「隔一個刻度動一格」的一般速度，不是每刻度都動
    const headAfterDash = { ...a.body[0]! };
    tickSnake(state); // 偶數刻度，一般速度這拍會動
    const movedHead = { ...a.body[0]! };
    expect(movedHead).not.toEqual(headAfterDash);
    tickSnake(state); // 奇數刻度，一般速度這拍不動
    expect(a.body[0]).toEqual(movedHead);
  });
});
