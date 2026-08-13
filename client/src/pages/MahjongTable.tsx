import { useEffect, useRef, useState } from 'react';
import {
  mahjongTileLabel,
  type MahjongMeld,
  type MahjongReactionAction,
  type MahjongSeatInfo,
  type MahjongTileId,
  type RoomView,
} from 'shared';
import { MahjongTileIcon } from '../mahjong/MahjongTileIcon';
import { tileWidth } from '../mahjong/pixelart';
import { MAHJONG_BANNER_TEXT_KEY, useMahjongActionBanner } from '../mahjong/useMahjongActionBanner';
import { StartControls } from '../components/StartControls';
import { TurnBanner } from '../components/TurnBanner';
import { useCountdown } from '../hooks/useCountdown';
import { emitWithAck } from '../net/socket';
import { useGame } from '../state/GameProvider';
import { useSkin } from '../state/skinContext';
import { RoomShell } from './RoomShell';

const MELD_KIND_KEY = { chi: 'mahjong.chi', peng: 'mahjong.peng', gang: 'mahjong.gang' } as const;

/** 骰子點數 1~6 對應的 Unicode 骰子字元，開局擲骰動畫用。 */
const DICE_FACE: Record<number, string> = {
  1: '⚀',
  2: '⚁',
  3: '⚂',
  4: '⚃',
  5: '⚄',
  6: '⚅',
};

/** 自己摸到的花牌，放在手牌上方——花牌不能打出去，也算進計台（花牌／正花），要讓玩家看得到摸了哪幾張。 */
function MyFlowers({ flowers }: { flowers: MahjongTileId[] }) {
  if (flowers.length === 0) return null;
  return (
    <div className="mahjong-flowers">
      {flowers.map((tile, index) => (
        <MahjongTileIcon key={`${tile}-${index}`} tile={tile} scale={0.9} />
      ))}
    </div>
  );
}

