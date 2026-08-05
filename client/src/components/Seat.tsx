import type { GameView, HoldemSeatInfo, SeatView } from 'shared';
import { CardBack } from './PlayingCard';

interface Props {
  seat: SeatView;
  isTurn: boolean;
  isMe: boolean;
  playing: boolean;
  game: GameView | null;
  /** 德州撲克的房內籌碼，開局前也看得到。 */
  chips?: number;
}

const RANK_MEDAL = ['🥇', '🥈', '🥉'];

export function Seat({ seat, isTurn, isMe, playing, game, chips }: Props) {
  const holdem = game?.type === 'holdem' ? game.seats[seat.seat] : undefined;
  const folded = holdem?.folded ?? false;

  return (
    <div
      className={['seat', isTurn ? 'seat--turn' : '', isMe ? 'seat--me' : '', folded ? 'seat--folded' : '']
        .filter(Boolean)
        .join(' ')}
    >
      <div className="seat__name">
        {seat.nickname}
        {isMe && <span className="tag tag--me">你</span>}
        {seat.isHost && <span className="tag tag--host">房主</span>}
        {!seat.connected && <span className="tag tag--offline">斷線</span>}
        {holdem?.isButton && <span className="tag tag--button">D</span>}
        {holdem?.blind === 'sb' && <span className="tag tag--blind">SB</span>}
        {holdem?.blind === 'bb' && <span className="tag tag--blind">BB</span>}
      </div>

      <div className="seat__status">
        {chips !== undefined ? (
          <HoldemStatus info={holdem} chips={chips} playing={playing} ready={seat.ready} />
        ) : (
          <BigTwoStatus game={game} seat={seat} playing={playing} />
        )}
      </div>

      {game?.type === 'bigTwo' && playing && game.seats[seat.seat]?.passed && (
        <div className="seat__passed">PASS</div>
      )}
      {holdem?.lastAction && playing && <div className="seat__action">{holdem.lastAction}</div>}
    </div>
  );
}

function BigTwoStatus({
  game,
  seat,
  playing,
}: {
  game: GameView | null;
  seat: SeatView;
  playing: boolean;
}) {
  const info = game?.type === 'bigTwo' ? game.seats[seat.seat] : undefined;
  const rank = info?.rank ?? null;

  if (rank !== null) {
    return (
      <span className="seat__rank">
        {RANK_MEDAL[rank - 1] ?? '🎖'} 第 {rank} 名
      </span>
    );
  }
  if (playing) return <CardBack count={info?.handCount ?? 0} />;
  return (
    <span className={seat.ready ? 'tag tag--ready' : 'tag tag--waiting'}>
      {seat.ready ? '已準備' : '未準備'}
    </span>
  );
}

function HoldemStatus({
  info,
  chips,
  playing,
  ready,
}: {
  info: HoldemSeatInfo | undefined;
  chips: number;
  playing: boolean;
  ready: boolean;
}) {
  return (
    <>
      <span className="seat__chips">🪙 {chips}</span>
      {!playing && !info && (
        <span className={ready ? 'tag tag--ready' : 'tag tag--waiting'}>
          {ready ? '已準備' : '未準備'}
        </span>
      )}
      {playing && info?.holeCount === 0 && <span className="tag tag--waiting">坐出</span>}
      {info?.allIn && <span className="tag tag--allin">ALL-IN</span>}
      {info && info.committed > 0 && <span className="seat__bet">下注 {info.committed}</span>}
    </>
  );
}
