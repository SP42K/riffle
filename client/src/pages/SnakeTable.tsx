import { useEffect, useMemo } from 'react';
import { SEAT_LIMITS, type RoomView, type SnakeDirection, type SnakeGameView } from 'shared';
import { SnakeColorDot } from '../components/SnakeColorDot';
import { StartControls } from '../components/StartControls';
import { useCountdown } from '../hooks/useCountdown';
import { emitWithAck } from '../net/socket';
import { useGame } from '../state/GameProvider';
import { isTyping, useSkin } from '../state/skinContext';
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

type Cell =
  | { kind: 'empty' }
  | { kind: 'food' }
  | { kind: 'body'; seat: number; head: boolean; dir: SnakeDirection }
  /** 重生閃爍中的幽靈：完整 3 節都畫出來（不算真的身體，別的蛇可以直接穿過），才看得出頭在哪、準備往哪走。 */
  | { kind: 'ghost'; seat: number; head: boolean; dir: SnakeDirection }
  /** 地雷果實：本人吃到加分，別人碰到扣一條命；預警階段誰都吃不到、也害不死人。 */
  | { kind: 'mine'; seat: number; warning: boolean };

/** 把伺服器的座標列表攤成一張格子陣列，index = y * width + x，畫格子時照順序輸出就好。 */
function buildGrid(game: SnakeGameView): Cell[] {
  const grid: Cell[] = Array.from({ length: game.width * game.height }, () => ({ kind: 'empty' }));
  const inBounds = (x: number, y: number) => x >= 0 && x < game.width && y >= 0 && y < game.height;

  for (const food of game.food) {
    if (inBounds(food.x, food.y)) grid[food.y * game.width + food.x] = { kind: 'food' };
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
    const kind = info.respawning ? 'ghost' : 'body';
    info.body.forEach((cell, index) => {
      if (inBounds(cell.x, cell.y)) {
        grid[cell.y * game.width + cell.x] = { kind, seat, head: index === 0, dir: info.dir };
      }
    });
  }
  return grid;
}

function cellGlyph(cell: Cell): string {
  switch (cell.kind) {
    case 'empty':
      return '·';
    case 'food':
      return '◆';
    case 'body':
      return cell.head ? HEAD_ARROW[cell.dir] : '■';
    case 'ghost':
      return cell.head ? HEAD_ARROW[cell.dir] : '◇';
    case 'mine':
      return '✦';
  }
}

function cellClassName(cell: Cell): string {
  switch (cell.kind) {
    case 'empty':
      return 'snake-cell snake-cell--empty';
    case 'food':
      return 'snake-cell snake-cell--food';
    case 'body':
      return [
        'snake-cell',
        'snake-cell--body',
        `snake-cell--seat${cell.seat % 4}`,
        cell.head ? 'snake-cell--head' : '',
      ]
        .filter(Boolean)
        .join(' ');
    case 'ghost':
      return [
        'snake-cell',
        'snake-cell--ghost',
        `snake-cell--seat${cell.seat % 4}`,
        cell.head ? 'snake-cell--head' : '',
      ]
        .filter(Boolean)
        .join(' ');
    case 'mine':
      return [
        'snake-cell',
        'snake-cell--mine',
        `snake-cell--seat${cell.seat % 4}`,
        cell.warning ? 'snake-cell--mine-warning' : 'snake-cell--mine-live',
      ].join(' ');
  }
}

export function SnakeRoom({ room }: { room: RoomView }) {
  const { run } = useGame();
  const { t } = useSkin();

  const game = room.game?.type === 'snake' ? room.game : null;
  const me = room.me;
  const isSpectator = me.mode === 'spectate';
  const playing = room.status === 'playing';
  const isHost = room.hostId === me.playerId;

  const mySeat = room.seats.find((seat) => seat.playerId === me.playerId)?.seat;
  const mySnake = game && mySeat !== undefined ? game.seats[mySeat] : undefined;
  const canSteer = playing && !isSpectator && Boolean(mySnake?.alive) && !mySnake?.respawning;

  // 開局後 3 秒倒數：turnDeadline 借用既有的回合倒數欄位扛這個，倒數結束後歸零
  const remainingMs = useCountdown(playing ? (game?.turnDeadline ?? 0) : 0);
  const countingDown = remainingMs > 0;

  // 按鍵只送方向意圖，真正的移動與碰撞判定都在下一拍才發生
  useEffect(() => {
    if (!canSteer) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return; // 長按只送一次，剩下的重複事件不必再打去伺服器
      if (isTyping(event.target)) return; // 焦點在聊天框裡就不吃方向鍵，WASD 要打得出字
      const dir = KEY_TO_DIR[event.code];
      if (!dir) return;
      event.preventDefault();
      run(() => emitWithAck('game:snake', { dir }));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canSteer, run]);

  const grid = useMemo(() => (game ? buildGrid(game) : null), [game]);

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
          {countingDown && (
            <p className="snake-countdown">
              {t('snake.startingIn', { n: Math.ceil(remainingMs / 1000) })}
            </p>
          )}
          <div className="snake-board" style={{ gridTemplateColumns: `repeat(${game.width}, 1fr)` }}>
            {grid.map((cell, index) => (
              <span key={index} className={cellClassName(cell)}>
                {cellGlyph(cell)}
              </span>
            ))}
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
                {t('snake.score', { n: game.seats[room.seats.find((s) => s.playerId === playerId)?.seat ?? -1]?.score ?? 0 })}
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
  ) : (
    <p className="muted">{t('snake.controlsHint')}</p>
  );

  return (
    <RoomShell room={room} center={center} footer={isSpectator ? null : footer} isMyTurn={false} />
  );
}
