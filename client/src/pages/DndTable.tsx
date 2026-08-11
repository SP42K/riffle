import { useMemo, useState, useEffect } from 'react';
import {
  DND_DIFFICULTIES,
  DND_EQUIPMENT_SPEC,
  DND_EQUIPMENT_NAME,
  DND_NPC_CONTROLS,
  DND_NPC_CONTROL_LABEL,
  DND_DIFFICULTY_LABEL,
  DND_DIFFICULTY_MULTIPLIER,
  type RoomView,
  type DndAction,
  type DndCellView,
  type DownstairsCharacterId,
} from 'shared';
import { StartControls } from '../components/StartControls';
import { TurnBanner } from '../components/TurnBanner';
import { useCountdown } from '../hooks/useCountdown';
import { emitWithAck, socket } from '../net/socket';
import { useGame } from '../state/GameProvider';
import { useSkin } from '../state/skinContext';

const DND_CLASSES: Array<{ id: DownstairsCharacterId; name: string; hp: number; ac: number; desc: string }> = [
  { id: 'brave', name: '戰士 (Warrior) 🛡️', hp: 24, ac: 14, desc: '前線坦攻。【鎖鏈】：將3格內的怪物拉到身旁（拿到【反射盾】後改成把 2/3/4 格內的怪物全部拖過來）。【反射】：受擊時把 1/3 的傷害彈回攻擊者（常駐）。【武勇】：命中時各1/3機率暈眩／擊退目標，或發動極限防禦（下一輪單次傷害上限2）。 (移動2格)' },
  { id: 'bubble', name: '盜賊 (Rogue) 🗡️', hp: 18, ac: 12, desc: '突襲刺客，極高機動。【撒網】：把 5 格內的一隻怪物釘在原地 3 回合，期間牠無法移動、每回合扣 1 HP，但仍能攻擊打得到的目標；虛空酋長靠瞬間移動，只會被扣血、位置綁不住。【弱點打擊】：命中時各1/2機率把目標的 AC 或傷害降到六成（2回合）。拿到【骰子匕首】後，撒網會多綁 1/2/3 輪、每輪多扣 1/2/3 點。 (移動5格)' },
  { id: 'tangerine', name: '法師 (Mage) 🧙', hp: 16, ac: 10, desc: '遠程爆發。【火牆】：對3格內的地面拉出一道3格火牆，站在裡面的怪物每回合燒3點HP，持續2回合。 (移動1格)' },
  { id: 'star', name: '牧師 (Cleric) ⛪', hp: 20, ac: 12, desc: '神聖判官，攻擊時治癒隊友。【神聖治癒】：補3格內隊友4點HP；由NPC操作時會優先搶救血量低於70%的隊友。 (移動1格)' },
];

