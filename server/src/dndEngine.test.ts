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
    
    // Set level to 3 to satisfy victory condition
    state.level = 3;

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
    state.board[14][7].piece = { id: 'p-p1', type: 'player', playerId: 'p1', name: 'Warrior (戰士)', hp: 10, maxHp: 24, ac: 14 };
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
    state.board[br][bc - 1].piece = { id: 'p-p1', type: 'player', playerId: 'p1', name: 'Warrior (戰士)', hp: 10, maxHp: 24, ac: 14 };
    
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
    state.board[sr][sc - 1].piece = { id: 'p-p1', type: 'player', playerId: 'p1', name: 'Warrior (戰士)', hp: 10, maxHp: 24, ac: 14 };
    
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
    const state = dealDnd(seats, { p1: 'bubble' });
    state.traps = [];
    clearGoblins(state);

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

    // 網子撐 3 回合，到期之後就會往前壓
    applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    applyDndAction(seats, state, 'p1', { kind: 'rest' }, () => 0.5);
    expect(findPiece(state, (p) => p.id === 'm-net').piece.trappedTurns).toBe(0);
    expect(findPiece(state, (p) => p.id === 'm-net').c).toBeLessThan(10);
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

  it('should add three high-speed Goblin Rogues on B2 and add Goblin Mages on top of them on B3', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'brave' });

    descendTo(state, seats, 2);
    expect(state.level).toBe(2);
    expect(countPieces(state, (p) => p.id.startsWith('m-rogue-'))).toBe(3);
    expect(countPieces(state, (p) => p.id.startsWith('m-mage-'))).toBe(0);
    const rogue = findPiece(state, (p) => p.id.startsWith('m-rogue-'));
    expect(rogue.piece.speed).toBe(5);

    descendTo(state, seats, 3);
    expect(state.level).toBe(3);
    // B3 疊加 B2 的盜賊，再加上 3 名法師
    expect(countPieces(state, (p) => p.id.startsWith('m-rogue-'))).toBe(3);
    expect(countPieces(state, (p) => p.id.startsWith('m-mage-'))).toBe(3);
    const mage = findPiece(state, (p) => p.id.startsWith('m-mage-'));
    expect(mage.piece.range).toBe(3);
    expect(mage.piece.speed).toBe(1);
  });

  it('should let a Goblin Rogue close five cells in a single monster round', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'brave' });
    state.traps = [];
    clearGoblins(state);

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
    // 座位 3 固定是牧師 NPC
    const state = dealDnd(seats, { p1: 'brave' });
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
      (e) => e.t === 'dndAttack' && e.damage < 0 && e.target.includes('Warrior'),
    );
    expect(heal).toBeDefined();
    expect(state.seats[0].hp).toBeGreaterThan(6);
    expect(state.seats[clericSeat].skillCooldown).toBe(1); // 補完要冷卻
  });

  it('should leave an NPC Cleric attacking when the whole party is above 70% HP', () => {
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'brave' });
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

  it('should record win/lose on the state, not leave it to ranking', () => {
    // ranking 勝敗都有值（它是名次表），所以 state 必須自己記住輸贏，
    // 不然前端只能拿 ranking.length 猜，敗北會被顯示成通關
    const seats: Seats = ['p1', null, null, null];
    const state = dealDnd(seats, { p1: 'brave' });
    state.traps = [];
    clearGoblins(state);
    state.level = 3;
    state.bossSpawned = true;

    // 清空 + 三樓 = 勝利
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
