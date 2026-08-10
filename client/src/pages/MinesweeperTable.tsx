import { useMemo, useState } from 'react';
import {
  SEAT_LIMITS,
  type RoomView,
  type MinesweeperAction,
  type MinesweeperCellView,
} from 'shared';
import { StartControls } from '../components/StartControls';
import { TurnBanner } from '../components/TurnBanner';
import { useCountdown } from '../hooks/useCountdown';
import { emitWithAck } from '../net/socket';
import { useGame } from '../state/GameProvider';
import { useSkin } from '../state/skinContext';
import { RoomShell } from './RoomShell';

export function MinesweeperRoom({ room }: { room: RoomView }) {
  const { run } = useGame();
  const { skin, t } = useSkin();
  const [flagMode, setFlagMode] = useState(false); // Mobile toggle for flag mode

  const game = room.game?.type === 'minesweeper' ? room.game : null;
  const me = room.me;
  const isSpectator = me.mode === 'spectate';
  const playing = room.status === 'playing';
  const isMyTurn = playing && game?.turnPlayerId === me.playerId;
  const isHost = room.hostId === me.playerId;

  const remainingMs = useCountdown(playing ? (game?.turnDeadline ?? 0) : 0);

  const handleCellClick = (r: number, c: number, forceFlag = false) => {
    if (!isMyTurn || !game || game.over) return;
    const cell = game.board[r]?.[c];
    if (!cell || cell.revealed) return;
    const kind = (flagMode || forceFlag) ? 'flag' : 'reveal';
    const action: MinesweeperAction = { kind, r, c };
    run(() => emitWithAck('game:minesweeper', { action }));
  };

  const handleCellContextMenu = (e: React.MouseEvent, r: number, c: number) => {
    e.preventDefault();
    if (!isMyTurn || !game || game.over) return;
    const cell = game.board[r]?.[c];
    if (!cell || cell.revealed) return;
    handleCellClick(r, c, true);
  };

  const handleCellDoubleClick = (r: number, c: number) => {
    if (!isMyTurn || !game || game.over) return;
    const cell = game.board[r]?.[c];
    if (!cell || !cell.revealed || !cell.adjacentMines || cell.adjacentMines === 0) return;
    const action: MinesweeperAction = { kind: 'chord', r, c };
    run(() => emitWithAck('game:minesweeper', { action }));
  };

  const handleCellMouseDown = (e: React.MouseEvent, r: number, c: number) => {
    if (!isMyTurn || !game || game.over) return;
    const cell = game.board[r]?.[c];
    if (!cell || !cell.revealed || !cell.adjacentMines || cell.adjacentMines === 0) return;

    // e.button === 1 is Middle Click.
    // e.buttons === 3 is Left + Right click pressed simultaneously.
    if (e.button === 1 || e.buttons === 3) {
      e.preventDefault();
      const action: MinesweeperAction = { kind: 'chord', r, c };
      run(() => emitWithAck('game:minesweeper', { action }));
    }
  };

  // Rendering cell content based on skin
  const getCellDisplay = (cell: MinesweeperCellView) => {
    if (cell.revealed) {
      if (cell.exploded) {
        if (skin.id === 'vscode') return <span style={{ color: 'var(--red)', fontSize: '0.8rem' }}>Error</span>;
        if (skin.id === 'terminal') return <span style={{ color: '#ff5555' }}>X</span>;
        return '💣';
      }
      if (cell.adjacentMines && cell.adjacentMines > 0) {
        return cell.adjacentMines;
      }
      return skin.id === 'terminal' ? '.' : '';
    }

    if (cell.flaggedBy) {
      if (skin.id === 'vscode') return '🔴'; // Breakpoint
      if (skin.id === 'terminal') return 'F';
      return '🚩';
    }

    return '';
  };

  // Center panel containing the minefield board
  const center = (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {playing && game && (
        <>
          <div className="minesweeper-info">
            <span>{t('minesweeper.remainingMines', { n: game.remainingMines })}</span>
            {isMyTurn && <span style={{ color: 'var(--gold)' }}>{t('minesweeperHint.yourTurn')}</span>}
          </div>

          <div className="minesweeper-board" data-skin={skin.id}>
            {game.board.map((row) =>
              row.map((cell) => (
                <button
                  key={`${cell.r}-${cell.c}`}
                  type="button"
                  className={`minesweeper-cell ${cell.revealed ? 'revealed' : ''} ${cell.exploded ? 'exploded' : ''} ${cell.flaggedBy ? 'flagged' : ''}`}
                  data-adjacent={cell.adjacentMines || undefined}
                  onClick={() => handleCellClick(cell.r, cell.c)}
                  onContextMenu={(e) => handleCellContextMenu(e, cell.r, cell.c)}
                  onDoubleClick={() => handleCellDoubleClick(cell.r, cell.c)}
                  onMouseDown={(e) => handleCellMouseDown(e, cell.r, cell.c)}
                  disabled={!isMyTurn}
                  title={
                    cell.flaggedBy
                      ? `Flagged by: ${room.seats.find((s) => s?.playerId === cell.flaggedBy)?.nickname || 'User'}`
                      : undefined
                  }
                >
                  {getCellDisplay(cell)}
                </button>
              ))
            )}
          </div>

          {/* Scores Panel */}
          <div className="minesweeper-scores">
            {room.seats.map((seat) => {
              if (!seat) return null;
              const seatInfo = game.seats[seat.seat];
              const score = seatInfo?.score ?? 0;
              const finalScore = seatInfo?.finalScore;
              const isActive = game.turnPlayerId === seat.playerId;
              const isMe = seat.playerId === me.playerId;

              return (
                <div
                  key={seat.playerId}
                  className={`minesweeper-score-row ${isActive ? 'active' : ''}`}
                >
                  <span>
                    {isActive && '▶ '}
                    {seat.nickname} {isMe ? `(${t('seat.you')})` : ''}
                    {!seat.connected && ` [${t('seat.offline')}]`}
                  </span>
                  <span>
                    {finalScore !== null && finalScore !== undefined
                      ? `${t('minesweeper.finalScore', { n: finalScore })}`
                      : `${t('minesweeper.score', { n: score })}`}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {!playing && (
        <div style={{ textAlign: 'center', marginTop: '2rem' }}>
          <h2>{t('minesweeper.idleTitle')}</h2>
          <p className="muted">
            {t('minesweeper.idleHint', {
              n: room.seats.filter(Boolean).length,
              max: room.maxPlayers,
              min: SEAT_LIMITS.minesweeper.min,
            })}
          </p>
          <StartControls room={room} />
        </div>
      )}
    </div>
  );

  // Footer controls
  const footer = playing && game && isMyTurn ? (
    <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', width: '100%' }}>
      <button
        type="button"
        className={`btn ${flagMode ? 'btn--primary' : ''}`}
        onClick={() => setFlagMode(!flagMode)}
        title="Toggle between clicking to reveal cells or clicking to flag cells (useful on mobile)"
      >
        {flagMode ? '🚩 Flag Mode [ON]' : '⛏ Reveal Mode'}
      </button>
      <div style={{ display: 'flex', alignItems: 'center', fontSize: '0.9rem', color: 'var(--muted)' }}>
        Remaining time: {Math.ceil(remainingMs / 1000)}s
      </div>
    </div>
  ) : playing && game && !isSpectator ? (
    <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '0.9rem', padding: '0.5rem' }}>
      {t('minesweeperHint.waitOthers')}
    </div>
  ) : isSpectator && playing ? (
    <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '0.9rem', padding: '0.5rem' }}>
      {t('minesweeperHint.spectating')}
    </div>
  ) : null;

  return (
    <RoomShell
      room={room}
      center={center}
      footer={footer}
      isMyTurn={isMyTurn}
    />
  );
}