export function DndRoom({ room }: { room: RoomView }) {
  const { run, roomMessages } = useGame();
  const { skin, t } = useSkin();

  const game = room.game?.type === 'dnd' ? room.game : null;
  const me = room.me;
  const playing = room.status === 'playing';
  // 輪到我：自己的座位，或是這個 NPC 座位由我代打
  const iControlNpcs = !!game && game.npcControllerId === me.playerId;
  const npcSeatIsMine =
    !!game && !game.turnPlayerId && iControlNpcs && game.phase === 'party' && !game.over;
  const isMyTurn = playing && (game?.turnPlayerId === me.playerId || npcSeatIsMine);
  const isHost = room.hostId === me.playerId;

  const remainingMs = useCountdown(playing ? (game?.turnDeadline ?? 0) : 0);

  const [turnPhase, setTurnPhase] = useState<'idle' | 'targeting_move' | 'moved' | 'targeting_attack' | 'targeting_skill'>('idle');
  const [pendingMove, setPendingMove] = useState<{ r: number; c: number } | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [selectedMonsterId, setSelectedMonsterId] = useState<string | null>(null);
  const [bossMode, setBossMode] = useState<'pick' | 'move' | 'attack'>('pick');

  const iAmBoss = !!game && game.bossPlayerId === me.playerId;
  const bossPhase = game?.phase === 'boss';
  const myBossTurn = iAmBoss && bossPhase && isMyTurn;

  useEffect(() => {
    if (!isMyTurn) {
      setTurnPhase('idle');
      setPendingMove(null);
      setSelectedMonsterId(null);
      setBossMode('pick');
    }
  }, [isMyTurn]);

  /** 魔王選中的那隻怪，連同牠的位置。 */
  const selectedMonster = useMemo(() => {
    if (!game || !selectedMonsterId) return null;
    for (let r = 0; r < game.board.length; r++) {
      const row = game.board[r];
      if (!row) continue;
      for (let c = 0; c < row.length; c++) {
        const piece = row[c]?.piece;
        if (piece && piece.id === selectedMonsterId) return { r, c, piece };
      }
    }
    return null;
  }, [game, selectedMonsterId]);

  /** keepSelection：移動之後保留選取並切到攻擊，跟玩家「移動 → 終結動作」的節奏一致。 */
  const selectedHasMoved = !!(game && selectedMonsterId && game.movedMonsterIds.includes(selectedMonsterId));

  const bossCommand = (action: unknown, keepSelection = false) => {
    run(() => emitWithAck('game:dnd', { action: action as any }));
    if (keepSelection) {
      setBossMode('attack');
    } else {
      setSelectedMonsterId(null);
      setBossMode('pick');
    }
  };

  const lastAttackEvent = useMemo(() => {
    const attacks = room.log.filter((e) => ['dndAttack', 'dndTrap', 'dndLevelUp'].includes(e.t));
    return attacks.length > 0 ? (attacks[attacks.length - 1] as any) : null;
  }, [room.log]);

  /**
   * 現在由我操作的棋子：平常是自己的角色，代打 NPC 時**只能**是那個 NPC。
   * 代打時千萬不能退回自己的角色 —— 棋盤是逐格掃的，自己的棋子通常排在
   * NPC 前面，先比 playerId 的話會拿到自己的位置，操作面板就會用錯座標，
   * 移動送出去必定被伺服器判成超出範圍。
   */
  const myPosition = useMemo(() => {
    if (!game) return null;
    const npcId = npcSeatIsMine ? `npc-${game.turnSeat}` : null;
    for (let r = 0; r < game.board.length; r++) {
      const row = game.board[r];
      if (!row) continue;
      for (let c = 0; c < row.length; c++) {
        const piece = row[c]?.piece;
        if (!piece || piece.type !== 'player') continue;
        const mine = npcId ? piece.id === npcId : piece.playerId === me.playerId;
        if (mine) return { r, c, piece };
      }
    }
    return null;
  }, [game, me.playerId, npcSeatIsMine]);

  const mySeat = npcSeatIsMine
    ? (game?.turnSeat ?? -1)
    : (room.seats.find((seat) => seat.playerId === me.playerId)?.seat ?? -1);
  // 自己倒了但隊友還站著 —— 這種結束要講清楚，不然畫面看起來像莫名其妙跳出來
  const iDiedWithTeammatesLeft =
    !!game && mySeat !== -1 && game.seats[mySeat]?.alive === false &&
    [0, 1, 2, 3].some((seat) => seat !== mySeat && game.seats[seat]?.alive);
  const myFearTurns = mySeat === -1 ? 0 : (game?.seats[mySeat]?.fearTurns ?? 0);

  /**
   * 中了【恐懼】時，伺服器會把移動目標鏡射到反方向。這裡只是讓預覽跟著鏡射，
   * 玩家才不會照著一個不會成真的位置去挑攻擊目標 —— 判定仍然以伺服器為準。
   */
  const fearAdjust = (r: number, c: number) => {
    if (!myFearTurns || !myPosition) return { r, c };
    return { r: myPosition.r * 2 - r, c: myPosition.c * 2 - c };
  };

  const getSkillName = (classId: string) => {
    switch (classId) {
      case 'brave': return '⛓️ 鎖鏈';
      case 'bubble': return '🕸️ 撒網';
      case 'tangerine': return '🔥 火牆';
      case 'star': return '✨ 神聖治癒';
      default: return '✨ 技能';
    }
  };

  const handleCellClick = (r: number, c: number) => {
    if (!isMyTurn || !game || game.over) return;

    // 魔王回合：先點怪物選中牠，再點目標格／目標角色
    if (myBossTurn) {
      const clicked = game.board[r]?.[c]?.piece;

      // 點到另一隻還能指揮的怪就直接換過去（含還沒選任何怪的情況）
      if (clicked?.type === 'goblin' && !game.actedMonsterIds.includes(clicked.id)) {
        if (clicked.id !== selectedMonsterId) {
          setSelectedMonsterId(clicked.id);
          setBossMode(game.movedMonsterIds.includes(clicked.id) ? 'attack' : 'move');
        }
        return;
      }

      if (bossMode === 'pick' || !selectedMonster) return;

      const dist = Math.abs(r - selectedMonster.r) + Math.abs(c - selectedMonster.c);
      if (bossMode === 'move') {
        const speed = selectedMonster.piece.speed ?? 2;
        if (dist > 0 && dist <= speed && !clicked) {
          bossCommand({ kind: 'bossMove', monsterId: selectedMonster.piece.id, r, c }, true);
        }
      } else if (bossMode === 'attack') {
        const range = selectedMonster.piece.range ?? (selectedMonster.piece.id === 'boss-3' ? 2 : 1);
        if (clicked?.type === 'player' && dist <= range) {
          bossCommand({ kind: 'bossAttack', monsterId: selectedMonster.piece.id, targetId: clicked.id });
        }
      }
      return;
    }

    if (!myPosition) return;

    const currentR = pendingMove ? pendingMove.r : myPosition.r;
    const currentC = pendingMove ? pendingMove.c : myPosition.c;
    const dr = r - currentR;
    const dc = c - currentC;
    const dist = Math.abs(dr) + Math.abs(dc);

    const cell = game.board[r]?.[c];
    if (!cell) return;
    const classId = myPosition.piece.classId || 'brave';

    if (turnPhase === 'targeting_move') {
      const moveRange = classId === 'bubble' ? 5 : (classId === 'brave' ? 2 : 1);

      if (r === myPosition.r && c === myPosition.c) {
        setPendingMove({ r, c });
        setTurnPhase('moved');
        return;
      }

      const landing = fearAdjust(r, c);
      const landingCell = game.board[landing.r]?.[landing.c];
      if (!landingCell) return;

      if (dist <= moveRange && dist > 0 && (!landingCell.piece || landingCell.piece.type === 'staircase')) {
        setPendingMove(landing);
        setTurnPhase('moved');
      }
    } else if (turnPhase === 'targeting_attack') {
      const attackRange = classId === 'tangerine' ? 3 : 1;
      if (cell.piece && cell.piece.type === 'goblin' && dist <= attackRange) {
        executeTurn({ kind: 'attack', targetId: cell.piece.id });
      }
    } else if (turnPhase === 'targeting_skill') {
      if (classId === 'star') {
        if (cell.piece && cell.piece.type === 'player' && dist <= 3) {
          executeTurn({ kind: 'skill', targetId: cell.piece.id });
        }
      } else if (classId === 'bubble') {
        if (cell.piece?.type === 'goblin' && dist <= 5) {
          executeTurn({ kind: 'skill', targetId: cell.piece.id });
        }
      } else if (classId === 'tangerine') {
        // 【火牆】是對地技，點空地或點怪物腳下都行
        if (dist <= 3) {
          executeTurn({ kind: 'skill', r, c });
        }
      } else if (classId === 'brave') {
        const equip = mySeat >= 0 ? game.seats[mySeat]?.equipment : undefined;
        const reach = equip ? DND_EQUIPMENT_SPEC[equip.tier].chainRange : 3;
        if (cell.piece && cell.piece.type === 'goblin' && dist <= reach) {
          executeTurn({ kind: 'skill', targetId: cell.piece.id });
        }
      } else {
        executeTurn({ kind: 'skill' });
      }
    }
  };

  const handleMoveDir = (dir: 'up' | 'down' | 'left' | 'right') => {
    if (!isMyTurn || !game || game.over || !myPosition || turnPhase !== 'targeting_move') return;
    
    let nr = myPosition.r;
    let nc = myPosition.c;
    if (dir === 'up') nr--;
    if (dir === 'down') nr++;
    if (dir === 'left') nc--;
    if (dir === 'right') nc++;
    
    const classId = myPosition.piece.classId || 'brave';
    const moveRange = classId === 'bubble' ? 5 : (classId === 'brave' ? 2 : 1);
    const dist = Math.abs(nr - myPosition.r) + Math.abs(nc - myPosition.c);

    const landing = fearAdjust(nr, nc);
    const cell = game.board[landing.r]?.[landing.c];
    if (cell && dist <= moveRange && (!cell.piece || cell.piece.type === 'staircase')) {
      setPendingMove(landing);
      setTurnPhase('moved');
    }
  };

  const executeTurn = (finalAction: unknown) => {
    const isSamePlace = pendingMove?.r === myPosition?.r && pendingMove?.c === myPosition?.c;
    // pendingMove 存的是「會站上去的格子」。中了【恐懼】時伺服器會再鏡射一次，
    // 而鏡射是對合運算，所以這裡再鏡射回去，兩次抵銷後就落在玩家看到的位置。
    const requested =
      pendingMove && !isSamePlace ? fearAdjust(pendingMove.r, pendingMove.c) : null;
    const payload = {
      kind: 'turnCombo',
      move: requested,
      action: finalAction
    };

    run(() => emitWithAck('game:dnd', { action: payload as any }));
    setTurnPhase('idle');
    setPendingMove(null);
  };

  const sendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    // 伺服器讀的是 payload.text，送 message 的話 cleanText 拿到 undefined 就直接 return，
    // 聊天會安靜地整個失效
    socket.emit('room:chat', { text: chatInput });
    setChatInput('');
  };

  const getCellDisplay = (cell: DndCellView, r: number, c: number) => {
    const fireWall = game?.fireWalls?.find((w) => w.r === r && w.c === c);
    if (fireWall && !cell.piece) {
      return (
        <div className="dnd-token" style={{ opacity: 0.9 }}>
          <span className="token-icon" style={{ fontSize: '1.2rem' }}>🔥</span>
          <span className="token-label" style={{ color: fireWall.hostile ? 'var(--red)' : '#e67e22', fontSize: '0.65rem' }}>
            {fireWall.hostile ? '邪火' : '火牆'} {fireWall.turns}
          </span>
        </div>
      );
    }

    if (!cell.piece) {
      if (cell.trapTriggered) {
        return (
          <div className="dnd-token trap-token" style={{ opacity: 0.8 }}>
            <span className="token-icon" style={{ fontSize: '1.2rem' }}>🕸️</span>
            <span className="token-label" style={{ color: 'var(--red)', fontSize: '0.65rem' }}>陷阱</span>
          </div>
        );
      }
      return '';
    }
    const piece = cell.piece;

    if (piece.type === 'player') {
      const seatIndex = room.seats.findIndex((s) => s?.playerId === piece.playerId);
      const label = `P${seatIndex + 1}`;
      let icon = '👤';
      if (piece.classId === 'brave') icon = '🛡️';
      else if (piece.classId === 'bubble') icon = '🗡️';
      else if (piece.classId === 'tangerine') icon = '🧙';
      else if (piece.classId === 'star') icon = '⛪';
      
      // 殘影要畫在「現在操作的角色」身上，代打 NPC 時就是那個 NPC
      const isMe = myPosition ? piece.id === myPosition.piece.id : piece.playerId === me.playerId;
      const isOriginalGhost = isMe && pendingMove && (pendingMove.r !== myPosition?.r || pendingMove.c !== myPosition?.c);

      return (
        <div className="dnd-token player-token" data-seat={seatIndex} style={{ opacity: isOriginalGhost ? 0.3 : 1 }}>
          <span className="token-icon">{icon}</span>
          <span className="token-label">{label}</span>
        </div>
      );
    } else if (piece.type === 'villager') {
      return (
        <div className="dnd-token" title={`${piece.name} HP ${piece.hp}/${piece.maxHp}`}>
          <span className="token-icon">🧑‍🌾</span>
          <span className="token-label" style={{ color: '#2ecc71', fontSize: '0.65rem' }}>村民</span>
        </div>
      );
    } else if (piece.type === 'staircase') {
      return (
        <div className="dnd-token staircase-token" style={{ animation: 'pulse 1.5s infinite' }}>
          <span className="token-icon" style={{ fontSize: '1.2rem' }}>🪜</span>
          <span className="token-label" style={{ color: 'var(--gold)', fontSize: '0.75rem' }}>下樓梯</span>
        </div>
      );
    } else {
      let icon = '👹';
      if (piece.name.includes('薩滿') || piece.name.includes('Shaman')) icon = '🔮';
      else if (piece.name.includes('酋長') || piece.name.includes('Chief')) icon = '👑';
      else if (piece.name.includes('盜賊') || piece.name.includes('Rogue')) icon = '🥷';
      else if (piece.name.includes('法師') || piece.name.includes('Mage')) icon = '🧿';
      if (piece.id === 'boss-5') icon = '🕯️';
      else if (piece.copyClass) icon = '🪞';
      const acted = !!game?.actedMonsterIds.includes(piece.id);
      const picked = selectedMonsterId === piece.id;
      return (
        <div
          className="dnd-token goblin-token"
          style={{
            opacity: bossPhase && acted ? 0.35 : 1,
            outline: picked ? '2px solid var(--gold)' : undefined,
            borderRadius: picked ? '4px' : undefined,
          }}
        >
          <span className="token-icon">{icon}</span>
          <span className="token-label">{piece.name.split(' ')[0]}</span>
          {(piece.invulnerable || piece.stunnedTurns || piece.trappedTurns || piece.acDebuffTurns || piece.atkDebuffTurns) ? (
            <span className="token-label" style={{ color: 'var(--gold)', fontSize: '0.6rem' }}>
              {piece.invulnerable ? '🛡️無敵'
                : piece.stunnedTurns ? '💫暈眩'
                : piece.trappedTurns ? '🪤受困'
                : piece.acDebuffTurns ? '🗡️破甲'
                : '🩸削弱'}
            </span>
          ) : null}
        </div>
      );
    }
  };

  const renderBossMenu = () => {
    if (!game) return null;
    const monsters: Array<{ id: string; name: string; hp: number; maxHp: number; acted: boolean }> = [];
    for (const row of game.board) {
      for (const cell of row) {
        const piece = cell.piece;
        if (piece?.type === 'goblin') {
          monsters.push({
            id: piece.id,
            name: piece.name.split(' ')[0]!,
            hp: piece.hp,
            maxHp: piece.maxHp,
            acted: game.actedMonsterIds.includes(piece.id),
          });
        }
      }
    }
    const pending = monsters.filter((m) => !m.acted).length;

    return (
      <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', width: '100%' }}>
        <h4 style={{ color: 'var(--red)', textAlign: 'center', margin: 0, fontSize: '0.9rem' }}>
          👑 魔王回合 · 還有 {pending} 隻可以指揮
        </h4>

        {selectedMonster ? (
          <>
            <div style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--gold)' }}>
              已選中 {selectedMonster.piece.name.split(' ')[0]}
              （移動 {selectedMonster.piece.speed ?? 2} 格 · 射程 {selectedMonster.piece.range ?? (selectedMonster.piece.id === 'boss-3' ? 2 : 1)} 格）
              {selectedHasMoved && <span style={{ color: 'var(--muted)' }}> · 已移動</span>}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                className={bossMode === 'move' ? 'btn btn--primary' : 'btn'}
                style={{ flex: 1, justifyContent: 'center', opacity: selectedHasMoved ? 0.45 : 1 }}
                disabled={selectedHasMoved}
                onClick={() => setBossMode('move')}
              >
                👣 移動
              </button>
              <button
                className={bossMode === 'attack' ? 'btn btn--primary' : 'btn'}
                style={{ flex: 1, justifyContent: 'center' }}
                onClick={() => setBossMode('attack')}
              >
                ⚔️ 攻擊
              </button>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--muted)', textAlign: 'center' }}>
              {bossMode === 'move' ? '點棋盤上的空格移動過去' : '點射程內的冒險者發動攻擊'}
              <br />可以先移動再攻擊；打不到人就按待命
            </div>
            <button
              className="btn"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={() => bossCommand({ kind: 'bossHold', monsterId: selectedMonster.piece.id })}
            >
              🛑 待命（結束這隻的行動）
            </button>
            <button className="btn" style={{ width: '100%', justifyContent: 'center', fontSize: '0.8rem' }} onClick={() => { setSelectedMonsterId(null); setBossMode('pick'); }}>
              只是取消選取
            </button>
          </>
        ) : (
          <div style={{ fontSize: '0.8rem', color: 'var(--muted)', textAlign: 'center' }}>
            點棋盤上的怪物來指揮牠。<br />沒有下令的怪物會在你結束回合後自動行動。
          </div>
        )}

        <div style={{ borderTop: '1px solid var(--line)', margin: '0.2rem 0' }} />
        <button
          className="btn btn--primary"
          style={{ width: '100%', justifyContent: 'center' }}
          onClick={() => bossCommand({ kind: 'bossEnd' })}
        >
          ⏭️ 結束回合（其餘交給 AI）
        </button>
      </div>
    );
  };

  const renderActionMenu = () => {
    const classId = myPosition?.piece?.classId || 'brave';
    
    if (turnPhase === 'targeting_attack' || turnPhase === 'targeting_skill') {
      return (
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', alignItems: 'center', width: '100%' }}>
          <span style={{ color: 'var(--gold)', fontWeight: 'bold', textAlign: 'center', fontSize: '0.85rem' }}>🎯 請點擊畫面的目標格子...</span>
          <button className="btn" style={{ width: '100%' }} onClick={() => setTurnPhase(pendingMove ? 'moved' : 'idle')}>返回</button>
        </div>
      );
    }

    if (turnPhase === 'targeting_move') {
      return (
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
          <h4 style={{ color: 'var(--gold)', textAlign: 'center', margin: '0 0 0.8rem 0', fontSize: '0.9rem' }}>選擇移動位置</h4>
          <div className="dnd-dpad">
            <button type="button" className="dpad-btn up" onClick={() => handleMoveDir('up')}>▲</button>
            <div className="dpad-middle">
              <button type="button" className="dpad-btn left" onClick={() => handleMoveDir('left')}>◀</button>
              <div className="dpad-center-hub" style={{ fontSize: '1rem' }}>🎮</div>
              <button type="button" className="dpad-btn right" onClick={() => handleMoveDir('right')}>▶</button>
            </div>
            <button type="button" className="dpad-btn down" onClick={() => handleMoveDir('down')}>▼</button>
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.8rem', textAlign: 'center' }}>
            或直接點擊棋盤格子
          </div>
          <div style={{ borderTop: '1px solid var(--line)', margin: '0.8rem 0', width: '100%' }} />
          <button className="btn" style={{ width: '100%', display: 'flex', justifyContent: 'center' }} onClick={() => setTurnPhase('idle')}>返回主選單</button>
        </div>
      );
    }

    if (turnPhase === 'idle') {
      return (
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', width: '100%' }}>
          <h4 style={{ color: 'var(--gold)', textAlign: 'center', margin: '0 0 0.3rem 0', fontSize: '0.9rem' }}>選擇行動</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <button className="btn btn--primary" style={{ display: 'flex', justifyContent: 'center' }} onClick={() => setTurnPhase('targeting_move')}>👣 移動</button>
            <button className="btn btn--primary" style={{ display: 'flex', justifyContent: 'center' }} onClick={() => setTurnPhase('targeting_attack')}>⚔️ 攻擊</button>
            <button className="btn btn--primary" style={{ display: 'flex', justifyContent: 'center' }} onClick={() => setTurnPhase('targeting_skill')}>{getSkillName(classId)}</button>
            <button className="btn btn--primary" style={{ display: 'flex', justifyContent: 'center' }} onClick={() => executeTurn({ kind: 'rest' })}>🏕️ 休息</button>
          </div>
        </div>
      );
    }

    if (turnPhase === 'moved') {
      return (
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', width: '100%' }}>
          <h4 style={{ color: 'var(--gold)', textAlign: 'center', margin: '0 0 0.3rem 0', fontSize: '0.85rem' }}>已移動，選擇終結動作</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <button className="btn btn--primary" style={{ display: 'flex', justifyContent: 'center' }} onClick={() => setTurnPhase('targeting_attack')}>⚔️ 攻擊</button>
            <button className="btn btn--primary" style={{ display: 'flex', justifyContent: 'center' }} onClick={() => setTurnPhase('targeting_skill')}>{getSkillName(classId)}</button>
            <button className="btn btn--primary" style={{ display: 'flex', justifyContent: 'center' }} onClick={() => executeTurn({ kind: 'rest' })}>🏕️ 休息</button>
          </div>
          <div style={{ borderTop: '1px solid var(--line)', margin: '0.1rem 0' }} />
          <button className="btn" style={{ width: '100%', display: 'flex', justifyContent: 'center' }} onClick={() => { setTurnPhase('idle'); setPendingMove(null); }}>取消移動</button>
        </div>
      );
    }

    return null;
  };

  return (
    <div style={{ padding: '1.5rem', maxWidth: '1400px', margin: '0 auto', color: 'var(--text)', boxSizing: 'border-box' }}>
      
      {/* 頂部房號與離開按鈕列 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', background: 'rgba(0,0,0,0.2)', padding: '0.8rem 1.2rem', borderRadius: '8px', border: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--gold)' }}>{room.name} 的房間</h2>
          <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{t('room.code', { id: room.id })}</span>
        </div>
        <button className="btn" onClick={() => run(() => emitWithAck('room:leave', {}))}>{t('room.leave')}</button>
      </div>

      {/* 主體雙欄排版：左側 (地圖/狀態) / 右側 (聊天室 + 操作鍵盤) */}
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: '1.5rem', flexWrap: 'wrap' }}>
        
        {/* === 左側欄位：地城資訊、隊伍狀態、主棋盤 === */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: '3 1 600px', minWidth: '320px', gap: '1.5rem', alignItems: 'center' }}>
          
          {playing && game && (
            <div style={{ width: '100%', maxWidth: '900px' }}>
              <h3 style={{ textAlign: 'center', margin: '0 0 1rem 0', color: 'var(--gold)', letterSpacing: '2px' }}>
                🏰 地下城第 {game.level} 層 / 共 5 層
                <span style={{ marginLeft: '0.8rem', fontSize: '0.8rem', color: 'var(--muted)', letterSpacing: 'normal' }}>
                  {DND_DIFFICULTY_LABEL[game.difficulty]}模式 · 怪物強度 {Math.round(DND_DIFFICULTY_MULTIPLIER[game.difficulty] * 100)}%
                  {game.bossPlayerId && (
                    <span style={{ color: 'var(--red)' }}>
                      {' '}· 👑 {room.seats.find((s) => s.playerId === game.bossPlayerId)?.nickname ?? '魔王'} 操控怪物
                    </span>
                  )}
                </span>
              </h3>
              {game.level === 3 && (
                <div style={{ display: 'flex', gap: '0.8rem', justifyContent: 'center', margin: '0 0 0.8rem 0', flexWrap: 'wrap' }}>
                  <span style={{ background: 'rgba(46, 204, 113, 0.15)', border: '1px solid #2ecc71', color: '#2ecc71', borderRadius: '999px', padding: '0.25rem 0.9rem', fontSize: '0.85rem' }}>
                    🏃 已獲救 {game.villagersRescued} / 需要 5
                  </span>
                  <span style={{ background: 'rgba(231, 76, 60, 0.12)', border: '1px solid var(--red)', color: 'var(--red)', borderRadius: '999px', padding: '0.25rem 0.9rem', fontSize: '0.85rem' }}>
                    ☠️ 陣亡 {game.villagersLost}
                  </span>
                  <span style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--line)', color: 'var(--muted)', borderRadius: '999px', padding: '0.25rem 0.9rem', fontSize: '0.85rem' }}>
                    🧑‍🌾 逃亡中 {10 - game.villagersRescued - game.villagersLost} · 第 {game.roundCount} 輪
                  </span>
                </div>
              )}
              <div style={{ textAlign: 'left', margin: '0 auto', width: '100%', fontSize: '0.9rem', color: 'var(--muted)', background: 'rgba(0,0,0,0.4)', padding: '1rem', borderRadius: '8px', borderLeft: '3px solid var(--gold)', lineHeight: '1.4' }}>
                {game.level === 1 && "📖 【B1 貪婪地窖】: 你們跟隨微光聖物的指引來到失落的法師塔。底層已被哥布林佔據，請清除牠們並找尋通往深處的樓梯。"}
                {game.level === 2 && "📖 【B2 薩滿祭壇】: 這裡瀰漫著詭異的魔法氣息。哥布林薩滿正在進行儀式試圖召喚虛空魔物 —— 而且有 3 隻哥布林盜賊在暗處游走，牠們一次能衝刺 5 格。阻止他們！"}
                {game.level === 3 && "📖 【B3 逃亡通道】: 哥布林把整村的人抓來當祭品。10 位村民正拼命往上方的出口跑，第二輪就會有伏兵殺出、之後每 3 輪還有追兵從後方追上來。擋住他們，至少讓 5 位村民活著離開！"}
                {game.level === 5 && "📖 【B5 邪神祭壇】: 守著祭壇的是一整批邪神信徒。清掉四分之三之後，哥布林邪神才會睜眼 —— 它照著你們的模樣捏出分身，分身會用你們自己的招式。有分身護體時本體刀槍不入，打碎所有分身才有 2 回合的空窗可以真的傷到它。當它掉到半血，護體會消失、改成在分身之間流竄奪舍：看血量，找出哪一個才是本體。"}
                {game.level === 4 && "📖 【B4 酋長王座】: 抵達高塔基石。除了精銳哥布林與盜賊，還有 3 名哥布林法師能隔 3 格轟擊你們。被虛空力量腐化的哥布林酋長就在前方 —— 牠的攻擊會放逐、召喚或降下恐懼，重傷時更會把上兩層的 Boss 一起召回！"}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-start', gap: '1.5rem', width: '100%', flexWrap: 'wrap' }}>
            
            {/* 隊伍狀態與最後戰役判定 */}
            {playing && game && (
              <div style={{ width: '220px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <TurnBanner
                  isMyTurn={isMyTurn}
                  nickname={
                    room.seats.find((s) => s?.playerId === game.turnPlayerId)?.nickname
                    || game.seats[game.turnSeat]?.name
                    || '—'
                  }
                  remainingMs={remainingMs}
                />
                {npcSeatIsMine && myPosition && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--gold)', textAlign: 'center', marginTop: '-0.5rem' }}>
                    🤖 你正在代打 {game.seats[game.turnSeat]?.name ?? myPosition.piece.name}
                  </div>
                )}

                <div className="dnd-party-status">
                  <h3>🛡️ 冒險者隊伍狀態</h3>
                  {[0, 1, 2, 3].map((seatIndex) => {
                    const seatInfo = game.seats[seatIndex];
                    if (!seatInfo) return null;
                    const seat = room.seats.find((s) => s?.seat === seatIndex);
                    const displayName = seat ? seat.nickname : (seatInfo.name || `NPC ${seatIndex + 1}`);
                    const hp = seatInfo.hp;
                    const maxHp = seatInfo.maxHp;
                    const alive = seatInfo.alive;

                    return (
                      <div key={seatIndex} className="party-member" data-alive={alive}>
                        <div className="party-member-header">
                          <span className="party-member-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            P{seatIndex + 1}. {displayName}
                            {seatInfo.equipment && (
                              <span title={`${DND_EQUIPMENT_NAME[seatInfo.equipment.kind]}（${seatInfo.equipment.tier}）`} style={{ color: 'var(--gold)', marginLeft: '4px' }}>
                                ⚔️{DND_EQUIPMENT_NAME[seatInfo.equipment.kind]}
                              </span>
                            )}
                          </span>
                          <span className={`party-member-status ${!alive ? 'dead' : seatInfo.banishedTurns ? 'banished' : 'alive'}`} style={seatInfo.banishedTurns ? { color: 'var(--gold)' } : {}}>
                            {!alive
                              ? t('dnd.dead')
                              : seatInfo.banishedTurns
                                ? `放逐 (${seatInfo.banishedTurns})`
                                : seatInfo.stunnedTurns
                                  ? `💫 暈眩 (${seatInfo.stunnedTurns})`
                                  : seatInfo.restrainedTurns
                                    ? `🕸️ 被纏住 (${seatInfo.restrainedTurns})`
                                : seatInfo.fearTurns
                                  ? `😱 恐懼 (${seatInfo.fearTurns})`
                                  : seatInfo.damageCapTurns
                                    ? '🛡️ 極限防禦'
                                    : t('dnd.alive')}
                          </span>
                        </div>
                        <div className="party-member-hp">
                          <div className="party-hp-bar-container">
                            <div className="party-hp-bar" style={{ width: `${(hp / maxHp) * 100}%` }} />
                          </div>
                          <span className="party-hp-text">{t('dnd.hp', { hp, maxHp })}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {lastAttackEvent && (
                  <div className="dnd-dice-sidebar-card" style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '1rem', borderRadius: 'var(--radius)', border: '1px solid var(--line)', textAlign: 'center' }}>
                    <h4 style={{ margin: '0 0 0.8rem 0', fontSize: '0.85rem', color: 'var(--gold)' }}>🎲 最後戰役判定</h4>
                    {lastAttackEvent.t === 'dndLevelUp' ? (
                      <div>
                        <div style={{ fontSize: '1.8rem', marginBottom: '0.4rem' }}>🪜</div>
                        <strong style={{ color: '#2ecc71', fontSize: '0.85rem', display: 'block', marginBottom: '0.4rem' }}>進入地下城第 {lastAttackEvent.level} 層！</strong>
                        <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>全體隊員已恢復 50% 生命值！</span>
                      </div>
                    ) : lastAttackEvent.t === 'dndTrap' ? (
                      <div>
                        <div style={{ fontSize: '1.8rem', marginBottom: '0.4rem' }}>🕸️</div>
                        <strong style={{ color: '#e74c3c', fontSize: '0.85rem', display: 'block', marginBottom: '0.4rem' }}>{lastAttackEvent.player} 觸發隱藏陷阱！</strong>
                        <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>受到了 {lastAttackEvent.damage} 點傷害！</span>
                      </div>
                    ) : lastAttackEvent.t === 'dndMessage' ? (
                      <div>
                        <div style={{ fontSize: '1.8rem', marginBottom: '0.4rem' }}>✨</div>
                        <strong style={{ color: 'var(--gold)', fontSize: '0.85rem', display: 'block', marginBottom: '0.4rem' }}>{lastAttackEvent.message}</strong>
                      </div>
                    ) : (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.8rem', marginBottom: '0.6rem' }}>
                          <div className="dnd-d20-mini" style={{ fontSize: '1.6rem', width: '42px', height: '42px', lineHeight: '42px', background: 'radial-gradient(circle, rgba(243,156,18,0.1) 0%, rgba(211,84,0,0.2) 100%)', border: '2px solid var(--gold)', borderRadius: '50%', color: 'var(--gold)', fontWeight: '900', userSelect: 'none' }}>
                            {lastAttackEvent.damage < 0 ? '✨' : lastAttackEvent.roll}
                          </div>
                          <div style={{ textAlign: 'left', overflow: 'hidden' }}>
                            <div style={{ fontSize: '0.8rem', fontWeight: 'bold', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                              {lastAttackEvent.damage < 0 ? `${lastAttackEvent.player} 治療 ${lastAttackEvent.target}` : `${lastAttackEvent.player} ➔ ${lastAttackEvent.target}`}
                            </div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>{lastAttackEvent.damage < 0 ? '神聖法術' : `D20 擲骰判定`}</div>
                          </div>
                        </div>
                        <div className={`dnd-dice-hit-text ${lastAttackEvent.hit ? 'hit' : 'miss'}`} style={{ fontSize: '0.85rem', padding: '4px', borderRadius: '4px' }}>
                          {lastAttackEvent.damage < 0 ? `恢復了 ${-lastAttackEvent.damage} 點生命` : (lastAttackEvent.hit ? `命中！💥 造成 ${lastAttackEvent.damage} 傷害` : '未命中 🛡️')}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 主棋盤 */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: '2 1 400px', minWidth: 0 }}>
              {playing && game ? (
                <div className="dnd-board-container" style={{ width: '100%', maxWidth: '100%', overflowX: 'auto', margin: '0' }}>
                  <div className="dnd-board" style={{ margin: '0 auto' }}>
                    {game.board.map((row, r) =>
                      row.map((cell, c) => {
                        const currentR = pendingMove ? pendingMove.r : (myPosition?.r ?? 999);
                        const currentC = pendingMove ? pendingMove.c : (myPosition?.c ?? 999);
                        const classId = myPosition?.piece?.classId || 'brave';
                        const attackRange = classId === 'tangerine' ? 3 : 1;
                        const moveRange = classId === 'bubble' ? 5 : (classId === 'brave' ? 2 : 1);
                        
                        const dist = myPosition ? Math.abs(r - currentR) + Math.abs(c - currentC) : 999;
                        const distFromOriginal = myPosition ? Math.abs(r - myPosition.r) + Math.abs(c - myPosition.c) : 999;
                        
                        // 恐懼中實際會站上去的是鏡射後的格子，能不能走要看那一格
                        const landing = fearAdjust(r, c);
                        const landingCell = game.board[landing.r]?.[landing.c];
                        const isMoveable = distFromOriginal > 0 && distFromOriginal <= moveRange
                          && !!landingCell && (!landingCell.piece || landingCell.piece.type === 'staircase');
                        const isAttackable = myPosition && dist <= attackRange && cell.piece?.type === 'goblin';
                        const myEquip = mySeat >= 0 ? game.seats[mySeat]?.equipment : undefined;
                        const chainRange = myEquip && classId === 'brave'
                          ? DND_EQUIPMENT_SPEC[myEquip.tier].chainRange
                          : 3;
                        const skillRange = classId === 'bubble' ? 5 : classId === 'brave' ? chainRange : 3;
                        const isSkillable = myPosition && dist <= skillRange && (
                          classId === 'star' ? cell.piece?.type === 'player'
                          : classId === 'tangerine' ? true // 火牆是對地技，任何格子都能點
                          : cell.piece?.type === 'goblin' // 戰士【鎖鏈】與盜賊【撒網】都是指定怪物
                        );

                        let borderClass = '';
                        if (myBossTurn) {
                          if (!selectedMonster) {
                            // 還沒選怪：可以指揮的怪物亮起來
                            if (cell.piece?.type === 'goblin' && !game.actedMonsterIds.includes(cell.piece.id)) {
                              borderClass = 'can-attack';
                            }
                          } else {
                            const bossDist = Math.abs(r - selectedMonster.r) + Math.abs(c - selectedMonster.c);
                            const speed = selectedMonster.piece.speed ?? 2;
                            const range = selectedMonster.piece.range ?? (selectedMonster.piece.id === 'boss-3' ? 2 : 1);
                            if (bossMode === 'move' && !selectedHasMoved && bossDist > 0 && bossDist <= speed && !cell.piece) {
                              borderClass = 'can-move';
                            } else if (bossMode === 'attack' && bossDist <= range && cell.piece?.type === 'player') {
                              borderClass = 'can-attack';
                            }
                          }
                        } else if (isMyTurn) {
                          if (turnPhase === 'targeting_move') {
                            if (isMoveable) borderClass = 'can-move';
                            if (r === myPosition?.r && c === myPosition?.c) borderClass = 'can-move'; 
                          } else if (turnPhase === 'targeting_attack' && isAttackable) {
                            borderClass = 'can-attack';
                          } else if (turnPhase === 'targeting_skill' && isSkillable) {
                            borderClass = 'can-attack';
                          }
                        }
                        
                        const isPendingHere = pendingMove && r === pendingMove.r && c === pendingMove.c;

                        return (
                          <button
                            key={`${r}-${c}`}
                            type="button"
                            className={`dnd-cell ${borderClass}`}
                            onClick={() => handleCellClick(r, c)}
                            disabled={!isMyTurn}
                            style={{
                              position: 'relative',
                              border: game.fireWalls?.some((w) => w.r === r && w.c === c)
                                ? '1px solid #e67e22'
                                : cell.trapTriggered ? '1px solid var(--red)' : undefined,
                              background: game.fireWalls?.some((w) => w.r === r && w.c === c)
                                ? 'rgba(230, 126, 34, 0.22)'
                                : cell.trapTriggered ? 'rgba(231, 76, 60, 0.12)' : (isPendingHere ? 'rgba(227, 179, 65, 0.25)' : undefined),
                            }}
                          >
                            {getCellDisplay(cell, r, c)}
                            
                            {isPendingHere && turnPhase !== 'idle' && !cell.piece && (
                              <div className="dnd-token player-token" style={{ opacity: 0.6, position: 'absolute' }}>
                                <span className="token-icon">👤</span>
                              </div>
                            )}

                            {cell.piece && cell.piece.type !== 'staircase' && (
                              <div className="dnd-hp-bar-container">
                                <div className="dnd-hp-bar" style={{ width: `${(cell.piece.hp / cell.piece.maxHp) * 100}%`, backgroundColor: cell.piece.type === 'player' ? '#2ecc71' : '#e74c3c' }} />
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

          </div>
        </div>

        {/* === 右側欄位：真正的房間聊天室 + 緊貼在下方的【選擇行動操作鍵盤】 === */}
        <div style={{ width: '320px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* 1. 正常的房間聊天室 */}
          <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', background: 'var(--panel)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--line)' }}>
            <h4 style={{ margin: 0, color: 'var(--gold)', fontSize: '0.95rem' }}>{t('room.chatTitle')}</h4>
            <div style={{ height: '180px', overflowY: 'auto', background: 'rgba(0,0,0,0.2)', padding: '0.5rem', borderRadius: '4px', fontSize: '0.85rem', color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {/* 聊天紀錄走 room:chat 事件、存在 GameProvider 裡 —— RoomView 上沒有 chats 這個欄位 */}
              {roomMessages.map((message) => (
                <div key={message.id}><strong>{message.nickname}:</strong> {message.text}</div>
              ))}
            </div>
            <form onSubmit={sendChat} style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="text"
                placeholder="說點什麼..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                style={{ flex: 1, background: 'rgba(0,0,0,0.3)', border: '1px solid var(--line)', borderRadius: '4px', padding: '0.4rem 0.6rem', color: 'var(--text)', fontSize: '0.85rem' }}
              />
              <button type="submit" className="btn" style={{ fontSize: '0.85rem', padding: '0.4rem 0.8rem' }}>送出</button>
            </form>
          </div>

          {/* 2. 聊天室下方的【選擇行動操作鍵盤】 */}
          {playing && game && (
            <div>
              {myBossTurn ? (
                renderBossMenu()
              ) : isMyTurn && myPosition ? (
                renderActionMenu()
              ) : (
                <div className="panel" style={{ opacity: 0.5, textAlign: 'center', padding: '1.5rem 1rem', fontSize: '0.85rem', color: 'var(--muted)', border: '1px dashed var(--line)' }}>
                  {bossPhase ? '👑 魔王正在指揮怪物…' : '⏳ 靜待其他玩家行動'}
                </div>
              )}
            </div>
          )}

          {game?.over && (
            <div className="game-over-panel" style={{ textAlign: 'center', background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px' }}>
              <h2 className="game-over-title" style={{ color: 'var(--gold)', fontSize: '1.2rem', marginBottom: '0.5rem' }}>🎉 冒險結束</h2>
              <p className="game-over-desc" style={{ fontSize: '0.9rem', marginBottom: '1rem' }}>
                {/* ranking 勝敗都有值（它是名次表），要看 won 才知道輸贏 */}
                {game.won
                  ? '隊伍完成了地城清理！'
                  : game.bossPlayerId
                    ? '👑 冒險者全軍覆沒 —— 魔王獲勝！'
                    : iDiedWithTeammatesLeft
                      ? '你已陣亡，冒險就此結束 —— 沒有你，隊伍走不下去了。'
                      : '隊伍全軍覆沒，冒險失敗！'}
              </p>
              {isHost && (
                <button type="button" className="btn btn--primary" onClick={() => emitWithAck('game:start', {})}>
                  {t('dnd.playAgain')}
                </button>
              )}
              {!isHost && <div className="wait-host-hint" style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>{t('dnd.waitHost')}</div>}
            </div>
          )}

        </div>

      </div>

      {/* === 🎯 最下方的系統欄 / 即時戰報紀錄區塊 === */}
      {playing && game && (
        <div style={{
          marginTop: '2rem',
          background: 'rgba(0, 0, 0, 0.4)',
          padding: '1rem 1.2rem',
          borderRadius: '8px',
          border: '1px solid var(--line)',
          width: '100%',
          maxHeight: '140px',
          overflowY: 'auto',
          fontSize: '0.85rem',
          color: 'var(--muted)',
          lineHeight: '1.5',
          boxSizing: 'border-box'
        }}>
          <div style={{ color: 'var(--gold)', fontWeight: 'bold', marginBottom: '4px', fontSize: '0.9rem' }}>{t('dnd.logTitle')}</div>
          {/*
            戰報一律交給外觀的 formatLog。自己寫一份 if-chain 的話，沒列到的事件
            （dndStart／dndMonsterTurn／dndOver／timeoutDnd…）會直接吐 JSON 到畫面上，
            而且句子寫死中文，三個外觀全部失效。
          */}
          {room.log.map((logItem, idx) => (
            <div key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '2px' }}>
              {skin.formatLog(logItem)}
            </div>
          ))}
        </div>
      )}

    </div>
  );
}

function DndCharacterLobby({ room }: { room: RoomView }) {
  const mySeat = room.seats.find((seat) => seat.playerId === room.me.playerId);
  const mine = mySeat?.characterId ?? 'brave';
  const myRole = mySeat?.dndRole ?? 'hero';
  const isHost = room.hostId === room.me.playerId;
  const difficulty = room.dndDifficulty ?? 'normal';
  const npcControl = room.dndNpcControl ?? 'auto';
  const bossSeat = room.seats.find((seat) => seat.dndRole === 'boss');
  const bossTakenByOther = !!bossSeat && bossSeat.playerId !== room.me.playerId;
  const humanAdventurers = room.seats.filter((seat) => seat.dndRole !== 'boss').length;
  const heroCount = humanAdventurers;

  return (
    <div className="dnd-lobby-container" style={{ width: '100%', maxWidth: '640px', margin: '0 auto', padding: '1rem' }}>
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <h2 style={{ color: 'var(--gold)', marginBottom: '0.5rem' }}>⚔️ 選擇你的冒險職業 ⚔️</h2>
        <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>地下城難度已大幅提升！請與隊友協商挑選互補的職業以利破關。</p>
      </div>

      <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--line)', marginBottom: '1.5rem' }}>
        <h3 style={{ fontSize: '0.95rem', margin: '0 0 0.3rem 0', color: 'var(--text)' }}>🎭 你的位置</h3>
        <p style={{ fontSize: '0.78rem', color: 'var(--muted)', margin: '0 0 0.8rem 0' }}>
          魔王不下場冒險，改成親自指揮場上的怪物。一間房只能有一位魔王；
          沒有真人冒險者也能開局 —— 四個位置會全部交給 NPC。
        </p>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {([
            { role: 'hero', label: '🗡️ 冒險者', desc: '選職業下地城' },
            { role: 'boss', label: '👑 魔王', desc: '操控所有怪物' },
          ] as const).map((option) => {
            const selected = myRole === option.role;
            const disabled = option.role === 'boss' && bossTakenByOther;
            return (
              <button
                key={option.role}
                type="button"
                disabled={disabled}
                onClick={() => socket.emit('room:dndRole', { role: option.role })}
                style={{
                  flex: '1 1 0',
                  background: selected ? 'rgba(227, 179, 65, 0.12)' : 'var(--panel)',
                  border: selected ? '2px solid var(--gold)' : '1px solid var(--line)',
                  borderRadius: '6px',
                  padding: '0.6rem',
                  color: selected ? 'var(--gold)' : 'var(--text)',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  opacity: disabled ? 0.45 : 1,
                }}
              >
                <div style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{option.label}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
                  {disabled ? `${bossSeat?.nickname} 已經選了` : option.desc}
                </div>
              </button>
            );
          })}
        </div>
        {bossSeat && humanAdventurers === 0 && (
          <p style={{ fontSize: '0.78rem', color: 'var(--gold)', margin: '0.8rem 0 0 0' }}>
            🕹️ 單人魔王模式：四位冒險者全部由 NPC 操作，你負責指揮怪物把他們攔下來。
          </p>
        )}
      </div>

      <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--line)', marginBottom: '1.5rem' }}>
        <h3 style={{ fontSize: '0.95rem', margin: '0 0 0.3rem 0', color: 'var(--text)' }}>🤖 空位角色怎麼動</h3>
        <p style={{ fontSize: '0.78rem', color: 'var(--muted)', margin: '0 0 0.8rem 0' }}>
          沒人坐的位置會補上 NPC 隊友。可以讓他們自己行動，或是全部交給真人冒險者操作
          {heroCount <= 1 ? '（一個人就等於同時操作 4 個角色）' : ''}。
          {bossSeat ? '魔王不會拿到隊伍的操作權。' : ''}
        </p>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {DND_NPC_CONTROLS.map((option) => {
            const selected = npcControl === option;
            return (
              <button
                key={option}
                type="button"
                disabled={!isHost}
                onClick={() => socket.emit('room:dndNpcControl', { control: option })}
                style={{
                  flex: '1 1 0',
                  background: selected ? 'rgba(227, 179, 65, 0.12)' : 'var(--panel)',
                  border: selected ? '2px solid var(--gold)' : '1px solid var(--line)',
                  borderRadius: '6px',
                  padding: '0.6rem',
                  color: selected ? 'var(--gold)' : 'var(--text)',
                  cursor: isHost ? 'pointer' : 'default',
                  opacity: isHost || selected ? 1 : 0.5,
                }}
              >
                <div style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{DND_NPC_CONTROL_LABEL[option]}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
                  {option === 'auto' ? 'NPC 自己判斷行動' : '輪到 NPC 時由冒險者下指令'}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--line)', marginBottom: '1.5rem' }}>
        <h3 style={{ fontSize: '0.95rem', margin: '0 0 0.3rem 0', color: 'var(--text)' }}>⚔️ 地城難度</h3>
        <p style={{ fontSize: '0.78rem', color: 'var(--muted)', margin: '0 0 0.8rem 0' }}>
          {isHost ? '由房主決定，開打之後整局固定。倍率同時吃在怪物的 HP、傷害與防禦上。' : '由房主決定。倍率同時吃在怪物的 HP、傷害與防禦上。'}
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          {DND_DIFFICULTIES.map((id) => {
            const selected = difficulty === id;
            const percent = Math.round(DND_DIFFICULTY_MULTIPLIER[id] * 100);
            return (
              <button
                key={id}
                type="button"
                disabled={!isHost}
                onClick={() => socket.emit('room:dndDifficulty', { difficulty: id })}
                style={{
                  flex: '1 1 120px',
                  background: selected ? 'rgba(227, 179, 65, 0.12)' : 'var(--panel)',
                  border: selected ? '2px solid var(--gold)' : '1px solid var(--line)',
                  borderRadius: '6px',
                  padding: '0.6rem',
                  color: selected ? 'var(--gold)' : 'var(--text)',
                  cursor: isHost ? 'pointer' : 'default',
                  opacity: isHost || selected ? 1 : 0.5,
                }}
              >
                <div style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{DND_DIFFICULTY_LABEL[id]}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>怪物強度 {percent}%</div>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem', marginBottom: '2rem', opacity: myRole === 'boss' ? 0.35 : 1, pointerEvents: myRole === 'boss' ? 'none' : 'auto' }}>
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
            const isBoss = seat.dndRole === 'boss';
            return (
              <div key={seat.playerId} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: isBoss ? 'rgba(231, 76, 60, 0.12)' : 'rgba(255,255,255,0.03)', padding: '6px 12px', borderRadius: '20px', border: isBoss ? '1px solid var(--red)' : '1px solid var(--line)' }}>
                <span style={{ fontSize: '0.9rem' }}>{isBoss ? '👑' : '👤'}</span>
                <strong style={{ fontSize: '0.85rem' }}>{seat.nickname}</strong>
                <span style={{ color: 'var(--gold)', fontSize: '0.8rem' }}>[{isBoss ? '魔王' : classInfo.name.split(' ')[0]}]</span>
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