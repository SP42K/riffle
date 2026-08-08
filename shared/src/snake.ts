import type { PlayerId } from './types.js';

/** 貪吃蛇的移動方向。 */
export type SnakeDirection = 'up' | 'down' | 'left' | 'right';

export const SNAKE_DIRECTIONS: readonly SnakeDirection[] = ['up', 'down', 'left', 'right'];

/** 正方形棋盤的邊長（格）。 */
export const SNAKE_GRID_SIZE = 20;

/**
 * 引擎每次真正被呼叫的間隔（ms）。這是「刻度」的間隔，不是「一般蛇的移動間隔」——
 * 沒開加速的蛇只在偶數刻度移動，等於維持 150ms 一格的原速；加速中的蛇每個刻度都移動，
 * 變成 75ms 一格（2 倍速），而且是真的逐格移動、每刻度都能重新轉彎，不是一次跳兩格。
 * 拆成兩倍頻率是刻意的：這樣加速時每一格都會真正判定碰撞/撿取，不會跳過中間那格。
 */
export const SNAKE_TICK_MS = 75;

/** 按下開始後，先讓大家看清楚出生位置，倒數這麼久才真的開始移動。 */
export const SNAKE_START_DELAY_MS = 3_000;

/** 場上維持的果實數量，吃掉一顆就在別處補一顆。 */
export const SNAKE_FOOD_COUNT = 2;

/** 每人可以死幾次：第一次死掉會重生，用完才真的出局。 */
export const SNAKE_LIVES = 2;

/** 大地圖是一般地圖的幾倍（長寬各放大這個倍數，面積等於平方倍）。 */
export const SNAKE_LARGE_MAP_SCALE = 2;

/**
 * 房間建立時決定、中途不會變的規則開關。跟 BigTwoRules／MonopolyOptions 同一個做法：
 * 開關本身跟引擎邏輯分開放，新增一條開關不必去改題目本身怎麼判斷輸贏。
 */
export interface SnakeOptions {
  /** 撞到地圖邊界不會死，直接從另一邊繞出來。 */
  wraparound: boolean;
  /** 命用不完，撞了就在安全格重生，沒有「徹底出局」這回事——這個模式下改用時間限制結束遊戲。 */
  unlimitedLives: boolean;
  /** unlimitedLives 開著時，開局倒數結束起算幾秒後強制結束比分數；unlimitedLives 關著時這個欄位沒有作用。 */
  unlimitedLivesTimeLimitSec: number;
  /** 頭對頭（含交換位置）怎麼處理：bounce 兩邊都彈開不死；clash 兩邊都算死亡。 */
  headOnCollision: 'bounce' | 'clash';
  /**
   * 這個房間可不可以截斷別人：截斷只會透過 X 鍵的衝刺技能發生（見 SNAKE_DASH_* 常數），
   * 不衝刺、單純撞到別人身體一律算自己死。關掉這個選項時 X 鍵完全沒有作用。
   */
  cutting: boolean;
  /** 地圖長寬各放大 SNAKE_LARGE_MAP_SCALE 倍。 */
  largeMap: boolean;
  /** 場上會出現道具，撿到放進道具欄，按空白鍵使用。 */
  items: boolean;
}

export const DEFAULT_SNAKE_OPTIONS: SnakeOptions = {
  wraparound: false,
  unlimitedLives: false,
  unlimitedLivesTimeLimitSec: 120,
  headOnCollision: 'bounce',
  cutting: false,
  largeMap: false,
  items: false,
};

export const SNAKE_OPTION_KEYS: readonly (keyof SnakeOptions)[] = [
  'wraparound',
  'unlimitedLives',
  'unlimitedLivesTimeLimitSec',
  'headOnCollision',
  'cutting',
  'largeMap',
  'items',
];

/** unlimitedLivesTimeLimitSec 在大廳可以調整的範圍：太短玩不成、太長跟沒開一樣。 */
export const SNAKE_TIME_LIMIT_MIN_SEC = 30;
export const SNAKE_TIME_LIMIT_MAX_SEC = 600;

// ---------------------------------------------------------------------------
// 道具
// ---------------------------------------------------------------------------

/**
 * 道具種類。新增一種道具只要：這裡加一個 kind、加進 SNAKE_ITEM_KINDS，
 * 然後在 server/src/snakeEngine.ts 的 ITEM_EFFECTS 補一條處理方式——
 * 生成、拾取、道具欄都是共用邏輯，不必為新道具另外改。
 */
export type SnakeItemKind = 'speed' | 'reverse' | 'shield' | 'bullet' | 'magnet';

export const SNAKE_ITEM_KINDS: readonly SnakeItemKind[] = [
  'speed',
  'reverse',
  'shield',
  'bullet',
  'magnet',
];

