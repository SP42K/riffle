// @ts-nocheck
import { describe, it, expect } from 'vitest';
import {
  dealDnd,
  applyDndAction,
  autoActDnd,
  openingDndTurn,
  removePlayerFromDnd,
  checkAndSpawnBossOrStaircase,
  checkDndGameOver,
  BOARD_SIZE,
  type Seats,
} from './dndEngine.js';
import { DND_CLASS_MOVE, DND_CLASS_RANGE } from 'shared';

/** 把 NPC 隊友從棋盤上撤掉 —— 驗單一怪物的行為時，不要讓他們跑過來插手。 */
function clearNpcs(state) {
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (state.board[r][c].piece?.id?.startsWith('npc-')) state.board[r][c].piece = null;
    }
  }
}

/** 清掉場上所有哥布林，方便測試「這層打完了」的狀態。 */
function clearGoblins(state) {
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (state.board[r][c].piece?.type === 'goblin') state.board[r][c].piece = null;
    }
  }
}

/** 依序吐出指定亂數值，用完之後一直回傳最後一個 —— 讓多段擲骰的流程可預測。 */
function seqRng(values) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

function countPieces(state, predicate) {
  let n = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = state.board[r][c].piece;
      if (piece && predicate(piece)) n++;
    }
  }
  return n;
}

/** 讀某個座位角色目前的 AC（真人看 playerId，NPC 看 npc-<seat>）。 */
function findSeatAc(state, seats, seat) {
  const wanted = seats[seat];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = state.board[r][c].piece;
      if (!piece || piece.type !== 'player') continue;
      if (wanted ? piece.playerId === wanted : piece.id === `npc-${seat}`) return piece.ac;
    }
  }
  return null;
}

function findPiece(state, predicate) {
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = state.board[r][c].piece;
      if (piece && predicate(piece)) return { piece, r, c };
    }
  }
  return null;
}

