import { SEAT_LIMITS, type GameType, type RoomView } from 'shared';
import { emitWithAck, socket } from '../net/socket';
import { useGame } from '../state/GameProvider';
import { useSkin } from '../state/skinContext';
import type { TextKey } from '../skins/text';

/** 開始鈕的文案。用 Record 而不是三元 —— 新玩法漏了會編譯失敗。 */
const START_LABEL_KEY: Record<GameType, TextKey> = {
  bigTwo: 'start.startBigTwo',
  holdem: 'start.startHoldem',
  monopoly: 'start.startMonopoly',
  snake: 'start.startSnake',
};

/** 開局前的準備 / 開始遊戲，兩種玩法共用。 */
export function StartControls({ room }: { room: RoomView }) {
  const { run } = useGame();
  const { t } = useSkin();
  const me = room.me;
  const mySeat = room.seats.find((seat) => seat.playerId === me.playerId);
  const isHost = room.hostId === me.playerId;
  const min = SEAT_LIMITS[room.gameType].min;
  const everyoneReady = room.seats.every((seat) => seat.ready || seat.playerId === room.hostId);
  const canStart = isHost && room.seats.length >= min && everyoneReady;
  const startLabel = t(START_LABEL_KEY[room.gameType]);

  return (
    <>
      <button
        type="button"
        className={mySeat?.ready ? 'btn' : 'btn btn--primary'}
        onClick={() => socket.emit('room:ready', { ready: !mySeat?.ready })}
      >
        {mySeat?.ready ? t('start.cancelReady') : t('start.ready')}
      </button>
      {isHost && (
        <button
          type="button"
          className="btn btn--primary"
          disabled={!canStart}
          title={canStart ? undefined : t('start.needPlayers', { min })}
          onClick={() => run(() => emitWithAck('game:start', {}))}
        >
          {startLabel}
        </button>
      )}
    </>
  );
}
