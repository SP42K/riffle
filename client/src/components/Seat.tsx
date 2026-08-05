import type { GameView, HoldemSeatInfo, SeatView } from 'shared';
import { useSkin } from '../state/skinContext';
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

export function Seat({ seat, isTurn, isMe, playing, game, chips }: Props) {
  const { skin, t } = useSkin();
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
        {isMe && <span className="tag tag--me">{t('seat.you')}</span>}
        {seat.isHost && <span className="tag tag--host">{t('seat.host')}</span>}
        {!seat.connected && <span className="tag tag--offline">{t('seat.offline')}</span>}
        {holdem?.isButton && <span className="tag tag--button">{t('seat.button')}</span>}
        {holdem?.blind === 'sb' && <span className="tag tag--blind">{t('seat.sb')}</span>}
        {holdem?.blind === 'bb' && <span className="tag tag--blind">{t('seat.bb')}</span>}
      </div>

      <div className="seat__status">
        {chips !== undefined ? (
          <HoldemStatus info={holdem} chips={chips} playing={playing} ready={seat.ready} />
        ) : (
          <BigTwoStatus game={game} seat={seat} playing={playing} />
        )}
      </div>

      {game?.type === 'bigTwo' && playing && game.seats[seat.seat]?.passed && (
        <div className="seat__passed">{t('seat.pass')}</div>
      )}
      {holdem?.lastAction && playing && (
        <div className="seat__action">{skin.action(holdem.lastAction)}</div>
      )}
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
  const { skin, t } = useSkin();
  const info = game?.type === 'bigTwo' ? game.seats[seat.seat] : undefined;
  const rank = info?.rank ?? null;

  if (rank !== null) {
    return <span className="seat__rank">{t('seat.rank', { medal: skin.medal(rank), n: rank })}</span>;
  }
  if (playing) return <CardBack count={info?.handCount ?? 0} />;
  return (
    <span className={seat.ready ? 'tag tag--ready' : 'tag tag--waiting'}>
      {seat.ready ? t('seat.ready') : t('seat.notReady')}
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
  const { t } = useSkin();
  return (
    <>
      <span className="seat__chips">{t('seat.chips', { n: chips })}</span>
      {!playing && !info && (
        <span className={ready ? 'tag tag--ready' : 'tag tag--waiting'}>
          {ready ? t('seat.ready') : t('seat.notReady')}
        </span>
      )}
      {playing && info?.holeCount === 0 && <span className="tag tag--waiting">{t('seat.sitOut')}</span>}
      {info?.allIn && <span className="tag tag--allin">{t('seat.allIn')}</span>}
      {info && info.committed > 0 && (
        <span className="seat__bet">{t('seat.bet', { n: info.committed })}</span>
      )}
    </>
  );
}
