import { TURN_MS, type PlayerId, type DndAction, type DndCellView, type DndSeatInfo, type DndPiece, type LogEvent } from 'shared';

export type Seats = Array<PlayerId | null>;

export interface DndState {
  board: DndCellView[][];
  turnSeat: number;
  turnDeadline: number;
  over: boolean;
  seats: Record<number, DndSeatInfo>;
  ranking: PlayerId[];
}

export type DndError =
  | 'GAME_NOT_RUNNING'
  | 'NOT_YOUR_TURN'
  | 'INVALID_CELL'
  | 'CELL_OCCUPIED'
  | 'TARGET_OUT_OF_RANGE'
  | 'TARGET_NOT_FOUND'
  | 'BAD_ACTION';

export const DND_ERROR_MESSAGE: Record<DndError, string> = {
  GAME_NOT_RUNNING: '遊戲尚未開始或已結束',
  NOT_YOUR_TURN: '還沒輪到你行動',
  INVALID_CELL: '無效的移動座標',
  CELL_OCCUPIED: '該格子已被佔用',
  TARGET_OUT_OF_RANGE: '目標超出攻擊範圍（必須鄰近上下左右一格）',
  TARGET_NOT_FOUND: '找不到攻擊目標',
  BAD_ACTION: '無效的行動指令',
};

export const BOARD_SIZE = 8;

export function dealDnd(seats: Seats, rng: () => number = Math.random): DndState {
  const board: DndCellView[][] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    const row: DndCellView[] = [];
    for (let c = 0; c < BOARD_SIZE; c++) {
      row.push({ r, c, piece: null });
    }
    board.push(row);
  }

  const stateSeats: Record<number, DndSeatInfo> = {};

  // Place players at corner starting points
  // Seat 0: (0,0), Seat 1: (0,7), Seat 2: (7,0), Seat 3: (7,7)
  const starts = [
    { r: 0, c: 0 },
    { r: 0, c: 7 },
    { r: 7, c: 0 },
    { r: 7, c: 7 },
  ];

  const npcClasses = ['Warrior (戰士)', 'Rogue (盜賊)', 'Mage (法師)', 'Cleric (牧師)'];

  for (let seatIndex = 0; seatIndex < 4; seatIndex++) {
    const playerId = seats[seatIndex];
    const pos = starts[seatIndex] || { r: 0, c: 0 };
    if (playerId) {
      const piece: DndPiece = {
        id: `p-${playerId}`,
        type: 'player',
        playerId,
        name: `Player ${seatIndex + 1}`,
        hp: 20,
        maxHp: 20,
        ac: 12,
      };
      const targetCell = board[pos.r]?.[pos.c];
      if (targetCell) {
        targetCell.piece = piece;
      }
      stateSeats[seatIndex] = { hp: 20, maxHp: 20, alive: true, isNpc: false, name: `Player ${seatIndex + 1}` };
    } else {
      // Spawn NPC player
      const npcName = `NPC ${npcClasses[seatIndex] || 'Adventurer'}`;
      const piece: DndPiece = {
        id: `npc-${seatIndex}`,
        type: 'player',
        name: npcName,
        hp: 20,
        maxHp: 20,
        ac: 12,
      };
      const targetCell = board[pos.r]?.[pos.c];
      if (targetCell) {
        targetCell.piece = piece;
      }
      stateSeats[seatIndex] = { hp: 20, maxHp: 20, alive: true, isNpc: true, name: npcName };
    }
  }

  // Place 6 Goblins of different varieties near the center
  const monsterSpawns = [
    { r: 3, c: 3, name: 'Goblin A', hp: 8, ac: 10 },
    { r: 3, c: 4, name: 'Goblin B', hp: 8, ac: 10 },
    { r: 4, c: 3, name: 'Goblin C', hp: 8, ac: 10 },
    { r: 4, c: 4, name: 'Goblin D', hp: 8, ac: 10 },
    { r: 2, c: 5, name: 'Goblin Shaman (薩滿)', hp: 12, ac: 10 },
    { r: 5, c: 2, name: 'Goblin Chief (酋長)', hp: 18, ac: 12 },
  ];

  monsterSpawns.forEach((spawn, idx) => {
    const targetCell = board[spawn.r]?.[spawn.c];
    if (targetCell) {
      targetCell.piece = {
        id: `m-${idx}`,
        type: 'goblin',
        name: spawn.name,
        hp: spawn.hp,
        maxHp: spawn.hp,
        ac: spawn.ac,
      };
    }
  });

  const turnSeat = seats.findIndex((id) => id !== null);

  return {
    board,
    turnSeat,
    turnDeadline: Date.now() + TURN_MS,
    over: false,
    seats: stateSeats,
    ranking: [],
  };
}

