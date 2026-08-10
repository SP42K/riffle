import { TURN_MS, type PlayerId, type MinesweeperAction } from 'shared';

export type Seats = Array<PlayerId | null>;

export interface MinesweeperCell {
  r: number;
  c: number;
  hasMine: boolean;
  revealed: boolean;
  flaggedBy: PlayerId | null;
  exploded: boolean;
}

export interface MinesweeperState {
  board: MinesweeperCell[][];
  turnSeat: number;
  turnDeadline: number;
  over: boolean;
  scores: Record<PlayerId, number>;
  finalScores: Record<PlayerId, number> | null;
  ranking: PlayerId[];
}

export type MinesweeperError =
  | 'GAME_NOT_RUNNING'
  | 'NOT_YOUR_TURN'
  | 'INVALID_CELL'
  | 'CELL_REVEALED'
  | 'CELL_FLAGGED'
  | 'CANNOT_FLAG_REVEALED'
  | 'INVALID_CHORD';

export const MINESWEEPER_ERROR_MESSAGE: Record<MinesweeperError, string> = {
  GAME_NOT_RUNNING: '遊戲尚未開始',
  NOT_YOUR_TURN: '還沒輪到你',
  INVALID_CELL: '無效的座標',
  CELL_REVEALED: '該格子已經被翻開',
  CELL_FLAGGED: '插旗的格子不能點擊，請先拔旗',
  CANNOT_FLAG_REVEALED: '不能在已翻開的格子上插旗',
  INVALID_CHORD: '無法執行排除（周圍旗子數量不符或沒有可排除格子）',
};

export const BOARD_SIZE = 10;
export const MINE_COUNT = 15;

export function nextActiveSeat(seats: Seats, currentSeat: number): number {
  for (let step = 1; step <= seats.length; step++) {
    const seat = (currentSeat + step) % seats.length;
    if (seats[seat] !== null) return seat;
  }
  return currentSeat;
}

export function dealMinesweeper(seats: Seats, rng: () => number = Math.random): MinesweeperState {
  const board: MinesweeperCell[][] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    const row: MinesweeperCell[] = [];
    for (let c = 0; c < BOARD_SIZE; c++) {
      row.push({
        r,
        c,
        hasMine: false,
        revealed: false,
        flaggedBy: null,
        exploded: false,
      });
    }
    board.push(row);
  }

  let placed = 0;
  while (placed < MINE_COUNT) {
    const r = Math.floor(rng() * BOARD_SIZE);
    const c = Math.floor(rng() * BOARD_SIZE);
    const cell = board[r]?.[c];
    if (cell && !cell.hasMine) {
      cell.hasMine = true;
      placed++;
    }
  }

  const scores: Record<PlayerId, number> = {};
  for (const playerId of seats) {
    if (playerId) {
      scores[playerId] = 0;
    }
  }

  const turnSeat = seats.findIndex((id) => id !== null);

  return {
    board,
    turnSeat,
    turnDeadline: Date.now() + TURN_MS,
    over: false,
    scores,
    finalScores: null,
    ranking: [],
  };
}

export function countAdjacentMines(board: MinesweeperCell[][], r: number, c: number): number {
  let count = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
        if (board[nr]?.[nc]?.hasMine) count++;
      }
    }
  }
  return count;
}

export function cascadeReveal(board: MinesweeperCell[][], startR: number, startC: number): void {
  const queue: [number, number][] = [[startR, startC]];
  const startCell = board[startR]?.[startC];
  if (startCell) {
    startCell.revealed = true;
    startCell.flaggedBy = null;
  }

  while (queue.length > 0) {
    const [r, c] = queue.shift()!;
    const adjCount = countAdjacentMines(board, r, c);
    if (adjCount === 0) {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
            const cell = board[nr]?.[nc];
            if (cell && !cell.hasMine && !cell.revealed) {
              cell.revealed = true;
              cell.flaggedBy = null;
              queue.push([nr, nc]);
            }
          }
        }
      }
    }
  }
}

