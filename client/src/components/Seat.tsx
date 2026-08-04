import type { SeatView } from 'shared';
import { CardBack } from './PlayingCard';

interface Props {
  seat: SeatView;
  isTurn: boolean;
  isMe: boolean;
  playing: boolean;
}

const RANK_MEDAL = ['🥇', '🥈', '🥉'];

export function Seat({ seat, isTurn, isMe, playing }: Props) {
  return (
    <div
      className={['seat', isTurn ? 'seat--turn' : '', isMe ? 'seat--me' : ''].filter(Boolean).join(' ')}
    >
      <div className="seat__name">
        {seat.nickname}
        {isMe && <span className="tag tag--me">你</span>}
        {seat.isHost && <span className="tag tag--host">房主</span>}
        {!seat.connected && <span className="tag tag--offline">斷線</span>}
      </div>

      <div className="seat__status">
        {seat.rank !== null ? (
          <span className="seat__rank">
            {RANK_MEDAL[seat.rank - 1] ?? '🎖'} 第 {seat.rank} 名
          </span>
        ) : playing ? (
          <CardBack count={seat.handCount} />
        ) : (
          <span className={seat.ready ? 'tag tag--ready' : 'tag tag--waiting'}>
            {seat.ready ? '已準備' : '未準備'}
          </span>
        )}
      </div>

      {playing && seat.passed && seat.rank === null && <div className="seat__passed">PASS</div>}
    </div>
  );
}
