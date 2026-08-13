import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  SEAT_LIMITS,
  SNAKE_DASH_COOLDOWN_MS,
  SNAKE_DASH_DISPLAY,
  SNAKE_ITEM_CONFIG,
  SNAKE_ITEM_DURATION_MS,
  SNAKE_ITEM_LABEL,
  SNAKE_MAGNET_DURATION_MS,
  type RoomView,
  type SnakeDirection,
  type SnakeGameView,
  type SnakeItemKind,
  type SnakeSeatInfo,
} from 'shared';
import { SNAKE_SEAT_COLORS, SnakeColorDot } from '../components/SnakeColorDot';
import { StartControls } from '../components/StartControls';
import { useCountdown } from '../hooks/useCountdown';
import { useCoarsePointer } from '../hooks/useMediaQuery';
import { emitWithAck } from '../net/socket';
import { useGame } from '../state/GameProvider';
import { isTyping, useSkin } from '../state/skinContext';
import type { TextKey } from '../skins/text';
import { RoomShell } from './RoomShell';

/** 方向鍵與 WASD 都吃，用 event.code 判斷才不受輸入法/大小寫影響。 */
const KEY_TO_DIR: Record<string, SnakeDirection> = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
};

/** 頭朝哪個方向就用哪個箭頭——頭尾一眼分清楚，順便當方向指示。 */
const HEAD_ARROW: Record<SnakeDirection, string> = {
  up: '▲',
  down: '▼',
  left: '◀',
  right: '▶',
};

/** 道具在棋盤上的符號，跟果實（◆）、地雷（✦）明顯不同形狀。 */
const ITEM_GLYPH: Record<SnakeItemKind, string> = {
  speed: '»',
  reverse: '⇄',
  shield: '◈',
  bullet: '●',
  magnet: '⊛',
};

/** 飛行中子彈的符號，用細箭頭跟蛇頭的粗箭頭（▲▼◀▶）明顯區分。 */
const BULLET_ARROW: Record<SnakeDirection, string> = {
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
};

/** 衝刺技能目前狀態：沒開這個房間選項就是 unavailable；有開才分可用／充能中／衝刺中／冷卻中。 */
type DashState = 'normal' | 'charging' | 'dashing';

type Cell =
  | { kind: 'empty' }
  | { kind: 'food' }
  | { kind: 'corpseFood' }
  | { kind: 'body'; seat: number; head: boolean; dir: SnakeDirection; dashState: DashState }
  /** 重生閃爍中的幽靈：完整 3 節都畫出來（不算真的身體，別的蛇可以直接穿過），才看得出頭在哪、準備往哪走。 */
  | { kind: 'ghost'; seat: number; head: boolean; dir: SnakeDirection }
  /** 地雷果實：本人吃到加分，別人碰到扣一條命；預警階段誰都吃不到、也害不死人。 */
  | { kind: 'mine'; seat: number; warning: boolean }
  /** 道具點：撿到放進道具欄，空白鍵使用。 */
  | { kind: 'pickup'; item: SnakeItemKind }
  /** 飛行中的子彈：比蛇快兩倍，撞到身體就截斷。 */
  | { kind: 'bullet'; dir: SnakeDirection };