export function checkGameOver(board: MinesweeperCell[][]): boolean {
  let foundCount = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = board[r]?.[c];
      if (cell && cell.hasMine) {
        if (cell.exploded || cell.flaggedBy !== null) {
          foundCount++;
        }
      }
    }
  }
  return foundCount === MINE_COUNT;
}

export function finalizeMinesweeperScores(state: MinesweeperState, seats: Seats): void {
  const finalScores: Record<PlayerId, number> = {};
  const activePlayers = seats.filter((id): id is PlayerId => id !== null);

  for (const playerId of activePlayers) {
    finalScores[playerId] = state.scores[playerId] ?? 0;
  }

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = state.board[r]?.[c];
      if (cell && cell.flaggedBy && activePlayers.includes(cell.flaggedBy)) {
        if (cell.hasMine) {
          finalScores[cell.flaggedBy] = (finalScores[cell.flaggedBy] ?? 0) + 2;
        } else {
          finalScores[cell.flaggedBy] = (finalScores[cell.flaggedBy] ?? 0) - 1;
        }
      }
    }
  }

  state.finalScores = finalScores;

  const ranked = activePlayers.slice().sort((a, b) => {
    const scoreA = finalScores[a] ?? 0;
    const scoreB = finalScores[b] ?? 0;
    return scoreB - scoreA;
  });

  state.ranking = ranked;
  state.over = true;
}

export type ApplyResult =
  | { ok: true; result: { kind: 'reveal'; points: number; r: number; c: number } }
  | { ok: true; result: { kind: 'flag'; flagged: boolean; r: number; c: number } }
  | { ok: true; result: { kind: 'chord'; points: number; r: number; c: number } }
  | { ok: false; error: MinesweeperError };