export function nextActiveDndSeat(seats: Seats, currentSeat: number, stateSeats: Record<number, DndSeatInfo>): number {
  for (let step = 1; step <= 4; step++) {
    const seat = (currentSeat + step) % 4;
    if (stateSeats[seat]?.alive) return seat;
  }
  return currentSeat;
}

export type DndApplyResult =
  | { ok: true; events: LogEvent[] }
  | { ok: false; error: DndError };

export function applyDndAction(
  seats: Seats,
  state: DndState,
  playerId: PlayerId,
  action: DndAction,
  rng: () => number = Math.random,
): DndApplyResult {
  if (state.over) return { ok: false, error: 'GAME_NOT_RUNNING' };

  const activeSeat = state.turnSeat;
  if (seats[activeSeat] !== playerId) return { ok: false, error: 'NOT_YOUR_TURN' };

  // Find player piece
  let pr = -1, pc = -1;
  let playerPiece: DndPiece | null = null;
  for (let r = 0; r < BOARD_SIZE; r++) {
    const row = state.board[r];
    if (!row) continue;
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = row[c]?.piece;
      if (piece && piece.type === 'player' && piece.playerId === playerId) {
        pr = r;
        pc = c;
        playerPiece = piece;
        break;
      }
    }
  }

  if (!playerPiece) return { ok: false, error: 'BAD_ACTION' };

  const events: LogEvent[] = [];
  const { kind, dir, targetId } = action;

  if (kind === 'move') {
    if (!dir) return { ok: false, error: 'BAD_ACTION' };
    let tr = pr;
    let tc = pc;
    if (dir === 'up') tr--;
    else if (dir === 'down') tr++;
    else if (dir === 'left') tc--;
    else if (dir === 'right') tc++;

    const targetCell = state.board[tr]?.[tc];
    const sourceCell = state.board[pr]?.[pc];

    if (!targetCell || !sourceCell) {
      return { ok: false, error: 'INVALID_CELL' };
    }

    if (targetCell.piece !== null) {
      return { ok: false, error: 'CELL_OCCUPIED' };
    }

    // Move piece
    targetCell.piece = playerPiece;
    sourceCell.piece = null;

    events.push({ t: 'dndMove', player: playerPiece.name, dir });
  } else if (kind === 'attack') {
    if (!targetId) return { ok: false, error: 'BAD_ACTION' };

    // Find target
    let tr = -1, tc = -1;
    let targetPiece: DndPiece | null = null;
    for (let r = 0; r < BOARD_SIZE; r++) {
      const row = state.board[r];
      if (!row) continue;
      for (let c = 0; c < BOARD_SIZE; c++) {
        const piece = row[c]?.piece;
        if (piece && piece.id === targetId) {
          tr = r;
          tc = c;
          targetPiece = piece;
          break;
        }
      }
    }

    if (!targetPiece) return { ok: false, error: 'TARGET_NOT_FOUND' };

    // Check adjacent (Manhattan distance === 1)
    const dist = Math.abs(pr - tr) + Math.abs(pc - tc);
    if (dist !== 1) return { ok: false, error: 'TARGET_OUT_OF_RANGE' };

    const roll = Math.floor(rng() * 20) + 1;
    const isHit = roll + 3 >= targetPiece.ac; // +3 Attack Bonus vs AC

    if (isHit) {
      const dmgRoll = Math.floor(rng() * 6) + 1;
      const damage = dmgRoll + 2; // D6 + 2 Damage
      targetPiece.hp = Math.max(0, targetPiece.hp - damage);

      events.push({
        t: 'dndAttack',
        player: playerPiece.name,
        target: targetPiece.name,
        roll,
        hit: true,
        damage,
      });

      if (targetPiece.hp <= 0) {
        const targetCell = state.board[tr]?.[tc];
        if (targetCell) {
          targetCell.piece = null; // Defeated monster
        }
      }
    } else {
      events.push({
        t: 'dndAttack',
        player: playerPiece.name,
        target: targetPiece.name,
        roll,
        hit: false,
        damage: 0,
      });
    }
  } else {
    return { ok: false, error: 'BAD_ACTION' };
  }

  // End of player turn.
  // Check Game Over Condition
  let checkResult = checkDndGameOver(seats, state);
  if (checkResult.over) {
    state.over = true;
    state.ranking = checkResult.ranking;
    events.push({ t: 'dndOver', won: checkResult.won });
    return { ok: true, events };
  }

  // Check if round is finished (is this the last alive player in the sequence?)
  const aliveSeats: number[] = [];
  for (let idx = 0; idx < 4; idx++) {
    if (state.seats[idx]?.alive) {
      aliveSeats.push(idx);
    }
  }

  const isLastPlayerOfRound = activeSeat === Math.max(...aliveSeats);
  if (isLastPlayerOfRound) {
    // Run Goblins Turn!
    const monsterEvents = runMonstersTurn(seats, state, rng);
    events.push({ t: 'dndMonsterTurn' });
    events.push(...monsterEvents);

    checkResult = checkDndGameOver(seats, state);
    if (checkResult.over) {
      state.over = true;
      state.ranking = checkResult.ranking;
      events.push({ t: 'dndOver', won: checkResult.won });
      return { ok: true, events };
    }
  }

  // Shift turn to next player (may be an NPC)
  let nextSeat = nextActiveDndSeat(seats, activeSeat, state.seats);

  // Automatically execute NPC turns
  while (state.seats[nextSeat]?.isNpc && !state.over) {
    const npcEvents = runNpcTurn(seats, state, nextSeat, rng);
    events.push(...npcEvents);

    // Check if game is over after NPC turn
    checkResult = checkDndGameOver(seats, state);
    if (checkResult.over) {
      state.over = true;
      state.ranking = checkResult.ranking;
      events.push({ t: 'dndOver', won: checkResult.won });
      break;
    }

    // Check if the NPC was the last player in the round
    const currentAliveSeats: number[] = [];
    for (let idx = 0; idx < 4; idx++) {
      if (state.seats[idx]?.alive) {
        currentAliveSeats.push(idx);
      }
    }
    const isNpcLastPlayerOfRound = nextSeat === Math.max(...currentAliveSeats);
    if (isNpcLastPlayerOfRound) {
      const monsterEvents = runMonstersTurn(seats, state, rng);
      events.push({ t: 'dndMonsterTurn' });
      events.push(...monsterEvents);

      checkResult = checkDndGameOver(seats, state);
      if (checkResult.over) {
        state.over = true;
        state.ranking = checkResult.ranking;
        events.push({ t: 'dndOver', won: checkResult.won });
        break;
      }
    }

    nextSeat = nextActiveDndSeat(seats, nextSeat, state.seats);
  }

  if (!state.over) {
    state.turnSeat = nextSeat;
    state.turnDeadline = Date.now() + TURN_MS;
  }

  return { ok: true, events };
}