/** 把伺服器的座標列表攤成一張格子陣列，index = y * width + x，畫格子時照順序輸出就好。 */
function buildGrid(game: SnakeGameView): Cell[] {
  const grid: Cell[] = Array.from({ length: game.width * game.height }, () => ({ kind: 'empty' }));
  const inBounds = (x: number, y: number) => x >= 0 && x < game.width && y >= 0 && y < game.height;

  for (const food of game.food) {
    if (inBounds(food.x, food.y)) grid[food.y * game.width + food.x] = { kind: 'food' };
  }
  for (const food of game.corpseFood) {
    if (inBounds(food.x, food.y)) grid[food.y * game.width + food.x] = { kind: 'corpseFood' };
  }
  for (const item of game.items) {
    if (inBounds(item.cell.x, item.cell.y)) {
      grid[item.cell.y * game.width + item.cell.x] = { kind: 'pickup', item: item.kind };
    }
  }
  if (game.mine && inBounds(game.mine.cell.x, game.mine.cell.y)) {
    grid[game.mine.cell.y * game.width + game.mine.cell.x] = {
      kind: 'mine',
      seat: game.mine.seat,
      warning: game.mine.warning,
    };
  }
  for (const [seatKey, info] of Object.entries(game.seats)) {
    const seat = Number(seatKey);
    if (info.respawning) {
      info.body.forEach((cell, index) => {
        if (inBounds(cell.x, cell.y)) {
          grid[cell.y * game.width + cell.x] = { kind: 'ghost', seat, head: index === 0, dir: info.dir };
        }
      });
      continue;
    }
    const dashState: DashState = info.dashChargeUntil !== null ? 'charging' : info.dashActive ? 'dashing' : 'normal';
    info.body.forEach((cell, index) => {
      if (inBounds(cell.x, cell.y)) {
        grid[cell.y * game.width + cell.x] = { kind: 'body', seat, head: index === 0, dir: info.dir, dashState };
      }
    });
  }
  // 子彈疊在最上層畫，飛過蛇身或道具的那一拍看得到子彈本身，比較符合「看得到子彈飛」的訴求
  for (const bullet of game.bullets) {
    if (inBounds(bullet.cell.x, bullet.cell.y)) {
      grid[bullet.cell.y * game.width + bullet.cell.x] = { kind: 'bullet', dir: bullet.dir };
    }
  }
  return grid;
}

function cellGlyph(cell: Cell): string {
  switch (cell.kind) {
    case 'empty':
      return '·';
    case 'food':
      return '◆';
    case 'corpseFood':
      return '◇';
    case 'body':
      return cell.head ? HEAD_ARROW[cell.dir] : '■';
    case 'ghost':
      return cell.head ? HEAD_ARROW[cell.dir] : '◇';
    case 'mine':
      return '✦';
    case 'pickup':
      return ITEM_GLYPH[cell.item];
    case 'bullet':
      return BULLET_ARROW[cell.dir];
  }
}

function cellClassName(cell: Cell): string {
  switch (cell.kind) {
    case 'empty':
      return 'snake-cell snake-cell--empty';
    case 'food':
      return 'snake-cell snake-cell--food';
    case 'corpseFood':
      return 'snake-cell snake-cell--corpse-food';
    case 'body':
      return [
        'snake-cell',
        'snake-cell--body',
        `snake-cell--seat${cell.seat % SNAKE_SEAT_COLORS}`,
        cell.head ? 'snake-cell--head' : '',
        cell.dashState === 'charging' ? 'snake-cell--dash-charging' : '',
        cell.dashState === 'dashing' ? 'snake-cell--dash-dashing' : '',
      ]
        .filter(Boolean)
        .join(' ');
    case 'ghost':
      return [
        'snake-cell',
        'snake-cell--ghost',
        `snake-cell--seat${cell.seat % SNAKE_SEAT_COLORS}`,
        cell.head ? 'snake-cell--head' : '',
      ]
        .filter(Boolean)
        .join(' ');
    case 'mine':
      return [
        'snake-cell',
        'snake-cell--mine',
        `snake-cell--seat${cell.seat % SNAKE_SEAT_COLORS}`,
        cell.warning ? 'snake-cell--mine-warning' : 'snake-cell--mine-live',
      ].join(' ');
    case 'pickup':
      return 'snake-cell snake-cell--pickup';
    case 'bullet':
      return 'snake-cell snake-cell--bullet';
  }
}

interface AbilityBadge {
  icon: string;
  /** 秒數字串，例如 "1.2s"；空字串代表沒有倒數可顯示（單純圖示，例如衝刺位移中）。 */
  text: string;
}

/**
 * 頭上要顯示哪些技能圖示、要不要帶倒數，全部照 SNAKE_ITEM_CONFIG / SNAKE_DASH_DISPLAY 這兩張表決定，
 * 這裡完全不寫死任何道具邏輯——之後新增/調整技能只要改那兩張表，這個函式不用動。
 */
