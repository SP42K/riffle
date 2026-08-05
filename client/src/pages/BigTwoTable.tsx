import { useEffect, useMemo, useState } from 'react';
import {
  COMBO_LABEL,
  TURN_MS,
  canBeat,
  identifyCombo,
  smallestLegalPlay,
  sortCards,
  type Card,
  type Combo,
  type RoomView,
} from 'shared';
import { Hand, type SortMode } from '../components/Hand';
import { PlayingCard } from '../components/PlayingCard';
import { StartControls } from '../components/StartControls';
import { useCountdown } from '../hooks/useCountdown';
import { emitWithAck } from '../net/socket';
import { useGame } from '../state/GameProvider';
import { RoomShell } from './RoomShell';

export function BigTwoRoom({ room }: { room: RoomView }) {
  const { run } = useGame();
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

  const combo = useMemo(() => identifyCombo(selectedCards), [selectedCards]);
  const includesOpening = !openingCardId || selectedCards.some((c) => c.id === openingCardId);
  const canPlay = Boolean(isMyTurn && combo && includesOpening && canBeat(combo, lastCombo));

  const hint = buildHint({
    playing,
    isMyTurn: Boolean(isMyTurn),
    selectedCount: selectedCards.length,
    combo,
    lastCombo,
    includesOpening,
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
    });
    setSelectedIds(new Set(suggestion?.cards.map((c) => c.id) ?? []));
  };

  const center = (
    <>
      {!playing && room.status !== 'finished' && (
        <div className="table__idle">
          <p>等待房主開始遊戲</p>
          <p className="muted">
            目前 {room.seats.length}/{room.maxPlayers} 人，至少 2 人可開始
          </p>
        </div>
      )}

      {playing && (
        <>
          <div className="table__last">
            {game?.lastPlay ? (
              <>
                <p className="table__last-label">
                  {game.lastPlay.nickname} 的 {COMBO_LABEL[game.lastPlay.combo.type]}
                </p>
                <div className="table__last-cards">
                  {sortCards(game.lastPlay.combo.cards).map((card) => (
                    <PlayingCard key={card.id} card={card} />
                  ))}
                </div>
              </>
            ) : (
              <p className="table__last-label">
                自由出牌
                {openingCardId && <> · 這一手必須包含開局牌</>}
              </p>
            )}
          </div>

          <div className="table__turn">
            <span>
              輪到{' '}
              <strong>
                {isMyTurn
                  ? '你'
                  : (room.seats.find((s) => s.playerId === game?.turnPlayerId)?.nickname ?? '—')}
              </strong>
            </span>
            <div className="timer">
              <div
                className="timer__bar"
                style={{ width: `${Math.min(100, (remainingMs / TURN_MS) * 100)}%` }}
              />
            </div>
            <span className="timer__value">{Math.ceil(remainingMs / 1000)}s</span>
          </div>
        </>
      )}

      {room.status === 'finished' && game && (
        <div className="table__result">
          <h2>本局結束</h2>
          <ol>
            {game.ranking.map((playerId) => (
              <li key={playerId}>
                {room.seats.find((s) => s.playerId === playerId)?.nickname ?? '(已離開)'}
              </li>
            ))}
          </ol>
          {isHost ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => run(() => emitWithAck('game:start', {}))}
            >
              再來一局
            </button>
          ) : (
            <p className="muted">等房主開下一局</p>
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
              出牌
            </button>
            <button
              type="button"
              className="btn"
              disabled={!isMyTurn || !lastCombo}
              title={!lastCombo ? '你有領牌權，不能 PASS' : undefined}
              onClick={pass}
            >
              PASS
            </button>
            <button type="button" className="btn" disabled={!isMyTurn} onClick={suggest}>
              提示
            </button>
          </>
        )}
        <button
          type="button"
          className="btn"
          onClick={() => setSortMode((mode) => (mode === 'rank' ? 'suit' : 'rank'))}
        >
          排序：{sortMode === 'rank' ? '按大小' : '按花色'}
        </button>
        <span className={`room__hint${canPlay ? ' room__hint--ok' : ''}`}>{hint}</span>
      </div>

      <Hand
        cards={hand}
        selected={selectedIds}
        sortMode={sortMode}
        disabled={!playing}
        emptyLabel={playing ? '手牌已出完' : '等待發牌'}
        onToggle={toggleCard}
      />
    </>
  );

  return <RoomShell room={room} center={center} footer={isSpectator ? null : footer} />;
}

function buildHint(input: {
  playing: boolean;
  isMyTurn: boolean;
  selectedCount: number;
  combo: Combo | null;
  lastCombo: Combo | null;
  includesOpening: boolean;
}): string {
  const { playing, isMyTurn, selectedCount, combo, lastCombo, includesOpening } = input;
  if (!playing) return '按下準備，等房主開局';
  if (!isMyTurn) return '等待其他玩家出牌';
  if (selectedCount === 0) return lastCombo ? `請選 ${lastCombo.size} 張牌跟牌` : '請選擇要出的牌';
  if (!combo) return '這不是合法的牌型';
  if (!includesOpening) return '第一手必須包含開局牌';
  if (lastCombo && combo.size !== lastCombo.size) return `必須出 ${lastCombo.size} 張`;
  if (lastCombo && !canBeat(combo, lastCombo)) return `${COMBO_LABEL[combo.type]} 壓不過上一手`;
  return `可出：${COMBO_LABEL[combo.type]}`;
}
