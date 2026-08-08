// @ts-nocheck
import { describe, it, expect } from 'vitest';
import {
  dealDnd,
  applyDndAction,
  autoActDnd,
  removePlayerFromDnd,
  BOARD_SIZE,
  type Seats,
} from './dndEngine.js';

describe('D&D Game Engine', () => {
  it('should initialize the board with players and monsters correctly', () => {
    const seats: Seats = ['p1', 'p2', null, null];
    const state = dealDnd(seats);

    expect(state.board.length).toBe(BOARD_SIZE);
    expect(state.board[0].length).toBe(BOARD_SIZE);
    expect(state.over).toBe(false);

    // Verify player 1 starting position
    const cellP1 = state.board[0][0];
    expect(cellP1.piece).not.toBeNull();
    expect(cellP1.piece!.type).toBe('player');
    expect(cellP1.piece!.playerId).toBe('p1');

    // Verify player 2 starting position
    const cellP2 = state.board[0][7];
    expect(cellP2.piece).not.toBeNull();
    expect(cellP2.piece!.type).toBe('player');
    expect(cellP2.piece!.playerId).toBe('p2');

    // Verify monster spawn
    const goblinCell = state.board[3][3];
    expect(goblinCell.piece).not.toBeNull();
    expect(goblinCell.piece!.type).toBe('goblin');
  });

  it('should allow player to move in valid directions and reject invalid moves', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats);

    // Initial position is (0, 0)
    expect(state.board[0][0].piece).not.toBeNull();
    expect(state.board[0][0].piece!.playerId).toBe('p1');

    // Try to move left (out of bounds) -> should fail
    const moveLeft = applyDndAction(seats, state, 'p1', { kind: 'move', dir: 'left' });
    expect(moveLeft.ok).toBe(false);
    expect(moveLeft.error).toBe('INVALID_CELL');

    // Move down to (1, 0) -> should succeed
    const moveDown = applyDndAction(seats, state, 'p1', { kind: 'move', dir: 'down' });
    expect(moveDown.ok).toBe(true);
    expect(state.board[1][0].piece).not.toBeNull();
    expect(state.board[1][0].piece!.playerId).toBe('p1');
    expect(state.board[0][0].piece).toBeNull();
  });

  it('should handle combat rolls, hit checks, and target HP changes', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats);

    // Teleport player near a goblin at (3, 3) to (3, 2)
    const playerPiece = state.board[0][0].piece;
    state.board[0][0].piece = null;
    state.board[3][2].piece = playerPiece;

    // Verify attack fails if out of range -> attack goblin at (3, 3) from (0,0) (teleported, so it should succeed)
    // Wait, let's try attacking a non-adjacent target
    const farAttack = applyDndAction(seats, state, 'p1', { kind: 'attack', targetId: 'm-2' }); // m-2 is at (4,3), dist is (4-3)+(3-2) = 1+1 = 2 -> out of range!
    expect(farAttack.ok).toBe(false);
    expect(farAttack.error).toBe('TARGET_OUT_OF_RANGE');

    // Attack adjacent goblin m-0 at (3, 3) (dist is (3-3)+(3-2)=1 -> adjacent!)
    // Force rng to return 0.9 (which translates to high roll -> hit!)
    const rngHit = () => 0.9;
    const combatHit = applyDndAction(seats, state, 'p1', { kind: 'attack', targetId: 'm-0' }, rngHit);
    expect(combatHit.ok).toBe(true);
    expect(combatHit.events.some(e => e.t === 'dndAttack' && e.hit)).toBe(true);

    // Goblin hp is 8, AC is 10. Roll 0.9*20+1 = 19 (hit!). Damage is 0.9*6+1+2 = 5.4+1+2 = 8 -> goblin defeated!
    let goblinFound = false;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (state.board[r][c].piece?.id === 'm-0') {
          goblinFound = true;
        }
      }
    }
    expect(goblinFound).toBe(false);
  });

  it('should handle monster turn AI, moving monsters closer to players and attacking them', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats);

    // Move player close to Goblin A (3, 3)
    const playerPiece = state.board[0][0].piece;
    state.board[0][0].piece = null;
    state.board[2][3].piece = playerPiece; // Adjacent to (3, 3)!

    // Force RNG to return 0.5 for combat rolls
    const rng = () => 0.5;

    // Make player take an action (e.g. move to 2, 2) which triggers goblin round since p1 is the only player
    const moveAction = applyDndAction(seats, state, 'p1', { kind: 'move', dir: 'left' }, rng);
    expect(moveAction.ok).toBe(true);

    // Verify goblin turn events were generated
    expect(moveAction.events.some(e => e.t === 'dndMonsterTurn')).toBe(true);
    // Since player is at (2, 2) and Goblin A is at (3, 3), distance is (3-2)+(3-2) = 2.
    // Goblin A should move closer to (2, 2), e.g. to (2, 3) or (3, 2).
    // Let's verify Goblin A (m-0) moved away from (3,3)
    expect(state.board[3][3].piece?.id).not.toBe('m-0');
  });

  it('should check game over conditions and rank players accordingly', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats);

    // Clear all goblins to trigger victory immediately
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const piece = state.board[r][c].piece;
        if (piece && piece.type === 'goblin') {
          state.board[r][c].piece = null;
        }
      }
    }

    const actionResult = applyDndAction(seats, state, 'p1', { kind: 'move', dir: 'down' });
    expect(actionResult.ok).toBe(true);
    expect(state.over).toBe(true);
    expect(state.ranking).toEqual(['p1']);
  });

  it('should generate NPC party members for empty seats and execute their turns automatically', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats);

    // Verify 3 NPC adventurers are created
    expect(state.seats[1]?.isNpc).toBe(true);
    expect(state.seats[1]?.name).toContain('Rogue');
    expect(state.seats[2]?.isNpc).toBe(true);
    expect(state.seats[2]?.name).toContain('Mage');
    expect(state.seats[3]?.isNpc).toBe(true);
    expect(state.seats[3]?.name).toContain('Cleric');

    // Verify they are placed on the board corners (0,7), (7,0), (7,7)
    expect(state.board[0][7].piece?.id).toBe('npc-1');
    expect(state.board[7][0].piece?.id).toBe('npc-2');
    expect(state.board[7][7].piece?.id).toBe('npc-3');

    // p1 makes a move -> should trigger NPC turns and Goblin turn automatically
    const actionResult = applyDndAction(seats, state, 'p1', { kind: 'move', dir: 'down' });
    expect(actionResult.ok).toBe(true);

    // Verify NPC turns were run by checking their log events
    const rogueEvents = actionResult.events.filter(e => e.player === 'NPC Rogue (盜賊)');
    const mageEvents = actionResult.events.filter(e => e.player === 'NPC Mage (法師)');
    const clericEvents = actionResult.events.filter(e => e.player === 'NPC Cleric (牧師)');

    expect(rogueEvents.length).toBeGreaterThan(0);
    expect(mageEvents.length).toBeGreaterThan(0);
    expect(clericEvents.length).toBeGreaterThan(0);

    // Verify monsters turn ran as well at the end of the round
    expect(actionResult.events.some(e => e.t === 'dndMonsterTurn')).toBe(true);

    // Turn should return to p1 (Seat 0) since all NPCs took their turns in the loop
    expect(state.turnSeat).toBe(0);
  });
});