function abilityBadges(game: SnakeGameView, seat: number, info: SnakeSeatInfo, now: number): AbilityBadge[] {
  const badges: AbilityBadge[] = [];

  // 別人對這個座位用的延遲道具，還沒生效前的預警倒數（目前只有反轉：影響除了施放者以外的所有人）
  for (const pending of game.pendingEffects) {
    if (pending.actorSeat === seat) continue;
    const display = SNAKE_ITEM_CONFIG[pending.kind].display;
    if (!display.showChargeCountdown) continue;
    const remain = Math.max(0, (pending.applyAt - now) / 1000);
    badges.push({ icon: display.icon, text: `${remain.toFixed(1)}s` });
  }

  if (info.dashChargeUntil !== null) {
    const remain = Math.max(0, (info.dashChargeUntil - now) / 1000);
    if (SNAKE_DASH_DISPLAY.showChargeCountdown) badges.push({ icon: SNAKE_DASH_DISPLAY.icon, text: `${remain.toFixed(1)}s` });
  } else if (info.dashActive) {
    badges.push({ icon: SNAKE_DASH_DISPLAY.icon, text: '' });
  }

  const durations: Array<{ kind: SnakeItemKind; until: number | null }> = [
    { kind: 'speed', until: info.speedUntil },
    { kind: 'shield', until: info.shieldUntil },
    { kind: 'reverse', until: info.reversedUntil },
    { kind: 'magnet', until: info.magnetUntil },
  ];
  for (const { kind, until } of durations) {
    if (until === null || until <= now) continue;
    const display = SNAKE_ITEM_CONFIG[kind].display;
    if (!display.showDurationCountdown) continue;
    const remain = Math.max(0, (until - now) / 1000);
    badges.push({ icon: display.icon, text: `${Math.ceil(remain)}s` });
  }

  return badges;
}

/** 每條活著（含重生閃爍中）的蛇的頭部座標＋頭上要顯示的技能標籤，畫名牌跟道具欄浮動 HUD 用。 */
function headPositions(
  game: SnakeGameView,
  now: number,
): Array<{ seat: number; x: number; y: number; badges: AbilityBadge[] }> {
  const positions: Array<{ seat: number; x: number; y: number; badges: AbilityBadge[] }> = [];
  for (const [seatKey, info] of Object.entries(game.seats)) {
    const head = info.body[0];
    if (!head) continue;
    const seat = Number(seatKey);
    positions.push({ seat, x: head.x, y: head.y, badges: abilityBadges(game, seat, info, now) });
  }
  return positions;
}