export const SNAKE_ITEM_LABEL: Record<SnakeItemKind, string> = {
  speed: '加速',
  reverse: '反轉全場',
  shield: '護盾',
  bullet: '子彈',
  magnet: '磁鐵',
};

/** 道具欄格數：撿到第三個的時候，欄位已滿，那顆道具直接浪費掉。 */
export const SNAKE_ITEM_SLOTS = 2;

/** 場上同時維持幾個道具點；撿走一個就在別處補一個。 */
export const SNAKE_ITEM_COUNT = 3;

/**
 * 頭上浮動標籤要怎麼畫，跟引擎邏輯完全分開——新增/調整一個技能的顯示方式只要改這裡一個物件。
 * icon：頭上顯示的符號。
 * showChargeCountdown：還沒生效（延遲期／衝刺充能期）時，要不要在頭上倒數剩餘秒數。
 * showDurationCountdown：生效中若有持續時間，要不要在頭上倒數剩餘秒數（一次性效果如子彈/衝刺不需要）。
 */
export interface SnakeAbilityDisplay {
  icon: string;
  showChargeCountdown: boolean;
  showDurationCountdown: boolean;
}

/**
 * 每種道具「用掉之後」的行為設定，讓每種道具的預警/延遲/顯示都能各自調整，不必改引擎邏輯。
 * activationDelayMs：用掉的那一刻到真的生效中間隔多久（0 = 立即生效），
 * 這段期間會先發一則 announce 通知，給其他玩家一點反應時間，跟地雷果實的預警閃爍是同一個概念。
 * announce：生效那一刻要不要另外發一則房間聊天室看得到的系統通知（比戰報那六行更顯眼），
 * 目的是「影響到別人的道具」要讓大家都注意到，只影響自己的道具（加速/護盾/磁鐵）不用吵大家。
 */
export interface SnakeItemConfig {
  activationDelayMs: number;
  announce: boolean;
  display: SnakeAbilityDisplay;
}

export const SNAKE_ITEM_CONFIG: Record<SnakeItemKind, SnakeItemConfig> = {
  speed: {
    activationDelayMs: 0,
    announce: false,
    display: { icon: '»', showChargeCountdown: false, showDurationCountdown: true },
  },
  shield: {
    activationDelayMs: 0,
    announce: false,
    display: { icon: '◈', showChargeCountdown: false, showDurationCountdown: true },
  },
  magnet: {
    activationDelayMs: 0,
    announce: false,
    display: { icon: '⊛', showChargeCountdown: false, showDurationCountdown: true },
  },
  // 反轉全場：延遲生效給大家一點反應時間，而且一定要公告，不然被反轉的人根本不知道發生什麼事
  reverse: {
    activationDelayMs: 1_500,
    announce: true,
    display: { icon: '⇄', showChargeCountdown: true, showDurationCountdown: true },
  },
  // 開槍是攻擊性道具，立即生效沒有延遲空間，但一樣要公告，讓其他人知道場上有人在開槍
  bullet: {
    activationDelayMs: 0,
    announce: true,
    display: { icon: '●', showChargeCountdown: false, showDurationCountdown: false },
  },
};

/** 按 X 之後先原地凍結這麼久（充能／預警），凍結期間不會前進，也擋不了被別人撞。 */
export const SNAKE_DASH_CHARGE_MS = 500;

/**
 * 充能結束後鎖定方向前進幾格，每格各自判定碰撞／截斷。這幾格是用跟加速道具相同的
 * 「每刻度都動」速度衝出去（見 activeMovers），是真的比平常快一倍的爆發位移，不是
 * 用一般速度慢慢走完；不管當下有沒有另外吃到加速道具，衝刺這幾拍的速度都一樣，不會疊加更快。
 */
export const SNAKE_DASH_STEPS = 4;

/** 衝刺技能的冷卻時間，從按下 X 那一刻開始算，不是從衝刺結束算。 */
export const SNAKE_DASH_COOLDOWN_MS = 15_000;

/** 衝刺頭上顯示的設定，跟道具共用同一個顯示介面。 */
export const SNAKE_DASH_DISPLAY: SnakeAbilityDisplay = {
  icon: '⚔',
  showChargeCountdown: true,
  showDurationCountdown: false,
};

/** 加速／反轉／護盾的持續時間。 */
export const SNAKE_ITEM_DURATION_MS = 10_000;

/** 磁鐵吸果實的持續時間（比較短，不然太強）。 */
export const SNAKE_MAGNET_DURATION_MS = 8_000;

/** 撿到一次子彈道具，拿到這麼多發，之後每按一次空白鍵射一發，用完道具欄那格才清空。 */
export const SNAKE_BULLET_AMMO = 3;

/** 子彈每拍飛幾格，比蛇本身的一般速度快兩倍。 */
export const SNAKE_BULLET_SPEED = 2;