/** 自己碰／吃／槓出去的面子，放在手牌旁邊讓自己看得到摸過的牌型。 */
function MyMelds({ melds }: { melds: MahjongMeld[] }) {
  const { t } = useSkin();
  if (melds.length === 0) return null;
  return (
    <div className="mahjong-melds">
      {melds.map((meld, index) => (
        <div key={index} className="mahjong-meld">
          <span className="mahjong-meld__label">{t(MELD_KIND_KEY[meld.type])}</span>
          <div className="mahjong-meld__tiles">
            {meld.tiles.map((tile, tileIndex) => (
              <MahjongTileIcon key={`${tile}-${tileIndex}`} tile={tile} scale={1} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * 四家已經打出去的牌，統一放在牌桌中央，不塞進座位的小卡片裡、也不特別標是誰打的——
 * 用 discardOrder（全桌遞增序號）把四家混在一起排成「真正的出牌先後順序」，
 * 從左到右累加，一列滿了自動換行——每列幾張純粹是排版問題，交給 CSS 決定：
 * 桌機每列 20 張、窄螢幕（≤860px）每列 10 張。被吃／碰／槓／胡走的牌會從這裡消失
 * （改在贏家或吃碰槓那家的面子裡看得到）。因為是按真正時間順序排的，最新那張棄牌
 * 永遠是整排最後一格——如果剛好把上一行填滿，就會落在新的一行最左邊——用黃框標出來。
 */
function DiscardBoard({
  seats,
  lastDiscard,
}: {
  seats: Record<number, MahjongSeatInfo>;
  lastDiscard: { tile: MahjongTileId; fromSeat: number } | null;
}) {
  const visibleTiles = [0, 1, 2, 3]
    .flatMap((seat) => {
      const info = seats[seat];
      if (!info) return [];
      return info.discards.flatMap((tile, index) => {
        if (info.claimedDiscards[index]) return [];
        return [{ key: `${seat}-${index}-${tile}`, tile, order: info.discardOrder[index] ?? -1 }];
      });
    })
    .sort((a, b) => a.order - b.order);
  if (visibleTiles.length === 0) return null;
  const maxOrder = visibleTiles[visibleTiles.length - 1]!.order;
  return (
    <div className="mahjong-discard-board">
      {visibleTiles.map(({ key, tile, order }) => (
        <MahjongTileIcon
          key={key}
          tile={tile}
          scale={0.975}
          highlighted={lastDiscard !== null && order === maxOrder}
        />
      ))}
    </div>
  );
}

/**
 * 胡牌後公布全場的手牌，讓每個玩家（不只觀戰者）都能互相核對牌型——
 * 不只是暗牌，吃／碰／槓亮出來的面子也要一起算進「這個人的牌」，不然核對不完整。
 */
function RevealedHands({
  allHands,
  seats,
  nicknameOfSeat,
  title,
}: {
  allHands: Record<number, MahjongTileId[]>;
  seats: Record<number, MahjongSeatInfo>;
  nicknameOfSeat: (seat: number | null) => string;
  title: string;
}) {
  return (
    <div className="mahjong-revealed-hands">
      <p className="mahjong-revealed-hands__title">{title}</p>
      {[0, 1, 2, 3].map((seat) => {
        const tiles = allHands[seat];
        if (!tiles) return null;
        const melds = seats[seat]?.melds ?? [];
        return (
          <div key={seat} className="mahjong-revealed-hands__row">
            <span className="mahjong-revealed-hands__name">{nicknameOfSeat(seat)}</span>
            <div className="mahjong-revealed-hands__tiles">
              {tiles.map((tile, index) => (
                <MahjongTileIcon key={`hand-${seat}-${tile}-${index}`} tile={tile} scale={0.9} />
              ))}
              {melds.map((meld, meldIndex) => (
                <div key={`meld-${seat}-${meldIndex}`} className="mahjong-revealed-hands__meld">
                  {meld.tiles.map((tile, tileIndex) => (
                    <MahjongTileIcon key={`${tile}-${tileIndex}`} tile={tile} scale={0.9} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function MahjongRoom({ room }: { room: RoomView }) {
  const { run } = useGame();
  const { t } = useSkin();

  const game = room.game?.type === 'taiwanMahjong' ? room.game : null;
  const me = room.me;
  const isSpectator = me.mode === 'spectate';
  const isHost = room.hostId === me.playerId;

  const started = game !== null;
  const matchOver = game?.over ?? false;
  const roundResult = game?.roundResult ?? null;
  const isMyTurn = Boolean(started && !matchOver && game?.turnPlayerId === me.playerId);

  const hand = room.mahjongHand ?? [];
  // 剛摸到的那張跟手牌分開顯示（隔一張牌的距離放在手牌右邊），所以要從排序好的手牌裡摘掉它，
  // 只拿掉一張同值的牌就好——不能整組同花色的都跟著消失。
  const justDrawnTile = game?.myJustDrawn ?? null;
  const mainHand = (() => {
    if (!justDrawnTile) return hand;
    const idx = hand.indexOf(justDrawnTile);
    if (idx === -1) return hand;
    return [...hand.slice(0, idx), ...hand.slice(idx + 1)];
  })();
  const remainingMs = useCountdown(game?.turnDeadline ?? 0);

  const mySeatNumber = room.seats.find((s) => s.playerId === me.playerId)?.seat ?? null;
  const myInfo = game && mySeatNumber !== null ? game.seats[mySeatNumber] : undefined;
  const myNickname = room.seats.find((s) => s.playerId === me.playerId)?.nickname ?? '';
  // RoomShell 的座位列表不畫自己，所以自己吃碰槓胡的大字提示要另外在這裡蓋
  const myBanner = useMahjongActionBanner(room.log, room.logSeq, myNickname);

  // 剛開局（房主按下開始遊戲）先擲骰 3 秒決定莊家，接著蓋牌 3 秒醞釀一下，時間到才翻牌，
  // 順便彈「遊戲開始」——只在「這一場」真的從沒開始變成開始時觸發一次，
  // 中途重連或大老遠加進來旁觀不會誤觸發。
  const [dealPhase, setDealPhase] = useState<'dice' | 'hidden' | 'reveal' | 'normal'>('normal');
  const wasStartedRef = useRef(started);
  useEffect(() => {
    if (started && !wasStartedRef.current) {
      wasStartedRef.current = true;
      setDealPhase('dice');
      const hiddenTimer = window.setTimeout(() => setDealPhase('hidden'), 3_000);
      const revealTimer = window.setTimeout(() => setDealPhase('reveal'), 6_000);
      const normalTimer = window.setTimeout(() => setDealPhase('normal'), 7_500);
      return () => {
        window.clearTimeout(hiddenTimer);
        window.clearTimeout(revealTimer);
        window.clearTimeout(normalTimer);
      };
    }
    wasStartedRef.current = started;
    return undefined;
  }, [started]);

  const nicknameOfSeat = (seat: number | null) =>
    seat === null ? '' : (room.seats.find((s) => s.seat === seat)?.nickname ?? t('seat.left'));

  const discard = (tile: MahjongTileId) => {
    run(() => emitWithAck('game:mahjong', { action: { kind: 'discard', tile } }));
  };
  const selfDrawAction = (action: 'hu' | 'gang' | 'none', tile?: MahjongTileId) => {
    run(() => emitWithAck('game:mahjong', { action: { kind: 'selfDraw', action, tile } }));
  };
  const respond = (action: MahjongReactionAction, chiTiles?: [MahjongTileId, MahjongTileId]) => {
    run(() => emitWithAck('game:mahjong', { action: { kind: 'respond', action, chiTiles } }));
  };
  const continueRound = () => {
    run(() => emitWithAck('game:mahjong', { action: { kind: 'continueRound' } }));
  };
  const respondJoinRequest = (accept: boolean) => {
    run(() => emitWithAck('room:respondJoinRequest', { accept }));
  };

  // 開局擲骰／蓋牌動畫還沒播完（還沒翻牌顯示「遊戲開始」）之前，真人也不能搶著動作，
  // 跟伺服器那邊電腦座位的延遲門檻是同一件事的兩面。
  const actionsLocked = dealPhase === 'dice' || dealPhase === 'hidden';

  const center = (
    <>
      {isHost && room.mahjongJoinRequest && (
        <div className="mahjong-join-request">
          <p>{t('mahjong.joinRequestText', { name: room.mahjongJoinRequest.nickname })}</p>
          <div className="mahjong-join-request__actions">
            <button type="button" className="btn btn--primary" onClick={() => respondJoinRequest(true)}>
              {t('mahjong.joinRequestAccept')}
            </button>
            <button type="button" className="btn" onClick={() => respondJoinRequest(false)}>
              {t('mahjong.joinRequestReject')}
            </button>
          </div>
        </div>
      )}
      {!started && (
        <div className="table__idle">
          <p>{t('mahjong.idleTitle')}</p>
          <p className="muted">
            {t('mahjong.idleHint', { n: room.seats.length, max: room.maxPlayers })}
          </p>
        </div>
      )}

      {started && dealPhase !== 'normal' && (
        <div className="mahjong-deal-overlay">
          {dealPhase === 'dice' ? (
            <>
              <div className="mahjong-dice-row">
                {game.bankerDice.map((die, index) => (
                  <span key={index} className="mahjong-die">
                    {DICE_FACE[die] ?? die}
                  </span>
                ))}
              </div>
              <p className="mahjong-deal-text">
                {t('mahjong.bankerDiceResult', { name: nicknameOfSeat(game.bankerSeat) })}
              </p>
            </>
          ) : (
            <p className="mahjong-deal-text">
              {dealPhase === 'hidden' ? t('mahjong.dealing') : t('mahjong.gameStartBanner')}
            </p>
          )}
        </div>
      )}

      {started && !matchOver && (
        <>
          <div className="table__last mahjong-meta">
            {myBanner && (
              <div className={`mahjong-banner mahjong-banner--${myBanner.kind}`}>
                {t(MAHJONG_BANNER_TEXT_KEY[myBanner.kind])}
              </div>
            )}
            <p className="table__last-label">
              {t('mahjong.round', { n: game.round })} · {t('mahjong.banker', { name: nicknameOfSeat(game.bankerSeat) })} ·{' '}
              {t('mahjong.wall', { n: game.wallCount })}
            </p>
            {myInfo && (
              <p className="mahjong-my-score">{t('mahjong.myScoreLabel', { n: myInfo.score })}</p>
            )}
            {game.lastDiscard && (
              <div className="table__last-cards">
                <MahjongTileIcon tile={game.lastDiscard.tile} scale={1.1} />
                <span className="muted">
                  {t('mahjong.lastDiscard', {
                    name: nicknameOfSeat(game.lastDiscard.fromSeat),
                    tile: mahjongTileLabel(game.lastDiscard.tile),
                  })}
                </span>
              </div>
            )}
          </div>

          {game.phase !== 'roundEnd' && (
            <TurnBanner
              isMyTurn={isMyTurn}
              nickname={nicknameOfSeat(
                room.seats.find((s) => s.playerId === game.turnPlayerId)?.seat ?? null,
              )}
              remainingMs={remainingMs}
            />
          )}

          {game.phase !== 'roundEnd' && (
            <DiscardBoard seats={game.seats} lastDiscard={game.lastDiscard} />
          )}

          {game.phase === 'selfDraw' && game.mySelfDraw && (
            <div className="table__prompt">
              <p>{t('mahjong.selfDrawTitle')}</p>
              <div className="mahjong-actions">
                {game.mySelfDraw.canHu && (
                  <button
                    type="button"
                    className="btn btn--primary mahjong-action--claim"
                    disabled={actionsLocked}
                    onClick={() => selfDrawAction('hu')}
                  >
                    {t('mahjong.hu')}
                  </button>
                )}
                {game.mySelfDraw.gangChoices.map((choice) => (
                  <button
                    type="button"
                    key={choice.tile}
                    className="btn"
                    disabled={actionsLocked}
                    onClick={() => selfDrawAction('gang', choice.tile)}
                  >
                    {t('mahjong.gang')} {mahjongTileLabel(choice.tile)}
                  </button>
                ))}
                <button type="button" className="btn" disabled={actionsLocked} onClick={() => selfDrawAction('none')}>
                  {t('mahjong.none')}
                </button>
              </div>
            </div>
          )}

          {game.phase === 'reaction' && game.myReaction && (
            <div className="table__prompt">
              <p>
                {t('mahjong.reactionTitle', {
                  name: nicknameOfSeat(game.myReaction.fromSeat),
                  tile: mahjongTileLabel(game.myReaction.discardedTile),
                })}
              </p>
              <div className="mahjong-actions">
                {game.myReaction.options.includes('hu') && (
                  <button
                    type="button"
                    className="btn btn--primary mahjong-action--claim"
                    disabled={actionsLocked}
                    onClick={() => respond('hu')}
                  >
                    {t('mahjong.hu')}
                  </button>
                )}
                {game.myReaction.options.includes('peng') && (
                  <button
                    type="button"
                    className="btn mahjong-action--claim"
                    disabled={actionsLocked}
                    onClick={() => respond('peng')}
                  >
                    {t('mahjong.peng')}
                  </button>
                )}
                {game.myReaction.options.includes('chi') &&
                  game.myReaction.chiOptions.map((opt) => (
                    <button
                      type="button"
                      key={`${opt[0]}-${opt[1]}`}
                      className="btn mahjong-action--claim"
                      disabled={actionsLocked}
                      onClick={() => respond('chi', [opt[0], opt[1]])}
                    >
                      {t('mahjong.chi')}
                      {mahjongTileLabel(game.myReaction!.discardedTile)}
                      {/* 同一張棄牌若有不只一種吃法（例如上家打 3 萬，手上湊得出 12 或 45），
                          光顯示「吃3萬」會分不出兩顆按鈕差在哪，用小字補上實際用到的兩張手牌 */}
                      {game.myReaction!.chiOptions.length > 1 && (
                        <span className="mahjong-chi-detail">{opt.map(mahjongTileLabel).join(' ')}</span>
                      )}
                    </button>
                  ))}
                {game.myReaction.options.includes('gang') && (
                  <button type="button" className="btn" disabled={actionsLocked} onClick={() => respond('gang')}>
                    {t('mahjong.gang')}
                  </button>
                )}
                {game.myReaction.options.includes('pass') && (
                  <button type="button" className="btn" disabled={actionsLocked} onClick={() => respond('pass')}>
                    {t('mahjong.pass')}
                  </button>
                )}
              </div>
            </div>
          )}

          {game.phase === 'roundEnd' && roundResult && (
            <div className="table__result">
              <h2>{t('mahjong.resultTitle')}</h2>
              {roundResult.winType === 'draw' ? (
                <p>{t('mahjong.drawResult')}</p>
              ) : (
                <>
                  {roundResult.winnerSeat !== null && game.allHands?.[roundResult.winnerSeat] && (
                    <div className="mahjong-winning-hand">
                      <span className="mahjong-winning-hand__label">{t('mahjong.winningHandLabel')}</span>
                      <div className="mahjong-winning-hand__tiles">
                        {game.allHands[roundResult.winnerSeat]!.map((tile, index) => (
                          <MahjongTileIcon key={`hand-${tile}-${index}`} tile={tile} scale={1} />
                        ))}
                        {(game.seats[roundResult.winnerSeat]?.melds ?? []).map((meld, meldIndex) => (
                          <div key={meldIndex} className="mahjong-winning-hand__meld">
                            {meld.tiles.map((tile, tileIndex) => (
                              <MahjongTileIcon key={`${tile}-${tileIndex}`} tile={tile} scale={1} />
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <p>
                    {t(roundResult.winType === 'selfDraw' ? 'mahjong.winSelfDraw' : 'mahjong.winDiscard', {
                      name: nicknameOfSeat(roundResult.winnerSeat),
                      n: roundResult.tai,
                    })}
                  </p>
                  {roundResult.breakdown.length > 0 && (
                    <ul>
                      {roundResult.breakdown.map((item) => (
                        <li key={item.name}>
                          {item.name} +{item.tai}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
              {game.pendingMatchEnd ? (
                <p className="muted">{t('mahjong.matchEndingSoon')}</p>
              ) : (
                <>
                  <p className="muted">{t('mahjong.nextRoundSoon')}</p>
                  {mySeatNumber !== null && (
                    <div className="mahjong-ready">
                      <button
                        type="button"
                        className="btn btn--primary"
                        disabled={game.roundReady[mySeatNumber] ?? false}
                        onClick={continueRound}
                      >
                        {t(game.roundReady[mySeatNumber] ? 'mahjong.readyWaiting' : 'mahjong.readyContinue')}
                      </button>
                      <p className="muted">
                        {t('mahjong.readyCount', {
                          n: [0, 1, 2, 3].filter((seat) => game.roundReady[seat]).length,
                        })}
                      </p>
                    </div>
                  )}
                </>
              )}
              {game.allHands && (
                <RevealedHands
                  allHands={game.allHands}
                  seats={game.seats}
                  nicknameOfSeat={nicknameOfSeat}
                  title={t('mahjong.revealedHandsTitle')}
                />
              )}
            </div>
          )}
        </>
      )}

      {matchOver && game && (
        <div className="table__result">
          <h2>{t('mahjong.matchOverTitle')}</h2>
          {game.allHands && (
            <RevealedHands
              allHands={game.allHands}
              seats={game.seats}
              nicknameOfSeat={nicknameOfSeat}
              title={t('mahjong.revealedHandsTitle')}
            />
          )}
          <p>{t('mahjong.matchCompleteRanking', { n: game.round })}</p>
          <ol>
            {[0, 1, 2, 3]
              .slice()
              .sort((a, b) => (game.seats[b]?.score ?? 0) - (game.seats[a]?.score ?? 0))
              .map((seat) => (
                <li key={seat}>
                  {nicknameOfSeat(seat)} — {t('mahjong.scoreLabel', { n: game.seats[seat]?.score ?? 0 })}
                </li>
              ))}
          </ol>
          {isHost ? (
            <button type="button" className="btn btn--primary" onClick={() => run(() => emitWithAck('game:start', {}))}>
              {t('mahjong.playAgain')}
            </button>
          ) : (
            <p className="muted">{t('mahjong.waitHost')}</p>
          )}
        </div>
      )}
    </>
  );

  const canDiscard =
    isMyTurn && game?.phase === 'discard' && dealPhase !== 'hidden' && dealPhase !== 'dice';

  const footer = (
    <div className="room__controls">
      {!started ? (
        <StartControls room={room} />
      ) : (
        <>
          <span className="room__hint">
            {matchOver
              ? t('mahjong.matchOverTitle')
              : game?.phase === 'roundEnd'
                ? t('mahjongHint.roundEnd')
                : !isMyTurn
                  ? t('mahjongHint.waitOthers')
                  : game?.phase === 'selfDraw'
                    ? t('mahjongHint.selfDraw')
                    : game?.phase === 'reaction'
                      ? t('mahjongHint.reaction')
                      : t('mahjongHint.yourTurnDiscard')}
          </span>
          {myInfo && <MyFlowers flowers={myInfo.flowers} />}
          {myInfo && <MyMelds melds={myInfo.melds} />}
          <div className="mahjong-hand-row">
            {hand.length === 0 && <span className="muted">{t('mahjong.handEmpty')}</span>}
            {mainHand.map((tile, index) => (
              <MahjongTileIcon
                key={`${tile}-${index}`}
                tile={tile}
                faceDown={dealPhase === 'dice' || dealPhase === 'hidden'}
                disabled={!canDiscard}
                onClick={canDiscard ? () => discard(tile) : undefined}
              />
            ))}
            {justDrawnTile && (
              <div className="mahjong-hand-row__drawn" style={{ marginLeft: tileWidth(1.3) + 4 }}>
                <MahjongTileIcon
                  tile={justDrawnTile}
                  faceDown={dealPhase === 'dice' || dealPhase === 'hidden'}
                  disabled={!canDiscard}
                  onClick={canDiscard ? () => discard(justDrawnTile) : undefined}
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );

  return (
    <RoomShell
      room={room}
      center={center}
      footer={isSpectator ? null : footer}
      isMyTurn={isMyTurn}
      showLog={false}
    />
  );
}