/** 衝刺技能的獨立 HUD——放在棋盤正上方，比行內膠囊更搶眼。 */
function DashHUD({ mySnake, t }: { mySnake: SnakeSeatInfo; t: (key: TextKey, vars?: Record<string, string | number>) => string }) {
  // 用 requestAnimationFrame 讓進度條即時更新，不受 tick 廣播頻率影響
  const [now, setNow] = useState(() => Date.now());
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    const tick = () => {
      setNow(Date.now());
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, []);

  const inCooldown = mySnake.dashCooldownUntil !== null && mySnake.dashCooldownUntil > now;
  const inCharging = mySnake.dashChargeUntil !== null;
  const inDashing  = mySnake.dashActive;

  let phase: 'ready' | 'charging' | 'dashing' | 'cooldown';
  let label: string;
  let progress = 1; // 0~1，進度條填滿比例

  if (inCharging) {
    phase = 'charging';
    const remain = Math.max(0, mySnake.dashChargeUntil! - now);
    label = `⚔ ${t('snake.dashCharging')} ${(remain / 1000).toFixed(1)}s`;
    progress = 1 - remain / 500; // SNAKE_DASH_CHARGE_MS = 500
  } else if (inDashing) {
    phase = 'dashing';
    label = `⚔ ${t('snake.dashActive')}`;
    progress = 1;
  } else if (inCooldown) {
    phase = 'cooldown';
    const remain = Math.max(0, mySnake.dashCooldownUntil! - now);
    const secs = Math.ceil(remain / 1000);
    label = `⚔ ${t('snake.dashCooldown')} ${secs}s`;
    progress = 1 - remain / SNAKE_DASH_COOLDOWN_MS;
  } else {
    phase = 'ready';
    label = `⚔ ${t('snake.dashReady')} [X]`;
    progress = 1;
  }

  return (
    <div className={`dash-hud dash-hud--${phase}`}>
      <div className="dash-hud__bar-wrap">
        <div className="dash-hud__bar" style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%` }} />
      </div>
      <span className="dash-hud__label">{label}</span>
    </div>
  );
}

/** 道具 HUD：棋盤正上方，放大版道具欄 + 生效中效果的進度條。 */
function ItemHUD({
  mySnake,
  mySeat,
}: {
  mySnake: SnakeSeatInfo;
  mySeat: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    const tick = () => { setNow(Date.now()); rafRef.current = requestAnimationFrame(tick); };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, []);

  // 生效中的道具效果，每種有各自的持續時間和顏色
  const EFFECT_COLORS: Record<SnakeItemKind, string> = {
    speed:   '#facc15',
    shield:  '#60a5fa',
    reverse: '#f472b6',
    bullet:  '#f97316',
    magnet:  '#34d399',
  };
  const EFFECT_TOTAL: Record<SnakeItemKind, number> = {
    speed:   SNAKE_ITEM_DURATION_MS,
    shield:  SNAKE_ITEM_DURATION_MS,
    reverse: SNAKE_ITEM_DURATION_MS,
    bullet:  SNAKE_ITEM_DURATION_MS,
    magnet:  SNAKE_MAGNET_DURATION_MS,
  };
  const activeEffects: Array<{ kind: SnakeItemKind; until: number }> = (
    [
      { kind: 'speed'   as SnakeItemKind, until: mySnake.speedUntil ?? 0 },
      { kind: 'shield'  as SnakeItemKind, until: mySnake.shieldUntil ?? 0 },
      { kind: 'reverse' as SnakeItemKind, until: mySnake.reversedUntil ?? 0 },
      { kind: 'magnet'  as SnakeItemKind, until: mySnake.magnetUntil ?? 0 },
    ] as Array<{ kind: SnakeItemKind; until: number }>
  ).filter(({ until }) => until > now);

  const hasInventory = mySnake.inventory.length > 0;

  if (!hasInventory && activeEffects.length === 0) return null;

  return (
    <div className="item-hud">
      {/* 道具欄放大版 */}
      {hasInventory && (
        <div className="item-hud__slots">
          {Array.from({ length: 2 }, (_, i) => mySnake.inventory[i]).map((slot, i) => (
            <div
              key={i}
              className={`item-hud__slot${slot ? ` item-hud__slot--${slot.kind}` : ' item-hud__slot--empty'}${i === 0 ? ' item-hud__slot--active' : ''}`}
            >
              <span className="item-hud__glyph">{slot ? SNAKE_ITEM_CONFIG[slot.kind].display.icon : '·'}</span>
              <span className="item-hud__name">{slot ? SNAKE_ITEM_LABEL[slot.kind] : ''}</span>
              {slot?.ammo !== undefined && <span className="item-hud__ammo">×{slot.ammo}</span>}
              {i === 0 && slot && <span className="item-hud__hint">[空白]</span>}
            </div>
          ))}
        </div>
      )}
      {/* 生效中的效果進度條 */}
      {activeEffects.length > 0 && (
        <div className="item-hud__effects">
          {activeEffects.map(({ kind, until }) => {
            const remain = Math.max(0, until - now);
            const total = EFFECT_TOTAL[kind];
            const progress = remain / total;
            const secs = Math.ceil(remain / 1000);
            const color = EFFECT_COLORS[kind];
            return (
              <div key={kind} className="item-hud__effect">
                <span className="item-hud__effect-icon" style={{ color }}>
                  {SNAKE_ITEM_CONFIG[kind].display.icon}
                </span>
                <div className="item-hud__effect-bar-wrap">
                  <div
                    className="item-hud__effect-bar"
                    style={{ width: `${progress * 100}%`, background: color, boxShadow: `0 0 6px ${color}` }}
                  />
                </div>
                <span className="item-hud__effect-secs" style={{ color }}>{secs}s</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 其他人使用道具或衝刺時彈出的短暫通知。 */
function ItemToast({ roomMessages, myPlayerId }: { roomMessages: import('shared').ChatMessage[]; myPlayerId: string }) {
  const { skin } = useSkin();
  // 只看最新一條有 notice 且跟蛇道具/衝刺相關的系統訊息
  const latest = useMemo(() => {
    for (let i = roomMessages.length - 1; i >= 0; i--) {
      const msg = roomMessages[i]!;
      if (!msg.notice) continue;
      if (msg.notice.t === 'snakeItem' || msg.notice.t === 'snakeDash') return msg;
    }
    return null;
  }, [roomMessages]);

  const [visible, setVisible] = useState(false);
  const [displayMsg, setDisplayMsg] = useState<typeof latest>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!latest) return;
    setDisplayMsg(latest);
    setVisible(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), 2800);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [latest?.id]);

  if (!displayMsg || !displayMsg.notice) return null;

  const isSnakeItem = displayMsg.notice.t === 'snakeItem';
  const kind: SnakeItemKind | null = isSnakeItem && displayMsg.notice.t === 'snakeItem' ? displayMsg.notice.item : null;
  const TOAST_COLORS: Record<SnakeItemKind, string> = {
    speed: '#facc15', shield: '#60a5fa', reverse: '#f472b6',
    bullet: '#f97316', magnet: '#34d399',
  };
  const color = kind ? TOAST_COLORS[kind] : '#60a5fa';

  return (
    <div className={`item-toast${visible ? ' item-toast--visible' : ''}`} style={{ borderColor: color, color }}>
      <span className="item-toast__icon">{kind ? SNAKE_ITEM_CONFIG[kind].display.icon : '⚔'}</span>
      <span className="item-toast__text">{skin.notice(displayMsg.notice)}</span>
    </div>
  );
}

/** 觸控裝置沒有鍵盤：方向鍵改成畫面上的九宮格搖桿，空白鍵／X 鍵改成旁邊兩顆技能鈕。 */
function SnakePad({
  canAct,
  itemsEnabled,
  cuttingEnabled,
  onDir,
  onItem,
  onDash,
  t,
}: {
  canAct: boolean;
  itemsEnabled: boolean;
  cuttingEnabled: boolean;
  onDir: (dir: SnakeDirection) => void;
  onItem: () => void;
  onDash: () => void;
  t: (key: TextKey, vars?: Record<string, string | number>) => string;
}) {
  // 用 pointerdown 而不是 click：手指按下去就送出，不必等 300ms 的點擊判定，
  // 抓住 pointer 也才不會手指滑到隔壁鍵時又觸發第二個方向。
  const press = (fire: () => void) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    if ('vibrate' in navigator) navigator.vibrate(10);
    fire();
  };
  const release = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const dirButton = (dir: SnakeDirection, key: TextKey) => (
    <button
      type="button"
      className={`btn snake-pad__btn snake-pad__btn--${dir}`}
      disabled={!canAct}
      aria-label={t(key)}
      onPointerDown={press(() => onDir(dir))}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      <span aria-hidden="true">{HEAD_ARROW[dir]}</span>
    </button>
  );

  return (
    <div className="snake-pad">
      <div className="snake-pad__dpad">
        {dirButton('up', 'snake.padUp')}
        {dirButton('left', 'snake.padLeft')}
        {dirButton('right', 'snake.padRight')}
        {dirButton('down', 'snake.padDown')}
      </div>
      <div className="snake-pad__skills">
        {itemsEnabled && (
          <button
            type="button"
            className="btn snake-pad__skill"
            disabled={!canAct}
            onPointerDown={press(onItem)}
            onPointerUp={release}
            onPointerCancel={release}
            onLostPointerCapture={release}
          >
            {t('snake.padItem')}
          </button>
        )}
        {cuttingEnabled && (
          <button
            type="button"
            className="btn snake-pad__skill"
            disabled={!canAct}
            onPointerDown={press(onDash)}
            onPointerUp={release}
            onPointerCancel={release}
            onLostPointerCapture={release}
          >
            {t('snake.padDash')}
          </button>
        )}
      </div>
    </div>
  );
}

export function SnakeRoom({ room }: { room: RoomView }) {
  const { run, roomMessages } = useGame();
  const { t } = useSkin();
  const coarsePointer = useCoarsePointer();

  const game = room.game?.type === 'snake' ? room.game : null;
  const me = room.me;
  const isSpectator = me.mode === 'spectate';
  const playing = room.status === 'playing';
  const isHost = room.hostId === me.playerId;
  const itemsEnabled = room.snakeOptions?.items ?? false;

  const mySeat = room.seats.find((seat) => seat.playerId === me.playerId)?.seat;
  const mySnake = game && mySeat !== undefined ? game.seats[mySeat] : undefined;
  const canAct = playing && !isSpectator && Boolean(mySnake?.alive) && !mySnake?.respawning;

  // 開局後 3 秒倒數：turnDeadline 借用既有的回合倒數欄位扛這個，倒數結束後歸零
  const remainingMs = useCountdown(playing ? (game?.turnDeadline ?? 0) : 0);
  const countingDown = remainingMs > 0;

  // 鍵盤與觸控搖桿送的是同一批意圖，統一走這三個 helper，兩條路徑不會各寫一份
  const emitDir = useCallback((dir: SnakeDirection) => run(() => emitWithAck('game:snake', { dir })), [run]);
  const emitItem = useCallback(() => run(() => emitWithAck('game:snakeItem', {})), [run]);
  const emitDash = useCallback(() => run(() => emitWithAck('game:snakeDash', {})), [run]);

  // 按鍵只送方向意圖或道具使用意圖，真正的移動與碰撞判定都在下一拍才發生
  useEffect(() => {
    if (!canAct) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return; // 長按只送一次，剩下的重複事件不必再打去伺服器
      if (isTyping(event.target)) return; // 焦點在聊天框裡就不吃方向鍵/空白鍵
      if (event.code === 'Space') {
        event.preventDefault();
        emitItem();
        return;
      }
      if (event.code === 'KeyX') {
        event.preventDefault();
        emitDash();
        return;
      }
      const dir = KEY_TO_DIR[event.code];
      if (!dir) return;
      event.preventDefault();
      emitDir(dir);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canAct, emitDir, emitItem, emitDash]);

  const grid = useMemo(() => (game ? buildGrid(game) : null), [game]);
  const heads = useMemo(() => (game ? headPositions(game, Date.now()) : []), [game]);
  const cuttingEnabled = room.snakeOptions?.cutting ?? false;

  const center = (
    <>
      {!playing && room.status !== 'finished' && (
        <div className="table__idle">
          <p>{t('snake.idleTitle')}</p>
          <p className="muted">
            {t('snake.idleHint', {
              n: room.seats.length,
              max: room.maxPlayers,
              min: SEAT_LIMITS.snake.min,
            })}
          </p>
        </div>
      )}

      {playing && game && grid && (
        <>
          {mySeat !== undefined && (
            <p className="snake-my-color">
              <SnakeColorDot seat={mySeat} /> {t('snake.yourColor')}
            </p>
          )}
          {cuttingEnabled && mySnake && !isSpectator && (
            <DashHUD mySnake={mySnake} t={t} />
          )}
          {itemsEnabled && mySnake && !isSpectator && (
            <ItemHUD mySnake={mySnake} mySeat={mySeat ?? 0} />
          )}
          {countingDown && (
            <p className="snake-countdown">
              {t('snake.startingIn', { n: Math.ceil(remainingMs / 1000) })}
            </p>
          )}
          {/* --snake-cols 給 CSS 算窄螢幕的格子大小用：一般地圖 20、大地圖 40 */}
          <div
            className="snake-board-wrap"
            style={{ '--snake-cols': game.width } as CSSProperties}
          >
            <div className="snake-board" style={{ gridTemplateColumns: `repeat(${game.width}, 1fr)` }}>
              {grid.map((cell, index) => (
                <span key={index} className={cellClassName(cell)}>
                  {cellGlyph(cell)}
                </span>
              ))}
            </div>
            {/* 其他人使用道具/衝刺的全域浮出通知 */}
            <ItemToast roomMessages={roomMessages} myPlayerId={me.playerId} />
            {/* 浮動覆蓋層：名牌跟自己的道具欄，用百分比座標疊在棋盤上，不佔用格子本身的空間 */}
            <div className="snake-overlay">
              {heads.map(({ seat, x, y, badges }) => {
                const nickname = room.seats.find((s) => s.seat === seat)?.nickname ?? '';
                const left = `${((x + 0.5) / game.width) * 100}%`;
                const top = `${((y + 0.5) / game.height) * 100}%`;
                return (
                  <span key={seat} className="snake-head-tag" style={{ left, top }}>
                    {badges.length > 0 && (
                      <span className="snake-skill-badges">
                        {badges.map((badge, i) => (
                          <span key={i} className="snake-skill-badge">
                            {badge.icon}
                            {badge.text}
                          </span>
                        ))}
                      </span>
                    )}
                    <span className={`snake-name-tag snake-cell--seat${seat % SNAKE_SEAT_COLORS}`}>{nickname}</span>
                  </span>
                );
              })}
              {mySeat !== undefined &&
                mySnake &&
                mySnake.body[0] &&
                itemsEnabled && (
                  <div
                    className="snake-inventory"
                    style={{
                      left: `${((mySnake.body[0].x + 0.5) / game.width) * 100}%`,
                      top: `${((mySnake.body[0].y + 0.5) / game.height) * 100}%`,
                    }}
                  >
                    {Array.from({ length: 2 }, (_, i) => mySnake.inventory[i]).map((slot, i) => (
                      <span key={i} className={`snake-inventory__slot${slot ? '' : ' snake-inventory__slot--empty'}`}>
                        {slot ? ITEM_GLYPH[slot.kind] : '·'}
                        {slot?.ammo !== undefined ? slot.ammo : ''}
                      </span>
                    ))}
                  </div>
                )}
            </div>
          </div>
        </>
      )}

      {room.status === 'finished' && game && (
        <div className="table__result">
          <h2>{t('snake.resultTitle')}</h2>
          <ol>
            {game.ranking.map((playerId) => (
              <li key={playerId}>
                {room.seats.find((s) => s.playerId === playerId)?.nickname ?? t('seat.left')}
                {' — '}
                {(() => {
                  const seatInfo = game.seats[room.seats.find((s) => s.playerId === playerId)?.seat ?? -1];
                  const total = (seatInfo?.score ?? 0) + (seatInfo?.body.length ?? 0);
                  return t('snake.score', { n: total });
                })()}
              </li>
            ))}
          </ol>
          {isHost ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => run(() => emitWithAck('game:start', {}))}
            >
              {t('snake.playAgain')}
            </button>
          ) : (
            <p className="muted">{t('snake.waitHost')}</p>
          )}
        </div>
      )}
    </>
  );

  const footer = !playing ? (
    <div className="room__controls">
      <StartControls room={room} />
    </div>
  ) : coarsePointer ? (
    // 手指裝置：提示文字講的是鍵盤，換成真的按得到的搖桿
    <SnakePad
      canAct={canAct}
      itemsEnabled={itemsEnabled}
      cuttingEnabled={cuttingEnabled}
      onDir={emitDir}
      onItem={emitItem}
      onDash={emitDash}
      t={t}
    />
  ) : (
    <p className="muted">
      {t('snake.controlsHint')}
      {itemsEnabled ? ` · ${t('snake.useItemHint')}` : ''}
      {cuttingEnabled ? ` · ${t('snake.dashHint')}` : ''}
    </p>
  );

  return (
    <RoomShell room={room} center={center} footer={isSpectator ? null : footer} isMyTurn={false} />
  );
}
