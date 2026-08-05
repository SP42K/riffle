import { SEAT_LIMITS, type RoomView } from 'shared';
import { emitWithAck, socket } from '../net/socket';
import { useGame } from '../state/GameProvider';

/** 開局前的準備 / 開始遊戲，兩種玩法共用。 */
export function StartControls({ room }: { room: RoomView }) {
  const { run } = useGame();
  const me = room.me;
  const mySeat = room.seats.find((seat) => seat.playerId === me.playerId);
  const isHost = room.hostId === me.playerId;
  const min = SEAT_LIMITS[room.gameType].min;
  const everyoneReady = room.seats.every((seat) => seat.ready || seat.playerId === room.hostId);
  const canStart = isHost && room.seats.length >= min && everyoneReady;
  const startLabel = room.gameType === 'holdem' ? '開始牌局' : '開始遊戲';

  return (
    <>
      <button
        type="button"
        className={mySeat?.ready ? 'btn' : 'btn btn--primary'}
        onClick={() => socket.emit('room:ready', { ready: !mySeat?.ready })}
      >
        {mySeat?.ready ? '取消準備' : '準備'}
      </button>
      {isHost && (
        <button
          type="button"
          className="btn btn--primary"
          disabled={!canStart}
          title={canStart ? undefined : `需要至少 ${min} 人，且所有人都已準備`}
          onClick={() => run(() => emitWithAck('game:start', {}))}
        >
          {startLabel}
        </button>
      )}
    </>
  );
}