function runMonstersTurn(seats: Seats, state: DndState, rng: () => number): LogEvent[] {
  const events: LogEvent[] = [];

  // Find all monsters
  const monsters: { piece: DndPiece; r: number; c: number }[] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    const row = state.board[r];
    if (!row) continue;
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = row[c]?.piece;
      if (piece && piece.type === 'goblin') {
        monsters.push({ piece, r, c });
      }
    }
  }

  monsters.forEach((mon) => {
    // Find nearest alive player
    let targetPlayer: { piece: DndPiece; r: number; c: number; seat: number } | null = null;
    let minDist = 9999;

    for (let r = 0; r < BOARD_SIZE; r++) {
      const row = state.board[r];
      if (!row) continue;
      for (let c = 0; c < BOARD_SIZE; c++) {
        const piece = row[c]?.piece;
        if (piece && piece.type === 'player') {
          let seat = -1;
          if (piece.playerId) {
            seat = seats.indexOf(piece.playerId);
          } else if (piece.id.startsWith('npc-')) {
            seat = parseInt(piece.id.split('-')[1]!, 10);
          }

          if (seat !== -1 && state.seats[seat]?.alive) {
            const dist = Math.abs(mon.r - r) + Math.abs(mon.c - c);
            if (dist < minDist) {
              minDist = dist;
              targetPlayer = { piece, r, c, seat };
            }
          }
        }
      }
    }

    if (!targetPlayer) return;

    // If player is adjacent (Manhattan distance === 1), Attack!
    if (minDist === 1) {
      const roll = Math.floor(rng() * 20) + 1;
      const isHit = roll + 1 >= targetPlayer.piece.ac; // +1 Attack Bonus vs AC 12

      if (isHit) {
        const dmg = Math.floor(rng() * 4) + 1; // D4 Damage
        targetPlayer.piece.hp = Math.max(0, targetPlayer.piece.hp - dmg);
        const playerSeat = state.seats[targetPlayer.seat];
        if (playerSeat) {
          playerSeat.hp = targetPlayer.piece.hp;
        }

        events.push({
          t: 'dndAttack',
          player: mon.piece.name,
          target: `Player ${targetPlayer.seat + 1}`,
          roll,
          hit: true,
          damage: dmg,
        });

        if (targetPlayer.piece.hp <= 0) {
          if (playerSeat) {
            playerSeat.alive = false;
          }
          const playerCell = state.board[targetPlayer.r]?.[targetPlayer.c];
          if (playerCell) {
            playerCell.piece = null; // Remove dead player token
          }
        }
      } else {
        events.push({
          t: 'dndAttack',
          player: mon.piece.name,
          target: `Player ${targetPlayer.seat + 1}`,
          roll,
          hit: false,
          damage: 0,
        });
      }
    } else {
      // Move closer to player
      const moves = [
        { r: mon.r - 1, c: mon.c, dir: 'up' },
        { r: mon.r + 1, c: mon.c, dir: 'down' },
        { r: mon.r, c: mon.c - 1, dir: 'left' },
        { r: mon.r, c: mon.c + 1, dir: 'right' },
      ];

      let bestMove: { r: number; c: number; dir: string } | null = null;
      let bestDist = minDist;

      for (const move of moves) {
        if (move.r >= 0 && move.r < BOARD_SIZE && move.c >= 0 && move.c < BOARD_SIZE) {
          const targetCell = state.board[move.r]?.[move.c];
          if (targetCell && targetCell.piece === null) {
            const d = Math.abs(move.r - targetPlayer.r) + Math.abs(move.c - targetPlayer.c);
            if (d < bestDist) {
              bestDist = d;
              bestMove = move;
            }
          }
        }
      }

      if (bestMove) {
        const targetCell = state.board[bestMove.r]?.[bestMove.c];
        const sourceCell = state.board[mon.r]?.[mon.c];
        if (targetCell && sourceCell) {
          targetCell.piece = mon.piece;
          sourceCell.piece = null;
          mon.r = bestMove.r;
          mon.c = bestMove.c;
          events.push({ t: 'dndMove', player: mon.piece.name, dir: bestMove.dir });
        }
      }
    }
  });

  return events;
}

