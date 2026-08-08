import { useMemo, useState, useEffect, useRef } from 'react';
import {
  type RoomView,
  type DndAction,
  type DndCellView,
  type DndPiece,
  type DownstairsCharacterId,
} from 'shared';
import { StartControls } from '../components/StartControls';
import { TurnBanner } from '../components/TurnBanner';
import { useCountdown } from '../hooks/useCountdown';
import { emitWithAck, socket } from '../net/socket';
import { useGame } from '../state/GameProvider';
import { useSkin } from '../state/skinContext';
import { RoomShell } from './RoomShell';

const DND_CLASSES: Array<{ id: DownstairsCharacterId; name: string; hp: number; ac: number; desc: string }> = [
  { id: 'brave', name: '戰士 (Warrior) 🛡️', hp: 24, ac: 14, desc: '前線坦攻，高防高血，持巨劍進行近戰 (D8+2)' },
  { id: 'bubble', name: '盜賊 (Rogue) 🗡️', hp: 18, ac: 12, desc: '突襲刺客，擁有極高出手命中率 (D6+4)' },
  { id: 'tangerine', name: '法師 (Mage) 🧙', hp: 16, ac: 10, desc: '遠程爆發，能造成毀滅性極高傷害 (D10+2)' },
  { id: 'star', name: '牧師 (Cleric) ⛪', hp: 20, ac: 12, desc: '神聖裁決者，攻擊命中時將會治癒自身 2 點生命 (D6+2)' },
];

function DndCharacterLobby({ room }: { room: RoomView }) {
  const mine = room.seats.find((seat) => seat.playerId === room.me.playerId)?.characterId ?? 'brave';

  return (
    <div className="dnd-lobby-container" style={{ width: '100%', maxWidth: '640px', margin: '0 auto', padding: '1rem' }}>
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <h2 style={{ color: 'var(--gold)', marginBottom: '0.5rem' }}>⚔️ 選擇你的冒險職業 ⚔️</h2>
        <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>地下城難度已大幅提升！請與隊友協商挑選互補的職業以利破關。</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        {DND_CLASSES.map((cls) => {
          const isSelected = mine === cls.id;
          return (
            <button
              key={cls.id}
              type="button"
              onClick={() => socket.emit('room:character', { characterId: cls.id })}
              style={{
                background: isSelected ? 'rgba(227, 179, 65, 0.1)' : 'var(--panel)',
                border: isSelected ? '2px solid var(--gold)' : '1px solid var(--line)',
                borderRadius: '8px',
                padding: '1.2rem',
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'all 0.2s',
                boxShadow: isSelected ? '0 0 15px rgba(227, 179, 65, 0.2)' : 'none',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                <strong style={{ color: isSelected ? 'var(--gold)' : 'var(--text)', fontSize: '1.1rem' }}>
                  {cls.name}
                </strong>
                {isSelected && <span style={{ color: 'var(--gold)', fontSize: '0.8rem', marginLeft: 'auto', background: 'rgba(227,179,65,0.15)', padding: '2px 6px', borderRadius: '4px' }}>已選定</span>}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>
                HP: {cls.hp} | AC: {cls.ac}
              </div>
              <p style={{ fontSize: '0.8rem', margin: 0, color: 'var(--muted)', lineHeight: '1.4' }}>
                {cls.desc}
              </p>
            </button>
          );
        })}
      </div>

      <div className="dnd-party-lobby" style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--line)', marginBottom: '2.5rem' }}>
        <h3 style={{ fontSize: '0.95rem', margin: '0 0 0.8rem 0', color: 'var(--text)' }}>👥 當前探險隊伍組合</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
          {room.seats.map((seat) => {
            if (!seat) return null;
            const classInfo = DND_CLASSES.find((c) => c.id === seat.characterId) || DND_CLASSES[0]!;
            return (
              <div key={seat.playerId} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.03)', padding: '6px 12px', borderRadius: '20px', border: '1px solid var(--line)' }}>
                <span style={{ fontSize: '0.9rem' }}>👤</span>
                <strong style={{ fontSize: '0.85rem' }}>{seat.nickname}</strong>
                <span style={{ color: 'var(--gold)', fontSize: '0.8rem' }}>[{classInfo.name.split(' ')[0]}]</span>
                <span className={seat.ready || seat.playerId === room.hostId ? 'tag tag--ready' : 'tag'} style={{ fontSize: '0.7rem' }}>
                  {seat.ready || seat.playerId === room.hostId ? '已準備' : '等待中'}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem' }}>
        <StartControls room={room} />
      </div>
    </div>
  );
}

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

  // Consume queue items one by one
  useEffect(() => {
    if (!activeRoll && rollQueue.length > 0) {
      const nextRoll = rollQueue[0];
      setRollQueue((prev) => prev.slice(1));
      setActiveRoll(nextRoll);
    }
  }, [activeRoll, rollQueue]);

  // Handle rolling animation and timer lifecycles for activeRoll
  useEffect(() => {
    if (activeRoll) {
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
  }, [activeRoll]);

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
      let icon = '👤';
      if (piece.classId === 'brave') icon = '🛡️';
      else if (piece.classId === 'bubble') icon = '🗡️';
      else if (piece.classId === 'tangerine') icon = '🧙';
      else if (piece.classId === 'star') icon = '⛪';
      return (
        <div className="dnd-token player-token" data-seat={seatIndex}>
          <span className="token-icon">{icon}</span>
          <span className="token-label">{label}</span>
        </div>
      );
    } else {
      let icon = '👹';
      if (piece.name.includes('薩滿') || piece.name.includes('Shaman')) icon = '🔮';
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
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'flex-start', gap: '2rem', width: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', maxWidth: '640px' }}>
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
          <DndCharacterLobby room={room} />
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
            <div className="dnd-dice-title">
              {activeRoll.damage < 0 ? `✨ ${activeRoll.player} 治療 ${activeRoll.target}` : `⚔️ ${activeRoll.player} 攻擊 ${activeRoll.target}`}
            </div>
            <div className={`dnd-d20 ${isRolling ? 'rolling' : ''}`}>
              {isRolling ? '🎲' : (activeRoll.damage < 0 ? '✨' : activeRoll.roll)}
            </div>
            {!isRolling && (
              <div className="dnd-dice-result">
                {activeRoll.damage < 0 ? (
                  <>
                    <div className="dnd-dice-roll-label">神聖醫療施展成功</div>
                    <div className="dnd-dice-hit-text hit" style={{ color: '#2ecc71', background: 'rgba(46, 204, 113, 0.1)', boxShadow: '0 0 10px rgba(46, 204, 113, 0.2)' }}>
                      ✨ 治療！恢復了 {-activeRoll.damage} 點生命！
                    </div>
                  </>
                ) : (
                  <>
                    <div className="dnd-dice-roll-label">D20 擲骰判定對抗怪物 AC</div>
                    <div className={`dnd-dice-hit-text ${activeRoll.hit ? 'hit' : 'miss'}`}>
                      {activeRoll.hit ? `命中！💥 造成 ${activeRoll.damage} 傷害` : '未命中 🛡️'}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
