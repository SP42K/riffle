// @ts-nocheck
import { describe, expect, it } from 'vitest';
import {
  dealMinesweeper,
  countAdjacentMines,
  cascadeReveal,
  checkGameOver,
  applyMinesweeperAction,
  autoActMinesweeper,
  finalizeMinesweeperScores,
  BOARD_SIZE,
  MINE_COUNT,
  type Seats,
} from './minesweeperEngine.js';

describe('Minesweeper Engine', () => {
  it('should initialize a board with correct dimensions and mine count', () => {
    const seats: Seats = ['p1', 'p2', null, null];
    const state = dealMinesweeper(seats);

    expect(state.board.length).toBe(BOARD_SIZE);
    expect(state.board[0].length).toBe(BOARD_SIZE);

    let actualMines = 0;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (state.board[r][c].hasMine) {
          actualMines++;
        }
      }
    }
    expect(actualMines).toBe(MINE_COUNT);
    expect(state.turnSeat).toBe(0); // 'p1' goes first
    expect(state.scores['p1']).toBe(0);
    expect(state.scores['p2']).toBe(0);
    expect(state.over).toBe(false);
  });

  it('should calculate adjacent mine counts correctly', () => {
    const seats: Seats = ['p1'];
    // We mock the RNG to place mines at known locations.
    // Instead of random, let's manually place some mines.
    const state = dealMinesweeper(seats);
    // Clear all mines
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        state.board[r][c].hasMine = false;
      }
    }
    // Place mines at (0, 0), (0, 1), (1, 0)
    state.board[0][0].hasMine = true;
    state.board[0][1].hasMine = true;
    state.board[1][0].hasMine = true;

    expect(countAdjacentMines(state.board, 1, 1)).toBe(3);
    expect(countAdjacentMines(state.board, 0, 2)).toBe(1);
    expect(countAdjacentMines(state.board, 5, 5)).toBe(0);
  });

  it('should cascade reveal safe regions and clear flags on those cells', () => {
    const seats: Seats = ['p1'];
    const state = dealMinesweeper(seats);
    // Clear all mines
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        state.board[r][c].hasMine = false;
      }
    }
    // Put a mine at (2, 2)
    state.board[2][2].hasMine = true;
    // Put a flag on (0, 1)
    state.board[0][1].flaggedBy = 'p1';

    // Click at (0, 0)
    cascadeReveal(state.board, 0, 0);

    // (0,0) and neighbors should be revealed, and the flag on (0,1) should be removed.
    expect(state.board[0][0].revealed).toBe(true);
    expect(state.board[0][1].revealed).toBe(true);
    expect(state.board[0][1].flaggedBy).toBeNull();
    // (2,2) should not be revealed
    expect(state.board[2][2].revealed).toBe(false);
  });

  it('should process reveal and flag actions, update scores, and change turns', () => {
    const seats: Seats = ['p1', 'p2'];
    const state = dealMinesweeper(seats);

    // Clear all mines
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        state.board[r][c].hasMine = false;
      }
    }
    // Place a mine at (3, 3) and a diagonal wall to stop the cascade at (0,0)
    state.board[3][3].hasMine = true;
    state.board[0][2].hasMine = true;
    state.board[1][1].hasMine = true;
    state.board[2][0].hasMine = true;

    // p1 tries to make a move on p2's turn? No, turn seat is 0 ('p1').
    // p2 tries to click -> should fail
    const p2FailRes = applyMinesweeperAction(seats, state, 'p2', { kind: 'reveal', r: 0, c: 0 });
    expect(p2FailRes.ok).toBe(false);
    expect(p2FailRes.error).toBe('NOT_YOUR_TURN');

    // p1 reveals safe cell at (0, 0) -> should succeed
    const p1RevealRes = applyMinesweeperAction(seats, state, 'p1', { kind: 'reveal', r: 0, c: 0 });
    expect(p1RevealRes.ok).toBe(true);
    expect(state.scores['p1']).toBe(1);
    expect(state.turnSeat).toBe(1); // turn shifts to 'p2'

    // p2 flags (3, 3) -> should succeed
    const p2FlagRes = applyMinesweeperAction(seats, state, 'p2', { kind: 'flag', r: 3, c: 3 });
    expect(p2FlagRes.ok).toBe(true);
    expect(state.board[3][3].flaggedBy).toBe('p2');
    expect(state.turnSeat).toBe(0); // turn shifts back to 'p1'

    // p1 tries to click flagged cell (3, 3) -> should fail
    const p1RevealFlaggedRes = applyMinesweeperAction(seats, state, 'p1', { kind: 'reveal', r: 3, c: 3 });
    expect(p1RevealFlaggedRes.ok).toBe(false);
    expect(p1RevealFlaggedRes.error).toBe('CELL_FLAGGED');

    // p1 overwrites p2's flag on (3, 3) -> should succeed and change turn
    const p1OverwriteRes = applyMinesweeperAction(seats, state, 'p1', { kind: 'flag', r: 3, c: 3 });
    expect(p1OverwriteRes.ok).toBe(true);
    expect(state.board[3][3].flaggedBy).toBe('p1');
    expect(state.turnSeat).toBe(1);

    // p2 unflags (3, 3)? Wait, p2 is active, so they toggle flag on (3, 3).
    // Since it's flagged by p1, toggling it changes it to p2.
    const p2ToggleOtherRes = applyMinesweeperAction(seats, state, 'p2', { kind: 'flag', r: 3, c: 3 });
    expect(p2ToggleOtherRes.ok).toBe(true);
    expect(state.board[3][3].flaggedBy).toBe('p2');
    expect(state.turnSeat).toBe(0);

    // p1 is active. Toggles flag on (3, 3) -> changes to p1.
    applyMinesweeperAction(seats, state, 'p1', { kind: 'flag', r: 3, c: 3 });
    // p2 is active. Toggles flag on (3, 3)? No, turn shifted to p2. Wait, turn was at 0, p1 action shifted to 1.
    // Yes. Now p2 is active. Let's click (3, 3) -> wait, it is flagged by p1. So p2 must unflag/overwrite first.
    // Let's toggle flag on (3, 3) on p2's turn to change it to p2's flag.
    applyMinesweeperAction(seats, state, 'p2', { kind: 'flag', r: 3, c: 3 });
    // Turn is now p1's.
    // p1 is active. They toggle flag on (3,3) again -> changes to p1's flag.
    applyMinesweeperAction(seats, state, 'p1', { kind: 'flag', r: 3, c: 3 });
    // Turn is now p2's.
    // p2 is active. They toggle flag on (3,3) -> changes to p2's flag.
    applyMinesweeperAction(seats, state, 'p2', { kind: 'flag', r: 3, c: 3 });
    // Turn is now p1's.
    // p1 is active. They toggle flag on (3, 3) -> changes to p1's flag.
    applyMinesweeperAction(seats, state, 'p1', { kind: 'flag', r: 3, c: 3 });
    // Turn is now p2's.
    // p2 is active. They toggle (3,3) -> changes to p2's flag.
    applyMinesweeperAction(seats, state, 'p2', { kind: 'flag', r: 3, c: 3 });
    // Turn is now p1's.
    // Let's say p1 wants to clear the flag on (3,3). Wait, they are active. They toggle flag on (3,3) -> changes to p1's flag.
    // If they want to clear it, they have to wait for their turn again! Yes, because toggling flag changes it to their flag, and then next toggle clears it.
    // Let's verify:
    applyMinesweeperAction(seats, state, 'p1', { kind: 'flag', r: 3, c: 3 }); // Flag becomes p1's. Turn becomes p2.
    // p2 passes turn by revealing (9, 9)
    applyMinesweeperAction(seats, state, 'p2', { kind: 'reveal', r: 9, c: 9 }); // Turn becomes p1.
    // p1 is active. Toggles flag on (3, 3) -> since it is flagged by p1, it removes the flag!
    const p1UnflagRes = applyMinesweeperAction(seats, state, 'p1', { kind: 'flag', r: 3, c: 3 });
    expect(p1UnflagRes.ok).toBe(true);
    expect(state.board[3][3].flaggedBy).toBeNull();
    expect(state.turnSeat).toBe(1);
  });

  it('should end the game when all mines are discovered and calculate correct final scores', () => {
    const seats: Seats = ['p1', 'p2'];
    const state = dealMinesweeper(seats);

    // Clear all mines
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        state.board[r][c].hasMine = false;
      }
    }
    // For 15 mines, let's place 15 mines at (0, 0) to (0, 9) and (1, 0) to (1, 4)
    let count = 0;
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (count < MINE_COUNT) {
          state.board[r][c].hasMine = true;
          count++;
        }
      }
    }

    // Now let's trigger clicking/exploding of some mines, and flagging of others.
    // Since turn switches, let's make moves.
    // Explode mine at (0, 0) on p1's turn
    applyMinesweeperAction(seats, state, 'p1', { kind: 'reveal', r: 0, c: 0 }); // p1 score = -1, turn = p2
    // Flag mine at (0, 1) on p2's turn
    applyMinesweeperAction(seats, state, 'p2', { kind: 'flag', r: 0, c: 1 }); // p2 flags (0,1), turn = p1

    // Explode mine at (0, 2) on p1's turn
    applyMinesweeperAction(seats, state, 'p1', { kind: 'reveal', r: 0, c: 2 }); // p1 score = -2, turn = p2
    // Flag mine at (0, 3) on p2's turn
    applyMinesweeperAction(seats, state, 'p2', { kind: 'flag', r: 0, c: 3 }); // p2 flags (0,3), turn = p1

    // Let's flag the rest of the mines (11 remaining, correctly, and also place 1 incorrect flag)
    // To make it quick, let's manually flag the remaining 11 mines, and also place 1 incorrect flag on a safe cell, then trigger the last flag on the last mine.
    // Let's manually flag some mines.
    // We flag correctly: (0, 4) to (0, 9) (6 mines) by 'p1', (1, 0) to (1, 3) (4 mines) by 'p2'.
    // That's 10 correctly flagged mines.
    // And 1 incorrect flag on (9, 9) by 'p2'.
    for (let c = 4; c <= 9; c++) {
      state.board[0][c].flaggedBy = 'p1';
    }
    for (let c = 0; c <= 3; c++) {
      state.board[1][c].flaggedBy = 'p2';
    }
    state.board[9][9].flaggedBy = 'p2'; // Incorrect flag

    // We have:
    // 2 exploded mines: (0, 0), (0, 2)
    // 12 correctly flagged mines: (0,1), (0,3), (0,4)..(0,9), (1,0)..(1,3)
    // Total found so far: 14 mines.
    // Remaining mine: (1, 4).
    expect(checkGameOver(state.board)).toBe(false);

    // Let's make the final move: p1 flags the last mine at (1, 4)
    // First let's make sure it is p1's turn.
    state.turnSeat = 0;
    const finalMove = applyMinesweeperAction(seats, state, 'p1', { kind: 'flag', r: 1, c: 4 });

    expect(finalMove.ok).toBe(true);
    expect(state.over).toBe(true);
    expect(state.finalScores).not.toBeNull();

    // Let's verify final scores:
    // p1:
    // - Initial click score: -2 (from 2 explosions)
    // - Correct flags: (0,4)..(0,9) (6 flags) + (1,4) (1 flag) = 7 flags -> +14 points
    // - Expected final score: -2 + 14 = 12 points
    expect(state.finalScores!['p1']).toBe(12);

    // p2:
    // - Initial click score: 0
    // - Correct flags: (0,1), (0,3), (1,0)..(1,3) = 6 flags -> +12 points
    // - Incorrect flags: (9,9) = 1 flag -> -1 point
    // - Expected final score: 0 + 12 - 1 = 11 points
    expect(state.finalScores!['p2']).toBe(11);

    // Ranking should be ['p1', 'p2']
    expect(state.ranking).toEqual(['p1', 'p2']);
  });

  it('should support chord action to clear adjacent cells when flags match adjacent count', () => {
    const seats: Seats = ['p1', 'p2'];
    const state = dealMinesweeper(seats);

    // Clear board and place 1 mine at (0, 1)
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        state.board[r][c].hasMine = false;
      }
    }
    state.board[0][1].hasMine = true;

    // Reveal (0, 0)
    state.board[0][0].revealed = true;

    // Flag (0, 1) by p2 (passing turn to p1)
    state.turnSeat = 1;
    const flagMove = applyMinesweeperAction(seats, state, 'p2', { kind: 'flag', r: 0, c: 1 });
    expect(flagMove.ok).toBe(true);

    // It's p1's turn. Chord at (0, 0) should clear the surrounding cells: (1, 0) and (1, 1)
    expect(state.turnSeat).toBe(0);
    const chordMove = applyMinesweeperAction(seats, state, 'p1', { kind: 'chord', r: 0, c: 0 });
    expect(chordMove.ok).toBe(true);
    expect(chordMove.result.kind).toBe('chord');
    expect(chordMove.result.points).toBe(1); // successfully revealed safe cells -> +1 pt

    // Verify adjacent cells (1, 0) and (1, 1) are revealed
    expect(state.board[1][0].revealed).toBe(true);
    expect(state.board[1][1].revealed).toBe(true);
  });


  it('should auto-act by clicking a random cell', () => {
    const seats: Seats = ['p1', 'p2'];
    const state = dealMinesweeper(seats);
    // Clear all mines
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        state.board[r][c].hasMine = false;
      }
    }

    const res = autoActMinesweeper(seats, state);
    expect(res).not.toBeNull();
    expect(res!.ok).toBe(true);
    expect(state.turnSeat).toBe(1); // turn changes
  });
});