interface GameOverCheck {
  over: boolean;
  won: boolean;
  ranking: PlayerId[];
}

function checkDndGameOver(seats: Seats, state: DndState): GameOverCheck {
  // Check Goblins
  let goblinCount = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    const row = state.board[r];
    if (!row) continue;
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = row[c]?.piece;
      if (piece && piece.type === 'goblin') goblinCount++;
    }
  }

  // Check Players
  const alivePlayers = seats.filter((id, idx) => id && state.seats[idx]?.alive);

  if (goblinCount === 0) {
    // Players win!
    // Rank by HP left
    const ranked = seats
      .filter((id): id is PlayerId => id !== null)
      .sort((a, b) => {
        const seatA = seats.indexOf(a);
        const seatB = seats.indexOf(b);
        const hpA = state.seats[seatA]?.hp ?? 0;
        const hpB = state.seats[seatB]?.hp ?? 0;
        return hpB - hpA;
      });
    return { over: true, won: true, ranking: ranked };
  }

  if (alivePlayers.length === 0) {
    // Players lose!
    const ranked = seats
      .filter((id): id is PlayerId => id !== null)
      .sort((a, b) => {
        const seatA = seats.indexOf(a);
        const seatB = seats.indexOf(b);
        const hpA = state.seats[seatA]?.hp ?? 0;
        const hpB = state.seats[seatB]?.hp ?? 0;
        return hpB - hpA;
      });
    return { over: true, won: false, ranking: ranked };
  }

  return { over: false, won: false, ranking: [] };
}

