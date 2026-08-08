import { useMemo, useState, useEffect, useRef } from 'react';
import {
  type RoomView,
  type DndAction,
  type DndCellView,
  type DndPiece,
} from 'shared';
import { StartControls } from '../components/StartControls';
import { TurnBanner } from '../components/TurnBanner';
import { useCountdown } from '../hooks/useCountdown';
import { emitWithAck } from '../net/socket';
import { useGame } from '../state/GameProvider';
import { useSkin } from '../state/skinContext';
import { RoomShell } from './RoomShell';

export function DndRoom({ room }: { room: RoomView }) {
  const { run } = useGame();
  const { skin, t } = useSkin();

  const game = room.game?.type === 'dnd' ? room.game : null;
  const me = room.me;
  const playing = room.status === 'playing';
  const isMyTurn = playing && game?.turnPlayerId === me.playerId;
  const isHost = room.hostId === me.playerId;

  const remainingMs = useCountdown(playing ? (game?.turnDeadline ?? 0) : 0);

  // Roll Animation States and Queue
  const prevLogLengthRef = useRef(room.log.length);
  const [rollQueue, setRollQueue] = useState<any[]>([]);
  const [activeRoll, setActiveRoll] = useState<any | null>(null);
  const [isRolling, setIsRolling] = useState(false);

  // Monitor logs to collect attack events into queue
  useEffect(() => {
    const oldLen = prevLogLengthRef.current;
    const newLen = room.log.length;
    prevLogLengthRef.current = newLen;

    if (newLen > oldLen) {
      const newEvents = room.log.slice(oldLen, newLen);
      const attackEvents = newEvents.filter((e) => e.t === 'dndAttack');
      if (attackEvents.length > 0) {
        setRollQueue((prev) => [...prev, ...attackEvents]);
      }
    }
  }, [room.log.length]);

  // Execute queue items sequentially
  useEffect(() => {
    if (!activeRoll && rollQueue.length > 0) {
      const nextRoll = rollQueue[0];
      setRollQueue((prev) => prev.slice(1));
      setActiveRoll(nextRoll);
      setIsRolling(true);

      const timer1 = setTimeout(() => {
        setIsRolling(false);
      }, 700);

      const timer2 = setTimeout(() => {
        setActiveRoll(null);
      }, 2200);

      return () => {
        clearTimeout(timer1);
        clearTimeout(timer2);
      };
    }
  }, [activeRoll, rollQueue]);

  // Find current player position
  const myPosition = useMemo(() => {
    if (!game) return null;
    for (let r = 0; r < game.board.length; r++) {
      const row = game.board[r];
      if (row) {
        for (let c = 0; c < row.length; c++) {
          const piece = row[c]?.piece;
          if (piece && piece.type === 'player' && piece.playerId === me.playerId) {
            return { r, c, piece };
          }
        }
      }
    }
    return null;
  }, [game, me.playerId]);

  const handleCellClick = (r: number, c: number) => {
    if (!isMyTurn || !game || game.over || !myPosition) return;

    const dr = r - myPosition.r;
    const dc = c - myPosition.c;
    const dist = Math.abs(dr) + Math.abs(dc);

    if (dist === 1) {
      const cell = game.board[r]?.[c];
      if (!cell) return;

      if (cell.piece) {
        if (cell.piece.type === 'goblin') {
          // Attack goblin
          const action: DndAction = { kind: 'attack', targetId: cell.piece.id };
          run(() => emitWithAck('game:dnd', { action }));
        }
      } else {
        // Move to cell
        let dir: DndAction['dir'];
        if (dr === -1 && dc === 0) dir = 'up';
        else if (dr === 1 && dc === 0) dir = 'down';
        else if (dr === 0 && dc === -1) dir = 'left';
        else if (dr === 0 && dc === 1) dir = 'right';

        if (dir) {
          const action: DndAction = { kind: 'move', dir };
          run(() => emitWithAck('game:dnd', { action }));
        }
      }
    }
  };

  const handleMoveDir = (dir: 'up' | 'down' | 'left' | 'right') => {
    if (!isMyTurn || !game || game.over || !myPosition) return;
    const action: DndAction = { kind: 'move', dir };
    run(() => emitWithAck('game:dnd', { action }));
  };

  const getCellDisplay = (cell: DndCellView) => {
    if (!cell.piece) return '';
    const piece = cell.piece;

    if (piece.type === 'player') {
      const seatIndex = room.seats.findIndex((s) => s?.playerId === piece.playerId);
      const label = `P${seatIndex + 1}`;
      return (
        <div className="dnd-token player-token" data-seat={seatIndex}>
          <span className="token-icon">👤</span>
          <span className="token-label">{label}</span>
        </div>
      );
    } else {
      let icon = '👹';
      if (piece.name.includes('薩滿') || piece.name.includes('Shaman')) icon = '🧙';
      else if (piece.name.includes('酋長') || piece.name.includes('Chief')) icon = '👑';
      return (
        <div className="dnd-token goblin-token">
          <span className="token-icon">{icon}</span>
          <span className="token-label">{piece.name.split(' ')[0]}</span>
        </div>
      );
    }
  };

  const center = (
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'flex-start', gap: '2rem' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {playing && game ? (
          <div className="dnd-board-container">
            <div className="dnd-board">
              {game.board.map((row, r) =>
                row.map((cell, c) => {
                  const isAdjacent =
                    myPosition && Math.abs(r - myPosition.r) + Math.abs(c - myPosition.c) === 1;
                  const isMoveable = isAdjacent && !cell.piece;
                  const isAttackable = isAdjacent && cell.piece?.type === 'goblin';

                  let borderClass = '';
                  if (isMyTurn) {
                    if (isMoveable) borderClass = 'can-move';
                    if (isAttackable) borderClass = 'can-attack';
                  }

                  return (
                    <button
                      key={`${r}-${c}`}
                      type="button"
                      className={`dnd-cell ${borderClass}`}
                      onClick={() => handleCellClick(r, c)}
                      disabled={!isMyTurn}
                    >
                      {getCellDisplay(cell)}
                      {cell.piece && (
                        <div className="dnd-hp-bar-container">
                          <div
                            className="dnd-hp-bar"
                            style={{
                              width: `${(cell.piece.hp / cell.piece.maxHp) * 100}%`,
                              backgroundColor: cell.piece.type === 'player' ? '#2ecc71' : '#e74c3c',
                            }}
                          />
                        </div>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          <div style={{ margin: '2rem 0' }}>
            <StartControls room={room} />
          </div>
        )}
      </div>

      {playing && game && (
        <div className="dnd-side-panel" style={{ width: '280px', marginTop: '1rem' }}>
          <TurnBanner
            isMyTurn={isMyTurn}
            nickname={room.seats.find((s) => s?.playerId === game.turnPlayerId)?.nickname || '—'}
            remainingMs={remainingMs}
          />

          <div className="dnd-party-status">
            <h3>🛡️ 冒險者隊伍狀態</h3>
            {[0, 1, 2, 3].map((seatIndex) => {
              const seatInfo = game.seats[seatIndex];
              if (!seatInfo) return null;
              const seat = room.seats[seatIndex];
              const displayName = seat ? seat.nickname : (seatInfo.name || `NPC ${seatIndex + 1}`);
              const hp = seatInfo.hp;
              const maxHp = seatInfo.maxHp;
              const alive = seatInfo.alive;

              return (
                <div key={seatIndex} className="party-member" data-alive={alive}>
                  <div className="party-member-header">
                    <span className="party-member-name">
                      P{seatIndex + 1}. {displayName}
                    </span>
                    <span className={`party-member-status ${alive ? 'alive' : 'dead'}`}>
                      {alive ? t('dnd.alive') : t('dnd.dead')}
                    </span>
                  </div>
                  <div className="party-member-hp">
                    <div className="party-hp-bar-container">
                      <div
                        className="party-hp-bar"
                        style={{ width: `${(hp / maxHp) * 100}%` }}
                      />
                    </div>
                    <span className="party-hp-text">
                      {t('dnd.hp', { hp, maxHp })}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {game.over && (
            <div className="game-over-panel">
              <h2 className="game-over-title">🎉 冒險結束</h2>
              <p className="game-over-desc">
                {game.ranking.length > 0
                  ? '隊伍完成了地城清理！'
                  : '隊伍全軍覆沒，冒險失敗！'}
              </p>
              {isHost && (
                <button
                  type="button"
                  className="play-again-btn"
                  onClick={() => emitWithAck('game:start', {})}
                >
                  {t('dnd.playAgain')}
                </button>
              )}
              {!isHost && <div className="wait-host-hint">{t('dnd.waitHost')}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );

  const footer = isMyTurn && myPosition ? (
    <div className="dnd-controls" style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
      <div className="dnd-dpad">
        <button
          type="button"
          className="dpad-btn up"
          onClick={() => handleMoveDir('up')}
          title="Move Up"
        >
          ▲
        </button>
        <div className="dpad-middle">
          <button
            type="button"
            className="dpad-btn left"
            onClick={() => handleMoveDir('left')}
            title="Move Left"
          >
            ◀
          </button>
          <div className="dpad-center-hub">🎮</div>
          <button
            type="button"
            className="dpad-btn right"
            onClick={() => handleMoveDir('right')}
            title="Move Right"
          >
            ▶
          </button>
        </div>
        <button
          type="button"
          className="dpad-btn down"
          onClick={() => handleMoveDir('down')}
          title="Move Down"
        >
          ▼
        </button>
      </div>
    </div>
  ) : null;

  return (
    <>
      <RoomShell room={room} center={center} footer={footer} isMyTurn={isMyTurn} />
      {activeRoll && (
        <div className="dnd-dice-overlay">
          <div className="dnd-dice-card">
            <div className="dnd-dice-title">⚔️ {activeRoll.player} 攻擊 {activeRoll.target}</div>
            <div className={`dnd-d20 ${isRolling ? 'rolling' : ''}`}>
              {isRolling ? '🎲' : activeRoll.roll}
            </div>
            {!isRolling && (
              <div className="dnd-dice-result">
                <div className="dnd-dice-roll-label">D20 擲骰判定對抗怪物 AC</div>
                <div className={`dnd-dice-hit-text ${activeRoll.hit ? 'hit' : 'miss'}`}>
                  {activeRoll.hit ? `命中！💥 造成 ${activeRoll.damage} 傷害` : '未命中 🛡️'}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
