import type { PlayerId } from './types.js';

/** 貪吃蛇的移動方向。 */
export type SnakeDirection = 'up' | 'down' | 'left' | 'right';

export const SNAKE_DIRECTIONS: readonly SnakeDirection[] = ['up', 'down', 'left', 'right'];

/** 正方形棋盤的邊長（格）。 */
export const SNAKE_GRID_SIZE = 20;

/** 每拍間隔（ms）。所有蛇同時前進一格，不是回合制。 */
export const SNAKE_TICK_MS = 150;

/** 按下開始後，先讓大家看清楚出生位置，倒數這麼久才真的開始移動。 */
export const SNAKE_START_DELAY_MS = 3_000;

/** 場上維持的果實數量，吃掉一顆就在別處補一顆。 */
export const SNAKE_FOOD_COUNT = 2;

/** 每人可以死幾次：第一次死掉會重生，用完才真的出局。 */
export const SNAKE_LIVES = 2;

/** 死掉之後在重生點原地閃爍這麼久（幽靈狀態，不參與碰撞），時間到才正式復活開始動。 */
export const SNAKE_RESPAWN_MS = 3_000;

/** 地雷果實生成後的預警閃爍時間：這段時間內誰都吃不到、也不會被害死。 */
export const SNAKE_MINE_TELEGRAPH_MS = 2_000;

/** 地雷果實過了預警之後，真正生效可以互動的時間；沒人動它就自然消失。 */
export const SNAKE_MINE_LIVE_MS = 5_000;

/** 地雷果實消失（不管是被吃掉、害死人、還是自然過期）之後，等這麼久才會生出下一顆。 */
export const SNAKE_MINE_GAP_MS = 5_000;

/** 本人吃到自己顏色的地雷果實，一次拿到這麼多分（同時也加長一節，跟一般果實一樣）。 */
export const SNAKE_MINE_BONUS_SCORE = 3;

/** 棋盤座標，(0,0) 是左上角。 */
export interface SnakeCell {
  x: number;
  y: number;
}

/** 地雷果實：屬於某個座位的顏色，本人吃到加分，別人碰到會死。 */
export interface SnakeMineView {
  seat: number;
  cell: SnakeCell;
  /** true 表示還在預警閃爍中，還不會生效。 */
  warning: boolean;
}

export interface SnakeSeatInfo {
  /** 蛇身，index 0 是頭。重生閃爍中也是完整長度（畫在重生點上），徹底出局時為空陣列。 */
  body: SnakeCell[];
  /** 還在遊戲裡（含正在重生閃爍中）就是 true；兩條命都用完才是 false。 */
  alive: boolean;
  /** 正在重生閃爍中：body 畫得出來但不參與碰撞，畫面上要讓它看起來在閃。 */
  respawning: boolean;
  /** 剩餘命數，用完（0）就是徹底出局。 */
  lives: number;
  /** 吃到的果實數（含地雷果實的加分），排名依這個由高到低排。 */
  score: number;
  /** 目前實際朝向 —— 是這一拍真的走的方向，不是玩家按下的輸入緩衝。 */
  dir: SnakeDirection;
}

export interface SnakeGameView {
  type: 'snake';
  /** 貪吃蛇沒有「輪到誰」，恆為 null；跟 turnDeadline 一樣是給 TurnBased 用的惰性欄位。 */
  turnPlayerId: PlayerId | null;
  turnDeadline: number;
  over: boolean;
  width: number;
  height: number;
  food: SnakeCell[];
  /** 場上同時只有一顆，沒有生成中（空窗期）時為 null。 */
  mine: SnakeMineView | null;
  /** seat → 該座位的蛇。座位空著或還沒發蛇時沒有這個 key。 */
  seats: Record<number, SnakeSeatInfo>;
  /** 依分數由高到低排；只有 over 時才有值。 */
  ranking: PlayerId[];
}