export function autoActDnd(seats: Seats, state: DndState): DndApplyResult | null {
  const activeSeat = state.turnSeat;
  const playerId = seats[activeSeat];
  if (!playerId) return null;

  // Simple auto-act: try to attack any adjacent goblin. If none, move in a random direction.
  let pr = -1, pc = -1;
  let playerPiece: DndPiece | null = null;
  for (let r = 0; r < BOARD_SIZE; r++) {
    const row = state.board[r];
    if (!row) continue;
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = row[c]?.piece;
      if (piece && piece.type === 'player' && piece.playerId === playerId) {
        pr = r;
        pc = c;
        playerPiece = piece;
        break;
      }
    }
  }

  if (!playerPiece) return null;

  // Search for adjacent goblin
  const dirs = [
    { dr: -1, dc: 0, dir: 'up' },
    { dr: 1, dc: 0, dir: 'down' },
    { dr: 0, dc: -1, dir: 'left' },
    { dr: 0, dc: 1, dir: 'right' },
  ];

  for (const d of dirs) {
    const nr = pr + d.dr;
    const nc = pc + d.dc;
    const targetCell = state.board[nr]?.[nc];
    if (targetCell) {
      const target = targetCell.piece;
      if (target && target.type === 'goblin') {
        return applyDndAction(seats, state, playerId, { kind: 'attack', targetId: target.id });
      }
    }
  }

  // No adjacent goblin, move to any empty random neighbor
  const shuffledDirs = dirs.sort(() => Math.random() - 0.5);
  for (const d of shuffledDirs) {
    const nr = pr + d.dr;
    const nc = pc + d.dc;
    const targetCell = state.board[nr]?.[nc];
    if (targetCell && targetCell.piece === null) {
      return applyDndAction(seats, state, playerId, { kind: 'move', dir: d.dir as any });
    }
  }

  return null;
}

export function removePlayerFromDnd(seats: Seats, state: DndState, playerId: PlayerId): void {
  const seatIndex = seats.indexOf(playerId);
  if (seatIndex === -1) return;

  // Mark player dead/inactive
  if (state.seats[seatIndex]) {
    state.seats[seatIndex].alive = false;
  }

  // Remove player piece from board
  for (let r = 0; r < BOARD_SIZE; r++) {
    const row = state.board[r];
    if (!row) continue;
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = row[c]?.piece;
      if (piece && piece.type === 'player' && piece.playerId === playerId) {
        row[c]!.piece = null;
        break;
      }
    }
  }

  seats[seatIndex] = null;

  const activePlayers = seats.filter((id): id is PlayerId => id !== null);
  if (activePlayers.length === 0) {
    state.over = true;
    return;
  }

  if (state.turnSeat === seatIndex) {
    state.turnSeat = nextActiveDndSeat(seats, state.turnSeat, state.seats);
    state.turnDeadline = Date.now() + TURN_MS;
  }
}