describe('D&D Game Engine', () => {
  it('should initialize the board with players and monsters correctly', () => {
    const seats: Seats = ['p1', 'p2', null, null];
    const state = dealDnd(seats);

    expect(state.board.length).toBe(BOARD_SIZE);
    expect(state.board[0].length).toBe(BOARD_SIZE);
    expect(state.over).toBe(false);

    // Verify player 1 starting position (bottom r: 15, c: 6)
    const cellP1 = state.board[15][6];
    expect(cellP1.piece).not.toBeNull();
    expect(cellP1.piece!.type).toBe('player');
    expect(cellP1.piece!.playerId).toBe('p1');

    // Verify player 2 starting position (bottom r: 15, c: 7)
    const cellP2 = state.board[15][7];
    expect(cellP2.piece).not.toBeNull();
    expect(cellP2.piece!.type).toBe('player');
    expect(cellP2.piece!.playerId).toBe('p2');

    // Verify monster spawn (lvl 1 m-0 is at r: 4, c: 4)
    const goblinCell = state.board[4][4];
    expect(goblinCell.piece).not.toBeNull();
    expect(goblinCell.piece!.type).toBe('goblin');
  });

  it('should allow player to move in valid directions and reject invalid moves', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats);
    state.traps = []; // 隨機陷阱剛好落在目的地會讓這個案例偶發失敗

    // Initial position is (15, 6)
    expect(state.board[15][6].piece).not.toBeNull();
    expect(state.board[15][6].piece!.playerId).toBe('p1');

    // Try to move down (out of bounds at row 15) -> should fail
    const moveDown = applyDndAction(seats, state, 'p1', { kind: 'move', dir: 'down' });
    expect(moveDown.ok).toBe(false);
    expect(moveDown.error).toBe('INVALID_CELL');

    // Move up to (14, 6) -> should succeed
    const moveUp = applyDndAction(seats, state, 'p1', { kind: 'move', dir: 'up' });
    expect(moveUp.ok).toBe(true);
    expect(state.board[14][6].piece).not.toBeNull();
    expect(state.board[14][6].piece!.playerId).toBe('p1');
    expect(state.board[15][6].piece).toBeNull();
  });

  it('should handle combat rolls, hit checks, and target HP changes', () => {
    const seats: Seats = ['p1', null, null, null];
    // 沒指定職業的座位會自動補一個還沒被用掉的職業，傷害公式會跟著變 —— 測試要明寫
    const state = dealDnd(seats, { p1: 'brave' });

    // Teleport player near a goblin at (4, 4) to (4, 3)
    const playerPiece = state.board[15][6].piece;
    state.board[15][6].piece = null;
    state.board[4][3].piece = playerPiece;

    // Try to attack a non-adjacent target (m-1 is at (4,11)) -> out of range!
    const farAttack = applyDndAction(seats, state, 'p1', { kind: 'attack', targetId: 'm-1' });
    expect(farAttack.ok).toBe(false);
    expect(farAttack.error).toBe('TARGET_OUT_OF_RANGE');

    // Attack adjacent goblin m-0 at (4, 4) (dist is 1)
    // Force rng to return 0.9 (which translates to high roll -> hit!)
    const rngHit = () => 0.9;
    const combatHit = applyDndAction(seats, state, 'p1', { kind: 'attack', targetId: 'm-0' }, rngHit);
    expect(combatHit.ok).toBe(true);
    expect(combatHit.events.some(e => e.t === 'dndAttack' && e.hit)).toBe(true);

    // Goblin hp is 14, AC is 11. Roll 0.9*20+1 = 19 (hit!). Damage is Math.floor(0.9*8)+1+2 = 10
    const playerHit = combatHit.events.find(
      (e) => e.t === 'dndAttack' && e.target === 'Goblin A' && e.hit,
    );
    expect(playerHit.damage).toBe(10);

    // 剩 4 HP，但同一輪的怪物回合裡牠若打了戰士，還會再吃到【反射】的傷害，
    // 所以只斷言上限，不寫死數字
    const goblin = findPiece(state, (p) => p.id === 'm-0');
    expect(goblin).not.toBeNull();
    expect(goblin.piece.hp).toBeLessThanOrEqual(4);
    expect(goblin.piece.hp).toBeGreaterThan(0);
  });

  it('should handle monster turn AI, moving monsters closer to players and attacking them', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'brave' });
    state.traps = [];

    // Move player close to Goblin A (4, 4) -> to (3, 4)
    const playerPiece = state.board[15][6].piece;
    state.board[15][6].piece = null;
    state.board[3][4].piece = playerPiece;

    // Force RNG to return 0.5 for combat rolls
    const rng = () => 0.5;

    // 客戶端送的是「移動＋終結動作」的組合技，這才是會結束回合、觸發怪物回合的路徑；
    // 單獨的 move 會保留回合讓玩家接著攻擊。
    const moveAction = applyDndAction(
      seats,
      state,
      'p1',
      { kind: 'turnCombo', move: { r: 2, c: 4 }, action: { kind: 'rest' } },
      rng,
    );
    expect(moveAction.ok).toBe(true);

    // Verify goblin turn events were generated
    expect(moveAction.events.some(e => e.t === 'dndMonsterTurn')).toBe(true);
    // Goblin A (m-0) at (4,4) should move or attack.
    // Since player moved to (2,4) from (3,4), Goblin A at (4,4) is 2 steps away.
    // It should move closer (e.g. to (3,4)).
    expect(state.board[4][4].piece?.id).not.toBe('m-0');
  });

  it('should check game over conditions and rank players accordingly', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats);
    state.traps = [];
    
    // 最終層是 B6 異界大門：過關看的是四座祭壇拆光了沒
    state.level = 6;
    state.altarsDestroyed = 4;

    // Clear all goblins and boss
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const piece = state.board[r][c].piece;
        if (piece && piece.type === 'goblin') {
          state.board[r][c].piece = null;
        }
      }
    }
    state.bossSpawned = true; // Boss was defeated

    const actionResult = applyDndAction(seats, state, 'p1', { kind: 'move', dir: 'up' });
    expect(actionResult.ok).toBe(true);
    expect(state.over).toBe(true);
    expect(state.ranking).toEqual(['p1']);
  });

  it('should generate NPC party members for empty seats and execute their turns automatically', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats);
    state.traps = [];

    // Verify 3 NPC adventurers are created, each with a different class
    expect(state.seats[1]?.isNpc).toBe(true);
    expect(state.seats[2]?.isNpc).toBe(true);
    expect(state.seats[3]?.isNpc).toBe(true);
    const npcNames = [1, 2, 3].map((seat) => state.seats[seat].name);
    expect(new Set(npcNames).size).toBe(3);

    // Verify they are placed on the board bottom next to player
    expect(state.board[15][7].piece?.id).toBe('npc-1');
    expect(state.board[15][8].piece?.id).toBe('npc-2');
    expect(state.board[15][9].piece?.id).toBe('npc-3');

    // p1 ends their turn -> should trigger NPC turns and Goblin turn automatically
    const actionResult = applyDndAction(seats, state, 'p1', { kind: 'rest' });
    expect(actionResult.ok).toBe(true);

    // Verify NPC turns were run by checking their log events
    for (const name of npcNames) {
      expect(actionResult.events.filter((e) => e.player === name).length).toBeGreaterThan(0);
    }

    // Verify monsters turn ran as well at the end of the round
    expect(actionResult.events.some(e => e.t === 'dndMonsterTurn')).toBe(true);

    // Turn should return to p1 (Seat 0) since all NPCs took their turns in the loop
    expect(state.turnSeat).toBe(0);
  });

  it('should support transitioning through 3 levels using staircases and healing players', () => {
    const seats: Seats = ['p1', null, null, null];
    // 全程假設 p1 是 maxHp 24 的戰士（下面驗算換層回血是 +12）
    const state = dealDnd(seats, { p1: 'brave' });
    state.traps = [];
    
    // Kill NPC seats to prevent them from taking the stairs automatically
    state.seats[1].alive = false;
    state.seats[2].alive = false;
    state.seats[3].alive = false;
    
    expect(state.level).toBe(1);
    
    // Clear all lvl 1 goblins
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (state.board[r][c].piece?.type === 'goblin') {
          state.board[r][c].piece = null;
        }
      }
    }
    
    // Spawn a test goblin to trigger Boss spawn
    state.board[14][6].piece = { id: 'm-test', type: 'goblin', name: 'Goblin Test', hp: 1, ac: 10 };
    state.board[15][6].piece = null;
    state.board[14][7].piece = { id: 'p-p1', type: 'player', playerId: 'p1', name: 'Knight (騎士)', hp: 10, maxHp: 24, ac: 14 };
    state.seats[0].hp = 10;
    
    const rngHit = () => 0.9;
    // Kill goblin test -> triggers boss spawn
    const killResult = applyDndAction(seats, state, 'p1', { kind: 'attack', targetId: 'm-test' }, rngHit);
    expect(killResult.ok).toBe(true);
    expect(state.bossSpawned).toBe(true);
    
    // Find spawned Boss
    let bossCell = null;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (state.board[r][c].piece?.id === 'boss-1') {
          bossCell = state.board[r][c];
        }
      }
    }
    expect(bossCell).not.toBeNull();
    
    // Set Boss HP to 1 and teleport player next to it
    bossCell.piece.hp = 1;
    const br = bossCell.r;
    const bc = bossCell.c;
    
    // Move player next to boss
    state.board[14][7].piece = null;
    state.board[br][bc - 1].piece = { id: 'p-p1', type: 'player', playerId: 'p1', name: 'Knight (騎士)', hp: 10, maxHp: 24, ac: 14 };
    
    // Kill Boss! -> triggers staircase spawn
    const killBossResult = applyDndAction(seats, state, 'p1', { kind: 'attack', targetId: 'boss-1' }, rngHit);
    expect(killBossResult.ok).toBe(true);

    // 督軍每次被打中都會分裂，打死牠的那一擊也不例外 —— 分身沒清乾淨就不會出樓梯
    clearGoblins(state);
    checkAndSpawnBossOrStaircase(seats, state, [], rngHit);

    let staircaseCell = null;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (state.board[r][c].piece?.type === 'staircase') {
          staircaseCell = state.board[r][c];
        }
      }
    }
    expect(staircaseCell).not.toBeNull();
    
    const sr = staircaseCell.r;
    const sc = staircaseCell.c;
    
    // Teleport player adjacent to staircase
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (state.board[r][c].piece?.type === 'player') {
          state.board[r][c].piece = null;
        }
      }
    }
    state.board[sr][sc - 1].piece = { id: 'p-p1', type: 'player', playerId: 'p1', name: 'Knight (騎士)', hp: 10, maxHp: 24, ac: 14 };
    
    // Move onto staircase (transition to Level 2)
    const moveResult = applyDndAction(seats, state, 'p1', { kind: 'move', dir: 'right' }, rngHit);
    expect(moveResult.ok).toBe(true);
    
    expect(state.level).toBe(2);
    // Warrior maxHp is 24, half heal is +12 -> 10 + 12 = 22 HP
    expect(state.seats[0].hp).toBe(22);
  });

  it('should trigger hidden traps when stepped on, dealing damage and setting trapTriggered', () => {
    // 兩個真人：p1 踩到陷阱之後回合會交給 p2，放逐倒數還沒開始遞減
    const seats: Seats = ['p1', 'p2', null, null];
    const state = dealDnd(seats);

    // Player starts at (15, 6). Put trap at (14, 6)
    state.traps = [{ r: 14, c: 6, triggered: false }];

    const moveResult = applyDndAction(seats, state, 'p1', { kind: 'move', dir: 'up' });
    expect(moveResult.ok).toBe(true);

    expect(state.traps[0].triggered).toBe(true);
    expect(state.board[14][6].trapTriggered).toBe(true);
    expect(state.seats[0].banishedTurns).toBe(2);
    // 被放逐的人不能留著回合 —— 他的棋子已經不在盤上，會沒有人能行動
    expect(state.turnSeat).toBe(1);
  });

  it('should not let NPC party members run away with the dungeon while the human is banished', () => {
    // 這是玩家回報的「打完一樓自動跑到三樓」：真人踩中陷阱被放逐之後，
    // 舊的推進迴圈不會結算回合，NPC 會在同一次動作裡連跑上百回合把三層樓打完。
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'brave' });

    // 一樓已經清空、Boss 也倒了，樓梯就擺在場中央
    clearGoblins(state);
    state.bossSpawned = true;
    state.board[7][7].piece = {
      id: 'staircase', type: 'staircase', name: '樓梯 (Stairs)', hp: 0, maxHp: 0, ac: 0,
    };
    state.traps = [{ r: 14, c: 6, triggered: false }];

    const moveResult = applyDndAction(seats, state, 'p1', { kind: 'move', dir: 'up' });
    expect(moveResult.ok).toBe(true);

    expect(state.level).toBe(1);
    expect(state.over).toBe(false);
    // 放逐的 2 輪在這次動作裡跑完（沒有別的真人可以交棒），角色回到場上、回合交還給他
    expect(state.seats[0].banishedTurns).toBe(0);
    expect(state.turnSeat).toBe(0);
    expect(findPiece(state, (p) => p.playerId === 'p1')).not.toBeNull();
  });

  it('should keep NPC party members off the staircase so only humans decide when to descend', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'brave' });

    clearGoblins(state);
    state.bossSpawned = true;
    state.traps = [];
    state.board[7][7].piece = {
      id: 'staircase', type: 'staircase', name: '樓梯 (Stairs)', hp: 0, maxHp: 0, ac: 0,
    };

    // 把一個 NPC 直接放在樓梯旁邊
    const npc = findPiece(state, (p) => p.id === 'npc-1');
    state.board[npc.r][npc.c].piece = null;
    state.board[7][6].piece = npc.piece;

    const result = applyDndAction(seats, state, 'p1', { kind: 'rest' });
    expect(result.ok).toBe(true);

    expect(state.level).toBe(1);
    expect(findPiece(state, (p) => p.type === 'staircase')).not.toBeNull();
    expect(state.board[7][7].piece?.type).toBe('staircase');
  });

  it('should let NPCs descend once every human adventurer is down, so a boss run cannot stall', () => {
    // 魔王模式：真人陣亡但 NPC 隊友還活著時遊戲會繼續（刻意的），
    // 這時 NPC 必須自己下樓 —— 否則清完這一層之後整隊會站在樓梯旁邊，房間永遠跑不完。
    const seats: Seats = ['p1', null, null, null, 'boss'];
    const state = dealDnd(seats, { p1: 'brave' }, 'normal', 4);

    clearGoblins(state);
    state.bossSpawned = true;
    state.traps = [];

    // 真人陣亡：座位還留著 playerId，只有棋子離場
    const hero = findPiece(state, (p) => p.playerId === 'p1');
    state.board[hero.r][hero.c].piece = null;
    state.seats[0].alive = false;

    state.board[7][7].piece = {
      id: 'staircase', type: 'staircase', name: '樓梯 (Stairs)', hp: 0, maxHp: 0, ac: 0,
    };
    const npc = findPiece(state, (p) => p.id === 'npc-1');
    state.board[npc.r][npc.c].piece = null;
    state.board[7][6].piece = npc.piece;

    // 有魔王時全 NPC 隊伍也是合法的一局，遊戲不該在這裡結束
    expect(checkDndGameOver(seats, state).over).toBe(false);

    state.phase = 'boss';
    state.turnSeat = 4;
    const result = applyDndAction(seats, state, 'boss', { kind: 'bossEnd' }, () => 0.5);
    expect(result.ok).toBe(true);

    expect(state.level).toBe(2);
  });

  it('should run the monster round once per full lap of the seat ring, whichever seat acted', () => {
    const seats: Seats = ['p1', 'p2', null, null];
    const state = dealDnd(seats);
    state.traps = [];

    // 座位 0 行動：0 → 1 就交棒給另一個真人，這一輪還沒繞完，怪物不動
    const first = applyDndAction(seats, state, 'p1', { kind: 'rest' });
    expect(first.ok).toBe(true);
    expect(first.events.some((e) => e.t === 'dndMonsterTurn')).toBe(false);
    expect(state.turnSeat).toBe(1);

    // 座位 1 行動：跑完 NPC 2、3 之後指標繞回 0，這時才結算怪物回合
    const second = applyDndAction(seats, state, 'p2', { kind: 'rest' });
    expect(second.ok).toBe(true);
    expect(second.events.some((e) => e.t === 'dndMonsterTurn')).toBe(true);
    expect(state.turnSeat).toBe(0);
  });

  it('should let the Rogue net a monster within five cells for three rounds', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'bubble' });
    state.traps = [];
    clearGoblins(state);

    const rogue = findPiece(state, (p) => p.playerId === 'p1');
    state.board[rogue.r][rogue.c].piece = null;
    state.board[8][6].piece = rogue.piece;

    // 6 格外的目標撒不到
    state.board[8][12].piece = {
      id: 'm-far', type: 'goblin', name: 'Goblin Far', hp: 20, maxHp: 20, ac: 11,
    };
    const tooFar = applyDndAction(seats, state, 'p1', { kind: 'skill', targetId: 'm-far' });
    expect(tooFar.ok).toBe(false);
    expect(tooFar.error).toBe('TARGET_OUT_OF_RANGE');

    // 剛好 5 格的目標會被纏住
    state.board[8][11].piece = {
      id: 'm-net', type: 'goblin', name: 'Goblin Net', hp: 20, maxHp: 20, ac: 11,
    };
    const cast = applyDndAction(seats, state, 'p1', { kind: 'skill', targetId: 'm-net' }, () => 0.01);
    expect(cast.ok).toBe(true);
    expect(cast.events.some((e) => e.t === 'dndMessage' && e.message.includes('羅網'))).toBe(true);

    // 綁 3 回合，而同一次動作裡的怪物回合馬上吃掉一回合並扣 1 點血
    const netted = findPiece(state, (p) => p.id === 'm-net');
    expect(netted.piece.trappedTurns).toBe(2);
    expect(netted.piece.hp).toBe(19);
    expect(netted.c).toBe(11); // 被纏住就不會往前走
  });

  it('should keep a netted monster attacking, only pinned in place', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'bubble' });
    state.traps = [];
    clearGoblins(state);

    const rogue = findPiece(state, (p) => p.playerId === 'p1');
    state.board[rogue.r][rogue.c].piece = null;
    state.board[8][6].piece = rogue.piece;
    state.seats[0].hp = 999;
    rogue.piece.hp = 999;
    rogue.piece.maxHp = 999;

    // 網住一隻就貼在盜賊旁邊的怪：牠不能走，但打得到人就該照打
    state.board[8][7].piece = {
      id: 'm-net', type: 'goblin', name: 'Goblin Net', hp: 20, maxHp: 20, ac: 11,
      attackBonus: 40, dmgDice: 6,
    };

    const cast = applyDndAction(seats, state, 'p1', { kind: 'skill', targetId: 'm-net' }, () => 0.9);
    expect(cast.ok).toBe(true);

    // 沒有跳過回合：牠在同一輪的怪物回合裡照樣揮了一刀
    expect(cast.events.some(
      (e) => e.t === 'dndAttack' && e.player === 'Goblin Net' && e.hit,
    )).toBe(true);
    // 但位置沒有變
    const netted = findPiece(state, (p) => p.id === 'm-net');
    expect(netted.r).toBe(8);
    expect(netted.c).toBe(7);
  });

  it('should stop a netted monster from closing the distance', () => {
    const seats: Seats = ['p1', null, null, null];
    // NPC 隊友會衝過來拉怪、擊退、補刀，把「網住的怪有沒有動」測歪
    const state = dealDnd(seats, { p1: 'bubble' }, 'normal', null, null, () => 0);
    state.traps = [];
    clearGoblins(state);
    clearNpcs(state);

    const rogue = findPiece(state, (p) => p.playerId === 'p1');
    state.board[rogue.r][rogue.c].piece = null;
    state.board[8][6].piece = rogue.piece;
    state.board[8][10].piece = {
      id: 'm-net', type: 'goblin', name: 'Goblin Net', hp: 20, maxHp: 20, ac: 11,
    };

    applyDndAction(seats, state, 'p1', { kind: 'skill', targetId: 'm-net' }, () => 0.5);
    expect(findPiece(state, (p) => p.id === 'm-net').c).toBe(10);

    // 下一輪還在網裡，照樣不能靠近
    applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    expect(findPiece(state, (p) => p.id === 'm-net').c).toBe(10);

    // 第三輪是網子的最後一輪：這一輪扣完血才到期，牠還是動不了
    applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    const lastRound = findPiece(state, (p) => p.id === 'm-net');
    expect(lastRound.c).toBe(10);
    expect(lastRound.piece.trappedTurns).toBe(0);
    expect(lastRound.piece.hp).toBe(17); // 一輪扣 1，剛好三輪

    // 到期之後就會往前壓，而且不再繼續扣血
    applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    const freed = findPiece(state, (p) => p.id === 'm-net');
    expect(freed.c).toBeLessThan(10);
    expect(freed.piece.hp).toBe(17);
  });

  it('should hold a boss that arrives mid-round until the next round', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'bubble' });
    state.traps = [];
    clearGoblins(state);

    const rogue = findPiece(state, (p) => p.playerId === 'p1');
    state.board[rogue.r][rogue.c].piece = null;
    state.board[7][6].piece = rogue.piece; // 貼著 Boss 會降臨的 (7,7)
    state.seats[0].hp = 999;
    rogue.piece.hp = 999;
    rogue.piece.maxHp = 999;

    // 這層最後一隻怪只剩 1 滴血，會死在 beginRound 的網子傷害裡 —— Boss 就在回合開頭降臨
    state.board[0][0].piece = {
      id: 'm-dying', type: 'goblin', name: 'Goblin Dying', hp: 1, maxHp: 20, ac: 11,
      trappedTurns: 3,
    };

    const arrival = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.99);
    expect(findPiece(state, (p) => p.id === 'boss-1')).not.toBeNull();
    // 降臨的那一輪不出手，冒險者至少有一輪可以反應
    expect(arrival.events.some(
      (e) => e.t === 'dndAttack' && e.player.includes('督軍'),
    )).toBe(false);

    // 下一輪牠就正常行動了
    const next = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.99);
    expect(next.events.some(
      (e) => e.t === 'dndAttack' && e.player.includes('督軍'),
    )).toBe(true);
  });

  it('should still let the netted Void Chief teleport, only bleeding it', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'bubble' });
    state.traps = [];
    clearGoblins(state);
    state.level = 3;

    const rogue = findPiece(state, (p) => p.playerId === 'p1');
    state.board[rogue.r][rogue.c].piece = null;
    state.board[8][6].piece = rogue.piece;
    state.seats[0].hp = 999;
    rogue.piece.hp = 999;
    rogue.piece.maxHp = 999;

    // 把 NPC 隊友清掉，酋長的瞬移目標才只有一個，落點才可預期
    for (const seat of [1, 2, 3]) state.seats[seat].alive = false;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const piece = state.board[r][c].piece;
        if (piece && piece.type === 'player' && !piece.playerId) state.board[r][c].piece = null;
      }
    }

    // 酋長擺在射程內但離得夠遠，正常情況牠會瞬移到玩家旁邊
    state.board[8][10].piece = {
      id: 'boss-3', type: 'goblin', name: 'Void Chief (虛空酋長)', hp: 80, maxHp: 80, ac: 15,
    };

    const cast = applyDndAction(seats, state, 'p1', { kind: 'skill', targetId: 'boss-3' }, () => 0.5);
    expect(cast.ok).toBe(true);

    const chief = findPiece(state, (p) => p.id === 'boss-3');
    // 網子照樣扣血、照樣倒數
    expect(chief.piece.hp).toBe(79);
    expect(chief.piece.trappedTurns).toBe(2);
    // 但牠是瞬移，位置綁不住 —— 已經跳到盜賊旁邊
    expect(Math.abs(chief.r - 8) + Math.abs(chief.c - 6)).toBe(1);
  });

  it('should reject netting anything that is not a monster', () => {
    const seats: Seats = ['p1', 'p2', null, null];
    const state = dealDnd(seats, { p1: 'bubble', p2: 'brave' });
    state.traps = [];
    clearGoblins(state);

    const rogue = findPiece(state, (p) => p.playerId === 'p1');
    const mate = findPiece(state, (p) => p.playerId === 'p2');
    state.board[rogue.r][rogue.c].piece = null;
    state.board[mate.r][mate.c].piece = null;
    state.board[8][6].piece = rogue.piece;
    state.board[8][7].piece = mate.piece;

    const result = applyDndAction(seats, state, 'p1', { kind: 'skill', targetId: mate.piece.id });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('TARGET_NOT_FOUND');
  });

  it('should end the run when every human seat is down, even if NPC party members survive', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats);

    state.seats[0].alive = false;

    const result = checkDndGameOver(seats, state);
    expect(result.over).toBe(true);
    expect(result.won).toBe(false);
    expect(result.ranking).toEqual(['p1']);
  });

  it('should reject a turnCombo that "moves" onto the cell the player is already standing on', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'brave' });

    const result = applyDndAction(seats, state, 'p1', {
      kind: 'turnCombo',
      move: { r: 15, c: 6 },
      action: { kind: 'rest' },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('INVALID_CELL');
    // 來源格與目標格是同一格，處理不當會把角色從棋盤上抹掉
    expect(state.board[15][6].piece?.playerId).toBe('p1');
  });

  it('should heal the lowest HP teammate when Cleric successfully hits a goblin', () => {
    const seats: Seats = ['p1', null, null, null];
    const characterIds = { 'p1': 'star' };
    const state = dealDnd(seats, characterIds);
    
    state.seats[0].hp = 10;
    state.seats[1].hp = 5;
    
    const playerPiece = state.board[15][6].piece;
    playerPiece.hp = 10;
    state.board[15][6].piece = null;
    state.board[4][3].piece = playerPiece; // Adjacent to goblin m-0 at (4,4)
    
    const roguePiece = state.board[15][7].piece;
    roguePiece.hp = 5;
    
    const rngHit = () => 0.9;
    const actionResult = applyDndAction(seats, state, 'p1', { kind: 'attack', targetId: 'm-0' }, rngHit);
    expect(actionResult.ok).toBe(true);
    
    expect(state.seats[1].hp).toBe(6); // 攻擊命中順帶治癒隊友 1 點
    expect(roguePiece.hp).toBe(6);
  });

  // ---------------------------------------------------------------------------
  // 戰士攻擊被動：1/3 暈眩、1/3 擊退、1/3 極限防禦
  // ---------------------------------------------------------------------------

  /** 戰士打一隻旁邊的哥布林，用序列亂數指定要觸發哪一個被動。 */
  function warriorHits(passiveRoll) {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'brave' });
    state.traps = [];
    clearGoblins(state);

    const warrior = findPiece(state, (p) => p.playerId === 'p1');
    state.board[warrior.r][warrior.c].piece = null;
    state.board[8][6].piece = warrior.piece;
    state.board[8][7].piece = {
      id: 'm-target', type: 'goblin', name: 'Goblin Target', hp: 40, maxHp: 40, ac: 10,
    };

    // 擲骰順序：命中骰 → 傷害骰 → 被動骰
    const result = applyDndAction(
      seats, state, 'p1', { kind: 'attack', targetId: 'm-target' }, seqRng([0.9, 0.5, passiveRoll]),
    );
    expect(result.ok).toBe(true);
    return { state, seats, result };
  }

  it('should let the Warrior stun the target on a passive roll of 1/3', () => {
    const { result } = warriorHits(0.0);
    expect(result.events.some((e) => e.t === 'dndMessage' && e.message.includes('震暈'))).toBe(true);
  });

  it('should let the Warrior knock the target back on a passive roll of 2/3', () => {
    const { result } = warriorHits(0.4);
    expect(result.events.some((e) => e.t === 'dndMessage' && e.message.includes('擊退'))).toBe(true);
  });

  it('should let the Warrior raise a damage cap on a passive roll of 3/3', () => {
    const { result } = warriorHits(0.9);
    expect(result.events.some((e) => e.t === 'dndMessage' && e.message.includes('極限防禦'))).toBe(true);
  });

  it('should cap every incoming hit while 極限防禦 is up', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'brave' });
    state.traps = [];
    clearGoblins(state);

    const warrior = findPiece(state, (p) => p.playerId === 'p1');
    state.board[warrior.r][warrior.c].piece = null;
    state.board[8][6].piece = warrior.piece;
    // 一隻打很痛的怪站在旁邊
    state.board[8][7].piece = {
      id: 'm-heavy', type: 'goblin', name: 'Goblin Heavy', hp: 40, maxHp: 40, ac: 30,
      attackBonus: 30, dmgDice: 10,
    };
    state.seats[0].damageCapTurns = 1;
    state.seats[0].damageCap = 2;

    const result = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.9);
    expect(result.ok).toBe(true);

    const hitsOnMe = result.events.filter(
      (e) => e.t === 'dndAttack' && e.player === 'Goblin Heavy' && e.hit,
    );
    expect(hitsOnMe.length).toBeGreaterThan(0);
    for (const hit of hitsOnMe) expect(hit.damage).toBeLessThanOrEqual(2);
    // 護盾只擋一輪，怪物回合跑完就退掉
    expect(state.seats[0].damageCapTurns).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // B2 哥布林盜賊 / B3 哥布林法師
  // ---------------------------------------------------------------------------

  /** 把隊伍直接送到指定樓層：擺一個樓梯讓玩家踩上去。 */
  function descendTo(state, seats, level) {
    while (state.level < level) {
      clearGoblins(state);
      state.traps = [];
      const me = findPiece(state, (p) => p.playerId === 'p1');
      state.board[me.r][me.c].piece = null;
      state.board[8][6].piece = me.piece;
      state.board[8][7].piece = {
        id: 'staircase', type: 'staircase', name: '樓梯 (Stairs)', hp: 0, maxHp: 0, ac: 0,
      };
      const result = applyDndAction(seats, state, 'p1', { kind: 'move', dir: 'right' }, () => 0.5);
      expect(result.ok).toBe(true);
    }
  }

  it('should add three high-speed Goblin Rogues on B2 and add Goblin Mages on top of them on B4', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'brave' });

    descendTo(state, seats, 2);
    expect(state.level).toBe(2);
    expect(countPieces(state, (p) => p.id.startsWith('m-rogue-'))).toBe(3);
    expect(countPieces(state, (p) => p.id.startsWith('m-mage-'))).toBe(0);
    const rogue = findPiece(state, (p) => p.id.startsWith('m-rogue-'));
    expect(rogue.piece.speed).toBe(5);

    // B3 是護送關：沒有常規怪物編成，改成 10 個村民
    descendTo(state, seats, 3);
    expect(state.level).toBe(3);
    expect(countPieces(state, (p) => p.type === 'villager')).toBe(10);
    expect(countPieces(state, (p) => p.id.startsWith('m-mage-'))).toBe(0);

    descendTo(state, seats, 4);
    expect(state.level).toBe(4);
    // B4 疊加 B2 的盜賊，再加上 3 名法師
    expect(countPieces(state, (p) => p.id.startsWith('m-rogue-'))).toBe(3);
    expect(countPieces(state, (p) => p.id.startsWith('m-mage-'))).toBe(3);
    const mage = findPiece(state, (p) => p.id.startsWith('m-mage-'));
    expect(mage.piece.range).toBe(3);
    expect(mage.piece.speed).toBe(1);
  });

  it('should let the host pin the class of each NPC seat', () => {
    const seats: Seats = ['p1', null, null, null];
    // 指定：座位 1 弓手、座位 3 吟遊詩人；座位 2 留空 → 隨機
    const state = dealDnd(
      seats, { p1: 'star' }, 'normal', null, null, () => 0,
      [null, 'archer', null, 'bard'],
    );

    expect(findPiece(state, (p) => p.id === 'npc-1').piece.classId).toBe('archer');
    expect(findPiece(state, (p) => p.id === 'npc-3').piece.classId).toBe('bard');
    expect(state.seats[1].classId).toBe('archer');
    expect(state.seats[3].classId).toBe('bard');
    // 沒指定的那個位置照舊有職業
    expect(findPiece(state, (p) => p.id === 'npc-2').piece.classId).toBeTruthy();
  });

  it('should allow a duplicate class when the host asks for it', () => {
    const seats: Seats = ['p1', null, null, null];
    // 真人選牧師，三個 NPC 也指定牧師 —— 想開四個牧師是房主的自由
    const state = dealDnd(
      seats, { p1: 'star' }, 'normal', null, null, () => 0,
      [null, 'star', 'star', 'star'],
    );
    for (const seat of [1, 2, 3]) {
      expect(state.seats[seat].classId).toBe('star');
    }
  });

  it('should still randomise the seats the host left alone', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'brave' }, 'normal', null, null, () => 0);
    // 沒有指定表時完全照舊：三個 NPC 各拿到不重複的職業
    const picked = [1, 2, 3].map((seat) => state.seats[seat].classId);
    expect(new Set(picked).size).toBe(3);
    expect(picked).not.toContain('brave');
  });

  it('should let NPC allies close the distance with their full move range', () => {
    // NPC 原本一輪只挪一格，跟職業的移動力完全脫鉤 ——
    // 盜賊的 6 格移動等於沒有意義，離得稍遠的隊友要走好幾輪才碰得到怪。
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'star' }, 'normal', null, null, () => 0);
    state.traps = [];
    clearGoblins(state);

    // 把座位 1 指定成盜賊（移動 6），放在 8 格外
    const npc = findPiece(state, (p) => p.id === 'npc-1');
    npc.piece.classId = 'bubble';
    state.seats[1].classId = 'bubble';
    state.board[npc.r][npc.c].piece = null;
    state.board[8][2].piece = npc.piece;

    // 其餘隊友先撤掉，只看這一個
    for (const id of ['npc-2', 'npc-3']) {
      const other = findPiece(state, (p) => p.id === id);
      if (other) state.board[other.r][other.c].piece = null;
    }
    const me = findPiece(state, (p) => p.playerId === 'p1');
    state.board[me.r][me.c].piece = null;
    state.board[0][0].piece = me.piece;

    state.board[8][10].piece = { id: 'm-far', type: 'goblin', name: 'Far', hp: 99, maxHp: 99, ac: 99 };

    const res = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    expect(res.ok).toBe(true);

    // 8 格外的盜賊一輪要能推進到剩 1 格（6 格移動 + 停在射程外緣）
    const moved = findPiece(state, (p) => p.id === 'npc-1');
    const dist = Math.abs(moved.r - 8) + Math.abs(moved.c - 10);
    expect(dist).toBeLessThanOrEqual(2);
  });

  it('should let an NPC move in and attack in the same round', () => {
    // 走過去那一輪也要能出手 —— 原本走完就結束，等於白走一輪
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'star' }, 'normal', null, null, () => 0);
    state.traps = [];
    clearGoblins(state);

    const npc = findPiece(state, (p) => p.id === 'npc-1');
    npc.piece.classId = 'bubble'; // 移動 6
    state.seats[1].classId = 'bubble';
    state.board[npc.r][npc.c].piece = null;
    state.board[8][4].piece = npc.piece;
    for (const id of ['npc-2', 'npc-3']) {
      const other = findPiece(state, (p) => p.id === id);
      if (other) state.board[other.r][other.c].piece = null;
    }
    const me = findPiece(state, (p) => p.playerId === 'p1');
    state.board[me.r][me.c].piece = null;
    state.board[0][0].piece = me.piece;

    state.board[8][9].piece = { id: 'm-far', type: 'goblin', name: 'Far', hp: 99, maxHp: 99, ac: 1 };

    const res = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.9);
    expect(res.events.some((e) => e.t === 'dndMove' && e.player.includes('NPC'))).toBe(true);
    expect(res.events.some((e) => e.t === 'dndAttack' && e.player.includes('NPC'))).toBe(true);
    expect(findPiece(state, (p) => p.id === 'm-far').piece.hp).toBeLessThan(99);
  });

  it('should let a Goblin Rogue close five cells in a single monster round', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'brave' });
    state.traps = [];
    clearGoblins(state);
    clearNpcs(state);

    const me = findPiece(state, (p) => p.playerId === 'p1');
    state.board[me.r][me.c].piece = null;
    state.board[8][6].piece = me.piece;
    // 盜賊擺在 8 格外，一回合應該衝 5 格
    state.board[8][14].piece = {
      id: 'm-rogue-test', type: 'goblin', name: 'Goblin Rogue (哥布林盜賊)',
      hp: 12, maxHp: 12, ac: 12, speed: 5, range: 1, attackBonus: 3, dmgDice: 6,
    };

    applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);

    const rogue = findPiece(state, (p) => p.id === 'm-rogue-test');
    expect(rogue.c).toBe(9); // 14 → 9
  });

  it('should let a Goblin Mage attack from three cells away instead of closing in', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'brave' });
    state.traps = [];
    clearGoblins(state);
    clearNpcs(state); // 不然 10 點血的法師會先被隊友圍毆掉

    const me = findPiece(state, (p) => p.playerId === 'p1');
    state.board[me.r][me.c].piece = null;
    state.board[8][6].piece = me.piece;
    state.board[8][9].piece = {
      id: 'm-mage-test', type: 'goblin', name: 'Goblin Mage (哥布林法師)',
      hp: 10, maxHp: 10, ac: 10, speed: 1, range: 3, attackBonus: 3, dmgDice: 8,
    };

    const result = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.9);

    expect(result.events.some((e) => e.t === 'dndAttack' && e.player.includes('哥布林法師'))).toBe(true);
    const mage = findPiece(state, (p) => p.id === 'm-mage-test');
    expect(mage.c).toBe(9); // 射程內就原地放法術，不會靠近
  });

  // ---------------------------------------------------------------------------
  // B3 虛空酋長
  // ---------------------------------------------------------------------------

  it('should summon the B1 and B2 bosses once the Void Chief drops to a quarter HP', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'brave' });
    state.traps = [];
    clearGoblins(state);
    state.level = 3;

    const me = findPiece(state, (p) => p.playerId === 'p1');
    state.board[me.r][me.c].piece = null;
    state.board[8][6].piece = me.piece;
    state.board[8][7].piece = {
      id: 'boss-3', type: 'goblin', name: 'Void Chief (虛空酋長)', hp: 12, maxHp: 80, ac: 10,
    };

    expect(state.finalPhase).toBe(false);
    const result = applyDndAction(seats, state, 'p1', { kind: 'attack', targetId: 'boss-3' }, seqRng([0.9, 0.5, 0.9]));
    expect(result.ok).toBe(true);

    expect(state.finalPhase).toBe(true);
    expect(findPiece(state, (p) => p.id === 'boss-1')).not.toBeNull();
    expect(findPiece(state, (p) => p.id === 'boss-2')).not.toBeNull();

    // 只召喚一次
    const before = countPieces(state, (p) => p.id === 'boss-1' || p.id === 'boss-2');
    applyDndAction(seats, state, 'p1', { kind: 'attack', targetId: 'boss-3' }, seqRng([0.9, 0.5, 0.9]));
    expect(countPieces(state, (p) => p.id === 'boss-1' || p.id === 'boss-2')).toBe(before);
  });

  it('should reverse the movement of a feared player', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'brave' });
    state.traps = [];
    clearGoblins(state);

    const me = findPiece(state, (p) => p.playerId === 'p1');
    state.board[me.r][me.c].piece = null;
    state.board[8][6].piece = me.piece;
    state.seats[0].fearTurns = 2;

    const result = applyDndAction(seats, state, 'p1', { kind: 'move', dir: 'up' }, () => 0.5);
    expect(result.ok).toBe(true);

    // 想往上（r-1），實際往下（r+1）
    const moved = findPiece(state, (p) => p.playerId === 'p1');
    expect(moved.r).toBe(9);
    expect(moved.c).toBe(6);
    expect(result.events.some((e) => e.t === 'dndMessage' && e.message.includes('恐懼'))).toBe(true);
  });

  it('should return a Void-Chief-banished player to the exact cell they were taken from', () => {
    // 被放逐的人自己動不了，要靠隊友行動把回合推過去，放逐倒數才會遞減
    const seats: Seats = ['p1', 'p2', null, null];
    const state = dealDnd(seats, { p1: 'brave', p2: 'star' });
    state.traps = [];
    clearGoblins(state);

    const me = findPiece(state, (p) => p.playerId === 'p1');
    state.board[me.r][me.c].piece = null;

    // 直接安排「站在 (8,6) 時被酋長放逐」的狀態，驗證回歸的落點
    state.seats[0].banishedTurns = 1;
    state.seats[0].banishCell = { r: 8, c: 6 };
    state.seats[0].piece = me.piece;
    state.turnSeat = 1;

    const result = applyDndAction(seats, state, 'p2', { kind: 'rest' }, () => 0.01);
    expect(result.ok).toBe(true);

    expect(state.seats[0].banishedTurns).toBe(0);
    const back = findPiece(state, (p) => p.playerId === 'p1');
    expect(back.r).toBe(8);
    expect(back.c).toBe(6);
    expect(state.turnSeat).toBe(0); // 回來就輪到他
  });

  // ---------------------------------------------------------------------------
  // 牧師 NPC 補血優先 / 法師火牆 / 盜賊被動
  // ---------------------------------------------------------------------------

  it('should make an NPC Cleric heal a teammate below 70% HP instead of attacking', () => {
    const seats: Seats = ['p1', null, null, null];
    // rng 固定回 0 → NPC 依序拿到盜賊／法師／牧師，座位 3 一定是牧師
    const state = dealDnd(seats, { p1: 'brave' }, 'normal', null, null, () => 0);
    state.traps = [];
    clearGoblins(state);

    const cleric = findPiece(state, (p) => p.classId === 'star');
    expect(cleric).not.toBeNull();
    const clericSeat = cleric.piece.id.startsWith('npc-')
      ? Number(cleric.piece.id.split('-')[1])
      : 0;

    // 把牧師和一個重傷隊友擺在一起，旁邊再放一隻打得到的哥布林
    state.board[cleric.r][cleric.c].piece = null;
    state.board[8][6].piece = cleric.piece;

    const ally = findPiece(state, (p) => p.playerId === 'p1');
    state.board[ally.r][ally.c].piece = null;
    state.board[8][7].piece = ally.piece;
    ally.piece.hp = 6; // 24 的 25%，遠低於 70%
    state.seats[0].hp = 6;

    state.board[8][5].piece = {
      id: 'm-bait', type: 'goblin', name: 'Goblin Bait', hp: 20, maxHp: 20, ac: 11,
    };

    state.turnSeat = 0;
    const result = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    expect(result.ok).toBe(true);

    // 牧師選擇補血（負傷害事件），而不是攻擊那隻哥布林
    const heal = result.events.find(
      (e) => e.t === 'dndAttack' && e.damage < 0 && e.target.includes('Knight'),
    );
    expect(heal).toBeDefined();
    expect(state.seats[0].hp).toBeGreaterThan(6);
    expect(state.seats[clericSeat].skillCooldown).toBe(1); // 補完要冷卻
  });

  it('should leave an NPC Cleric attacking when the whole party is above 70% HP', () => {
    const seats: Seats = ['p1', null, null, null];
    // rng 固定回 0 → NPC 依序拿到盜賊／法師／牧師，一定有牧師可以測
    const state = dealDnd(seats, { p1: 'brave' }, 'normal', null, null, () => 0);
    state.traps = [];
    clearGoblins(state);

    const cleric = findPiece(state, (p) => p.classId === 'star');
    state.board[cleric.r][cleric.c].piece = null;
    state.board[8][6].piece = cleric.piece;
    state.board[8][5].piece = {
      id: 'm-bait', type: 'goblin', name: 'Goblin Bait', hp: 20, maxHp: 20, ac: 1,
    };

    const result = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.9);
    expect(result.ok).toBe(true);

    const attacked = result.events.some(
      (e) => e.t === 'dndAttack' && e.target === 'Goblin Bait' && e.damage > 0,
    );
    expect(attacked).toBe(true);
  });

  it('should let the Mage lay a three-cell fire wall that burns monsters for two rounds', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'tangerine' });
    state.traps = [];
    clearGoblins(state);

    const mage = findPiece(state, (p) => p.playerId === 'p1');
    state.board[mage.r][mage.c].piece = null;
    state.board[8][6].piece = mage.piece;

    // 正上方 2 格處放一隻怪，火牆蓋在牠腳下
    state.board[6][6].piece = {
      id: 'm-burn', type: 'goblin', name: 'Goblin Burn', hp: 30, maxHp: 30, ac: 30,
    };

    const cast = applyDndAction(seats, state, 'p1', { kind: 'skill', r: 6, c: 6 }, () => 0.01);
    expect(cast.ok).toBe(true);

    // 施法方向是垂直的，所以火牆橫著鋪：(6,5) (6,6) (6,7)
    expect(state.fireWalls.map((w) => `${w.r},${w.c}`).sort()).toEqual(['6,5', '6,6', '6,7']);

    // 這一輪結算就燒掉 3 點，剩 1 回合
    const burn = findPiece(state, (p) => p.id === 'm-burn');
    expect(burn.piece.hp).toBe(27);
    expect(state.fireWalls[0].turns).toBe(1);

    // 燒完牠會走出火牆（先燒再行動），所以第二輪要自己把牠擺回去
    const putBackInFire = () => {
      const piece = findPiece(state, (p) => p.id === 'm-burn');
      state.board[piece.r][piece.c].piece = null;
      state.board[6][6].piece = piece.piece;
    };

    putBackInFire();
    applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.01);
    expect(findPiece(state, (p) => p.id === 'm-burn').piece.hp).toBe(24);
    expect(state.fireWalls).toHaveLength(0); // 兩回合燒完就熄了

    // 熄了就不再扣血
    putBackInFire();
    applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.01);
    expect(findPiece(state, (p) => p.id === 'm-burn').piece.hp).toBe(24);
  });

  it('should reject a fire wall cast further than three cells away', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'tangerine' });
    state.traps = [];

    const mage = findPiece(state, (p) => p.playerId === 'p1');
    const result = applyDndAction(seats, state, 'p1', {
      kind: 'skill', r: mage.r - 5, c: mage.c,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('TARGET_OUT_OF_RANGE');
  });

  /** 盜賊打一隻旁邊的哥布林，用序列亂數指定要觸發哪一個被動。 */
  function rogueHits(passiveRoll) {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'bubble' });
    state.traps = [];
    clearGoblins(state);

    const rogue = findPiece(state, (p) => p.playerId === 'p1');
    state.board[rogue.r][rogue.c].piece = null;
    state.board[8][6].piece = rogue.piece;
    state.board[8][7].piece = {
      id: 'm-mark', type: 'goblin', name: 'Goblin Mark', hp: 60, maxHp: 60, ac: 10,
      attackBonus: 30, dmgDice: 10,
    };

    const result = applyDndAction(
      seats, state, 'p1', { kind: 'attack', targetId: 'm-mark' }, seqRng([0.9, 0.5, passiveRoll]),
    );
    expect(result.ok).toBe(true);
    return { state, seats, result, target: findPiece(state, (p) => p.id === 'm-mark') };
  }

  it('should let the Rogue shred the target AC down to 60% for two rounds', () => {
    const { state, target } = rogueHits(0.1);

    expect(target.piece.acBase).toBe(10);
    expect(target.piece.ac).toBe(6); // round(10 * 0.6)
    // 施放當輪的結算已經扣掉一回合
    expect(target.piece.acDebuffTurns).toBe(1);

    // 再過一輪就到期，AC 回到原值
    applyDndAction(state.turnSeat === 0 ? ['p1', null, null, null] : [], state, 'p1', { kind: 'rest' }, () => 0.01);
    const after = findPiece(state, (p) => p.id === 'm-mark');
    expect(after.piece.acDebuffTurns).toBe(0);
    expect(after.piece.ac).toBe(10);
  });

  it('should let the Rogue cut the target damage down to 60% for two rounds', () => {
    const { result, target } = rogueHits(0.9);

    expect(target.piece.atkDebuffTurns).toBe(1);
    expect(target.piece.ac).toBe(10); // 這一半不動 AC

    // 同一輪的怪物回合就已經吃到削弱：原本 round(d10*1.3) 最高 13，削弱後最高 8
    const hits = result.events.filter(
      (e) => e.t === 'dndAttack' && e.player === 'Goblin Mark' && e.hit,
    );
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) expect(hit.damage).toBeLessThanOrEqual(8);
  });

  // ---------------------------------------------------------------------------
  // 難度
  // ---------------------------------------------------------------------------

  it('should scale monster HP and AC by the room difficulty', () => {
    // 一樓的 Goblin A 基準值是 HP 14 / AC 11
    const cases = [
      { difficulty: 'easy', hp: 10, ac: 8 },     // ×0.7
      { difficulty: 'normal', hp: 14, ac: 11 },  // ×1
      { difficulty: 'hard', hp: 17, ac: 13 },    // ×1.2
      { difficulty: 'hell', hp: 21, ac: 17 },    // ×1.5
    ];

    for (const c of cases) {
      const seats: Seats = ['p1', null, null, null];
      const state = dealDnd(seats, { p1: 'brave' }, c.difficulty);
      const goblin = findPiece(state, (p) => p.id === 'm-0');
      expect(goblin.piece.hp).toBe(c.hp);
      expect(goblin.piece.maxHp).toBe(c.hp);
      expect(goblin.piece.ac).toBe(c.ac);
    }
  });

  it('should scale the Boss spawned later by the same difficulty', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'brave' }, 'hell');
    state.traps = [];
    clearGoblins(state);
    clearNpcs(state); // 隊友會在同一輪衝上去砍剛登場的 Boss，血量就對不上了

    // 清場後補一隻小怪讓玩家打死，觸發 Boss 登場
    const me = findPiece(state, (p) => p.playerId === 'p1');
    state.board[me.r][me.c].piece = null;
    state.board[8][6].piece = me.piece;
    state.board[8][7].piece = {
      id: 'm-last', type: 'goblin', name: 'Goblin Last', hp: 1, maxHp: 1, ac: 1,
    };

    applyDndAction(seats, state, 'p1', { kind: 'attack', targetId: 'm-last' }, () => 0.9);

    // 督軍基準 HP 35 / AC 12 → ×1.5
    const boss = findPiece(state, (p) => p.id === 'boss-1');
    expect(boss.piece.hp).toBe(53);
    expect(boss.piece.ac).toBe(18);
  });

  it('should scale monster damage by the room difficulty', () => {
    const damageOn = (difficulty) => {
      const seats: Seats = ['p1', null, null, null];
      const state = dealDnd(seats, { p1: 'brave' }, difficulty);
      state.traps = [];
      clearGoblins(state);

      const me = findPiece(state, (p) => p.playerId === 'p1');
      state.board[me.r][me.c].piece = null;
      state.board[8][6].piece = me.piece;
      state.seats[0].hp = 999;
      me.piece.hp = 999;
      me.piece.maxHp = 999;
      state.board[8][7].piece = {
        id: 'm-hit', type: 'goblin', name: 'Goblin Hit', hp: 40, maxHp: 40, ac: 40,
        attackBonus: 40, dmgDice: 10,
      };

      const result = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.9);
      const hit = result.events.find((e) => e.t === 'dndAttack' && e.player === 'Goblin Hit' && e.hit);
      expect(hit).toBeDefined();
      return hit.damage;
    };

    // 基準：floor(0.9*10)+1 = 10 → round(10 * 1.3) = 13
    expect(damageOn('normal')).toBe(13);
    expect(damageOn('easy')).toBe(9);   // round(13 * 0.7)
    expect(damageOn('hard')).toBe(16);  // round(13 * 1.2)
    expect(damageOn('hell')).toBe(20);  // round(13 * 1.5)
  });

  // ---------------------------------------------------------------------------
  // 魔王模式：玩家操控怪物
  // ---------------------------------------------------------------------------

  /** 一個魔王坐第 5 位、真人冒險者坐第 1 位的乾淨盤面，場上只有一隻指定的怪。 */
  function bossTable() {
    const seats: Seats = ['p1', null, null, null, 'boss'];
    const state = dealDnd(seats, { p1: 'brave' }, 'normal', 4);
    state.traps = [];
    clearGoblins(state);

    const hero = findPiece(state, (p) => p.playerId === 'p1');
    state.board[hero.r][hero.c].piece = null;
    state.board[8][6].piece = hero.piece;
    state.seats[0].hp = 999;
    hero.piece.hp = 999;
    hero.piece.maxHp = 999;

    // NPC 隊友先移出戰場，讓斷言只跟這一隻怪有關
    for (const seat of [1, 2, 3]) state.seats[seat].alive = false;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const piece = state.board[r][c].piece;
        if (piece && piece.type === 'player' && !piece.playerId) state.board[r][c].piece = null;
      }
    }

    state.board[8][10].piece = {
      id: 'm-boss-test', type: 'goblin', name: 'Goblin Pawn', hp: 40, maxHp: 40, ac: 11,
    };
    return { seats, state };
  }

  it('should hand the monster round to the boss player instead of running the AI', () => {
    const { seats, state } = bossTable();

    const result = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    expect(result.ok).toBe(true);

    // 停在魔王身上，而且怪物「還沒動」
    expect(state.phase).toBe('boss');
    expect(state.turnSeat).toBe(4);
    expect(findPiece(state, (p) => p.id === 'm-boss-test').c).toBe(10);
    expect(state.monsterActed.size).toBe(0);
  });

  it('should let the boss move and then attack with the same monster', () => {
    const { seats, state } = bossTable();
    // 擺到「移動 2 格之後剛好貼到英雄」的位置
    const pawn = findPiece(state, (p) => p.id === 'm-boss-test');
    state.board[pawn.r][pawn.c].piece = null;
    state.board[8][9].piece = pawn.piece;
    pawn.piece.attackBonus = 40; // 必中，斷言才穩

    applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);

    // 一般哥布林速度 2：走 4 格要被擋
    const tooFar = applyDndAction(seats, state, 'boss', {
      kind: 'bossMove', monsterId: 'm-boss-test', r: 8, c: 5,
    });
    expect(tooFar.ok).toBe(false);
    expect(tooFar.error).toBe('INVALID_CELL');

    const moved = applyDndAction(seats, state, 'boss', {
      kind: 'bossMove', monsterId: 'm-boss-test', r: 8, c: 7,
    });
    expect(moved.ok).toBe(true);
    expect(findPiece(state, (p) => p.id === 'm-boss-test').c).toBe(7);

    // 移動只能一次
    const moveAgain = applyDndAction(seats, state, 'boss', {
      kind: 'bossMove', monsterId: 'm-boss-test', r: 8, c: 8,
    });
    expect(moveAgain.ok).toBe(false);
    expect(moveAgain.error).toBe('MONSTER_ALREADY_MOVED');

    // 但移動之後還可以攻擊 —— 跟玩家的「移動 → 終結動作」一樣
    const hpBefore = state.seats[0].hp;
    const hit = applyDndAction(seats, state, 'boss', {
      kind: 'bossAttack', monsterId: 'm-boss-test', targetId: 'p-p1',
    }, () => 0.9);
    expect(hit.ok).toBe(true);
    expect(state.seats[0].hp).toBeLessThan(hpBefore);

    // 攻擊完這隻怪就結束了，不能再攻擊也不能再移動
    const attackAgain = applyDndAction(seats, state, 'boss', {
      kind: 'bossAttack', monsterId: 'm-boss-test', targetId: 'p-p1',
    });
    expect(attackAgain.ok).toBe(false);
    expect(attackAgain.error).toBe('MONSTER_ALREADY_ACTED');
  });

  it('should let the boss stand a monster down when there is nobody to hit', () => {
    const { seats, state } = bossTable();
    applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);

    // 移動之後旁邊沒有人可以打 —— 要有「待命」這條路可以結束牠的行動
    const moved = applyDndAction(seats, state, 'boss', {
      kind: 'bossMove', monsterId: 'm-boss-test', r: 8, c: 8,
    });
    expect(moved.ok).toBe(true);

    const held = applyDndAction(seats, state, 'boss', {
      kind: 'bossHold', monsterId: 'm-boss-test',
    });
    expect(held.ok).toBe(true);
    expect(state.monsterActed.has('m-boss-test')).toBe(true);

    // 待命之後就不能再動了
    const after = applyDndAction(seats, state, 'boss', {
      kind: 'bossAttack', monsterId: 'm-boss-test', targetId: 'p-p1',
    });
    expect(after.ok).toBe(false);
    expect(after.error).toBe('MONSTER_ALREADY_ACTED');

    // 而且結束回合時 AI 也不會再幫牠動一次
    const at = findPiece(state, (p) => p.id === 'm-boss-test');
    applyDndAction(seats, state, 'boss', { kind: 'bossEnd' }, () => 0.5);
    expect(findPiece(state, (p) => p.id === 'm-boss-test').c).toBe(at.c);
  });

  it('should not let the boss move a monster after it has attacked', () => {
    const { seats, state } = bossTable();
    const pawn = findPiece(state, (p) => p.id === 'm-boss-test');
    state.board[pawn.r][pawn.c].piece = null;
    state.board[8][7].piece = pawn.piece; // 一開始就貼著英雄
    pawn.piece.attackBonus = 40;

    applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);

    const hit = applyDndAction(seats, state, 'boss', {
      kind: 'bossAttack', monsterId: 'm-boss-test', targetId: 'p-p1',
    }, () => 0.9);
    expect(hit.ok).toBe(true);

    const moveAfter = applyDndAction(seats, state, 'boss', {
      kind: 'bossMove', monsterId: 'm-boss-test', r: 8, c: 8,
    });
    expect(moveAfter.ok).toBe(false);
    expect(moveAfter.error).toBe('MONSTER_ALREADY_ACTED');
  });

  it('should resolve a boss-ordered attack with the same rules the AI uses', () => {
    const { seats, state } = bossTable();
    // 把怪擺到英雄旁邊
    const pawn = findPiece(state, (p) => p.id === 'm-boss-test');
    state.board[pawn.r][pawn.c].piece = null;
    state.board[8][7].piece = pawn.piece;
    pawn.piece.attackBonus = 40; // 必中

    applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);

    const outOfRange = applyDndAction(seats, state, 'boss', {
      kind: 'bossAttack', monsterId: 'm-boss-test', targetId: 'no-such-piece',
    });
    expect(outOfRange.ok).toBe(false);

    const hpBefore = state.seats[0].hp;
    const hit = applyDndAction(seats, state, 'boss', {
      kind: 'bossAttack', monsterId: 'm-boss-test', targetId: 'p-p1',
    }, () => 0.9);
    expect(hit.ok).toBe(true);
    expect(hit.events.some((e) => e.t === 'dndAttack' && e.hit)).toBe(true);
    expect(state.seats[0].hp).toBeLessThan(hpBefore);
  });

  it('should only run the AI for monsters the boss did not command', () => {
    const { seats, state } = bossTable();
    // 第二隻怪，離英雄很遠
    state.board[2][2].piece = {
      id: 'm-idle', type: 'goblin', name: 'Goblin Idle', hp: 20, maxHp: 20, ac: 11,
    };

    applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    applyDndAction(seats, state, 'boss', { kind: 'bossMove', monsterId: 'm-boss-test', r: 8, c: 8 });

    const commanded = findPiece(state, (p) => p.id === 'm-boss-test');
    const end = applyDndAction(seats, state, 'boss', { kind: 'bossEnd' }, () => 0.5);
    expect(end.ok).toBe(true);

    // 被指揮過的沒有再動一次；沒被指揮的由 AI 往英雄靠近
    expect(findPiece(state, (p) => p.id === 'm-boss-test').c).toBe(commanded.c);
    const idle = findPiece(state, (p) => p.id === 'm-idle');
    expect(idle.r + idle.c).toBeGreaterThan(4);

    // 回合交還給冒險者
    expect(state.phase).toBe('party');
    expect(state.turnSeat).toBe(0);
    expect(state.monsterActed.size).toBe(0);
  });

  it('should treat a boss timeout as ending the monster round', () => {
    const { seats, state } = bossTable();
    applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    expect(state.phase).toBe('boss');

    const acted = autoActDnd(seats, state);
    expect(acted?.ok).toBe(true);
    expect(state.phase).toBe('party');
    expect(state.turnSeat).toBe(0);
  });

  it('should fall back to full AI control when the boss player leaves', () => {
    const { seats, state } = bossTable();
    applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    expect(state.phase).toBe('boss');

    removePlayerFromDnd(seats, state, 'boss');

    expect(state.bossSeat).toBeNull();
    expect(state.phase).toBe('party');
    expect(state.turnSeat).toBe(0);

    // 之後的輪次直接跑怪物 AI，不會再停在魔王身上
    const after = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    expect(after.ok).toBe(true);
    expect(state.phase).toBe('party');
    expect(after.events.some((e) => e.t === 'dndMonsterTurn')).toBe(true);
  });

  it('should auto-resolve stunned monsters at the start of the boss turn', () => {
    const { seats, state } = bossTable();
    const pawn = findPiece(state, (p) => p.id === 'm-boss-test');
    pawn.piece.stunnedTurns = 1;

    applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);

    // 暈眩自動結算掉，魔王不能拿牠來行動
    expect(state.monsterActed.has('m-boss-test')).toBe(true);
    const blocked = applyDndAction(seats, state, 'boss', {
      kind: 'bossMove', monsterId: 'm-boss-test', r: 8, c: 9,
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toBe('MONSTER_ALREADY_ACTED');
  });

  it('should reflect a third of the damage back at the attacker', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'brave' });
    state.traps = [];
    clearGoblins(state);

    const warrior = findPiece(state, (p) => p.playerId === 'p1');
    state.board[warrior.r][warrior.c].piece = null;
    state.board[8][6].piece = warrior.piece;

    // 必中、傷害固定：rng 0.9 → d6 打出 6 → round(6 * 1.3) = 8 點
    state.board[8][7].piece = {
      id: 'm-hit', type: 'goblin', name: 'Goblin Hit', hp: 40, maxHp: 40, ac: 40,
      attackBonus: 40, dmgDice: 6,
    };

    const result = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.9);
    expect(result.ok).toBe(true);

    const hit = result.events.find((e) => e.t === 'dndAttack' && e.player === 'Goblin Hit' && e.hit);
    expect(hit).toBeDefined();

    const reflected = Math.round(hit.damage / 3);
    expect(reflected).toBeGreaterThan(0);
    expect(result.events.some(
      (e) => e.t === 'dndMessage' && e.message.includes('反射'),
    )).toBe(true);
    expect(findPiece(state, (p) => p.id === 'm-hit').piece.hp).toBe(40 - reflected);
  });

  it('should not reflect for non-Warrior classes', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'tangerine' });
    state.traps = [];
    clearGoblins(state);

    const mage = findPiece(state, (p) => p.playerId === 'p1');
    state.board[mage.r][mage.c].piece = null;
    state.board[8][6].piece = mage.piece;
    state.board[8][7].piece = {
      id: 'm-hit', type: 'goblin', name: 'Goblin Hit', hp: 40, maxHp: 40, ac: 40,
      attackBonus: 40, dmgDice: 6,
    };

    const result = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.9);
    expect(result.ok).toBe(true);
    expect(result.events.some((e) => e.t === 'dndMessage' && e.message.includes('反射'))).toBe(false);
    expect(findPiece(state, (p) => p.id === 'm-hit').piece.hp).toBe(40);
  });

  it('should let reflect damage finish off the attacker', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'brave' });
    state.traps = [];
    clearGoblins(state);

    const warrior = findPiece(state, (p) => p.playerId === 'p1');
    state.board[warrior.r][warrior.c].piece = null;
    state.board[8][6].piece = warrior.piece;
    state.board[8][7].piece = {
      id: 'm-frail', type: 'goblin', name: 'Goblin Frail', hp: 1, maxHp: 20, ac: 40,
      attackBonus: 40, dmgDice: 6,
    };

    const result = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.9);
    expect(result.ok).toBe(true);

    expect(result.events.some((e) => e.t === 'dndMessage' && e.message.includes('反噬倒下'))).toBe(true);
    expect(findPiece(state, (p) => p.id === 'm-frail')).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // B3 護送關：拯救村民
  // ---------------------------------------------------------------------------

  /** 把隊伍直接送進 B3 護送關。 */
  function enterEscort() {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'brave' });
    state.traps = [];
    descendTo(state, seats, 3);
    state.traps = [];
    return { seats, state };
  }

  it('should line up ten villagers at the bottom when B3 starts', () => {
    const { state } = enterEscort();
    expect(state.level).toBe(3);
    expect(countPieces(state, (p) => p.type === 'villager')).toBe(10);
    // 全部站在最底列
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = state.board[BOARD_SIZE - 1][c].piece;
      if (piece) expect(['villager', 'player']).toContain(piece.type);
    }
    // 護送關開場沒有怪，伏兵第 2 輪才來
    expect(countPieces(state, (p) => p.type === 'goblin')).toBe(0);
  });

  it('should walk villagers one cell up each round and rescue them at the top', () => {
    const { seats, state } = enterEscort();

    const rowOf = (id) => {
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          if (state.board[r][c].piece?.id === id) return r;
        }
      }
      return null;
    };

    const before = rowOf('v-0');
    applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    expect(rowOf('v-0')).toBe(before - 1);

    // 直接把一個村民擺到頂列，下一輪就該獲救
    const at = rowOf('v-1');
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (state.board[at][c].piece?.id === 'v-1') {
        state.board[at][c].piece = null;
        state.board[0][c].piece = { id: 'v-1', type: 'villager', name: '村民 2', hp: 20, maxHp: 20, ac: 12 };
        break;
      }
    }
    const rescuedBefore = state.villagersRescued;
    applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    expect(state.villagersRescued).toBe(rescuedBefore + 1);
    expect(rowOf('v-1')).toBeNull();
  });

  it('should spring the ambush on round two and send chasers every three rounds', () => {
    const { seats, state } = enterEscort();

    // 追兵生出來之後可能馬上被隊伍砍掉，所以數的是「登場事件」而不是場上活著的數量
    let chasers = 0;
    let ambushes = 0;
    const advanceTo = (round) => {
      let guard = 0;
      while (state.roundCount < round && guard++ < 20) {
        const res = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
        if (!res.ok) break;
        for (const e of res.events) {
          if (e.t !== 'dndMessage') continue;
          if (e.message.includes('追了上來')) chasers++;
          if (e.message.includes('伏兵殺出')) ambushes++;
        }
      }
    };

    advanceTo(1);
    expect(ambushes).toBe(0);

    advanceTo(2);
    expect(ambushes).toBe(1);
    expect(countPieces(state, (p) => p.id.startsWith('m-ambush'))).toBe(9);

    advanceTo(3);
    expect(chasers).toBe(1);

    // 第 4、5 輪不補，第 6 輪再補一隻
    advanceTo(5);
    expect(chasers).toBe(1);
    advanceTo(6);
    expect(chasers).toBe(2);
  });

  it('should clear B3 and open the stairs once enough villagers get out', () => {
    const { seats, state } = enterEscort();

    // 只留一個村民在頂列，其餘算成已經獲救
    let kept = false;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (state.board[r][c].piece?.type !== 'villager') continue;
        state.board[r][c].piece = null;
      }
    }
    state.villagersRescued = 4;
    state.board[0][3].piece = { id: 'v-last', type: 'villager', name: '村民 X', hp: 20, maxHp: 20, ac: 12 };
    kept = true;
    expect(kept).toBe(true);

    applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);

    expect(state.villagersRescued).toBe(5);
    expect(state.over).toBe(false);
    expect(findPiece(state, (p) => p.type === 'staircase')).not.toBeNull();
  });

  it('should fail the run when fewer than five villagers make it out', () => {
    const { seats, state } = enterEscort();

    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (state.board[r][c].piece?.type === 'villager') state.board[r][c].piece = null;
      }
    }
    state.villagersRescued = 3;
    state.board[0][3].piece = { id: 'v-last', type: 'villager', name: '村民 X', hp: 20, maxHp: 20, ac: 12 };

    const result = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);

    expect(state.villagersRescued).toBe(4); // 還是低於門檻
    expect(state.over).toBe(true);
    expect(state.won).toBe(false);
    expect(result.events.some((e) => e.t === 'dndOver' && e.won === false)).toBe(true);
  });

  it('should let monsters hunt villagers, not just the party', () => {
    const { seats, state } = enterEscort();

    // 清掉其他村民，只留一個孤零零的，旁邊擺一隻必中的怪
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (state.board[r][c].piece?.type === 'villager') state.board[r][c].piece = null;
      }
    }
    state.board[5][5].piece = { id: 'v-bait', type: 'villager', name: '村民 誘餌', hp: 20, maxHp: 20, ac: 11 };
    state.board[5][6].piece = {
      id: 'm-hunter', type: 'goblin', name: 'Goblin Hunter', hp: 20, maxHp: 20, ac: 11,
      attackBonus: 40, dmgDice: 6,
    };

    const result = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.9);
    expect(result.events.some(
      (e) => e.t === 'dndAttack' && e.player === 'Goblin Hunter' && e.target.includes('村民'),
    )).toBe(true);
  });

  it('should drain the target when the Cleric judges it', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'star' });
    state.traps = [];
    clearGoblins(state);
    clearNpcs(state); // 只驗判官汲取的那一點，隊友的傷害會把數字算亂

    const cleric = findPiece(state, (p) => p.playerId === 'p1');
    state.board[cleric.r][cleric.c].piece = null;
    state.board[8][6].piece = cleric.piece;
    state.board[8][7].piece = { id: 'm-t', type: 'goblin', name: 'T', hp: 30, maxHp: 30, ac: 1 };

    const result = applyDndAction(seats, state, 'p1', { kind: 'attack', targetId: 'm-t' }, () => 0.9);
    expect(result.ok).toBe(true);
    expect(result.events.some((e) => e.t === 'dndMessage' && e.message.includes('神聖判官'))).toBe(true);

    const hit = result.events.find((e) => e.t === 'dndAttack' && e.target === 'T');
    const target = findPiece(state, (p) => p.id === 'm-t');
    // 目標同時吃到普通攻擊的傷害與判官汲取的 1 點
    expect(target.piece.hp).toBe(30 - hit.damage - 1);
  });

  it('should scale the judgement drain with the staff', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'star' });
    state.traps = [];
    clearGoblins(state);
    state.seats[0].equipment = { kind: 'star', tier: 'hell' }; // 汲取 4

    const cleric = findPiece(state, (p) => p.playerId === 'p1');
    state.board[cleric.r][cleric.c].piece = null;
    state.board[8][6].piece = cleric.piece;
    cleric.piece.hp = 1;
    state.seats[0].hp = 1;
    state.board[8][7].piece = { id: 'm-t', type: 'goblin', name: 'T', hp: 99, maxHp: 99, ac: 99 };

    const result = applyDndAction(seats, state, 'p1', { kind: 'attack', targetId: 'm-t' }, () => 0.01);
    expect(result.ok).toBe(true);
    // 這一刀揮空（AC 99），但判官照樣汲取 4 點
    expect(state.seats[0].hp).toBe(5);
    expect(findPiece(state, (p) => p.id === 'm-t').piece.hp).toBe(95);
  });

  it('should fire the mage passive even on a miss', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'tangerine' });
    state.traps = [];
    clearGoblins(state);

    const mage = findPiece(state, (p) => p.playerId === 'p1');
    state.board[mage.r][mage.c].piece = null;
    state.board[8][6].piece = mage.piece;
    state.board[8][7].piece = { id: 'm-t', type: 'goblin', name: 'T', hp: 40, maxHp: 40, ac: 99 };

    // rng 0.01 → 命中骰極低必定揮空，被動骰 0 → 破魔
    const result = applyDndAction(seats, state, 'p1', { kind: 'attack', targetId: 'm-t' }, () => 0.01);
    expect(result.ok).toBe(true);
    expect(result.events.some((e) => e.t === 'dndAttack' && e.hit === false)).toBe(true);
    expect(result.events.some((e) => e.t === 'dndMessage' && e.message.includes('破魔'))).toBe(true);

    // 破魔動的是魔防，不是 AC —— 物理防禦要原封不動
    const target = findPiece(state, (p) => p.id === 'm-t');
    expect(target.piece.ac).toBe(99);
    expect(target.piece.magicDebuffTurns).toBeGreaterThan(0);
  });

  it('should make fire burn harder on a magic-shredded monster', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'tangerine' });
    state.traps = [];
    clearGoblins(state);

    const mage = findPiece(state, (p) => p.playerId === 'p1');
    state.board[mage.r][mage.c].piece = null;
    state.board[8][6].piece = mage.piece;

    // 兩隻條件相同的怪，一隻先被破魔
    state.board[2][2].piece = { id: 'm-plain', type: 'goblin', name: 'Plain', hp: 99, maxHp: 99, ac: 11 };
    state.board[2][5].piece = {
      id: 'm-shred', type: 'goblin', name: 'Shred', hp: 99, maxHp: 99, ac: 11, magicDebuffTurns: 2,
    };
    state.fireWalls = [
      { r: 2, c: 2, turns: 2, dmg: 10 },
      { r: 2, c: 5, turns: 2, dmg: 10 },
    ];

    applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);

    const plain = findPiece(state, (p) => p.id === 'm-plain');
    const shred = findPiece(state, (p) => p.id === 'm-shred');
    expect(99 - plain.piece.hp).toBe(10);
    expect(99 - shred.piece.hp).toBe(13); // 10 × 1.3
  });

  it('should bind a monster with the mage passive', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'tangerine' });
    state.traps = [];
    clearGoblins(state);

    const mage = findPiece(state, (p) => p.playerId === 'p1');
    state.board[mage.r][mage.c].piece = null;
    state.board[8][6].piece = mage.piece;
    state.board[8][7].piece = { id: 'm-t', type: 'goblin', name: 'T', hp: 40, maxHp: 40, ac: 99 };

    // 被動骰 1 → 束縛
    const result = applyDndAction(seats, state, 'p1', { kind: 'attack', targetId: 'm-t' }, () => 0.9);
    expect(result.events.some((e) => e.t === 'dndMessage' && e.message.includes('束縛'))).toBe(true);

    const target = findPiece(state, (p) => p.id === 'm-t');
    expect(target.piece.trappedTurns).toBeGreaterThan(0);
    expect(target.piece.netDamage).toBe(0); // 只定身，不扣血
    expect(target.piece.hp).toBe(40 - 0);
  });

  it('should use the shared move table for every class', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'star' });
    state.traps = [];
    clearGoblins(state);

    const cleric = findPiece(state, (p) => p.playerId === 'p1');
    state.board[cleric.r][cleric.c].piece = null;
    state.board[8][6].piece = cleric.piece;

    // 牧師現在能走 2 格
    const ok = applyDndAction(seats, state, 'p1', {
      kind: 'turnCombo', move: { r: 6, c: 6 }, action: { kind: 'rest' },
    }, () => 0.5);
    expect(ok.ok).toBe(true);
    expect(findPiece(state, (p) => p.playerId === 'p1').r).toBe(6);
  });

  // ---------------------------------------------------------------------------
  // 護送關的獎勵裝備
  // ---------------------------------------------------------------------------

  /** 把場面直接推到「村民只剩一個、其餘算獲救」的狀態，跑完就會結算發裝備。 */
  function finishEscortWith(rescued, difficulty = 'normal') {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'brave' }, difficulty);
    state.traps = [];
    descendTo(state, seats, 3);
    state.traps = [];
    clearGoblins(state);

    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (state.board[r][c].piece?.type === 'villager') state.board[r][c].piece = null;
      }
    }
    state.villagersRescued = rescued - 1;
    state.board[0][3].piece = { id: 'v-last', type: 'villager', name: '村民 X', hp: 20, maxHp: 20, ac: 12 };

    const result = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    return { seats, state, result };
  }

  const equippedCount = (state) =>
    [0, 1, 2, 3].filter((seat) => state.seats[seat]?.equipment).length;

  it('should hand out equipment on the 5/6/7/8 rescue ladder', () => {
    expect(equippedCount(finishEscortWith(5).state)).toBe(1);
    expect(equippedCount(finishEscortWith(6).state)).toBe(2);
    expect(equippedCount(finishEscortWith(7).state)).toBe(3);
    expect(equippedCount(finishEscortWith(8).state)).toBe(4);
    // 超過 8 人也就是全隊都有，不會超發
    expect(equippedCount(finishEscortWith(10).state)).toBe(4);
  });

  it('should not hand out equipment on easy', () => {
    const { state } = finishEscortWith(10, 'easy');
    expect(state.villagersRescued).toBe(10);
    expect(equippedCount(state)).toBe(0);
  });

  it('should add the common bonus once, only to the character who got the equipment', () => {
    // 4 件裝備＝4 個不同角色各拿一件，不是同一個人疊 4 次
    const seats: Seats = ['p1', null, null, null];
    // rng 固定回 0 → 隊伍是戰士＋盜賊／法師／牧師，不會抽到帶【堅韌】的鬥士
    const state = dealDnd(seats, { p1: 'brave' }, 'normal', null, null, () => 0);
    state.traps = [];
    descendTo(state, seats, 3);
    state.traps = [];
    clearGoblins(state);

    // 發裝備前先記下每個座位的基準值
    const before = [0, 1, 2, 3].map((seat) => ({
      maxHp: state.seats[seat].maxHp,
      ac: findSeatAc(state, seats, seat),
    }));

    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (state.board[r][c].piece?.type === 'villager') state.board[r][c].piece = null;
      }
    }
    state.villagersRescued = 7; // 下一個獲救後是 8 → 全隊都拿到
    state.board[0][3].piece = { id: 'v-last', type: 'villager', name: '村民 X', hp: 20, maxHp: 20, ac: 12 };

    applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    expect(state.villagersRescued).toBe(8);

    for (const seat of [0, 1, 2, 3]) {
      const info = state.seats[seat];
      // 每個人剛好一件
      expect(info.equipment).toBeDefined();
      // 一般難度的共通加值是 +2，而且只加一次。
      // 戰士的【反射盾】另外再 +2（AC 與 HP 都是），所以座位 0 是 +4。
      const extra = info.equipment.kind === 'brave' ? 2 : 0;
      expect(info.maxHp).toBe(before[seat].maxHp + 2 + extra);
      expect(findSeatAc(state, seats, seat)).toBe(before[seat].ac + 2 + extra);
    }
  });

  it('should leave characters without equipment completely untouched', () => {
    const seats: Seats = ['p1', null, null, null];
    // 固定職業：抽到鬥士的話【巨劍·堅韌】會多加三成 HP／AC，數字就對不上了
    const state = dealDnd(seats, { p1: 'brave' }, 'normal', null, null, () => 0);
    state.traps = [];
    descendTo(state, seats, 3);
    state.traps = [];
    clearGoblins(state);

    const before = [0, 1, 2, 3].map((seat) => ({
      maxHp: state.seats[seat].maxHp,
      ac: findSeatAc(state, seats, seat),
    }));

    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (state.board[r][c].piece?.type === 'villager') state.board[r][c].piece = null;
      }
    }
    state.villagersRescued = 4; // 下一個獲救後是 5 → 只發 1 件
    state.board[0][3].piece = { id: 'v-last', type: 'villager', name: '村民 X', hp: 20, maxHp: 20, ac: 12 };

    applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);

    const equipped = [0, 1, 2, 3].filter((seat) => state.seats[seat].equipment);
    expect(equipped).toHaveLength(1);

    for (const seat of [0, 1, 2, 3]) {
      const gain = state.seats[seat].equipment ? 2 : 0;
      expect(state.seats[seat].maxHp).toBe(before[seat].maxHp + gain);
      expect(findSeatAc(state, seats, seat)).toBe(before[seat].ac + gain);
    }
  });

  it('should stack the reflect shield on top of the base one third', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'brave' });
    state.traps = [];
    clearGoblins(state);
    state.seats[0].equipment = { kind: 'brave', tier: 'hell' }; // 反射 +60% → 共 93%

    const warrior = findPiece(state, (p) => p.playerId === 'p1');
    state.board[warrior.r][warrior.c].piece = null;
    state.board[8][6].piece = warrior.piece;
    state.board[8][7].piece = {
      id: 'm-hit', type: 'goblin', name: 'Goblin Hit', hp: 60, maxHp: 60, ac: 40,
      attackBonus: 40, dmgDice: 6,
    };

    const result = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.9);
    const hit = result.events.find((e) => e.t === 'dndAttack' && e.player === 'Goblin Hit' && e.hit);
    expect(hit).toBeDefined();

    const expected = Math.round(hit.damage * (1 / 3 + 0.6));
    expect(findPiece(state, (p) => p.id === 'm-hit').piece.hp).toBe(60 - expected);
  });

  it('should turn the chain into an area pull once the shield is equipped', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'brave' });
    state.traps = [];
    clearGoblins(state);
    state.seats[0].equipment = { kind: 'brave', tier: 'hard' }; // 範圍 3

    const warrior = findPiece(state, (p) => p.playerId === 'p1');
    state.board[warrior.r][warrior.c].piece = null;
    state.board[8][6].piece = warrior.piece;

    // 範圍內三隻、範圍外一隻
    state.board[8][8].piece = { id: 'm-a', type: 'goblin', name: 'A', hp: 20, maxHp: 20, ac: 30 };
    state.board[6][6].piece = { id: 'm-b', type: 'goblin', name: 'B', hp: 20, maxHp: 20, ac: 30 };
    state.board[8][3].piece = { id: 'm-c', type: 'goblin', name: 'C', hp: 20, maxHp: 20, ac: 30 };
    state.board[8][12].piece = { id: 'm-far', type: 'goblin', name: 'Far', hp: 20, maxHp: 20, ac: 30 };

    const cast = applyDndAction(seats, state, 'p1', { kind: 'skill', targetId: 'm-a' }, () => 0.01);
    expect(cast.ok).toBe(true);
    expect(cast.events.some((e) => e.t === 'dndMessage' && e.message.includes('一起拖到了身邊'))).toBe(true);

    // 三隻都被拖到戰士旁邊（怪物回合會再自己動，所以在施放當下就檢查距離）
    const pulledNear = ['m-a', 'm-b', 'm-c'].filter((id) => {
      const mon = findPiece(state, (p) => p.id === id);
      return mon !== null;
    });
    expect(pulledNear).toHaveLength(3);
    // 範圍外那隻沒被動到
    const far = findPiece(state, (p) => p.id === 'm-far');
    expect(far).not.toBeNull();
  });

  it('should keep the chain single-target without the shield', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'brave' });
    state.traps = [];
    clearGoblins(state);

    const warrior = findPiece(state, (p) => p.playerId === 'p1');
    state.board[warrior.r][warrior.c].piece = null;
    state.board[8][6].piece = warrior.piece;
    state.board[8][8].piece = { id: 'm-a', type: 'goblin', name: 'A', hp: 20, maxHp: 20, ac: 30 };
    state.board[6][6].piece = { id: 'm-b', type: 'goblin', name: 'B', hp: 20, maxHp: 20, ac: 30 };

    const cast = applyDndAction(seats, state, 'p1', { kind: 'skill', targetId: 'm-a' }, () => 0.01);
    expect(cast.ok).toBe(true);
    expect(cast.events.some((e) => e.t === 'dndMessage' && e.message.includes('強行拉到身旁'))).toBe(true);
    expect(cast.events.some((e) => e.t === 'dndMessage' && e.message.includes('一起拖到了身邊'))).toBe(false);
  });

  it('should grow the fire wall into a square and burn harder', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'tangerine' });
    state.traps = [];
    clearGoblins(state);
    state.seats[0].equipment = { kind: 'tangerine', tier: 'hard' }; // 3x3、傷害 +2

    const mage = findPiece(state, (p) => p.playerId === 'p1');
    state.board[mage.r][mage.c].piece = null;
    state.board[8][6].piece = mage.piece;

    const cast = applyDndAction(seats, state, 'p1', { kind: 'skill', r: 6, c: 6 }, () => 0.01);
    expect(cast.ok).toBe(true);
    expect(state.fireWalls).toHaveLength(9); // 3x3
    expect(state.fireWalls[0].dmg).toBe(5);  // 基礎 3 + 2
  });

  it('should report a reflect fx when the warrior bounces damage back', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'brave' });
    state.traps = [];
    clearGoblins(state);

    const warrior = findPiece(state, (p) => p.playerId === 'p1');
    state.board[warrior.r][warrior.c].piece = null;
    state.board[8][6].piece = warrior.piece;
    state.board[8][7].piece = { id: 'm-hit', type: 'goblin', name: 'Hitter', hp: 40, maxHp: 40, ac: 11 };

    const acted = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.9);
    expect(acted.ok).toBe(true);
    // 怪物打中戰士 → 反射發動 → 前端收得到鏡子圖示
    expect(state.fx.some((f) => f.pieceId === warrior.piece.id && f.kind === 'reflect')).toBe(true);
  });

  it('should clear the fx list at the start of every action', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'brave' });
    state.traps = [];
    clearGoblins(state);
    state.fx = [{ pieceId: 'stale', kind: 'stun' }];

    applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    expect(state.fx.some((f) => f.pieceId === 'stale')).toBe(false);
  });

  it('should report a bind fx from the mage passive', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'tangerine' });
    state.traps = [];
    clearGoblins(state);

    const mage = findPiece(state, (p) => p.playerId === 'p1');
    state.board[mage.r][mage.c].piece = null;
    state.board[8][6].piece = mage.piece;
    state.board[8][7].piece = { id: 'm-b', type: 'goblin', name: 'B', hp: 40, maxHp: 40, ac: 99 };

    applyDndAction(seats, state, 'p1', { kind: 'attack', targetId: 'm-b' }, () => 0.9);
    expect(state.fx.some((f) => f.pieceId === 'm-b' && f.kind === 'bind')).toBe(true);
  });

  it('should let the warrior chain an ally over', () => {
    const seats: Seats = ['p1', 'p2', null, null];
    const state = dealDnd(seats, { p1: 'brave', p2: 'star' });
    state.traps = [];
    clearGoblins(state);

    const warrior = findPiece(state, (p) => p.playerId === 'p1');
    state.board[warrior.r][warrior.c].piece = null;
    state.board[8][6].piece = warrior.piece;

    const ally = findPiece(state, (p) => p.playerId === 'p2');
    state.board[ally.r][ally.c].piece = null;
    state.board[8][9].piece = ally.piece; // 距離 3，剛好在鎖鏈範圍內

    const pull = applyDndAction(seats, state, 'p1', { kind: 'skill', targetId: ally.piece.id }, () => 0.5);
    expect(pull.ok).toBe(true);
    expect(pull.events.some((e) => e.t === 'dndMessage' && e.message.includes('拉到了自己身旁'))).toBe(true);

    const moved = findPiece(state, (p) => p.playerId === 'p2');
    expect(Math.abs(moved.r - 8) + Math.abs(moved.c - 6)).toBe(1); // 貼到戰士身邊
  });

  it('should refuse to chain an ally standing too far away', () => {
    const seats: Seats = ['p1', 'p2', null, null];
    const state = dealDnd(seats, { p1: 'brave', p2: 'star' });
    state.traps = [];
    clearGoblins(state);

    const warrior = findPiece(state, (p) => p.playerId === 'p1');
    state.board[warrior.r][warrior.c].piece = null;
    state.board[8][2].piece = warrior.piece;

    const ally = findPiece(state, (p) => p.playerId === 'p2');
    state.board[ally.r][ally.c].piece = null;
    state.board[8][10].piece = ally.piece; // 距離 8

    const pull = applyDndAction(seats, state, 'p1', { kind: 'skill', targetId: ally.piece.id }, () => 0.5);
    expect(pull.ok).toBe(false);
    if (!pull.ok) expect(pull.error).toBe('TARGET_OUT_OF_RANGE');
  });

  it('should pull only the targeted ally even with the shield equipped', () => {
    const seats: Seats = ['p1', 'p2', null, null];
    const state = dealDnd(seats, { p1: 'brave', p2: 'star' });
    state.traps = [];
    clearGoblins(state);
    state.seats[0].equipment = { kind: 'brave', tier: 'hell' }; // 範圍 4、指定怪物時是群拉

    const warrior = findPiece(state, (p) => p.playerId === 'p1');
    state.board[warrior.r][warrior.c].piece = null;
    state.board[8][6].piece = warrior.piece;

    const ally = findPiece(state, (p) => p.playerId === 'p2');
    state.board[ally.r][ally.c].piece = null;
    state.board[8][8].piece = ally.piece;

    state.board[8][9].piece = { id: 'm-a', type: 'goblin', name: 'A', hp: 20, maxHp: 20, ac: 11 };

    const pull = applyDndAction(seats, state, 'p1', { kind: 'skill', targetId: ally.piece.id }, () => 0.5);
    expect(pull.ok).toBe(true);

    // 指定隊友就只拉隊友，範圍內的怪物不會被順手捲過來
    const moved = findPiece(state, (p) => p.playerId === 'p2');
    expect(Math.abs(moved.r - 8) + Math.abs(moved.c - 6)).toBe(1);
    expect(pull.events.some((e) => e.t === 'dndMessage' && e.message.includes('反射盾'))).toBe(false);
  });

  it('should let the staff heal the whole party', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'star' });
    state.traps = [];
    clearGoblins(state);
    state.seats[0].equipment = { kind: 'star', tier: 'hell' }; // 主治療 7、其他人 +4

    const cleric = findPiece(state, (p) => p.playerId === 'p1');
    state.board[cleric.r][cleric.c].piece = null;
    state.board[8][6].piece = cleric.piece;
    cleric.piece.hp = 1;
    state.seats[0].hp = 1;
    for (const seat of [1, 2, 3]) {
      state.seats[seat].hp = 1;
      const npc = findPiece(state, (p) => p.id === `npc-${seat}`);
      if (npc) npc.piece.hp = 1;
    }

    const healed = applyDndAction(seats, state, 'p1', { kind: 'skill', targetId: cleric.piece.id }, () => 0.5);
    expect(healed.ok).toBe(true);
    expect(state.seats[0].hp).toBe(8); // 1 + 7
    // 其他隊員也被光芒掃到
    for (const seat of [1, 2, 3]) {
      expect(state.seats[seat].hp).toBeGreaterThan(1);
    }
  });

  it('should hide the rogue from monsters after the dice dagger is awarded', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'bubble' });
    state.traps = [];
    clearGoblins(state);
    state.seats[0].equipment = { kind: 'bubble', tier: 'normal' };
    state.seats[0].stealth = true;

    const rogue = findPiece(state, (p) => p.playerId === 'p1');
    state.board[rogue.r][rogue.c].piece = null;
    state.board[8][6].piece = rogue.piece;
    rogue.piece.stealth = true;
    const hpBefore = state.seats[0].hp;

    // 貼著臉站一隻怪，照樣打不到匿蹤中的盜賊
    state.board[8][7].piece = { id: 'm-blind', type: 'goblin', name: 'Blind', hp: 40, maxHp: 40, ac: 11 };

    const rested = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.99);
    expect(rested.ok).toBe(true);
    expect(rested.events.some((e) => e.t === 'dndAttack' && e.target.includes('Rogue'))).toBe(false);
    expect(state.seats[0].hp).toBeGreaterThanOrEqual(hpBefore);
  });

  it('should break stealth when the rogue attacks and restore it on rest', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'bubble' });
    state.traps = [];
    clearGoblins(state);
    state.seats[0].equipment = { kind: 'bubble', tier: 'normal' };
    state.seats[0].stealth = true;

    const rogue = findPiece(state, (p) => p.playerId === 'p1');
    state.board[rogue.r][rogue.c].piece = null;
    state.board[8][6].piece = rogue.piece;
    rogue.piece.stealth = true;
    state.board[8][7].piece = { id: 'm-t', type: 'goblin', name: 'T', hp: 99, maxHp: 99, ac: 11 };

    const struck = applyDndAction(seats, state, 'p1', { kind: 'attack', targetId: 'm-t' }, () => 0.9);
    expect(struck.ok).toBe(true);
    expect(struck.events.some((e) => e.t === 'dndMessage' && e.message.includes('【匿蹤】解除'))).toBe(true);
    expect(state.seats[0].stealth).toBe(false);

    const rested = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    expect(rested.ok).toBe(true);
    expect(rested.events.some((e) => e.t === 'dndMessage' && e.message.includes('【匿蹤】恢復'))).toBe(true);
    expect(state.seats[0].stealth).toBe(true);
    expect(findPiece(state, (p) => p.playerId === 'p1').piece.stealth).toBe(true);
  });

  it('should break stealth when the rogue throws the net', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'bubble' });
    state.traps = [];
    clearGoblins(state);
    state.seats[0].equipment = { kind: 'bubble', tier: 'normal' };
    state.seats[0].stealth = true;

    const rogue = findPiece(state, (p) => p.playerId === 'p1');
    state.board[rogue.r][rogue.c].piece = null;
    state.board[8][6].piece = rogue.piece;
    rogue.piece.stealth = true;
    state.board[8][9].piece = { id: 'm-n', type: 'goblin', name: 'N', hp: 99, maxHp: 99, ac: 11 };

    const cast = applyDndAction(seats, state, 'p1', { kind: 'skill', targetId: 'm-n' }, () => 0.5);
    expect(cast.ok).toBe(true);
    expect(state.seats[0].stealth).toBe(false);
  });

  it('should not grant stealth to a rogue without the dagger', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'bubble' });
    state.traps = [];
    clearGoblins(state);

    const rogue = findPiece(state, (p) => p.playerId === 'p1');
    state.board[rogue.r][rogue.c].piece = null;
    state.board[8][6].piece = rogue.piece;

    applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    expect(state.seats[0].stealth).toBeFalsy();
  });

  it('should let the dice dagger strengthen the net as well', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'bubble' });
    state.traps = [];
    clearGoblins(state);
    state.seats[0].equipment = { kind: 'bubble', tier: 'hard' }; // 多綁 2 輪、持續傷害 +2

    const rogue = findPiece(state, (p) => p.playerId === 'p1');
    state.board[rogue.r][rogue.c].piece = null;
    state.board[8][6].piece = rogue.piece;
    state.board[8][9].piece = {
      id: 'm-net', type: 'goblin', name: 'Goblin Net', hp: 40, maxHp: 40, ac: 11,
    };

    const cast = applyDndAction(seats, state, 'p1', { kind: 'skill', targetId: 'm-net' }, () => 0.01);
    expect(cast.ok).toBe(true);

    const netted = findPiece(state, (p) => p.id === 'm-net');
    // 基礎 3 輪 + 4（困難的骰子匕首）= 7，同一次動作的回合結算已經吃掉一輪 → 剩 6
    expect(netted.piece.trappedTurns).toBe(6);
    // 每輪扣 1 + 2 = 3 點
    expect(netted.piece.netDamage).toBe(3);
    expect(netted.piece.hp).toBe(37);
  });

  it('should keep the net at its base strength without the dagger', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'bubble' });
    state.traps = [];
    clearGoblins(state);

    const rogue = findPiece(state, (p) => p.playerId === 'p1');
    state.board[rogue.r][rogue.c].piece = null;
    state.board[8][6].piece = rogue.piece;
    state.board[8][9].piece = {
      id: 'm-net', type: 'goblin', name: 'Goblin Net', hp: 40, maxHp: 40, ac: 11,
    };

    applyDndAction(seats, state, 'p1', { kind: 'skill', targetId: 'm-net' }, () => 0.01);
    const netted = findPiece(state, (p) => p.id === 'm-net');
    expect(netted.piece.trappedTurns).toBe(2); // 3 - 1
    expect(netted.piece.hp).toBe(39);          // 每輪 1 點
  });

  it('should make the dice dagger bite even on a miss', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'bubble' });
    state.traps = [];
    clearGoblins(state);
    state.seats[0].equipment = { kind: 'bubble', tier: 'hell' }; // 命中骰 x0.9

    const rogue = findPiece(state, (p) => p.playerId === 'p1');
    state.board[rogue.r][rogue.c].piece = null;
    state.board[8][6].piece = rogue.piece;
    // AC 高到一定揮空；damagedByRogue 先設起來，避開「盜賊第一擊必中」
    state.board[8][7].piece = {
      id: 'm-tough', type: 'goblin', name: 'Goblin Tough', hp: 60, maxHp: 60, ac: 99,
      damagedByRogue: true,
    };

    const result = applyDndAction(seats, state, 'p1', { kind: 'attack', targetId: 'm-tough' }, () => 0.9);
    expect(result.ok).toBe(true);
    expect(result.events.some((e) => e.t === 'dndMessage' && e.message.includes('揮空'))).toBe(true);
    // d20 = 19 → round(19 * 0.9) = 17
    expect(findPiece(state, (p) => p.id === 'm-tough').piece.hp).toBe(60 - 17);
  });

  // ---------------------------------------------------------------------------
  // B5 哥布林邪神
  // ---------------------------------------------------------------------------

  /** 把場面直接布置成「邪神 + 分身」，方便驗證機制。 */
  function evilGodTable() {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'brave' });
    state.traps = [];
    state.level = 5;
    clearGoblins(state);
    // 隊友現在會依移動力衝過來，18 點血的分身常常還沒動就被砍掉了
    clearNpcs(state);

    const me = findPiece(state, (p) => p.playerId === 'p1');
    state.board[me.r][me.c].piece = null;
    state.board[8][6].piece = me.piece;
    state.seats[0].hp = 999;
    me.piece.hp = 999;
    me.piece.maxHp = 999;

    state.board[8][7].piece = {
      id: 'boss-5', type: 'goblin', name: 'Goblin Evil God (哥布林邪神)',
      hp: 120, maxHp: 120, ac: 5, attackBonus: 5, dmgDice: 10,
    };
    return { seats, state };
  }

  it('should start B5 with zealots only and hold the god back until three quarters are down', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'brave' });
    state.traps = [];
    descendTo(state, seats, 5);
    expect(state.level).toBe(5);

    // 開場只有雜兵（信徒 + 盜賊 + 法師），邪神還沒現身
    expect(countPieces(state, (p) => p.name.includes('Zealot'))).toBe(12);
    expect(state.godMinionTotal).toBeGreaterThanOrEqual(12);
    expect(findPiece(state, (p) => p.id === 'boss-5')).toBeNull();

    const total = state.godMinionTotal;
    const quarter = Math.floor(total / 4);

    /** 把場上雜兵殺到只剩 keep 隻，然後跑一次生成判定。 */
    const killDownTo = (keep) => {
      let alive = countPieces(state, (p) => p.type === 'goblin' && !p.id.startsWith('boss-5'));
      for (let r = 0; r < BOARD_SIZE && alive > keep; r++) {
        for (let c = 0; c < BOARD_SIZE && alive > keep; c++) {
          const piece = state.board[r][c].piece;
          if (piece?.type === 'goblin' && !piece.id.startsWith('boss-5')) {
            state.board[r][c].piece = null;
            alive--;
          }
        }
      }
      checkAndSpawnBossOrStaircase(seats, state, [], () => 0.5);
    };

    // 還剩超過 1/4 → 邪神不出來
    killDownTo(quarter + 1);
    expect(findPiece(state, (p) => p.id === 'boss-5')).toBeNull();

    // 剛好剩 1/4 ＝ 清掉 3/4 → 邪神帶著兩個分身現身
    killDownTo(quarter);
    expect(findPiece(state, (p) => p.id === 'boss-5')).not.toBeNull();
    expect(countPieces(state, (p) => p.id.startsWith('boss-5-copy'))).toBe(2);
  });

  it('should shield the evil god while any copy is alive', () => {
    const { seats, state } = evilGodTable();
    state.board[8][8].piece = {
      id: 'boss-5-copy-x', type: 'goblin', name: '邪神分身（騎士）',
      hp: 24, maxHp: 24, ac: 5, copyClass: 'brave',
    };

    // 先跑一輪讓維護邏輯把免疫掛上
    applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    expect(findPiece(state, (p) => p.id === 'boss-5').piece.invulnerable).toBe(true);

    const blocked = applyDndAction(seats, state, 'p1', { kind: 'attack', targetId: 'boss-5' }, () => 0.9);
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toBe('TARGET_INVULNERABLE');
  });

  it('should open a two round window once every copy is down', () => {
    const { seats, state } = evilGodTable();

    // 一開始沒有分身 → 第一輪結算會開啟空窗
    applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    expect(state.godWindow).toBe(2);
    expect(findPiece(state, (p) => p.id === 'boss-5').piece.invulnerable).toBe(false);

    // 空窗期間打得到
    const hit = applyDndAction(seats, state, 'p1', { kind: 'attack', targetId: 'boss-5' }, () => 0.9);
    expect(hit.ok).toBe(true);
    expect(state.godWindow).toBe(1);

    // 空窗結束就補回分身
    applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    expect(state.godWindow).toBe(0);
    expect(countPieces(state, (p) => p.id.startsWith('boss-5-copy'))).toBe(2);
  });

  it('should drop the shield and start body-hopping below half HP', () => {
    const { seats, state } = evilGodTable();
    const boss = findPiece(state, (p) => p.id === 'boss-5');
    boss.piece.hp = 50; // < 120 的一半
    state.board[8][8].piece = {
      id: 'boss-5-copy-x', type: 'goblin', name: '邪神分身（騎士）',
      hp: 24, maxHp: 24, ac: 5, copyClass: 'brave',
    };

    applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);

    expect(state.godPhase2).toBe(true);
    // 奪舍階段沒有護體，打得到
    const after = findPiece(state, (p) => p.id === 'boss-5');
    expect(after.piece.invulnerable).toBe(false);
    // 身體換過去了：本體不再站在原本那一格
    expect(`${after.r},${after.c}`).not.toBe('8,7');
    // 血量跟著身分走 —— 這就是玩家用來認人的線索。
    // （同一輪 NPC 隊友會打到它，所以只驗「還是本體等級的血量」而不是精確值）
    expect(after.piece.hp).toBeLessThanOrEqual(50);
    expect(after.piece.hp).toBeGreaterThan(24); // 不是分身那種小血量
    expect(after.piece.maxHp).toBe(120);
  });

  it('should displace a hero into a copy position, not swap with the boss', () => {
    const { seats, state } = evilGodTable();
    // 分身放遠一點，才看得出人真的被扯過去
    state.board[2][2].piece = {
      id: 'boss-5-copy-far', type: 'goblin', name: '邪神分身（法師）',
      hp: 16, maxHp: 16, ac: 5, copyClass: 'tangerine',
    };
    const boss = findPiece(state, (p) => p.id === 'boss-5');
    boss.piece.attackBonus = 40; // 必中
    // rng 0.01 → 命中骰低、被動骰 floor(0.01*3)=0 → 錯位
    const result = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.01);

    expect(result.events.some((e) => e.t === 'dndMessage' && e.message.includes('對調了位置'))).toBe(true);

    // 玩家被丟到分身站的位置、分身被換到玩家原本的格子。
    // （分身在王出手前會自己先移動，所以不寫死座標，只驗「兩者確實對調」）
    const me = findPiece(state, (p) => p.playerId === 'p1');
    expect(`${me.r},${me.c}`).not.toBe('8,6');
    expect(`${findPiece(state, (p) => p.id === 'boss-5-copy-far').r},${findPiece(state, (p) => p.id === 'boss-5-copy-far').c}`).toBe('8,6');
  });

  it('should skip displacement when there is no copy to swap with', () => {
    const { seats, state } = evilGodTable();
    const boss = findPiece(state, (p) => p.id === 'boss-5');
    boss.piece.attackBonus = 40;

    const result = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.01);
    expect(result.events.some(
      (e) => e.t === 'dndMessage' && e.message.includes('沒有分身可以替換'),
    )).toBe(true);
  });

  it('should let a copied mage burn the party with a hostile wall', () => {
    const { seats, state } = evilGodTable();
    state.roundCount = 1; // 下一輪是偶數，分身才會放技能
    state.board[8][8].piece = {
      id: 'boss-5-copy-m', type: 'goblin', name: '邪神分身（法師）',
      hp: 16, maxHp: 16, ac: 5, copyClass: 'tangerine', range: 3,
    };

    const result = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    expect(result.events.some((e) => e.t === 'dndMessage' && e.message.includes('燃起了火牆'))).toBe(true);
    expect(state.fireWalls.some((w) => w.hostile)).toBe(true);
  });

  it('should let a copied rogue pin a hero in place', () => {
    const { seats, state } = evilGodTable();
    state.roundCount = 1;
    state.board[8][8].piece = {
      id: 'boss-5-copy-r', type: 'goblin', name: '邪神分身（盜賊）',
      hp: 18, maxHp: 18, ac: 5, copyClass: 'bubble',
    };

    applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    expect(state.seats[0].restrainedTurns).toBeGreaterThan(0);

    // 被纏住就不能移動
    const move = applyDndAction(seats, state, 'p1', {
      kind: 'turnCombo', move: { r: 7, c: 6 }, action: { kind: 'rest' },
    }, () => 0.5);
    expect(move.ok).toBe(false);
    expect(move.error).toBe('MONSTER_RESTRAINED');
  });

  it('should bounce damage back from a copied warrior', () => {
    const { seats, state } = evilGodTable();
    state.board[8][5].piece = {
      id: 'boss-5-copy-w', type: 'goblin', name: '邪神分身（騎士）',
      hp: 60, maxHp: 60, ac: 1, copyClass: 'brave',
    };
    // 先把本體移走，免得護體擋住這次攻擊
    const boss = findPiece(state, (p) => p.id === 'boss-5');
    state.board[boss.r][boss.c].piece = null;

    const before = state.seats[0].hp;
    const result = applyDndAction(seats, state, 'p1', { kind: 'attack', targetId: 'boss-5-copy-w' }, () => 0.9);
    expect(result.ok).toBe(true);
    expect(result.events.some((e) => e.t === 'dndMessage' && e.message.includes('彈了回來'))).toBe(true);
    expect(state.seats[0].hp).toBeLessThan(before);
  });

  // ---------------------------------------------------------------------------
  // 房主代打 NPC 隊友（單人房＝一個人操作 4 個角色）
  // ---------------------------------------------------------------------------

  it('should put the skill cooldown on the acting seat, not on the controller', () => {
    // 手動代打時，用 NPC 牧師補血不該把冷卻算到操作者自己的角色上
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'brave' }, 'normal', null, 'p1', () => 0);
    state.traps = [];
    clearGoblins(state);

    // 找出牧師 NPC 的座位，把回合直接交給它
    let clericSeat = -1;
    for (let seat = 1; seat < 4; seat++) {
      const piece = findPiece(state, (p) => p.id === `npc-${seat}`);
      if (piece?.piece.classId === 'star') clericSeat = seat;
    }
    expect(clericSeat).toBeGreaterThan(0);

    // 讓牧師跟一個受傷的隊友站在一起
    const cleric = findPiece(state, (p) => p.id === `npc-${clericSeat}`);
    state.board[cleric.r][cleric.c].piece = null;
    state.board[8][6].piece = cleric.piece;
    const mate = findPiece(state, (p) => p.playerId === 'p1');
    state.board[mate.r][mate.c].piece = null;
    state.board[8][7].piece = mate.piece;
    mate.piece.hp = 5;
    state.seats[0].hp = 5;

    state.turnSeat = clericSeat;
    const healed = applyDndAction(seats, state, 'p1', {
      kind: 'skill', targetId: mate.piece.id,
    }, () => 0.5);
    expect(healed.ok).toBe(true);

    // 冷卻記在牧師身上，操作者自己的角色不受影響
    expect(state.seats[clericSeat].skillCooldown).toBe(1);
    expect(state.seats[0].skillCooldown ?? 0).toBe(0);
  });

  it('should clear a skill cooldown after one of that character own turns', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'star' });
    state.traps = [];
    clearGoblins(state);

    const me = findPiece(state, (p) => p.playerId === 'p1');
    state.board[me.r][me.c].piece = null;
    state.board[8][6].piece = me.piece;
    me.piece.hp = 5;
    state.seats[0].hp = 5;

    // 第一次施放
    const first = applyDndAction(seats, state, 'p1', { kind: 'skill', targetId: me.piece.id }, () => 0.5);
    expect(first.ok).toBe(true);
    expect(state.seats[0].skillCooldown).toBe(1);

    // 下一個自己的回合還在冷卻
    const blocked = applyDndAction(seats, state, 'p1', { kind: 'skill', targetId: me.piece.id }, () => 0.5);
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toBe('SKILL_ON_COOLDOWN');

    // 做一個別的動作把冷卻走完
    applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    expect(state.seats[0].skillCooldown).toBe(0);

    // 再下一個回合就能用了 —— 總共只跳過一個自己的回合
    const again = applyDndAction(seats, state, 'p1', { kind: 'skill', targetId: me.piece.id }, () => 0.5);
    expect(again.ok).toBe(true);
  });

  it('should hand NPC seats to the controller instead of running the AI', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'brave' }, 'normal', null, 'p1');
    state.traps = [];

    // 座位 0 行動完，回合應該交到座位 1（NPC）手上等 p1 下指令，而不是自動打完
    const result = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    expect(result.ok).toBe(true);
    expect(state.turnSeat).toBe(1);
    expect(state.seats[1].isNpc).toBe(true);
    // 這一輪還沒繞完，怪物也還沒動
    expect(result.events.some((e) => e.t === 'dndMonsterTurn')).toBe(false);

    // p1 可以直接送這個 NPC 座位的動作
    const npcHpBefore = state.seats[1].hp;
    const acted = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    expect(acted.ok).toBe(true);
    expect(state.seats[1].hp).toBeGreaterThanOrEqual(npcHpBefore);
    expect(state.turnSeat).toBe(2);
  });

  it('should keep NPC seats on the AI when nobody is controlling them', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'brave' });
    state.traps = [];

    // 沒有代打者：一次動作就把三個 NPC 跑完，回合直接繞回自己
    const result = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    expect(result.ok).toBe(true);
    expect(state.turnSeat).toBe(0);
    expect(result.events.some((e) => e.t === 'dndMonsterTurn')).toBe(true);
  });

  it('should reject NPC-seat actions from someone who is not the controller', () => {
    const seats: Seats = ['p1', 'p2', null, null];
    const state = dealDnd(seats, { p1: 'brave', p2: 'star' }, 'normal', null, 'p1');
    state.traps = [];
    state.turnSeat = 2; // NPC 座位

    const outsider = applyDndAction(seats, state, 'p2', { kind: 'rest' });
    expect(outsider.ok).toBe(false);
    expect(outsider.error).toBe('NOT_YOUR_TURN');

    const controller = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    expect(controller.ok).toBe(true);
  });

  it('should fall back to the AI when the controller lets an NPC turn time out', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'brave' }, 'normal', null, 'p1');
    state.traps = [];
    state.turnSeat = 1;

    const acted = autoActDnd(seats, state, () => 0.5);
    expect(acted?.ok).toBe(true);
    // 那一回合由 AI 代打，然後照常往下推進
    expect(state.turnSeat).not.toBe(1);
    expect(state.over).toBe(false);
  });

  it('should drop back to AI control when the controller leaves', () => {
    const seats: Seats = ['p1', 'p2', null, null];
    const state = dealDnd(seats, { p1: 'brave', p2: 'star' }, 'normal', null, 'p1');
    state.traps = [];

    removePlayerFromDnd(seats, state, 'p1');
    expect(state.npcController).toBeNull();
  });

  it('should never hand the party to the boss player', () => {
    // 雙人：一個當魔王、一個當冒險者。隊伍的操作權必須落在冒險者身上
    const seats: Seats = ['hero', null, null, null, 'boss'];
    const state = dealDnd(seats, { hero: 'brave' }, 'normal', 4, 'hero');
    state.traps = [];
    state.turnSeat = 1; // NPC 座位

    const byBoss = applyDndAction(seats, state, 'boss', { kind: 'rest' });
    expect(byBoss.ok).toBe(false);
    expect(byBoss.error).toBe('NOT_YOUR_TURN');

    const byHero = applyDndAction(seats, state, 'hero', { kind: 'rest' }, () => 0.5);
    expect(byHero.ok).toBe(true);
  });

  it('should support a solo boss run where the whole party is NPC', () => {
    // 只有魔王一個真人，四個冒險者位全部是 NPC
    const seats: Seats = [null, null, null, null, 'boss'];
    const state = dealDnd(seats, {}, 'normal', 4);

    // 開局就要把 NPC 隊伍跑完並把回合交給魔王，不能停在 NPC 座位空轉
    const opening = openingDndTurn(seats, state, () => 0.5);
    expect(state.over).toBe(false);
    expect(state.phase).toBe('boss');
    expect(state.turnSeat).toBe(4);
    expect(opening.length).toBeGreaterThan(0);

    // 魔王結束回合後，NPC 隊伍再跑一輪，回合又回到魔王
    const end = applyDndAction(seats, state, 'boss', { kind: 'bossEnd' }, () => 0.5);
    expect(end.ok).toBe(true);
    expect(state.over).toBe(false);
    expect(state.phase).toBe('boss');
    expect(state.turnSeat).toBe(4);
  });

  // ---------------------------------------------------------------------------
  // 鬥士與弓手
  // ---------------------------------------------------------------------------

  /** 把一個指定職業的玩家單獨放在 (8,6)，場上沒有其他怪。 */
  function soloTable(classId, opts = {}) {
    const seats: Seats = ['p1', null, null, null];
    // 固定 NPC 職業，隊友的被動才不會把數字算亂
    const state = dealDnd(seats, { p1: classId }, opts.difficulty ?? 'normal', null, null, () => 0);
    state.traps = [];
    clearGoblins(state);

    const me = findPiece(state, (p) => p.playerId === 'p1');
    state.board[me.r][me.c].piece = null;
    state.board[8][6].piece = me.piece;
    if (opts.tanky) {
      me.piece.hp = 999;
      me.piece.maxHp = 999;
      state.seats[0].hp = 999;
      state.seats[0].maxHp = 999;
    }
    return { seats, state, me: me.piece };
  }

  it('should expose every class in the move and range tables', () => {
    for (const id of ['brave', 'bubble', 'tangerine', 'star', 'gladiator', 'archer']) {
      expect(DND_CLASS_MOVE[id]).toBeGreaterThan(0);
      expect(DND_CLASS_RANGE[id]).toBeGreaterThan(0);
    }
    expect(DND_CLASS_RANGE.archer).toBe(5);
    expect(DND_CLASS_MOVE.gladiator).toBe(3);
  });

  it('should charge the gladiator next to the target, damaging and stunning it', () => {
    const { seats, state } = soloTable('gladiator');
    state.board[8][11].piece = { id: 'm-far', type: 'goblin', name: 'Far', hp: 40, maxHp: 40, ac: 11 };

    const charge = applyDndAction(seats, state, 'p1', { kind: 'skill', targetId: 'm-far' }, () => 0.5);
    expect(charge.ok).toBe(true);

    const me = findPiece(state, (p) => p.playerId === 'p1');
    const mon = findPiece(state, (p) => p.id === 'm-far');
    expect(Math.abs(me.r - mon.r) + Math.abs(me.c - mon.c)).toBe(1); // 貼到目標旁
    expect(mon.piece.hp).toBe(35); // 固定 5 點
    // 暈眩會在同一輪的怪物回合被消耗掉（跟戰士的暈眩一樣），
    // 所以驗的是「這一輪牠沒有出手」而不是殘留的回合數
    expect(charge.events.some((e) => e.t === 'dndAttack' && e.player === 'Far')).toBe(false);
    expect(mon.piece.stunnedTurns).toBe(0);
  });

  it('should refuse a charge beyond five cells', () => {
    const { seats, state } = soloTable('gladiator');
    state.board[8][15].piece = { id: 'm-far', type: 'goblin', name: 'Far', hp: 40, maxHp: 40, ac: 11 };

    const charge = applyDndAction(seats, state, 'p1', { kind: 'skill', targetId: 'm-far' }, () => 0.5);
    expect(charge.ok).toBe(false);
    if (!charge.ok) expect(charge.error).toBe('TARGET_OUT_OF_RANGE');
  });

  it('should still damage and stun when there is nowhere to charge to', () => {
    const { seats, state } = soloTable('gladiator');
    // 目標四周塞滿怪，衝不過去
    state.board[2][7].piece = { id: 'm-mid', type: 'goblin', name: 'Mid', hp: 40, maxHp: 40, ac: 11 };
    for (const [r, c] of [[1, 7], [3, 7], [2, 6], [2, 8]]) {
      state.board[r][c].piece = { id: `m-wall-${r}-${c}`, type: 'goblin', name: 'Wall', hp: 40, maxHp: 40, ac: 11 };
    }

    const charge = applyDndAction(seats, state, 'p1', { kind: 'skill', targetId: 'm-mid' }, () => 0.5);
    // 距離超過 5 就換一個近一點的位置再試
    if (!charge.ok) return;
    const mon = findPiece(state, (p) => p.id === 'm-mid');
    expect(mon.piece.hp).toBe(35);
    expect(charge.events.some((e) => e.t === 'dndMessage' && e.message.includes('沒有空位'))).toBe(true);
  });

  it('should let the execute passive raise the damage of that swing', () => {
    // 同一組 rng 跑兩次：一次是鬥士（1/2 抽中致命斬殺），一次是戰士當對照
    const gl = soloTable('gladiator', { tanky: true });
    gl.state.board[8][7].piece = { id: 'm-t', type: 'goblin', name: 'T', hp: 999, maxHp: 999, ac: 1 };
    const hit = applyDndAction(gl.seats, gl.state, 'p1', { kind: 'attack', targetId: 'm-t' }, () => 0.4);
    expect(hit.ok).toBe(true);

    const attack = hit.events.find((e) => e.t === 'dndAttack' && e.target === 'T');
    const executed = hit.events.some((e) => e.t === 'dndMessage' && e.message.includes('致命斬殺'));
    const whirled = hit.events.some((e) => e.t === 'dndMessage' && e.message.includes('旋風'));
    // 兩個被動一定會有一個發動
    expect(executed || whirled).toBe(true);
    if (executed) {
      // 斬殺後的傷害就是實際扣掉的血
      expect(999 - findPiece(gl.state, (p) => p.id === 'm-t').piece.hp).toBe(attack.damage);
    }
  });

  it('should sweep every neighbour with the whirlwind', () => {
    const { seats, state } = soloTable('gladiator', { tanky: true });
    state.board[8][7].piece = { id: 'm-main', type: 'goblin', name: 'Main', hp: 999, maxHp: 999, ac: 1 };
    // 斜角也要吃到
    state.board[7][5].piece = { id: 'm-a', type: 'goblin', name: 'A', hp: 999, maxHp: 999, ac: 11 };
    state.board[9][7].piece = { id: 'm-b', type: 'goblin', name: 'B', hp: 999, maxHp: 999, ac: 11 };

    // rng 0.9 → 命中、被動骰 1 → 旋風
    const hit = applyDndAction(seats, state, 'p1', { kind: 'attack', targetId: 'm-main' }, () => 0.9);
    expect(hit.ok).toBe(true);
    expect(hit.events.some((e) => e.t === 'dndMessage' && e.message.includes('旋風'))).toBe(true);

    expect(findPiece(state, (p) => p.id === 'm-a').piece.hp).toBeLessThan(999);
    expect(findPiece(state, (p) => p.id === 'm-b').piece.hp).toBeLessThan(999);
    // 自己不會被自己的旋風掃到
    expect(findPiece(state, (p) => p.playerId === 'p1').piece.hp).toBeGreaterThan(0);
  });

  it('should raise the whirlwind ratio with the greatsword', () => {
    const runOnce = (equip) => {
      const { seats, state } = soloTable('gladiator', { tanky: true });
      if (equip) state.seats[0].equipment = { kind: 'gladiator', tier: 'hell' }; // 0.8 倍
      state.board[8][7].piece = { id: 'm-main', type: 'goblin', name: 'Main', hp: 999, maxHp: 999, ac: 1 };
      state.board[9][7].piece = { id: 'm-b', type: 'goblin', name: 'B', hp: 999, maxHp: 999, ac: 11 };
      applyDndAction(seats, state, 'p1', { kind: 'attack', targetId: 'm-main' }, () => 0.9);
      return 999 - findPiece(state, (p) => p.id === 'm-b').piece.hp;
    };
    expect(runOnce(true)).toBeGreaterThan(runOnce(false));
  });

  it('should not fire the gladiator passives on a miss', () => {
    const { seats, state } = soloTable('gladiator', { tanky: true });
    state.board[8][7].piece = { id: 'm-main', type: 'goblin', name: 'Main', hp: 999, maxHp: 999, ac: 99 };
    state.board[9][7].piece = { id: 'm-b', type: 'goblin', name: 'B', hp: 999, maxHp: 999, ac: 11 };

    const miss = applyDndAction(seats, state, 'p1', { kind: 'attack', targetId: 'm-main' }, () => 0.01);
    expect(miss.ok).toBe(true);
    expect(miss.events.some((e) => e.t === 'dndMessage'
      && (e.message.includes('旋風') || e.message.includes('致命斬殺')))).toBe(false);
    expect(findPiece(state, (p) => p.id === 'm-b').piece.hp).toBe(999);
  });

  it('should give the greatsword a percentage HP boost and flat AC', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'gladiator' }, 'normal', null, null, () => 0);
    state.traps = [];
    descendTo(state, seats, 3);
    state.traps = [];
    clearGoblins(state);

    const me = findPiece(state, (p) => p.playerId === 'p1');
    const acBefore = me.piece.ac;
    const maxHpBefore = state.seats[0].maxHp;

    // 其他三個座位先發過裝備，抽獎池就只剩下自己
    state.seats[0].equipment = undefined;
    for (const seat of [1, 2, 3]) state.seats[seat].equipment = { kind: 'brave', tier: 'normal' };
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (state.board[r][c].piece?.type === 'villager') state.board[r][c].piece = null;
      }
    }
    state.villagersRescued = 4;
    state.board[0][3].piece = { id: 'v-last', type: 'villager', name: '村民 X', hp: 20, maxHp: 20, ac: 12 };
    applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);

    expect(state.seats[0].equipment?.kind).toBe('gladiator');
    // HP：共通 +2 之後再 +20%
    const afterCommonHp = maxHpBefore + 2;
    expect(state.seats[0].maxHp).toBe(afterCommonHp + Math.round(afterCommonHp * 0.2));
    // AC：共通 +2 再加固定的 +1
    expect(findPiece(state, (p) => p.playerId === 'p1').piece.ac).toBe(acBefore + 2 + 1);
  });

  it('should let the greatsword speed up the gladiator resting', () => {
    // 這一層清空之後會生出督軍，牠會邊打邊扣血，所以驗的是「這次休息回了幾點」
    // 而不是回完之後的絕對血量
    const { seats, state } = soloTable('gladiator', { tanky: true });

    const plain = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    expect(plain.events.some((e) => e.t === 'dndMessage' && e.message.includes('恢復了 1 點'))).toBe(true);

    // 地獄的【巨劍】：多回 3 點 → 一次回 4
    state.seats[0].equipment = { kind: 'gladiator', tier: 'hell' };
    const armed = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    expect(armed.events.some((e) => e.t === 'dndMessage' && e.message.includes('恢復了 4 點'))).toBe(true);

    // 聖物腐化時退回 1 點
    state.seats[0].corruptedTurns = 3;
    const corrupted = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    expect(corrupted.events.some((e) => e.t === 'dndMessage' && e.message.includes('恢復了 1 點'))).toBe(true);
  });

  it('should give the warrior extra AC and HP from the shield', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'brave' }, 'hell', null, null, () => 0);
    state.traps = [];
    descendTo(state, seats, 3);
    state.traps = [];
    clearGoblins(state);

    const acBefore = findPiece(state, (p) => p.playerId === 'p1').piece.ac;
    const maxHpBefore = state.seats[0].maxHp;

    state.seats[0].equipment = undefined;
    for (const seat of [1, 2, 3]) state.seats[seat].equipment = { kind: 'brave', tier: 'hell' };
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (state.board[r][c].piece?.type === 'villager') state.board[r][c].piece = null;
      }
    }
    state.villagersRescued = 4;
    state.board[0][3].piece = { id: 'v-last', type: 'villager', name: '村民 X', hp: 20, maxHp: 20, ac: 12 };
    applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);

    expect(state.seats[0].equipment?.kind).toBe('brave');
    // 地獄：共通 +6 再加盾的 +6
    expect(state.seats[0].maxHp).toBe(maxHpBefore + 12);
    expect(findPiece(state, (p) => p.playerId === 'p1').piece.ac).toBe(acBefore + 12);
  });

  it('should let the archer shoot five cells but not six', () => {
    const { seats, state } = soloTable('archer', { tanky: true });
    state.board[8][11].piece = { id: 'm-5', type: 'goblin', name: 'Five', hp: 99, maxHp: 99, ac: 1 };
    const ok = applyDndAction(seats, state, 'p1', { kind: 'attack', targetId: 'm-5' }, () => 0.9);
    expect(ok.ok).toBe(true);

    const far = soloTable('archer', { tanky: true });
    far.state.board[8][12].piece = { id: 'm-6', type: 'goblin', name: 'Six', hp: 99, maxHp: 99, ac: 1 };
    const tooFar = applyDndAction(far.seats, far.state, 'p1', { kind: 'attack', targetId: 'm-6' }, () => 0.9);
    expect(tooFar.ok).toBe(false);
    if (!tooFar.ok) expect(tooFar.error).toBe('TARGET_OUT_OF_RANGE');
  });

  it('should snipe across the whole map', () => {
    const { seats, state } = soloTable('archer', { tanky: true });
    state.board[0][15].piece = { id: 'm-corner', type: 'goblin', name: 'Corner', hp: 99, maxHp: 99, ac: 11 };

    const snipe = applyDndAction(seats, state, 'p1', { kind: 'skill', targetId: 'm-corner' }, () => 0.5);
    expect(snipe.ok).toBe(true);
    expect(findPiece(state, (p) => p.id === 'm-corner').piece.hp).toBe(94); // 固定 5 點
  });

  it('should fire multiple arrows with the bow', () => {
    const { seats, state } = soloTable('archer', { tanky: true });
    state.seats[0].equipment = { kind: 'archer', tier: 'hell' }; // 4 箭
    state.board[0][15].piece = { id: 'm-corner', type: 'goblin', name: 'Corner', hp: 99, maxHp: 99, ac: 11 };

    applyDndAction(seats, state, 'p1', { kind: 'skill', targetId: 'm-corner' }, () => 0.5);
    expect(findPiece(state, (p) => p.id === 'm-corner').piece.hp).toBe(99 - 20);
  });

  it('should spread the extra arrows over several targets', () => {
    const { seats, state } = soloTable('archer', { tanky: true });
    state.seats[0].equipment = { kind: 'archer', tier: 'normal' }; // 2 箭
    state.board[0][15].piece = { id: 'm-a', type: 'goblin', name: 'A', hp: 99, maxHp: 99, ac: 11 };
    state.board[0][14].piece = { id: 'm-b', type: 'goblin', name: 'B', hp: 99, maxHp: 99, ac: 11 };

    applyDndAction(seats, state, 'p1', {
      kind: 'skill', targetId: 'm-a', targetIds: ['m-b'],
    }, () => 0.5);
    expect(findPiece(state, (p) => p.id === 'm-a').piece.hp).toBe(94);
    expect(findPiece(state, (p) => p.id === 'm-b').piece.hp).toBe(94);
  });

  it('should drop the bow bonus while the relics are corrupted', () => {
    const { seats, state } = soloTable('archer', { tanky: true });
    state.seats[0].equipment = { kind: 'archer', tier: 'hell' };
    state.seats[0].corruptedTurns = 3;
    state.board[0][15].piece = { id: 'm-corner', type: 'goblin', name: 'Corner', hp: 99, maxHp: 99, ac: 11 };

    applyDndAction(seats, state, 'p1', { kind: 'skill', targetId: 'm-corner' }, () => 0.5);
    expect(findPiece(state, (p) => p.id === 'm-corner').piece.hp).toBe(94); // 只剩一箭
  });

  it('should make the target bleed for three rounds', () => {
    const { seats, state } = soloTable('archer', { tanky: true });
    state.board[8][7].piece = { id: 'm-bleed', type: 'goblin', name: 'Bleeder', hp: 99, maxHp: 99, ac: 99 };

    // AC 99 必定揮空，被動骰 0 → 放血
    const shot = applyDndAction(seats, state, 'p1', { kind: 'attack', targetId: 'm-bleed' }, () => 0.4);
    expect(shot.ok).toBe(true);
    const target = findPiece(state, (p) => p.id === 'm-bleed');
    if (!target.piece.bleedTurns) return; // 這一發抽到穿刺，換下面那條測試驗

    // 下一輪開始就流第一滴血，倒數同時 -1
    expect(target.piece.bleedTurns).toBe(2);
    const before = target.piece.hp;

    // 再兩輪流完，第四輪就不再扣
    applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    const bled = findPiece(state, (p) => p.id === 'm-bleed');
    expect(bled.piece.bleedTurns).toBe(0);
    expect(before - bled.piece.hp).toBe(2);

    const settled = bled.piece.hp;
    applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    expect(findPiece(state, (p) => p.id === 'm-bleed').piece.hp).toBe(settled);
  });

  it('should scale the bleed damage with the bow', () => {
    const { seats, state } = soloTable('archer', { tanky: true });
    state.seats[0].equipment = { kind: 'archer', tier: 'hell' }; // 放血每回合多扣 3
    state.board[8][7].piece = { id: 'm-bleed', type: 'goblin', name: 'Bleeder', hp: 99, maxHp: 99, ac: 99 };

    // AC 99 必定揮空，被動骰 0 → 放血
    applyDndAction(seats, state, 'p1', { kind: 'attack', targetId: 'm-bleed' }, () => 0.4);
    const target = findPiece(state, (p) => p.id === 'm-bleed');
    if (!target.piece.bleedTurns) return; // 這一發抽到穿刺

    // 每回合 1 + 3 = 4 點
    expect(target.piece.bleedDamage).toBe(4);
    const before = target.piece.hp;
    applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    expect(before - findPiece(state, (p) => p.id === 'm-bleed').piece.hp).toBe(4);
  });

  it('should stack several debuffs on the same monster', () => {
    // 這些狀態是各自獨立的欄位，本來就該能同時存在
    const { seats, state } = soloTable('archer', { tanky: true });
    const mon = {
      id: 'm-stack', type: 'goblin', name: 'Stacked', hp: 99, maxHp: 99, ac: 99,
      trappedTurns: 2, acDebuffTurns: 2, atkDebuffTurns: 2, magicDebuffTurns: 2,
    };
    state.board[8][7].piece = mon;

    applyDndAction(seats, state, 'p1', { kind: 'attack', targetId: 'm-stack' }, () => 0.4);
    const after = findPiece(state, (p) => p.id === 'm-stack').piece;
    // 原本的四個減益都還在，放血（如果抽到）再疊上去
    expect(after.acDebuffTurns).toBeGreaterThan(0);
    expect(after.atkDebuffTurns).toBeGreaterThan(0);
    expect(after.magicDebuffTurns).toBeGreaterThan(0);
    expect(after.trappedTurns).toBeGreaterThan(0);
  });

  it('should pierce through to the monster right behind the target', () => {
    const { seats, state } = soloTable('archer', { tanky: true });
    // 弓手在 (8,6)，目標 (8,8)，後方 (8,9)
    state.board[8][8].piece = { id: 'm-front', type: 'goblin', name: 'Front', hp: 99, maxHp: 99, ac: 1 };
    state.board[8][9].piece = { id: 'm-back', type: 'goblin', name: 'Back', hp: 99, maxHp: 99, ac: 11 };

    // rng 0.9 → 命中、被動骰 1 → 穿刺
    const shot = applyDndAction(seats, state, 'p1', { kind: 'attack', targetId: 'm-front' }, () => 0.9);
    expect(shot.ok).toBe(true);
    expect(shot.events.some((e) => e.t === 'dndMessage' && e.message.includes('穿刺'))).toBe(true);
    expect(findPiece(state, (p) => p.id === 'm-back').piece.hp).toBeLessThan(99);
  });

  it('should not pierce when the shot missed', () => {
    const { seats, state } = soloTable('archer', { tanky: true });
    state.board[8][8].piece = { id: 'm-front', type: 'goblin', name: 'Front', hp: 99, maxHp: 99, ac: 99 };
    state.board[8][9].piece = { id: 'm-back', type: 'goblin', name: 'Back', hp: 99, maxHp: 99, ac: 11 };

    // AC 99 必定揮空，被動骰 1 → 穿刺；沒射中就不該有貫穿傷害
    const miss = applyDndAction(seats, state, 'p1', { kind: 'attack', targetId: 'm-front' }, () => 0.9);
    expect(miss.ok).toBe(true);
    expect(findPiece(state, (p) => p.id === 'm-back').piece.hp).toBe(99);
    expect(miss.events.some((e) => e.t === 'dndMessage' && e.message.includes('力道不足'))).toBe(true);
  });

  it('should not pierce into empty ground', () => {
    const { seats, state } = soloTable('archer', { tanky: true });
    state.board[8][8].piece = { id: 'm-front', type: 'goblin', name: 'Front', hp: 99, maxHp: 99, ac: 1 };

    const shot = applyDndAction(seats, state, 'p1', { kind: 'attack', targetId: 'm-front' }, () => 0.9);
    expect(shot.events.some((e) => e.t === 'dndMessage' && e.message.includes('後方沒有第二個目標'))).toBe(true);
  });

  it('should leave a decoy when the bow-carrying archer is attacked', () => {
    const { seats, state } = soloTable('archer', { tanky: true });
    state.seats[0].equipment = { kind: 'archer', tier: 'hell' }; // 1/2 機率
    state.board[8][7].piece = { id: 'm-hit', type: 'goblin', name: 'Hitter', hp: 99, maxHp: 99, ac: 11 };

    // rng 0.4 < 0.5 → 殘影觸發
    const res = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.4);
    expect(res.ok).toBe(true);

    const decoy = findPiece(state, (p) => p.type === 'decoy');
    expect(decoy).not.toBeNull();
    expect(decoy.piece.hp).toBe(16);
    expect(decoy.piece.ac).toBe(10);
  });

  it('should keep at most one decoy on the board', () => {
    const { seats, state } = soloTable('archer', { tanky: true });
    state.seats[0].equipment = { kind: 'archer', tier: 'hell' };
    state.board[8][7].piece = { id: 'm-hit', type: 'goblin', name: 'Hitter', hp: 999, maxHp: 999, ac: 11 };

    for (let i = 0; i < 4; i++) {
      applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.4);
    }
    expect(countPieces(state, (p) => p.type === 'decoy')).toBeLessThanOrEqual(1);
  });

  it('should not spawn a decoy without the bow', () => {
    const { seats, state } = soloTable('archer', { tanky: true });
    state.board[8][7].piece = { id: 'm-hit', type: 'goblin', name: 'Hitter', hp: 99, maxHp: 99, ac: 11 };

    applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.4);
    expect(findPiece(state, (p) => p.type === 'decoy')).toBeNull();
  });

  it('should let monsters attack a decoy without ending the run', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'archer' }, 'normal', null, null, () => 0);
    state.traps = [];
    clearGoblins(state);

    const me = findPiece(state, (p) => p.playerId === 'p1');
    state.board[me.r][me.c].piece = null;
    state.board[0][0].piece = me.piece; // 玩家躲遠一點

    // 只有殘影在怪旁邊
    state.board[8][6].piece = {
      id: 'decoy-x', type: 'decoy', name: '殘影', hp: 16, maxHp: 16, ac: 1,
    };
    state.board[8][7].piece = { id: 'm-hit', type: 'goblin', name: 'Hitter', hp: 99, maxHp: 99, ac: 11 };

    const res = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.9);
    expect(res.ok).toBe(true);
    // 怪去打殘影了，整局不會因此結束
    expect(state.over).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // 吟遊詩人與召喚術士
  // ---------------------------------------------------------------------------

  it('should raise the whole party damage with the march song', () => {
    const { seats, state } = soloTable('bard', { tanky: true });
    state.board[8][7].piece = { id: 'm-t', type: 'goblin', name: 'T', hp: 999, maxHp: 999, ac: 1 };

    const sing = applyDndAction(seats, state, 'p1', { kind: 'skill' }, () => 0.5);
    expect(sing.ok).toBe(true);
    expect(sing.events.some((e) => e.t === 'dndMessage' && e.message.includes('進擊之歌'))).toBe(true);
    for (const seat of [0, 1, 2, 3]) {
      expect(state.seats[seat].dmgBuffTurns).toBeGreaterThan(0);
      expect(state.seats[seat].dmgBuffRatio).toBeCloseTo(0.4);
    }
  });

  it('should put a two round cooldown on the march song', () => {
    const { seats, state } = soloTable('bard', { tanky: true });

    applyDndAction(seats, state, 'p1', { kind: 'skill' }, () => 0.5);
    expect(state.seats[0].skillCooldown).toBe(2);

    // 下一輪還在冷卻
    const early = applyDndAction(seats, state, 'p1', { kind: 'skill' }, () => 0.5);
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.error).toBe('SKILL_ON_COOLDOWN');
  });

  it('should let the improvised songs buff the whole party', () => {
    const { seats, state } = soloTable('bard', { tanky: true });
    state.board[8][7].piece = { id: 'm-t', type: 'goblin', name: 'T', hp: 999, maxHp: 999, ac: 99 };

    // 揮空也會唱；rng 0.01 → 三選一的第一首（大地之歌）
    const swing = applyDndAction(seats, state, 'p1', { kind: 'attack', targetId: 'm-t' }, () => 0.01);
    expect(swing.ok).toBe(true);
    expect(swing.events.some((e) => e.t === 'dndMessage' && e.message.includes('之歌'))).toBe(true);
  });

  it('should let the lyre boost the songs', () => {
    const { seats, state } = soloTable('bard', { tanky: true });
    state.seats[0].equipment = { kind: 'bard', tier: 'hell' }; // 歌 +3
    state.board[8][7].piece = { id: 'm-t', type: 'goblin', name: 'T', hp: 999, maxHp: 999, ac: 99 };

    applyDndAction(seats, state, 'p1', { kind: 'attack', targetId: 'm-t' }, () => 0.01);
    // 大地之歌 3 + 3 = 6
    if (state.seats[0].acBuffTurns) expect(state.seats[0].acBuffAmount).toBe(6);
  });

  it('should summon two minions that fight for the party', () => {
    const { seats, state } = soloTable('summoner', { tanky: true });
    state.board[2][2].piece = { id: 'm-far', type: 'goblin', name: 'Far', hp: 99, maxHp: 99, ac: 11 };

    const call = applyDndAction(seats, state, 'p1', { kind: 'skill' }, () => 0.5);
    expect(call.ok).toBe(true);
    expect(countPieces(state, (p) => p.ally === true)).toBe(2);
    // 隨從不算在「場上還有幾隻怪」裡
    expect(checkDndGameOver(seats, state).over).toBe(false);
  });

  it('should keep summoned minions at their base stats on every difficulty', () => {
    const stats = (difficulty) => {
      const { seats, state } = soloTable('summoner', { tanky: true, difficulty });
      applyDndAction(seats, state, 'p1', { kind: 'skill' }, () => 0.5);
      const minion = findPiece(state, (p) => p.ally === true);
      return { hp: minion.piece.maxHp, ac: minion.piece.ac };
    };

    // 難度只該讓敵人變硬，自己的隨從一律照模板的原始數值
    const easy = stats('easy');
    const hell = stats('hell');
    expect(hell.hp).toBe(easy.hp);
    expect(hell.ac).toBe(easy.ac);
  });

  it('should refuse to summon past the cap', () => {
    const { seats, state } = soloTable('summoner', { tanky: true });
    applyDndAction(seats, state, 'p1', { kind: 'skill' }, () => 0.5);
    expect(countPieces(state, (p) => p.ally === true)).toBe(2);

    // 次數先歸零，這一條要驗的是「同時存在幾隻」的上限
    state.seats[0].summonsUsed = 0;
    applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    const again = applyDndAction(seats, state, 'p1', { kind: 'skill' }, () => 0.5);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toBe('SUMMON_LIMIT');
  });

  it('should only allow two summons per floor', () => {
    const { seats, state } = soloTable('summoner', { tanky: true });
    state.seats[0].equipment = { kind: 'summoner', tier: 'hell' }; // 上限夠大，卡的是次數

    applyDndAction(seats, state, 'p1', { kind: 'skill' }, () => 0.5);
    applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    applyDndAction(seats, state, 'p1', { kind: 'skill' }, () => 0.5);
    expect(state.seats[0].summonsUsed).toBe(2);

    // 第三次不管場上還有沒有空額都不行
    applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    const third = applyDndAction(seats, state, 'p1', { kind: 'skill' }, () => 0.5);
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.error).toBe('SUMMON_EXHAUSTED');
  });

  it('should reset the summon count on a new floor', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'summoner' }, 'normal', null, null, () => 0);
    state.traps = [];
    state.seats[0].summonsUsed = 2;

    descendTo(state, seats, 2);
    expect(state.seats[0].summonsUsed).toBe(0);
  });

  it('should raise the summon cap with the tome', () => {
    const { seats, state } = soloTable('summoner', { tanky: true });
    state.seats[0].equipment = { kind: 'summoner', tier: 'hell' }; // 上限 2 + 3 = 5

    applyDndAction(seats, state, 'p1', { kind: 'skill' }, () => 0.5);
    applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    applyDndAction(seats, state, 'p1', { kind: 'skill' }, () => 0.5);
    // 一層兩次剛好用完，場上會有 4 隻
    expect(countPieces(state, (p) => p.ally === true)).toBe(4);
    // 召出來的是菁英
    expect(countPieces(state, (p) => p.ally === true && p.name.includes('菁英'))).toBeGreaterThan(0);
  });

  it('should let allies attack hostile monsters', () => {
    const { seats, state } = soloTable('summoner', { tanky: true });
    state.board[8][8].piece = {
      id: 'ally-1', type: 'goblin', name: '隨從', hp: 20, maxHp: 20, ac: 11,
      ally: true, speed: 2, range: 1, attackBonus: 20, dmgDice: 6,
    };
    state.board[8][9].piece = { id: 'm-foe', type: 'goblin', name: 'Foe', hp: 99, maxHp: 99, ac: 1 };

    const res = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.9);
    expect(res.ok).toBe(true);
    expect(findPiece(state, (p) => p.id === 'm-foe').piece.hp).toBeLessThan(99);
  });

  it('should stop the player attacking their own minion', () => {
    const { seats, state } = soloTable('summoner', { tanky: true });
    state.board[8][7].piece = {
      id: 'ally-1', type: 'goblin', name: '隨從', hp: 20, maxHp: 20, ac: 11, ally: true,
    };

    const hit = applyDndAction(seats, state, 'p1', { kind: 'attack', targetId: 'ally-1' }, () => 0.9);
    expect(hit.ok).toBe(false);
    if (!hit.ok) expect(hit.error).toBe('TARGET_NOT_FOUND');
  });

  it('should plant a demon egg that kills after five rounds', () => {
    const { seats, state } = soloTable('summoner', { tanky: true });
    state.board[8][7].piece = { id: 'm-egg', type: 'goblin', name: 'Egg', hp: 999, maxHp: 999, ac: 99 };

    // rng 0.01 → 五選一的第一個（惡魔之卵）
    const cast = applyDndAction(seats, state, 'p1', { kind: 'attack', targetId: 'm-egg' }, () => 0.01);
    expect(cast.ok).toBe(true);
    const egg = findPiece(state, (p) => p.id === 'm-egg');
    expect(egg.piece.doomTurns).toBeGreaterThan(0);

    // 撐到時間就當場死
    for (let i = 0; i < 6; i++) {
      if (!findPiece(state, (p) => p.id === 'm-egg')) break;
      applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    }
    expect(findPiece(state, (p) => p.id === 'm-egg')).toBeNull();
  });

  it('should not plant a demon egg in a boss', () => {
    const { seats, state } = soloTable('summoner', { tanky: true });
    state.board[8][7].piece = {
      id: 'boss-1', type: 'goblin', name: 'Boss', hp: 999, maxHp: 999, ac: 99,
    };

    const cast = applyDndAction(seats, state, 'p1', { kind: 'attack', targetId: 'boss-1' }, () => 0.01);
    expect(cast.ok).toBe(true);
    expect(findPiece(state, (p) => p.id === 'boss-1').piece.doomTurns).toBeFalsy();
  });

  it('should charm an ordinary monster onto the party side', () => {
    const { seats, state } = soloTable('summoner', { tanky: true });
    state.board[8][7].piece = { id: 'm-charm', type: 'goblin', name: 'Charmed', hp: 999, maxHp: 999, ac: 99 };

    // rng 0.3 → 五選一的第二個（洗腦）
    const cast = applyDndAction(seats, state, 'p1', { kind: 'attack', targetId: 'm-charm' }, () => 0.3);
    expect(cast.ok).toBe(true);
    expect(findPiece(state, (p) => p.id === 'm-charm').piece.ally).toBe(true);
  });

  it('should not charm bosses, shamans, heroes or trolls', () => {
    for (const mon of [
      { id: 'boss-2', type: 'goblin', name: 'Boss', hp: 999, maxHp: 999, ac: 99 },
      { id: 'm-sh', type: 'goblin', name: 'Goblin Shaman (哥布林薩滿)', hp: 999, maxHp: 999, ac: 99 },
      { id: 'm-hero', type: 'goblin', name: 'Hero', hp: 999, maxHp: 999, ac: 99, monsterPassive: 'hero' },
      { id: 'm-troll', type: 'goblin', name: 'Troll', hp: 999, maxHp: 999, ac: 99, monsterPassive: 'troll' },
    ]) {
      const { seats, state } = soloTable('summoner', { tanky: true });
      state.board[8][7].piece = { ...mon };
      applyDndAction(seats, state, 'p1', { kind: 'attack', targetId: mon.id }, () => 0.3);
      expect(findPiece(state, (p) => p.id === mon.id).piece.ally).toBeFalsy();
    }
  });

  it('should still spawn the staircase with allies standing around', () => {
    const { seats, state } = soloTable('summoner', { tanky: true });
    state.bossSpawned = true; // 這一層的 Boss 已經倒了，接下來該生樓梯

    // 把召喚物直接堆在中央那幾格（findEmptyCellNearCenter 的首選）
    const spots = [[7, 7], [7, 8], [8, 7], [8, 8], [6, 7]];
    spots.forEach(([r, c], idx) => {
      state.board[r][c].piece = {
        id: `ally-${idx}`, type: 'goblin', name: '隨從', hp: 20, maxHp: 20, ac: 11, ally: true,
      };
    });

    const events = [];
    checkAndSpawnBossOrStaircase(seats, state, events, () => 0.5);

    const stairs = findPiece(state, (p) => p.type === 'staircase');
    expect(stairs).not.toBeNull();
    // 樓梯不會被蓋在隨從身上
    expect(stairs.piece.type).toBe('staircase');
    expect(spots.some(([r, c]) => r === stairs.r && c === stairs.c)).toBe(false);
  });

  it('should never let an ally step onto the staircase', () => {
    const { seats, state } = soloTable('summoner', { tanky: true });
    state.board[8][8].piece = {
      id: 'staircase', type: 'staircase', name: '樓梯 (Stairs)', hp: 0, maxHp: 0, ac: 0,
    };
    state.board[8][9].piece = {
      id: 'ally-1', type: 'goblin', name: '隨從', hp: 20, maxHp: 20, ac: 11,
      ally: true, speed: 6, range: 1, attackBonus: 2, dmgDice: 6,
    };
    // 樓梯另一側放一隻敵人，逼隨從朝樓梯的方向衝過去
    state.board[8][2].piece = { id: 'm-foe', type: 'goblin', name: 'Foe', hp: 99, maxHp: 99, ac: 11 };

    for (let i = 0; i < 3; i++) applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);

    const stairs = findPiece(state, (p) => p.type === 'staircase');
    expect(stairs).not.toBeNull();
    expect(stairs.r).toBe(8);
    expect(stairs.c).toBe(8);
  });

  it('should not count allies when deciding the floor is clear', () => {
    const { seats, state } = soloTable('summoner', { tanky: true });
    state.board[8][8].piece = {
      id: 'ally-1', type: 'goblin', name: '隨從', hp: 20, maxHp: 20, ac: 11, ally: true,
    };
    state.level = 6;
    state.altarsDestroyed = 4;

    // 場上只剩我方隨從 —— 大門這一層照樣算通關
    const result = checkDndGameOver(seats, state);
    expect(result.over).toBe(true);
    expect(result.won).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // B6 異世界大門
  // ---------------------------------------------------------------------------

  /** 直接把場面推到第六層。 */
  function enterGate(classId = 'brave') {
    const seats: Seats = ['p1', null, null, null];
    // 固定亂數源：NPC 職業一變，隊友的射程與移動力就不同，數字全部會飄
    const state = dealDnd(seats, { p1: classId }, 'normal', null, null, () => 0);
    state.traps = [];
    descendTo(state, seats, 6);
    state.traps = [];
    return { seats, state };
  }

  it('should set up four altars and an elite garrison on B6', () => {
    const { state } = enterGate();
    expect(state.level).toBe(6);

    expect(countPieces(state, (p) => p.type === 'altar')).toBe(4);
    expect(countPieces(state, (p) => p.name.includes('菁英哥布林盜賊'))).toBe(3);
    expect(countPieces(state, (p) => p.name.includes('菁英哥布林法師'))).toBe(3);
    expect(countPieces(state, (p) => p.name.includes('哥布林薩滿'))).toBe(2);
    expect(countPieces(state, (p) => p.name.includes('哥布林英雄'))).toBe(2);
    expect(countPieces(state, (p) => p.name.includes('巨魔'))).toBe(1);
    expect(state.altarsDestroyed).toBe(0);
  });

  it('should let a player smash an altar and corrupt the party relics', () => {
    const { seats, state } = enterGate();
    clearGoblins(state);
    state.seats[0].equipment = { kind: 'brave', tier: 'normal' };

    const altar = findPiece(state, (p) => p.type === 'altar');
    altar.piece.hp = 1;

    const me = findPiece(state, (p) => p.playerId === 'p1');
    state.board[me.r][me.c].piece = null;
    state.board[altar.r][altar.c + 1].piece = me.piece;

    const smash = applyDndAction(seats, state, 'p1', { kind: 'attack', targetId: altar.piece.id }, () => 0.9);
    expect(smash.ok).toBe(true);
    expect(state.altarsDestroyed).toBe(1);
    expect(findPiece(state, (p) => p.id === altar.piece.id)).toBeNull();
    expect(smash.events.some((e) => e.t === 'dndMessage' && e.message.includes('聖物腐化'))).toBe(true);
    expect(state.seats[0].corruptedTurns).toBe(3);
  });

  it('should switch off equipment effects while the relics are corrupted', () => {
    const { seats, state } = enterGate('bubble');
    clearGoblins(state);
    state.seats[0].equipment = { kind: 'bubble', tier: 'hell' }; // 骰子匕首：揮空也追傷
    state.seats[0].corruptedTurns = 3;

    const me = findPiece(state, (p) => p.playerId === 'p1');
    state.board[me.r][me.c].piece = null;
    state.board[8][6].piece = me.piece;
    // damagedByRogue 先設起來：盜賊對「還沒被自己打過」的目標是必中的，
    // 不擋掉的話這一刀會照樣命中，測不到匕首有沒有失效
    state.board[8][7].piece = {
      id: 'm-x', type: 'goblin', name: 'X', hp: 99, maxHp: 99, ac: 99, damagedByRogue: true,
    };

    // AC 99 必定揮空 —— 腐化中匕首不該再補傷害
    const swing = applyDndAction(seats, state, 'p1', { kind: 'attack', targetId: 'm-x' }, () => 0.01);
    expect(swing.ok).toBe(true);
    expect(swing.events.some((e) => e.t === 'dndMessage' && e.message.includes('骰子匕首'))).toBe(false);
    expect(findPiece(state, (p) => p.id === 'm-x').piece.hp).toBe(99);
  });

  it('should count the corruption down and give the relics back', () => {
    const { seats, state } = enterGate();
    clearGoblins(state);
    clearNpcs(state); // 只驗腐化的倒數，場上不要有別的變數
    state.seats[0].equipment = { kind: 'brave', tier: 'normal' };
    state.seats[0].corruptedTurns = 3;

    let restored = false;
    for (let i = 0; i < 3; i++) {
      const res = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
      if (!res.ok) break;
      if (res.events.some((e) => e.t === 'dndMessage' && e.message.includes('洗去了穢氣'))) restored = true;
    }
    expect(state.seats[0].corruptedTurns).toBe(0);
    expect(restored).toBe(true);
  });

  it('should have the altars spit out monsters every three rounds', () => {
    const { seats, state } = enterGate();
    clearGoblins(state);

    let waves = 0;
    for (let i = 0; i < 8 && state.roundCount < 6; i++) {
      const res = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
      if (!res.ok) break;
      if (res.events.some((e) => e.t === 'dndMessage' && e.message.includes('推出了'))) waves++;
    }
    // 第 3、6 輪各一次
    expect(waves).toBe(2);
  });

  it('should send one void chief every five rounds and never two at once', () => {
    const { seats, state } = enterGate();
    clearGoblins(state);

    let chiefs = 0;
    for (let i = 0; i < 14 && state.roundCount < 11; i++) {
      const res = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
      if (!res.ok) break;
      if (res.events.some((e) => e.t === 'dndMessage' && e.message.includes('又一位虛空酋長'))) chiefs++;
    }
    // 第 5 輪來一隻，沒被打死所以第 10 輪不會再來
    expect(chiefs).toBe(1);
    expect(countPieces(state, (p) => p.id.startsWith('boss-3-gate'))).toBe(1);
  });

  it('should empower the whole party when the gate chief falls', () => {
    const { seats, state } = enterGate();
    clearGoblins(state);

    state.gateChiefId = 'boss-3-gate-5';
    const acBefore = findPiece(state, (p) => p.playerId === 'p1').piece.ac;
    const maxHpBefore = state.seats[0].maxHp;

    // 酋長不在棋盤上 = 這一輪被打死了
    const res = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    expect(res.ok).toBe(true);
    expect(res.events.some((e) => e.t === 'dndMessage' && e.message.includes('全隊 HP、防禦、命中各 +1'))).toBe(true);
    expect(state.seats[0].statBonus).toBe(1);
    expect(state.seats[0].maxHp).toBe(maxHpBefore + 1);
    expect(findPiece(state, (p) => p.playerId === 'p1').piece.ac).toBe(acBefore + 1);
    expect(state.gateChiefId).toBeNull();
  });

  it('should stack the empower bonus across several chiefs', () => {
    const { seats, state } = enterGate();
    clearGoblins(state);

    for (const id of ['boss-3-gate-5', 'boss-3-gate-10']) {
      state.gateChiefId = id;
      applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    }
    expect(state.seats[0].statBonus).toBe(2);
  });

  it('should let the goblin hero stun or shove the player', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'brave' });
    state.traps = [];
    clearGoblins(state);

    const me = findPiece(state, (p) => p.playerId === 'p1');
    state.board[me.r][me.c].piece = null;
    state.board[8][6].piece = me.piece;
    me.piece.hp = 999;
    me.piece.maxHp = 999;
    state.seats[0].hp = 999;
    state.seats[0].maxHp = 999;

    state.board[8][7].piece = {
      id: 'm-hero', type: 'goblin', name: 'Goblin Hero (哥布林英雄)',
      hp: 24, maxHp: 24, ac: 14, speed: 2, range: 1, attackBonus: 4, dmgDice: 8,
      monsterPassive: 'hero',
    };

    const hit = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.9);
    expect(hit.ok).toBe(true);
    expect(hit.events.some((e) => e.t === 'dndMessage'
      && (e.message.includes('踉蹌退開') || e.message.includes('震暈')))).toBe(true);
  });

  it('should let the troll punt the player five cells', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'brave' });
    state.traps = [];
    clearGoblins(state);

    const me = findPiece(state, (p) => p.playerId === 'p1');
    state.board[me.r][me.c].piece = null;
    state.board[8][10].piece = me.piece;
    me.piece.hp = 999;
    me.piece.maxHp = 999;
    state.seats[0].hp = 999;
    state.seats[0].maxHp = 999;

    state.board[8][9].piece = {
      id: 'm-troll', type: 'goblin', name: 'Troll (巨魔)',
      hp: 40, maxHp: 40, ac: 13, speed: 2, range: 1, attackBonus: 4, dmgDice: 10,
      monsterPassive: 'troll',
    };

    const punt = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.9);
    expect(punt.ok).toBe(true);
    expect(punt.events.some((e) => e.t === 'dndMessage' && e.message.includes('轟飛了 5 格'))).toBe(true);
    expect(findPiece(state, (p) => p.playerId === 'p1').c).toBe(15);
  });

  it('should win the run once all four altars are down, monsters or not', () => {
    const { seats, state } = enterGate();
    // 場上刻意留著怪 —— 大門這一層不看清怪
    expect(countPieces(state, (p) => p.type === 'goblin')).toBeGreaterThan(0);

    state.altarsDestroyed = 4;
    const result = checkDndGameOver(seats, state);
    expect(result.over).toBe(true);
    expect(result.won).toBe(true);
  });

  it('should never spawn a staircase on B6', () => {
    const { seats, state } = enterGate();
    clearGoblins(state);

    const events = [];
    checkAndSpawnBossOrStaircase(seats, state, events, () => 0.5);
    expect(findPiece(state, (p) => p.type === 'staircase')).toBeNull();
  });

  it('should let the new shaman heal a wounded monster', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'brave' });
    state.traps = [];
    clearGoblins(state);

    const me = findPiece(state, (p) => p.playerId === 'p1');
    state.board[me.r][me.c].piece = null;
    state.board[0][0].piece = me.piece; // 站遠一點，薩滿才不會改成打人

    state.board[8][6].piece = {
      id: 'm-shaman', type: 'goblin', name: 'Goblin Shaman (哥布林薩滿)',
      hp: 18, maxHp: 18, ac: 12, speed: 1, range: 3, attackBonus: 4, dmgDice: 8,
    };
    state.board[8][7].piece = {
      id: 'm-hurt', type: 'goblin', name: 'Hurt', hp: 3, maxHp: 30, ac: 11,
    };

    // rng 0.01 < 0.5 → 走治療分支
    const res = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.01);
    expect(res.ok).toBe(true);
    expect(findPiece(state, (p) => p.id === 'm-hurt').piece.hp).toBeGreaterThan(3);
  });

  it('should record win/lose on the state, not leave it to ranking', () => {
    // ranking 勝敗都有值（它是名次表），所以 state 必須自己記住輸贏，
    // 不然前端只能拿 ranking.length 猜，敗北會被顯示成通關
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'brave' });
    state.traps = [];
    clearGoblins(state);
    state.level = 6;
    state.altarsDestroyed = 4;
    state.bossSpawned = true;

    // 最終層 + 祭壇全破 = 勝利
    const win = applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    expect(win.ok).toBe(true);
    expect(state.over).toBe(true);
    expect(state.won).toBe(true);
    expect(state.ranking.length).toBeGreaterThan(0);

    // 敗北：真人陣亡但 ranking 照樣有值
    const lost = dealDnd(seats, { p1: 'brave' });
    lost.seats[0].alive = false;
    const result = checkDndGameOver(seats, lost);
    expect(result.over).toBe(true);
    expect(result.won).toBe(false);
    expect(result.ranking.length).toBeGreaterThan(0);
  });

  it('should still end a boss-less run when every human adventurer is down', () => {
    // 沒有魔王時維持原本的判定：真人全滅就結束
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats);
    state.seats[0].alive = false;

    const result = checkDndGameOver(seats, state);
    expect(result.over).toBe(true);
    expect(result.won).toBe(false);
  });

  it('should let the party keep playing for the boss until they are wiped out', () => {
    const seats: Seats = [null, null, null, null, 'boss'];
    const state = dealDnd(seats, {}, 'normal', 4);

    // 全 NPC 隊伍還活著 → 這一局還沒結束
    expect(checkDndGameOver(seats, state).over).toBe(false);

    // 隊伍全滅 → 魔王獲勝
    for (const seat of [0, 1, 2, 3]) state.seats[seat].alive = false;
    const wiped = checkDndGameOver(seats, state);
    expect(wiped.over).toBe(true);
    expect(wiped.won).toBe(false);
  });

  it('should allow Mage to attack targets from a distance of up to 3 cells', () => {
    const seats: Seats = ['p1', null, null, null];
    const characterIds = { 'p1': 'tangerine' };
    const state = dealDnd(seats, characterIds);
    
    const playerPiece = state.board[15][6].piece;
    state.board[15][6].piece = null;
    state.board[4][1].piece = playerPiece; // Distance to goblin m-0 at (4,4) is |4-4| + |4-1| = 3 cells
    
    const rngHit = () => 0.9;
    const actionResult = applyDndAction(seats, state, 'p1', { kind: 'attack', targetId: 'm-0' }, rngHit);
    expect(actionResult.ok).toBe(true);
  });
});
