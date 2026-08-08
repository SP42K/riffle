import { TURN_MS, type PlayerId, type DndAction, type DndCellView, type DndSeatInfo, type DndPiece, type LogEvent, type DownstairsCharacterId } from 'shared';

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

export const CLASS_STATS: Record<DownstairsCharacterId, { name: string; hp: number; ac: number; attackBonus: number; dmgDice: number; dmgFlat: number; description: string }> = {
  brave: { name: 'Warrior (戰士)', hp: 24, ac: 14, attackBonus: 4, dmgDice: 8, dmgFlat: 2, description: '前線坦攻，高防高血 D8+2' },
  bubble: { name: 'Rogue (盜賊)', hp: 18, ac: 12, attackBonus: 5, dmgDice: 6, dmgFlat: 4, description: '突襲刺客，高命中 D6+4' },
  tangerine: { name: 'Mage (法師)', hp: 16, ac: 10, attackBonus: 3, dmgDice: 10, dmgFlat: 2, description: '遠程爆發，高傷害 D10+2' },
  star: { name: 'Cleric (牧師)', hp: 20, ac: 12, attackBonus: 3, dmgDice: 6, dmgFlat: 2, description: '神聖判官，D6+2，命中時治癒自己 2 HP' },
};

const DEFAULT_SEAT_CLASSES: DownstairsCharacterId[] = ['brave', 'bubble', 'tangerine', 'star'];

export function dealDnd(
  seats: Seats,
  characterIds?: Record<PlayerId, DownstairsCharacterId>,
  rng: () => number = Math.random
): DndState {
  const board: DndCellView[][] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    const row: DndCellView[] = [];
    for (let c = 0; c < BOARD_SIZE; c++) {
      row.push({ r, c, piece: null });
    }
    board.push(row);
  }

  const stateSeats: Record<number, DndSeatInfo> = {};

  const starts = [
    { r: 0, c: 0 },
    { r: 0, c: 7 },
    { r: 7, c: 0 },
    { r: 7, c: 7 },
  ];

  for (let seatIndex = 0; seatIndex < 4; seatIndex++) {
    const playerId = seats[seatIndex];
    const pos = starts[seatIndex] || { r: 0, c: 0 };
    const classId = (playerId && characterIds?.[playerId]) || DEFAULT_SEAT_CLASSES[seatIndex]!;
    const stats = CLASS_STATS[classId];

    if (playerId) {
      const piece: DndPiece = {
        id: `p-${playerId}`,
        type: 'player',
        playerId,
        name: `${stats.name}`,
        hp: stats.hp,
        maxHp: stats.hp,
        ac: stats.ac,
        classId,
      };
      const targetCell = board[pos.r]?.[pos.c];
      if (targetCell) {
        targetCell.piece = piece;
      }
      stateSeats[seatIndex] = { hp: stats.hp, maxHp: stats.hp, alive: true, isNpc: false, name: `${stats.name}` };
    } else {
      const npcName = `NPC ${stats.name}`;
      const piece: DndPiece = {
        id: `npc-${seatIndex}`,
        type: 'player',
        name: npcName,
        hp: stats.hp,
        maxHp: stats.hp,
        ac: stats.ac,
        classId,
      };
      const targetCell = board[pos.r]?.[pos.c];
      if (targetCell) {
        targetCell.piece = piece;
      }
      stateSeats[seatIndex] = { hp: stats.hp, maxHp: stats.hp, alive: true, isNpc: true, name: npcName };
    }
  }

  // Place 6 Goblins of different varieties near the center
  const monsterSpawns = [
    { r: 3, c: 3, name: 'Goblin A', hp: 10, ac: 10 },
    { r: 3, c: 4, name: 'Goblin B', hp: 10, ac: 10 },
    { r: 4, c: 3, name: 'Goblin C', hp: 10, ac: 10 },
    { r: 4, c: 4, name: 'Goblin D', hp: 10, ac: 10 },
    { r: 2, c: 5, name: 'Goblin Shaman (薩滿)', hp: 16, ac: 10 },
    { r: 5, c: 2, name: 'Goblin Chief (酋長)', hp: 24, ac: 12 },
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

    targetCell.piece = playerPiece;
    sourceCell.piece = null;

    events.push({ t: 'dndMove', player: playerPiece.name, dir });
  } else if (kind === 'attack') {
    if (!targetId) return { ok: false, error: 'BAD_ACTION' };

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

    const dist = Math.abs(pr - tr) + Math.abs(pc - tc);
    if (dist !== 1) return { ok: false, error: 'TARGET_OUT_OF_RANGE' };

    const classId = playerPiece.classId || 'brave';
    const stats = CLASS_STATS[classId];
    const roll = Math.floor(rng() * 20) + 1;
    const isHit = roll + stats.attackBonus >= targetPiece.ac;

    if (isHit) {
      const dmgRoll = Math.floor(rng() * stats.dmgDice) + 1;
      const damage = dmgRoll + stats.dmgFlat;
      targetPiece.hp = Math.max(0, targetPiece.hp - damage);

      if (classId === 'star') {
        playerPiece.hp = Math.min(playerPiece.maxHp, playerPiece.hp + 2);
        const seat = seats.indexOf(playerId);
        if (state.seats[seat]) {
          state.seats[seat].hp = playerPiece.hp;
        }
      }

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
          targetCell.piece = null;
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

  let checkResult = checkDndGameOver(seats, state);
  if (checkResult.over) {
    state.over = true;
    state.ranking = checkResult.ranking;
    events.push({ t: 'dndOver', won: checkResult.won });
    return { ok: true, events };
  }

  const aliveSeats: number[] = [];
  for (let idx = 0; idx < 4; idx++) {
    if (state.seats[idx]?.alive) {
      aliveSeats.push(idx);
    }
  }

  const isLastPlayerOfRound = activeSeat === Math.max(...aliveSeats);
  if (isLastPlayerOfRound) {
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

  let nextSeat = nextActiveDndSeat(seats, activeSeat, state.seats);

  while (state.seats[nextSeat]?.isNpc && !state.over) {
    const npcEvents = runNpcTurn(seats, state, nextSeat, rng);
    events.push(...npcEvents);

    checkResult = checkDndGameOver(seats, state);
    if (checkResult.over) {
      state.over = true;
      state.ranking = checkResult.ranking;
      events.push({ t: 'dndOver', won: checkResult.won });
      break;
    }

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
    // Shaman Special Healing Logic
    if (mon.piece.name.includes('薩滿') || mon.piece.name.includes('Shaman')) {
      let targetGoblinToHeal: { piece: DndPiece; r: number; c: number } | null = null;
      let minHealDist = 9999;
      
      for (const otherMon of monsters) {
        if (otherMon.piece.id !== mon.piece.id && otherMon.piece.hp < otherMon.piece.maxHp) {
          const dist = Math.abs(mon.r - otherMon.r) + Math.abs(mon.c - otherMon.c);
          if (dist <= 3 && dist < minHealDist) {
            minHealDist = dist;
            targetGoblinToHeal = otherMon;
          }
        }
      }

      if (targetGoblinToHeal) {
        const healAmt = 3;
        targetGoblinToHeal.piece.hp = Math.min(targetGoblinToHeal.piece.maxHp, targetGoblinToHeal.piece.hp + healAmt);
        events.push({
          t: 'dndAttack',
          player: mon.piece.name,
          target: targetGoblinToHeal.piece.name,
          roll: 0,
          hit: true,
          damage: -healAmt,
        });
        return;
      }
    }

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

    if (minDist === 1) {
      let attackBonus = 1;
      let dmgDice = 6;
      if (mon.piece.name.includes('酋長') || mon.piece.name.includes('Chief')) {
        attackBonus = 4;
        dmgDice = 10;
      } else if (mon.piece.name.includes('薩滿') || mon.piece.name.includes('Shaman')) {
        attackBonus = 2;
        dmgDice = 6;
      }

      const roll = Math.floor(rng() * 20) + 1;
      const isHit = roll + attackBonus >= targetPlayer.piece.ac;

      if (isHit) {
        const dmg = Math.floor(rng() * dmgDice) + 1;
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
            playerCell.piece = null;
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
          events.push({ t: 'dndMove', player: mon.piece.name, dir: bestMove.dir });
        }
      }
    }
  });

  return events;
}