function runNpcTurn(seats: Seats, state: DndState, npcSeat: number, rng: () => number): LogEvent[] {
  const events: LogEvent[] = [];
  const npcInfo = state.seats[npcSeat];
  if (!npcInfo || !npcInfo.alive) return [];

  const npcId = `npc-${npcSeat}`;
  const npcName = npcInfo.name || `NPC ${npcSeat + 1}`;

  // Find NPC piece position
  let pr = -1, pc = -1;
  let npcPiece: DndPiece | null = null;
  for (let r = 0; r < BOARD_SIZE; r++) {
    const row = state.board[r];
    if (!row) continue;
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = row[c]?.piece;
      if (piece && piece.id === npcId) {
        pr = r;
        pc = c;
        npcPiece = piece;
        break;
      }
    }
  }

  if (!npcPiece) return [];

  const dirs = [
    { dr: -1, dc: 0, dir: 'up' },
    { dr: 1, dc: 0, dir: 'down' },
    { dr: 0, dc: -1, dir: 'left' },
    { dr: 0, dc: 1, dir: 'right' },
  ];

  let targetGoblin: DndPiece | null = null;
  let targetR = -1, targetC = -1;

  for (const d of dirs) {
    const nr = pr + d.dr;
    const nc = pc + d.dc;
    const targetCell = state.board[nr]?.[nc];
    if (targetCell && targetCell.piece && targetCell.piece.type === 'goblin') {
      targetGoblin = targetCell.piece;
      targetR = nr;
      targetC = nc;
      break;
    }
  }

  if (targetGoblin) {
    // Attack!
    const roll = Math.floor(rng() * 20) + 1;
    const isHit = roll + 3 >= targetGoblin.ac; // +3 Attack Bonus vs AC 10

    if (isHit) {
      const dmgRoll = Math.floor(rng() * 6) + 1;
      const damage = dmgRoll + 2; // D6 + 2 Damage
      targetGoblin.hp = Math.max(0, targetGoblin.hp - damage);

      events.push({
        t: 'dndAttack',
        player: npcName,
        target: targetGoblin.name,
        roll,
        hit: true,
        damage,
      });

      if (targetGoblin.hp <= 0) {
        const targetCell = state.board[targetR]?.[targetC];
        if (targetCell) {
          targetCell.piece = null; // Defeated monster
        }
      }
    } else {
      events.push({
        t: 'dndAttack',
        player: npcName,
        target: targetGoblin.name,
        roll,
        hit: false,
        damage: 0,
      });
    }
  } else {
    // Find nearest goblin to move towards
    let targetMon: { piece: DndPiece; r: number; c: number } | null = null;
    let minDist = 9999;

    for (let r = 0; r < BOARD_SIZE; r++) {
      const row = state.board[r];
      if (!row) continue;
      for (let c = 0; c < BOARD_SIZE; c++) {
        const piece = row[c]?.piece;
        if (piece && piece.type === 'goblin') {
          const dist = Math.abs(pr - r) + Math.abs(pc - c);
          if (dist < minDist) {
            minDist = dist;
            targetMon = { piece, r, c };
          }
        }
      }
    }

    if (targetMon) {
      // Find best move that gets closer to the goblin
      let bestMove: { r: number; c: number; dir: string } | null = null;
      let bestDist = minDist;

      for (const d of dirs) {
        const nr = pr + d.dr;
        const nc = pc + d.dc;
        const targetCell = state.board[nr]?.[nc];
        if (targetCell && targetCell.piece === null) {
          const dist = Math.abs(nr - targetMon.r) + Math.abs(nc - targetMon.c);
          if (dist < bestDist) {
            bestDist = dist;
            bestMove = { r: nr, c: nc, dir: d.dir };
          }
        }
      }

      if (bestMove) {
        const targetCell = state.board[bestMove.r]?.[bestMove.c];
        const sourceCell = state.board[pr]?.[pc];
        if (targetCell && sourceCell) {
          targetCell.piece = npcPiece;
          sourceCell.piece = null;
          events.push({ t: 'dndMove', player: npcName, dir: bestMove.dir });
        }
      }
    }
  }

  return events;
}
