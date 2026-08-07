import { describe, expect, it } from 'vitest';
import {
  SNAKE_LIVES,
  SNAKE_MINE_BONUS_SCORE,
  SNAKE_START_DELAY_MS,
  type SnakeCell,
  type SnakeDirection,
} from 'shared';
import type { Seats } from './gameEngine.js';
import {
  initSnake,
  removePlayerFromSnake,
  setSnakeDirection,
  tickSnake,
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

  it('吃到果實：加長一節、加一分、原地的果實被吃掉', () => {
    const { state } = board(3);
    place(state, 'a', [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }], 'right');
    place(state, 'b', [{ x: 15, y: 15 }, { x: 14, y: 15 }, { x: 13, y: 15 }], 'right');
    place(state, 'c', [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }], 'up');
    state.food = [{ x: 6, y: 5 }]; // a 往右走的下一格正好有果實

    tickSnake(state);

    const a = state.snakes.get('a')!;
    expect(a.score).toBe(1);
    expect(a.body).toHaveLength(4); // 3 節長到 4 節，尾巴沒被砍掉
    expect(a.body[0]).toEqual({ x: 6, y: 5 });
    expect(state.food.some((f) => f.x === 6 && f.y === 5)).toBe(false);
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
    const { state } = board(3, 10, 10);
    place(state, 'a', [{ x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 5 }], 'left');
    place(state, 'b', [{ x: 8, y: 8 }, { x: 7, y: 8 }, { x: 6, y: 8 }], 'right');
    place(state, 'c', [{ x: 8, y: 1 }, { x: 7, y: 1 }, { x: 6, y: 1 }], 'right');
    state.food = [];
    tickSnake(state); // a 死一次，進入重生倒數

    state.snakes.get('a')!.respawnAt = Date.now() - 1; // 讓下一拍判定「倒數已經到了」
    tickSnake(state);

    const a = state.snakes.get('a')!;
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
    tickSnake(state);
    expect(livesOf(state, 'b')).toBe(0);
    expect(state.over).toBe(false); // a 還活著

    // a 接著也撞牆出局，這下兩人都沒命了，整局結束
    place(state, 'a', [{ x: 0, y: 6 }, { x: 1, y: 6 }, { x: 2, y: 6 }], 'left');
    const events = tickSnake(state);

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