export function checkDndGameOver(seats: Seats, state: DndState): { over: boolean; won: boolean; ranking: PlayerId[] } {
  let aliveCount = 0;
  for (let idx = 0; idx < 4; idx++) {
    if (state.seats[idx]?.alive) {
      aliveCount++;
    }
  }

  let goblinCount = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    const row = state.board[r];
    if (!row) continue;
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = row[c]?.piece;
      if (piece && piece.type === 'goblin') {
        goblinCount++;
      }
    }
  }

  if (goblinCount === 0) {
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

  if (aliveCount === 0) {
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

  if (state.seats[seatIndex]) {
    state.seats[seatIndex].alive = false;
  }

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
    const classId = npcPiece.classId || 'brave';
    const stats = CLASS_STATS[classId];
    const roll = Math.floor(rng() * 20) + 1;
    const isHit = roll + stats.attackBonus >= targetGoblin.ac;

    if (isHit) {
      const dmgRoll = Math.floor(rng() * stats.dmgDice) + 1;
      const damage = dmgRoll + stats.dmgFlat;
      targetGoblin.hp = Math.max(0, targetGoblin.hp - damage);

      if (classId === 'star') {
        npcPiece.hp = Math.min(npcPiece.maxHp, npcPiece.hp + 2);
        if (state.seats[npcSeat]) {
          state.seats[npcSeat].hp = npcPiece.hp;
        }
      }

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
          targetCell.piece = null;
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
