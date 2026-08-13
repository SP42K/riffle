import { useEffect, useMemo, useState } from 'react';
import {
  CUT_ORDER,
  DEFAULT_BIG_TWO_RULES,
  SEAT_LIMITS,
  beatFailure,
  canBeat,
  identifyCombo,
  smallestLegalPlay,
  sortCards,
  type BigTwoRules,
  type Card,
  type Combo,
  type RoomView,
} from 'shared';
import { Hand, type SortMode } from '../components/Hand';
import { PlayingCard } from '../components/PlayingCard';
import { StartControls } from '../components/StartControls';
import { SuitOrder } from '../components/SuitOrder';
import { TurnBanner } from '../components/TurnBanner';
import { useCountdown } from '../hooks/useCountdown';
import { emitWithAck } from '../net/socket';
import { useGame } from '../state/GameProvider';
import { useSkin, type SkinContextValue } from '../state/skinContext';
import { RoomShell } from './RoomShell';

export function BigTwoRoom({ room }: { room: RoomView }) {
  const { run } = useGame();
  const { skin, t } = useSkin();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortMode, setSortMode] = useState<SortMode>('rank');

  const game = room.game?.type === 'bigTwo' ? room.game : null;
  const me = room.me;
  const isSpectator = me.mode === 'spectate';
  const playing = room.status === 'playing';
  const isMyTurn = playing && game?.turnPlayerId === me.playerId;
  const isHost = room.hostId === me.playerId;

  const hand = useMemo(() => room.hand ?? [], [room.hand]);
  const lastCombo = game?.lastPlay?.combo ?? null;
  const openingCardId = game?.openingCardId ?? null;
  // 規則跟伺服器同一份，按鈕開關與提示才不會跟實際驗證結果對不上
  const rules: BigTwoRules = room.bigTwoRules ?? DEFAULT_BIG_TWO_RULES;

  const remainingMs = useCountdown(playing ? (game?.turnDeadline ?? 0) : 0);

  // 檯面換了一手就把選取清掉，免得上一輪選的牌還浮在那裡
  const tableSignature = game?.lastPlay?.combo.cards.map((c) => c.id).join(',') ?? '';
  useEffect(() => setSelectedIds(new Set()), [tableSignature]);

  // 只認手上真的還有的牌，不必在手牌變動時特地清理選取狀態
  const selectedCards = useMemo(
    () => hand.filter((card) => selectedIds.has(card.id)),
    [hand, selectedIds],
  );

  const toggleCard = (card: Card) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(card.id)) next.delete(card.id);
      else next.add(card.id);
      return next;
    });
  };

  const combo = useMemo(() => identifyCombo(selectedCards, rules), [selectedCards, rules]);
  const includesOpening = !openingCardId || selectedCards.some((c) => c.id === openingCardId);
  const canPlay = Boolean(isMyTurn && combo && includesOpening && canBeat(combo, lastCombo, rules));

  const hint = buildHint({
    playing,
    isMyTurn: Boolean(isMyTurn),
    selectedCards,
    combo,
    lastCombo,
    includesOpening,
    rules,
    skin,
    t,
  });

  const play = () => {
    if (!canPlay) return;
    run(async () => {
      await emitWithAck('game:play', { cardIds: selectedCards.map((c) => c.id) });
      setSelectedIds(new Set());
    });
  };

  const pass = () => run(() => emitWithAck('game:pass', {}));

  const suggest = () => {
    const suggestion = smallestLegalPlay(hand, lastCombo, {
      mustInclude: openingCardId ? [openingCardId] : undefined,
      rules,
    });
    setSelectedIds(new Set(suggestion?.cards.map((c) => c.id) ?? []));
  };

  const center = (
    <>
      {!playing && room.status !== 'finished' && (
        <div className="table__idle">
          <p>{t('bigTwo.idleTitle')}</p>
          <p className="muted">
            {t('bigTwo.idleHint', {
              n: room.seats.length,
              max: room.maxPlayers,
              min: SEAT_LIMITS.bigTwo.min,
            })}
          </p>
        </div>
      )}

      {playing && (
        <>
          <div className="table__last">
            {game?.lastPlay ? (
              <>
                <p className="table__last-label">
                  {t('bigTwo.lastPlay', {
                    name: game.lastPlay.nickname,
                    combo: skin.combo[game.lastPlay.combo.type],
                  })}
                </p>
                <div className="table__last-cards">
                  {sortCards(game.lastPlay.combo.cards).map((card) => (
                    <PlayingCard key={card.id} card={card} />
                  ))}
                </div>
              </>
            ) : (
              <p className="table__last-label">
                {t('bigTwo.freeLead')}
                {openingCardId && <>{t('bigTwo.mustIncludeOpening')}</>}
              </p>
            )}
          </div>

          <TurnBanner
            isMyTurn={Boolean(isMyTurn)}
            nickname={
              room.seats.find((s) => s.playerId === game?.turnPlayerId)?.nickname ?? '—'
            }
            remainingMs={remainingMs}
          />
        </>
      )}

      {room.status === 'finished' && game && (
        <div className="table__result">
          <h2>{t('bigTwo.resultTitle')}</h2>
          <ol>
            {game.ranking.map((playerId) => (
              <li key={playerId}>
                {room.seats.find((s) => s.playerId === playerId)?.nickname ?? t('seat.left')}
              </li>
            ))}
          </ol>
          {isHost ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => run(() => emitWithAck('game:start', {}))}
            >
              {t('bigTwo.playAgain')}
            </button>
          ) : (
            <p className="muted">{t('bigTwo.waitHost')}</p>
          )}
        </div>
      )}
    </>
  );

  const footer = (
    <>
      <div className="room__controls">
        {!playing ? (
          <StartControls room={room} />
        ) : (
          <>
            <button type="button" className="btn btn--primary" disabled={!canPlay} onClick={play}>
              {t('bigTwo.play')}
            </button>
            <button
              type="button"
              className="btn"
              disabled={!isMyTurn || !lastCombo}
              title={!lastCombo ? t('bigTwo.cannotPass') : undefined}
              onClick={pass}
            >
              {t('bigTwo.pass')}
            </button>
            <button type="button" className="btn" disabled={!isMyTurn} onClick={suggest}>
              {t('bigTwo.suggest')}
            </button>
            {/* PASS 停用的理由本來只在 title 裡，觸控裝置看不到，另外掛一行提示 */}
            {isMyTurn && !lastCombo && (
              <span className="room__hint touch-only">{t('bigTwo.cannotPass')}</span>
            )}
          </>
        )}
        <button
          type="button"
          className="btn"
          onClick={() => setSortMode((mode) => (mode === 'rank' ? 'suit' : 'rank'))}
        >
          {sortMode === 'rank' ? t('bigTwo.sortRank') : t('bigTwo.sortSuit')}
        </button>
        <span className={`room__hint${canPlay ? ' room__hint--ok' : ''}`}>{hint}</span>
      </div>

      <SuitOrder />

      <Hand
        cards={hand}
        selected={selectedIds}
        sortMode={sortMode}
        disabled={!playing}
        emptyLabel={playing ? t('bigTwo.handEmpty') : t('bigTwo.waitingDeal')}
        onToggle={toggleCard}
      />
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

function buildHint(input: {
  playing: boolean;
  isMyTurn: boolean;
  selectedCards: Card[];
  combo: Combo | null;
  lastCombo: Combo | null;
  includesOpening: boolean;
  rules: BigTwoRules;
  skin: SkinContextValue['skin'];
  t: SkinContextValue['t'];
}): string {
  const { playing, isMyTurn, selectedCards, combo, lastCombo, includesOpening, rules, skin, t } =
    input;
  if (!playing) return t('hint.notPlaying');
  if (!isMyTurn) return t('hint.waitOthers');
  if (selectedCards.length === 0) {
    return lastCombo ? t('hint.selectToFollow', { n: lastCombo.size }) : t('hint.selectCards');
  }
  if (!combo) {
    // 這一局不收同花時講明白一點，免得以為是自己選錯牌
    if (!rules.flush && identifyCombo(selectedCards, { ...rules, flush: true })?.type === 'flush') {
      return t('hint.noFlush');
    }
    return t('hint.invalidCombo');
  }
  if (!includesOpening) return t('hint.mustIncludeOpening');

  if (lastCombo) {
    const failure = beatFailure(combo, lastCombo, rules);
    if (failure === 'size') return t('hint.mustPlayN', { n: lastCombo.size });
    if (failure === 'comboType') {
      return t('hint.mustMatchCombo', { combo: skin.combo[lastCombo.type] });
    }
    if (failure) return t('hint.cannotBeat', { combo: skin.combo[combo.type] });
    // 用鐵支／同花順／一條龍蓋掉別種牌型，就是「切」
    if (
      rules.cuts &&
      CUT_ORDER[combo.type] !== undefined &&
      CUT_ORDER[lastCombo.type] === undefined
    ) {
      return t('hint.canCut', { combo: skin.combo[combo.type] });
    }
  }
  return t('hint.canPlay', { combo: skin.combo[combo.type] });
}
