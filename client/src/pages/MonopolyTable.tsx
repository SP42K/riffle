import { useEffect, useState } from 'react';
import {
  SEAT_LIMITS,
  type MonopolyAction,
  type MonopolyActions,
  type MonopolyEstateId,
  type MonopolyGameView,
  type PlayerId,
  type RoomView,
} from 'shared';
import { MonopolyBoard } from '../components/MonopolyBoard';
import { MonopolyTrade, type TradeOffer } from '../components/MonopolyTrade';
import { StartControls } from '../components/StartControls';
import { TurnBanner } from '../components/TurnBanner';
import { useCountdown } from '../hooks/useCountdown';
import { emitWithAck } from '../net/socket';
import { useGame } from '../state/GameProvider';
import { useSkin, type SkinContextValue } from '../state/skinContext';
import { RoomShell } from './RoomShell';

export function MonopolyRoom({ room }: { room: RoomView }) {
  const { run } = useGame();
  const { skin, t } = useSkin();
  const game = room.game?.type === 'monopoly' ? room.game : null;
  const me = room.me;
  const isSpectator = me.mode === 'spectate';
  const playing = room.status === 'playing';
  const isMyTurn = playing && !game?.over && game?.turnPlayerId === me.playerId;

  const actions = game?.myActions ?? null;
  const remainingMs = useCountdown(playing && !game?.over ? (game?.turnDeadline ?? 0) : 0);

  const nicknameOf = (playerId: PlayerId | null): string =>
    room.seats.find((seat) => seat.playerId === playerId)?.nickname ?? '—';

  const act = (action: MonopolyAction) => run(() => emitWithAck('game:monopoly', { action }));

  // 出價欄與交易面板都是本地暫存的表單狀態，換階段就收起來
  const [bid, setBid] = useState(0);
  const [tradeOpen, setTradeOpen] = useState(false);
  const bidFloor = actions?.canBid ? actions.minBid : 0;
  useEffect(() => setBid(bidFloor), [bidFloor, game?.auction?.tile]);
  useEffect(() => {
    if (!actions?.canOfferTrade) setTradeOpen(false);
  }, [actions?.canOfferTrade]);

  const positions = new Map<PlayerId, number>();
  if (game) {
    for (const seat of room.seats) {
      const info = game.seats[seat.seat];
      if (info && !info.bankrupt) positions.set(seat.playerId, info.position);
    }
  }

  const mySeat = room.seats.find((seat) => seat.playerId === me.playerId);
  const myInfo = mySeat && game ? game.seats[mySeat.seat] : undefined;
  const myEstates = game?.estates.filter((estate) => estate.owner === me.playerId) ?? [];

  const center = (
    <>
      {!game && (
        <div className="table__idle">
          <p>{t('monopoly.idleTitle')}</p>
          <p className="muted">
            {t('monopoly.idleHint', {
              n: room.seats.length,
              max: room.maxPlayers,
              min: SEAT_LIMITS.monopoly.min,
            })}
          </p>
        </div>
      )}

      {game && (
        <>
          <div className="monopoly__meta">
            <span>{t('monopoly.round', { n: game.round })}</span>
            <span className="monopoly__phase">
              {t('monopoly.phase', { phase: skin.monopolyPhase[game.phase] })}
            </span>
            <span className="muted">
              {game.dice
                ? t('monopoly.dice', {
                    a: game.dice[0],
                    b: game.dice[1],
                    n: game.dice[0] + game.dice[1],
                  })
                : t('monopoly.noDice')}
            </span>
            {game.parkingPot > 0 && (
              <span className="muted">{t('monopoly.parkingPot', { n: game.parkingPot })}</span>
            )}
            <span className="muted">
              {t('monopoly.supply', { houses: game.houseSupply, hotels: game.hotelSupply })}
            </span>
          </div>

          {!game.over && (
            <>
              <p className="monopoly__active">
                {t('monopoly.activePlayer', { name: nicknameOf(game.activePlayerId) })}
              </p>
              <TurnBanner
                isMyTurn={Boolean(isMyTurn)}
                nickname={nicknameOf(game.turnPlayerId)}
                remainingMs={remainingMs}
              />
            </>
          )}

          {game.auction && (
            <div className="monopoly__panel monopoly__auction">
              <h3>
                {t('monopoly.auctionTitle', { tile: skin.monopolyTile[game.auction.tile] })}
              </h3>
              <p>
                {game.auction.highBidderId
                  ? t('monopoly.auctionHigh', {
                      n: game.auction.highBid,
                      name: nicknameOf(game.auction.highBidderId),
                    })
                  : t('monopoly.auctionNoBid')}
              </p>
            </div>
          )}

          {game.trade && (
            <div className="monopoly__panel monopoly__trade-view">
              <h3>{t('monopoly.tradeTitle', { name: nicknameOf(game.trade.fromId) })}</h3>
              <p>
                <strong>{t('monopoly.tradeGive')}</strong>{' '}
                {describeSide(game.trade.give, game.trade.giveCash, skin, t)}
              </p>
              <p>
                <strong>{t('monopoly.tradeWant')}</strong>{' '}
                {describeSide(game.trade.want, game.trade.wantCash, skin, t)}
              </p>
            </div>
          )}

          {game.debt && (
            <div className="monopoly__panel monopoly__debt">
              <h3>
                {game.debt.creditorId
                  ? t('monopoly.debtTitle', {
                      name: nicknameOf(game.debt.creditorId),
                      n: game.debt.amount,
                    })
                  : t('monopoly.debtToBank', { n: game.debt.amount })}
              </h3>
              <p className="muted">
                {t('monopoly.debtShortfall', {
                  n: game.debt.shortfall,
                  max: game.debt.canRaise,
                })}
              </p>
            </div>
          )}

          {game.over && game.result && (
            <div className="table__result">
              <h2>{t('monopoly.resultTitle')}</h2>
              <p className="muted">
                {t('monopoly.resultReason', { reason: skin.monopolyEnd[game.result.reason] })}
              </p>
              {/* 用 ol 而不是 ul —— 名次的數字與各外觀的寫法都由 .table__result 的 CSS 出 */}
              <ol>
                {game.result.ranking.map((playerId) => (
                  <li key={playerId}>{nicknameOf(playerId)}</li>
                ))}
              </ol>
            </div>
          )}

          <MonopolyBoard
            estates={game.estates}
            seats={room.seats}
            positions={positions}
            myPlayerId={me.playerId}
            focusPosition={myInfo?.position ?? 0}
          />
        </>
      )}
    </>
  );

  const partners = room.seats.filter((seat) => {
    if (seat.playerId === me.playerId) return false;
    const info = game?.seats[seat.seat];
    return Boolean(info) && !info?.bankrupt;
  });

  const footer = (
    <>
      <div className="room__controls">
        {!game || game.over ? (
          <StartControls room={room} />
        ) : (
          <MonopolyControls
            actions={actions}
            disabled={!isMyTurn}
            bid={bid}
            onBid={setBid}
            onAct={act}
            onOpenTrade={() => setTradeOpen(true)}
          />
        )}
        <span className={`room__hint${isMyTurn ? ' room__hint--ok' : ''}`}>
          {buildHint({ game, playing, isMyTurn: Boolean(isMyTurn), t })}
        </span>
      </div>

      {tradeOpen && game && (
        <MonopolyTrade
          partners={partners}
          estates={game.estates}
          myPlayerId={me.playerId}
          onCancel={() => setTradeOpen(false)}
          onOffer={(offer: TradeOffer) => {
            act({ kind: 'offerTrade', ...offer });
            setTradeOpen(false);
          }}
        />
      )}

      {game && myInfo && (
        <div className="monopoly__mine">
          <div className="monopoly__me-info">
            <span className="seat__chips">{t('monopoly.cash', { n: myInfo.cash })}</span>
            <span className="muted">{t('monopoly.netWorth', { n: myInfo.netWorth })}</span>
            {myInfo.inJail && (
              <span className="tag tag--waiting">
                {t('monopoly.jailTurns', { n: myInfo.jailTurns })}
              </span>
            )}
            {myInfo.jailCards > 0 && (
              <span className="muted">{t('monopoly.jailCards', { n: myInfo.jailCards })}</span>
            )}
          </div>
          <div className="monopoly__estates">
            <h3>{t('monopoly.myEstates', { n: myEstates.length })}</h3>
            {myEstates.length === 0 && <p className="muted">{t('monopoly.noEstates')}</p>}
            <ul>
              {myEstates.map((estate) => (
                <li key={estate.tile} data-mortgaged={estate.mortgaged ? 'true' : undefined}>
                  <span>{skin.monopolyTile[estate.tile]}</span>
                  {estate.houses > 0 && <span>{skin.monopolyHouses(estate.houses)}</span>}
                  <EstateButtons tile={estate.tile} actions={actions} onAct={act} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );

  return (
    <RoomShell
      room={room}
      center={center}
      footer={isSpectator ? null : footer}
      isMyTurn={Boolean(isMyTurn)}
    />
  );
}

/** 一塊地旁邊的四顆小按鈕。能不能按完全看伺服器算好的清單。 */
function EstateButtons({
  tile,
  actions,
  onAct,
}: {
  tile: MonopolyEstateId;
  actions: MonopolyActions | null;
  onAct: (action: MonopolyAction) => void;
}) {
  const { t } = useSkin();
  const buttons: { key: string; label: string; enabled: boolean; action: MonopolyAction }[] = [
    {
      key: 'build',
      label: t('monopoly.build'),
      enabled: Boolean(actions?.buildable.includes(tile)),
      action: { kind: 'build', tile },
    },
    {
      key: 'sell',
      label: t('monopoly.sellHouse'),
      enabled: Boolean(actions?.sellable.includes(tile)),
      action: { kind: 'sellHouse', tile },
    },
    {
      key: 'mortgage',
      label: t('monopoly.mortgage'),
      enabled: Boolean(actions?.mortgageable.includes(tile)),
      action: { kind: 'mortgage', tile },
    },
    {
      key: 'unmortgage',
      label: t('monopoly.unmortgage'),
      enabled: Boolean(actions?.unmortgageable.includes(tile)),
      action: { kind: 'unmortgage', tile },
    },
  ];

  return (
    <span className="monopoly__estate-actions">
      {buttons.map((button) => (
        <button
          key={button.key}
          type="button"
          className="btn btn--small"
          disabled={!button.enabled}
          onClick={() => onAct(button.action)}
        >
          {button.label}
        </button>
      ))}
    </span>
  );
}

interface ControlsProps {
  actions: MonopolyActions | null;
  disabled: boolean;
  bid: number;
  onBid: (value: number) => void;
  onAct: (action: MonopolyAction) => void;
  onOpenTrade: () => void;
}

/**
 * 底部的動作列。
 *
 * 大富翁有 16 種動作，全部畫出來再一個個 disabled 會變成一整排灰按鈕；
 * 這裡只畫伺服器說當下可用的那幾顆。要不要能按完全看 myActions，前端不判規則。
 */
function MonopolyControls({ actions, disabled, bid, onBid, onAct, onOpenTrade }: ControlsProps) {
  const { t } = useSkin();
  if (!actions || disabled) return null;

  const min = actions.minBid;
  const max = actions.maxBid;

  const buttons: {
    key: string;
    label: string;
    show: boolean;
    className: string;
    onClick: () => void;
  }[] = [
    {
      key: 'roll',
      label: t('monopoly.roll'),
      show: actions.canRoll,
      className: 'btn btn--primary',
      onClick: () => onAct({ kind: 'roll' }),
    },
    {
      key: 'buy',
      label: t('monopoly.buy', { n: actions.buyPrice }),
      show: actions.canBuy,
      className: 'btn btn--primary',
      onClick: () => onAct({ kind: 'buy' }),
    },
    {
      key: 'decline',
      label: t('monopoly.decline'),
      show: actions.canDecline,
      className: 'btn',
      onClick: () => onAct({ kind: 'decline' }),
    },
    {
      key: 'passBid',
      label: t('monopoly.passBid'),
      show: actions.canPassBid,
      className: 'btn',
      onClick: () => onAct({ kind: 'passBid' }),
    },
    {
      key: 'payBail',
      label: t('monopoly.payBail', { n: actions.bailAmount }),
      show: actions.canPayBail,
      className: 'btn',
      onClick: () => onAct({ kind: 'payBail' }),
    },
    {
      key: 'jailCard',
      label: t('monopoly.useJailCard'),
      show: actions.canUseJailCard,
      className: 'btn',
      onClick: () => onAct({ kind: 'useJailCard' }),
    },
    {
      key: 'doubles',
      label: t('monopoly.rollForDoubles'),
      show: actions.canRollForDoubles,
      className: 'btn btn--primary',
      onClick: () => onAct({ kind: 'rollForDoubles' }),
    },
    {
      key: 'accept',
      label: t('monopoly.tradeAccept'),
      show: actions.canRespondTrade,
      className: 'btn btn--primary',
      onClick: () => onAct({ kind: 'respondTrade', accept: true }),
    },
    {
      key: 'reject',
      label: t('monopoly.tradeReject'),
      show: actions.canRespondTrade,
      className: 'btn',
      onClick: () => onAct({ kind: 'respondTrade', accept: false }),
    },
    {
      key: 'offerTrade',
      label: t('monopoly.offerTrade'),
      show: actions.canOfferTrade,
      className: 'btn',
      onClick: onOpenTrade,
    },
    {
      key: 'bankrupt',
      label: t('monopoly.declareBankrupt'),
      show: actions.canDeclareBankrupt,
      className: 'btn btn--danger',
      onClick: () => onAct({ kind: 'declareBankrupt' }),
    },
    {
      key: 'endTurn',
      label: t('monopoly.endTurn'),
      show: actions.canEndTurn,
      className: 'btn btn--primary',
      onClick: () => onAct({ kind: 'endTurn' }),
    },
  ];

  return (
    <>
      {actions.canBid && (
        <span className="monopoly__bid">
          <input
            type="number"
            className="monopoly__bid-input"
            min={min}
            max={max}
            value={bid}
            aria-label={t('monopoly.bidAmountLabel')}
            onChange={(event) => onBid(Number(event.target.value))}
          />
          <button
            type="button"
            className="btn btn--primary"
            disabled={bid < min || bid > max}
            onClick={() => onAct({ kind: 'bid', amount: bid })}
          >
            {t('monopoly.bid')}
          </button>
        </span>
      )}
      {buttons
        .filter((button) => button.show)
        .map((button) => (
          <button key={button.key} type="button" className={button.className} onClick={button.onClick}>
            {button.label}
          </button>
        ))}
    </>
  );
}

/**
 * 交易面板裡的一邊：幾塊地加多少現金。
 * 分隔符用中點而不是頓號 —— 頓號是中文標點，混在終端機外觀裡會露餡。
 */
function describeSide(
  tiles: readonly MonopolyEstateId[],
  cash: number,
  skin: SkinContextValue['skin'],
  t: SkinContextValue['t'],
): string {
  const parts = tiles.map((id) => skin.monopolyTile[id]);
  if (cash > 0) parts.push(t('monopoly.cash', { n: cash }));
  return parts.length > 0 ? parts.join(' · ') : t('monopoly.tradeNothing');
}

function buildHint(input: {
  game: MonopolyGameView | null;
  playing: boolean;
  isMyTurn: boolean;
  t: SkinContextValue['t'];
}): string {
  const { game, playing, isMyTurn, t } = input;
  if (!game) return t('monopolyHint.notPlaying');
  if (game.over) return t('monopoly.waitHost');
  if (!playing) return t('monopolyHint.notPlaying');
  if (!game.myActions) return t('monopolyHint.spectating');
  if (!isMyTurn) return t('monopolyHint.waitOthers');
  return t('monopolyHint.yourTurn');
}
