import {
  tileAt,
  type GameType,
  type GameView,
  type HoldemSeatInfo,
  type MonopolySeatInfo,
  type SeatView,
  type SnakeSeatInfo,
} from 'shared';
import { useSkin } from '../state/skinContext';
import { CardBack } from './PlayingCard';
import { SnakeColorDot } from './SnakeColorDot';

interface Props {
  seat: SeatView;
  isTurn: boolean;
  isMe: boolean;
  playing: boolean;
  /**
   * 房間的玩法。狀態列一定要照這個分派 ——
   * 以前是看 chips 有沒有值來猜，大富翁也有現金，猜就會猜錯。
   */
  gameType: GameType;
  game: GameView | null;
  /** 德州撲克的房內籌碼，開局前也看得到。 */
  chips?: number;
  /** 貪吃蛇房間開了「命無限」，命數要顯示 ∞ 而不是一個會一直不變的數字。 */
  snakeUnlimitedLives?: boolean;
}

export function Seat({
  seat,
  isTurn,
  isMe,
  playing,
  gameType,
  game,
  chips,
  snakeUnlimitedLives,
}: Props) {
  const { skin, t } = useSkin();
  const holdem = game?.type === 'holdem' ? game.seats[seat.seat] : undefined;
  const monopoly = game?.type === 'monopoly' ? game.seats[seat.seat] : undefined;
  const snake = game?.type === 'snake' ? game.seats[seat.seat] : undefined;
  // 蓋牌、破產、蛇死掉都是「還在座位上但已經出局」，共用同一個淡出樣式
  const folded = (holdem?.folded ?? false) || (monopoly?.bankrupt ?? false) || snake?.alive === false;

  return (
    <div
      className={['seat', isTurn ? 'seat--turn' : '', isMe ? 'seat--me' : '', folded ? 'seat--folded' : '']
        .filter(Boolean)
        .join(' ')}
    >
      <div className="seat__name">
        {gameType === 'snake' && <SnakeColorDot seat={seat.seat} />}
        {seat.nickname}
        {isMe && <span className="tag tag--me">{t('seat.you')}</span>}
        {seat.isHost && <span className="tag tag--host">{t('seat.host')}</span>}
        {!seat.connected && <span className="tag tag--offline">{t('seat.offline')}</span>}
        {holdem?.isButton && <span className="tag tag--button">{t('seat.button')}</span>}
        {holdem?.blind === 'sb' && <span className="tag tag--blind">{t('seat.sb')}</span>}
        {holdem?.blind === 'bb' && <span className="tag tag--blind">{t('seat.bb')}</span>}
      </div>

      <div className="seat__status">
        <SeatStatus
          gameType={gameType}
          game={game}
          seat={seat}
          playing={playing}
          holdem={holdem}
          monopoly={monopoly}
          snake={snake}
          chips={chips}
          snakeUnlimitedLives={snakeUnlimitedLives}
        />
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

function SeatStatus({
  gameType,
  game,
  seat,
  playing,
  holdem,
  monopoly,
  snake,
  chips,
  snakeUnlimitedLives,
}: {
  gameType: GameType;
  game: GameView | null;
  seat: SeatView;
  playing: boolean;
  holdem: HoldemSeatInfo | undefined;
  monopoly: MonopolySeatInfo | undefined;
  snake: SnakeSeatInfo | undefined;
  chips: number | undefined;
  snakeUnlimitedLives: boolean | undefined;
}) {
  switch (gameType) {
    case 'bigTwo':
      return <BigTwoStatus game={game} seat={seat} playing={playing} />;
    case 'holdem':
      return (
        <HoldemStatus info={holdem} chips={chips ?? 0} playing={playing} ready={seat.ready} />
      );
    case 'monopoly':
      return <MonopolyStatus info={monopoly} playing={playing} ready={seat.ready} />;
    case 'downstairs':
      return <DownstairsStatus game={game} seat={seat} playing={playing} ready={seat.ready} />;
    case 'snake':
      return (
        <SnakeStatus
          info={snake}
          playing={playing}
          ready={seat.ready}
          unlimitedLives={snakeUnlimitedLives ?? false}
        />
      );
  }
}

function DownstairsStatus({
  game,
  seat,
  playing,
  ready,
}: {
  game: GameView | null;
  seat: SeatView;
  playing: boolean;
  ready: boolean;
}) {
  const { t } = useSkin();
  const me = game?.type === 'downstairs' ? game.players[seat.playerId] : undefined;
  if (!playing || !me) {
    return (
      <span className={ready ? 'tag tag--ready' : 'tag tag--waiting'}>
        {ready ? t('seat.ready') : t('seat.notReady')}
      </span>
    );
  }
  if (!me.alive) return <span className="tag tag--waiting">{t('downstairs.eliminated')}</span>;
  return (
    <>
      <span className="seat__chips">{t('downstairs.health', { n: me.health })}</span>
      <span className="seat__chips">{t('downstairs.depth', { n: Math.floor(me.depth) })}</span>
    </>
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

function MonopolyStatus({
  info,
  playing,
  ready,
}: {
  info: MonopolySeatInfo | undefined;
  playing: boolean;
  ready: boolean;
}) {
  const { skin, t } = useSkin();
  if (!playing || !info) {
    return (
      <span className={ready ? 'tag tag--ready' : 'tag tag--waiting'}>
        {ready ? t('seat.ready') : t('seat.notReady')}
      </span>
    );
  }
  return (
    <>
      <span className="seat__chips">{t('monopoly.cash', { n: info.cash })}</span>
      <span className="seat__tile">{skin.monopolyTile[tileAt(info.position).id]}</span>
      {info.bankrupt && <span className="tag tag--offline">{t('monopoly.bankruptTag')}</span>}
      {!info.bankrupt && info.inJail && (
        <span className="tag tag--waiting">{t('monopoly.jailTag')}</span>
      )}
    </>
  );
}

function SnakeStatus({
  info,
  playing,
  ready,
  unlimitedLives,
}: {
  info: SnakeSeatInfo | undefined;
  playing: boolean;
  ready: boolean;
  unlimitedLives: boolean;
}) {
  const { t } = useSkin();
  if (!playing || !info) {
    return (
      <span className={ready ? 'tag tag--ready' : 'tag tag--waiting'}>
        {ready ? t('seat.ready') : t('seat.notReady')}
      </span>
    );
  }
  return (
    <>
      <span className="seat__chips">
        {t('snake.score', { n: info.score })} · {t('snake.bodyLen', { n: info.body.length })}
      </span>
      <span className="seat__chips">
        {unlimitedLives ? t('snake.livesUnlimited') : t('snake.lives', { n: info.lives })}
      </span>
      {info.respawning && <span className="tag tag--waiting">{t('snake.respawning')}</span>}
      {!info.alive && <span className="tag tag--offline">{t('snake.dead')}</span>}
      {info.speedUntil !== null && info.speedUntil > Date.now() && <span className="tag tag--ready">⚡</span>}
      {info.shieldUntil !== null && info.shieldUntil > Date.now() && <span className="tag tag--ready">🛡</span>}
      {info.reversedUntil !== null && info.reversedUntil > Date.now() && (
        <span className="tag tag--offline">⇄</span>
      )}
    </>
  );
}