/** 子彈飛超過這個格數還沒打中人／出界，就直接消失（避免穿牆模式下無限飛下去）。 */
export const SNAKE_BULLET_MAX_TRAVEL = 200;

/** 場上一個道具點：哪一格、是哪種道具。 */
export interface SnakeItemPickupView {
  cell: SnakeCell;
  kind: SnakeItemKind;
}

/** 飛行中的子彈：可以看得到的位置＋方向，前端照這個畫一顆會動的子彈。 */
export interface SnakeBulletView {
  cell: SnakeCell;
  dir: SnakeDirection;
}

/** 道具欄裡的一格：子彈另外帶剩餘發數，其他道具用不到這個欄位。 */
export interface SnakeInventorySlot {
  kind: SnakeItemKind;
  ammo?: number;
}

/** 死掉之後在重生點原地閃爍這麼久（幽靈狀態，不參與碰撞），時間到才正式復活開始動。 */
export const SNAKE_RESPAWN_MS = 3_000;

/** 地雷果實生成後的預警閃爍時間：這段時間內誰都吃不到、也不會被害死。 */
export const SNAKE_MINE_TELEGRAPH_MS = 2_000;

/** 地雷果實過了預警之後，真正生效可以互動的時間；沒人動它就自然消失。比一般果實的存在時間長一倍，撿的機會多一點。 */
export const SNAKE_MINE_LIVE_MS = 10_000;

/** 地雷果實消失（不管是被吃掉、害死人、還是自然過期）之後，等這麼久才會生出下一顆。 */
export const SNAKE_MINE_GAP_MS = 5_000;

/** 吃一顆一般果實拿到的分數。 */
export const SNAKE_FOOD_SCORE = 4;

/** 吃一顆一般果實身體變長幾節（不是只長 1 節，會分好幾拍慢慢長完）。 */
export const SNAKE_FOOD_GROWTH = 4;

/** 吃一顆屍體掉落果實拿到的分數（只加 1 分）。 */
export const SNAKE_CORPSE_FOOD_SCORE = 1;

/** 吃一顆屍體掉落果實身體變長幾節（只長 1 節）。 */
export const SNAKE_CORPSE_FOOD_GROWTH = 1;

/** 本人吃到自己顏色的地雷果實，一次拿到這麼多分。 */
export const SNAKE_MINE_BONUS_SCORE = 10;

/** 本人吃到自己顏色的地雷果實，身體變長幾節——比一般果實誘因大得多。 */
export const SNAKE_MINE_GROWTH = 10;

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
  /** 道具欄，最多 SNAKE_ITEM_SLOTS 格；只有開 items 選項的房間才會有內容。 */
  inventory: SnakeInventorySlot[];
  /** 加速結束時間戳；null 代表沒加速。跟其餘 *Until 一樣，前端拿來算頭上倒數還剩幾秒。 */
  speedUntil: number | null;
  /** 護盾結束時間戳；null 代表沒有護盾。 */
  shieldUntil: number | null;
  /** 被反轉結束時間戳；null 代表沒被反轉。 */
  reversedUntil: number | null;
  /** 磁鐵結束時間戳；null 代表沒開磁鐵。 */
  magnetUntil: number | null;
  /** 衝刺充能中（原地凍結）：還沒開始位移，這個時間點之後才會開始衝刺。null 表示沒在充能。 */
  dashChargeUntil: number | null;
  /** 衝刺位移中（鎖定方向前進的那 3 拍）。 */
  dashActive: boolean;
  /** 冷卻結束時間，這個時間點之後才能再按 X。null 表示沒有冷卻中（含房間根本沒開截斷選項）。 */
  dashCooldownUntil: number | null;
}

/** 用掉但還在延遲期、還沒真的生效的道具效果——給還沒被影響到的人一個「即將發生」的預警。 */
export interface SnakePendingEffectView {
  kind: SnakeItemKind;
  actorSeat: number;
  applyAt: number;
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
  /** 蛇死亡或被截斷時，身體隔一節掉落的屍體果實；吃到只加 1 分、長 1 節，顏色與一般果實不同。 */
  corpseFood: SnakeCell[];
  /** 場上同時只有一顆，沒有生成中（空窗期）時為 null。 */
  mine: SnakeMineView | null;
  /** 場上的道具點；沒開 items 選項的房間恆為空陣列。 */
  items: SnakeItemPickupView[];
  /** 飛行中的子彈；沒開 items 選項恆為空陣列。 */
  bullets: SnakeBulletView[];
  /** 用掉但還在延遲期的道具效果（目前只有反轉會延遲）；沒開 items 選項恆為空陣列。 */
  pendingEffects: SnakePendingEffectView[];
  /** seat → 該座位的蛇。座位空著或還沒發蛇時沒有這個 key。 */
  seats: Record<number, SnakeSeatInfo>;
  /** 依分數由高到低排；只有 over 時才有值。 */
  ranking: PlayerId[];
}