export function applyMinesweeperAction(
  seats: Seats,
  state: MinesweeperState,
  playerId: PlayerId,
  action: MinesweeperAction,
): ApplyResult {
  if (state.over) {
    return { ok: false, error: 'GAME_NOT_RUNNING' };
  }

  const activeSeat = state.turnSeat;
  if (seats[activeSeat] !== playerId) {
    return { ok: false, error: 'NOT_YOUR_TURN' };
  }

  const { kind, r, c } = action;
  if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) {
    return { ok: false, error: 'INVALID_CELL' };
  }

  const cell = state.board[r]?.[c];
  if (!cell) {
    return { ok: false, error: 'INVALID_CELL' };
  }

  if (kind === 'reveal') {
    if (cell.revealed) {
      return { ok: false, error: 'CELL_REVEALED' };
    }
    if (cell.flaggedBy !== null) {
      return { ok: false, error: 'CELL_FLAGGED' };
    }

    if (cell.hasMine) {
      cell.revealed = true;
      cell.exploded = true;
      state.scores[playerId] = (state.scores[playerId] ?? 0) - 1;

      const isOver = checkGameOver(state.board);
      if (isOver) {
        finalizeMinesweeperScores(state, seats);
      } else {
        state.turnSeat = nextActiveSeat(seats, activeSeat);
        state.turnDeadline = Date.now() + TURN_MS;
      }

      return { ok: true, result: { kind: 'reveal', points: -1, r, c } };
    } else {
      cascadeReveal(state.board, r, c);
      state.scores[playerId] = (state.scores[playerId] ?? 0) + 1;

      const isOver = checkGameOver(state.board);
      if (isOver) {
        finalizeMinesweeperScores(state, seats);
      } else {
        state.turnSeat = nextActiveSeat(seats, activeSeat);
        state.turnDeadline = Date.now() + TURN_MS;
      }

      return { ok: true, result: { kind: 'reveal', points: 1, r, c } };
    }
  } else if (kind === 'chord') {
    if (!cell.revealed) {
      return { ok: false, error: 'INVALID_CELL' };
    }
    const adjacentMines = countAdjacentMines(state.board, r, c);
    if (adjacentMines === 0) {
      return { ok: false, error: 'INVALID_CHORD' };
    }

    const adjacentCells: MinesweeperCell[] = [];
    let flagsCount = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
          const adjCell = state.board[nr]?.[nc];
          if (adjCell) {
            adjacentCells.push(adjCell);
            if (adjCell.flaggedBy !== null) {
              flagsCount++;
            }
          }
        }
      }
    }

    if (flagsCount !== adjacentMines) {
      return { ok: false, error: 'INVALID_CHORD' };
    }

    const cellsToReveal = adjacentCells.filter(cell => !cell.revealed && cell.flaggedBy === null);
    if (cellsToReveal.length === 0) {
      return { ok: false, error: 'INVALID_CHORD' };
    }

    let minesHit = 0;
    let safeRevealed = 0;
    for (const target of cellsToReveal) {
      if (target.revealed) continue;
      if (target.hasMine) {
        target.revealed = true;
        target.exploded = true;
        minesHit++;
      } else {
        cascadeReveal(state.board, target.r, target.c);
        safeRevealed++;
      }
    }

    let pointsDelta = 0;
    if (minesHit > 0) {
      pointsDelta = -minesHit;
    } else if (safeRevealed > 0) {
      pointsDelta = 1;
    }

    state.scores[playerId] = (state.scores[playerId] ?? 0) + pointsDelta;

    const isOver = checkGameOver(state.board);
    if (isOver) {
      finalizeMinesweeperScores(state, seats);
    } else {
      state.turnSeat = nextActiveSeat(seats, activeSeat);
      state.turnDeadline = Date.now() + TURN_MS;
    }

    return { ok: true, result: { kind: 'chord', points: pointsDelta, r, c } };
  } else {
    if (cell.revealed) {
      return { ok: false, error: 'CANNOT_FLAG_REVEALED' };
    }

    let flagged = false;
    if (cell.flaggedBy === playerId) {
      cell.flaggedBy = null;
      flagged = false;
    } else {
      cell.flaggedBy = playerId;
      flagged = true;
    }

    const isOver = checkGameOver(state.board);
    if (isOver) {
      finalizeMinesweeperScores(state, seats);
    } else {
      state.turnSeat = nextActiveSeat(seats, activeSeat);
      state.turnDeadline = Date.now() + TURN_MS;
    }

    return { ok: true, result: { kind: 'flag', flagged, r, c } };
  }
}

export function autoActMinesweeper(seats: Seats, state: MinesweeperState): ApplyResult | null {
  const activePlayerId = seats[state.turnSeat];
  if (!activePlayerId) return null;

  const options: { r: number; c: number }[] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = state.board[r]?.[c];
      if (cell && !cell.revealed && cell.flaggedBy === null) {
        options.push({ r, c });
      }
    }
  }

  if (options.length === 0) {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const cell = state.board[r]?.[c];
        if (cell && !cell.revealed) {
          options.push({ r, c });
        }
      }
    }
  }

  if (options.length === 0) return null;

  const choice = options[Math.floor(Math.random() * options.length)];
  if (!choice) return null;
  const action: MinesweeperAction = { kind: 'reveal', r: choice.r, c: choice.c };
  const res = applyMinesweeperAction(seats, state, activePlayerId, action);
  if (res.ok) return res;
  return null;
}

export function removePlayerFromMinesweeper(seats: Seats, state: MinesweeperState, playerId: PlayerId): void {
  const activePlayerId = seats[state.turnSeat];
  const playerSeat = seats.indexOf(playerId);
  if (playerSeat === -1) return;

  seats[playerSeat] = null;

  const activePlayers = seats.filter((id): id is PlayerId => id !== null);
  if (activePlayers.length === 0) {
    state.over = true;
    return;
  }

  if (activePlayerId === playerId) {
    state.turnSeat = nextActiveSeat(seats, state.turnSeat);
    state.turnDeadline = Date.now() + TURN_MS;
  }
}
