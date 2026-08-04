import { useEffect, useMemo, useState } from 'react';
import {
  COMBO_LABEL,
  TURN_MS,
  canBeat,
  identifyCombo,
  smallestLegalPlay,
  sortCards,
  type Card,
  type RoomView,
} from 'shared';
import { ChatPanel } from '../components/ChatPanel';
import { Hand, type SortMode } from '../components/Hand';
import { PlayingCard } from '../components/PlayingCard';
import { Seat } from '../components/Seat';
import { emitWithAck, socket } from '../net/socket';
import { useGame } from '../state/GameProvider';

/** 回合倒數，每 250ms 更新一次。deadline 為 0 表示沒有進行中的回合。 */
function useCountdown(deadline: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    setNow(Date.now()); // 換回合時先對時，不然會沿用上次 tick 的舊時間閃一下錯誤秒數
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [deadline]);
  return deadline ? Math.max(0, deadline - now) : 0;
}

export function Room({ room }: { room: RoomView }) {
  const { roomMessages, run } = useGame();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortMode, setSortMode] = useState<SortMode>('rank');

  const game = room.game;
  const me = room.me;
  const isSpectator = me.mode === 'spectate';
  const playing = room.status === 'playing';
  const isMyTurn = playing && game?.turnPlayerId === me.playerId;
  const isHost = room.hostId === me.playerId;

  const hand = useMemo(() => room.hand ?? [], [room.hand]);
  const allHands = room.allHands;
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
    isSpectator,
    playing,
    isMyTurn,
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

  const others = room.seats.filter((seat) => seat.playerId !== me.playerId);
  const mySeat = room.seats.find((seat) => seat.playerId === me.playerId);
  const seatedCount = room.seats.length;
  const everyoneReady = room.seats.every((seat) => seat.ready || seat.playerId === room.hostId);
  const canStart = isHost && !playing && seatedCount >= 2 && everyoneReady;

  return (
    <div className="room">
      <header className="room__header">
        <div>
          <h1>{room.name}</h1>
          <span className="room__code">房號 #{room.id}</span>
          {isSpectator && <span className="tag tag--spectator">觀戰中</span>}
        </div>
        <div className="room__header-actions">
          {isSpectator && room.seats.length < room.maxPlayers && !playing && (
            <button
              type="button"
              className="btn"
              onClick={() => run(() => emitWithAck('room:join', { roomId: room.id, mode: 'play' }))}
            >
              坐下來玩
            </button>
          )}
          {!isSpectator && !playing && (
            <button
              type="button"
              className="btn"
              onClick={() => run(() => emitWithAck('room:join', { roomId: room.id, mode: 'spectate' }))}
            >
              改為觀戰
            </button>
          )}
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => run(() => emitWithAck('room:leave', {}))}
          >
            離開房間
          </button>
        </div>
      </header>

      <div className="room__body">
        <div className="table">
          <div className="table__seats">
            {others.map((seat) => (
              <Seat
                key={seat.playerId}
                seat={seat}
                isTurn={game?.turnPlayerId === seat.playerId}
                isMe={false}
                playing={playing}
              />
            ))}
            {Array.from({ length: room.maxPlayers - room.seats.length }, (_, i) => (
              <div key={`empty-${i}`} className="seat seat--empty">
                空位
              </div>
            ))}
          </div>

          <div className="table__center">
            {!playing && room.status !== 'finished' && (
              <div className="table__idle">
                <p>等待房主開始遊戲</p>
                <p className="muted">
                  目前 {seatedCount}/{room.maxPlayers} 人，至少 2 人可開始
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
          </div>

          <div className="table__log">
            {room.log.slice(-6).map((line, index) => (
              <p key={`${index}-${line}`}>{line}</p>
            ))}
          </div>
        </div>

        <aside className="room__side">
          {isSpectator && allHands && (
            <section className="panel spectator">
              <h2>上帝視角</h2>
              {room.seats.map((seat) => (
                <div key={seat.playerId} className="spectator__row">
                  <span className="spectator__name">
                    {seat.nickname}
                    {game?.turnPlayerId === seat.playerId && <span className="tag tag--turn">輪到</span>}
                  </span>
                  <div className="spectator__cards">
                    {sortCards(allHands[seat.playerId] ?? []).map((card) => (
                      <PlayingCard key={card.id} card={card} small />
                    ))}
                  </div>
                </div>
              ))}
            </section>
          )}

          {room.spectators.length > 0 && (
            <section className="panel">
              <h2>觀戰者（{room.spectators.length}）</h2>
              <p className="muted">{room.spectators.map((s) => s.nickname).join('、')}</p>
            </section>
          )}

          <ChatPanel
            title="房間聊天"
            messages={roomMessages}
            myPlayerId={me.playerId}
            onSend={(text) => socket.emit('room:chat', { text })}
          />
        </aside>
      </div>

      {!isSpectator && (
        <footer className="room__footer">
          <div className="room__controls">
            {!playing ? (
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
                    title={canStart ? undefined : '需要至少 2 人，且所有人都已準備'}
                    onClick={() => run(() => emitWithAck('game:start', {}))}
                  >
                    開始遊戲
                  </button>
                )}
              </>
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
        </footer>
      )}
    </div>
  );
}

function buildHint(input: {
  isSpectator: boolean;
  playing: boolean;
  isMyTurn: boolean;
  selectedCount: number;
  combo: ReturnType<typeof identifyCombo>;
  lastCombo: ReturnType<typeof identifyCombo>;
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
