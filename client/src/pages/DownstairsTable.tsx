import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  DOWNSTAIRS_CHARACTERS,
  DOWNSTAIRS_FEVER_DURATION_MS,
  DOWNSTAIRS_FEVER_THRESHOLD,
  DOWNSTAIRS_SKILLS,
  PVE_BOSSES,
  PVE_BOSS_ATTACKS,
  PVE_ENEMIES,
  PVE_SCENES,
  downstairsComboSpeedMultiplier,
  type DownstairsCharacterId,
  type DownstairsGameView,
  type DownstairsPlatformKind,
  type PveEncounterState,
  type PveEnemyState,
  type RoomView,
  type TeamFeverState,
} from 'shared';
import { StartControls } from '../components/StartControls';
import { socket } from '../net/socket';
import { RoomShell } from './RoomShell';
import { hotkeyOf, isTyping, useSkin } from '../state/skinContext';
import '../features/downstairs/downstairs.css';

const REASON: Record<string, string> = {
  health: '生命用完了', ceiling: '被畫面頂端追上', fall: '跌出畫面', left: '離開遊戲',
};
const CHARACTER: Record<DownstairsCharacterId, { name: string; trait: string }> = {
  brave: { name: '小勇', trait: '勇敢紅圍巾' },
  bubble: { name: '泡泡', trait: '清爽藍帽子' },
  tangerine: { name: '阿橘', trait: '活力橘外套' },
  star: { name: '星仔', trait: '閃亮紫星帽' },
};
const ZONE_NAME = { garden: '苔芽庭園', workshop: '齒輪工坊', rooftop: '暴風屋頂', stars: '星光遺跡', boss: 'Boss 戰' } as const;
const EVENT_NAME = { golden: '金色十秒', springParty: '彈跳派對', rescue: '平台救援' } as const;
const EVENT_TIP = { golden: '追星拿額外回報', springParty: '善用彈跳快速換層', rescue: '單人安全平台正在進場' } as const;
const OBJECTIVE_COPY = {
  perfectLandings: { title: '精準落地', detail: '完成 Perfect', unit: '次' },
  riskyLandings: { title: '機關落地', detail: '自行選擇窄台或特殊平台', unit: '次' },
  stars: { title: '星星獵人', detail: '收集星星', unit: '顆' },
} as const;

export function DownstairsRoom({ room }: { room: RoomView }) {
  const game = room.game?.type === 'downstairs' ? room.game : null;
  const { hidden, prefs } = useSkin();

  useEffect(() => {
    const send = (direction: -1 | 0 | 1) => socket.emit('game:downstairs', { direction });
    const heldDirections = new Set<-1 | 1>();
    const directionOf = (event: KeyboardEvent): -1 | 0 | 1 => {
      if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') return -1;
      if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') return 1;
      return 0;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (!isTyping(event.target) && [prefs.hotkeyCycle, prefs.hotkeyBoss].includes(hotkeyOf(event))) { heldDirections.clear(); send(0); return; }
      if (document.querySelector('.boss-screen')) { heldDirections.clear(); send(0); return; }
      if (!isTyping(event.target) && (event.key === ' ' || event.key.toLowerCase() === 'e')) {
        event.preventDefault();
        socket.emit('game:downstairsSkill', {});
        return;
      }
      const direction = directionOf(event);
      if (direction !== 0) {
        event.preventDefault();
        heldDirections.add(direction);
        send(direction);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const direction = directionOf(event);
      if (direction === 0) return;
      heldDirections.delete(direction);
      send(heldDirections.has(1) ? 1 : heldDirections.has(-1) ? -1 : 0);
    };
    const release = () => { heldDirections.clear(); send(0); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', release);
    return () => {
      release();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', release);
    };
  }, [prefs.hotkeyBoss, prefs.hotkeyCycle]);

  useEffect(() => {
    if (hidden) socket.emit('game:downstairs', { direction: 0 });
  }, [hidden]);

  return (
    <RoomShell
      room={room}
      isMyTurn={false}
      center={game ? <DownstairsBoard initialGame={game} room={room} /> : <CharacterLobby room={room} />}
      footer={game ? <DownstairsControls initialGame={game} room={room} /> : <StartControls room={room} />}
    />
  );
}

function CharacterLobby({ room }: { room: RoomView }) {
  const mine = room.seats.find((seat) => seat.playerId === room.me.playerId)?.characterId ?? 'brave';
  return <div className="downstairs__waiting">
    <div className="downstairs__waiting-head">
      <span aria-hidden="true">🧒↡</span>
      <div><h2>選好角色，組隊挑戰深處</h2><p>踩擊小怪、破解場景機關並合作擊敗四個 Boss；Combo 個人累積，Team Fever 全隊共享。</p></div>
    </div>
    <div className="downstairs__characters" role="radiogroup" aria-label="選擇角色">
      {DOWNSTAIRS_CHARACTERS.map((id) => <button key={id} type="button" role="radio" aria-checked={mine === id} className={mine === id ? 'downstairs__character is-selected' : 'downstairs__character'} onClick={() => socket.emit('room:character', { characterId: id })}>
        <span className="downstairs__character-avatar" data-character={id} aria-hidden="true"><i>•ᴗ•</i></span>
        <strong>{CHARACTER[id].name}</strong><small>{CHARACTER[id].trait} · {DOWNSTAIRS_SKILLS[id].name}</small>
        <em>{mine === id ? '已選擇' : '選擇'}</em>
      </button>)}
    </div>
    <div className="downstairs__party"><h3>探險隊伍</h3>{room.seats.map((seat) => <div key={seat.playerId}><span className="downstairs__party-avatar" data-character={seat.characterId}>•ᴗ•</span><strong>{seat.nickname}{seat.playerId === room.me.playerId ? '（你）' : ''}</strong><span>{(CHARACTER[seat.characterId as keyof typeof CHARACTER] ?? CHARACTER.brave).name}</span><span className={seat.ready || seat.isHost ? 'tag tag--ready' : 'tag'}>{seat.ready || seat.isHost ? '已準備' : '等待中'}</span></div>)}</div>
    <div className="downstairs__legend"><span>▬ 安全</span><span>↟ 彈跳</span><span>▼ 踩擊</span><span>◆ Boss 機關</span></div>
  </div>;
}

function useLiveGame(initialGame: DownstairsGameView): DownstairsGameView {
  const [game, setGame] = useState(initialGame);
  useEffect(() => {
    setGame(initialGame);
    const receive = (next: DownstairsGameView) => setGame(next);
    socket.on('game:downstairsState', receive);
    return () => { socket.off('game:downstairsState', receive); };
  }, [initialGame]);
  return game;
}

function DownstairsControls({ initialGame, room }: { initialGame: DownstairsGameView; room: RoomView }) {
  const game = useLiveGame(initialGame);
  const pointers = useRef(new Map<number, -1 | 1>());
  const me = game.players[room.me.playerId];
  const skill = me ? DOWNSTAIRS_SKILLS[me.characterId] : null;
  const cooldown = me ? Math.ceil(me.skillCooldownMs / 1000) : 0;
  const emitPointers = () => socket.emit('game:downstairs', { direction: pointers.current.size ? Array.from(pointers.current.values()).at(-1)! : 0 });
  const press = (direction: -1 | 1) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, direction);
    emitPointers();
  };
  const release = (event: ReactPointerEvent<HTMLButtonElement>) => {
    pointers.current.delete(event.pointerId);
    emitPointers();
  };
  useEffect(() => () => { pointers.current.clear(); socket.emit('game:downstairs', { direction: 0 }); }, []);
  return <div className="downstairs__room-footer">
    <button type="button" className="btn downstairs__direction" disabled={!me?.alive} onPointerDown={press(-1)} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}>← 向左</button>
    <span>{me?.alive ? game.pve
      ? `生命 ${me.health} · 世界 ${Math.floor(game.pve.progression.worldDepthM)}m · 貢獻 ${me.depth} · Combo ${me.combo}`
      : `生命 ${me.health} · 深度 ${me.depth}m · Combo ${me.combo} · ★ ${me.stars % 3}/3${me.comboShield ? ' · 護符' : ''}`
      : REASON[me?.endReason ?? ''] ?? '觀戰中'}</span>
    <button type="button" className="btn downstairs__skill" disabled={!me?.alive || cooldown > 0} aria-label={skill?.name ?? '角色技能'} onClick={() => socket.emit('game:downstairsSkill', {})}>
      <strong>{me?.skillActiveMs ? '技能生效中' : skill?.name ?? '技能'}</strong>
      <small>{cooldown > 0 ? `${cooldown}s` : 'Space / E'}</small>
    </button>
    <button type="button" className="btn downstairs__direction" disabled={!me?.alive} onPointerDown={press(1)} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}>向右 →</button>
    {game.over && room.hostId === room.me.playerId && <StartControls room={room} />}
  </div>;
}

function DownstairsBoard({ initialGame, room }: { initialGame: DownstairsGameView; room: RoomView }) {
  const game = useLiveGame(initialGame);
  return <DownstairsBoardContent game={game} room={room} />;
}

export function DownstairsBoardContent({ game, room }: { game: DownstairsGameView; room: Pick<RoomView, 'me' | 'seats' | 'hostId'> }) {
  const [muted, setMuted] = useState(() => localStorage.getItem('downstairs.muted') === 'true');
  const feedbackSeen = useRef(game.feedbackSequence);
  const [platformTip, setPlatformTip] = useState<string | null>(null);
  const meId = room.me.playerId;
  const me = game.players[meId];
  const feverSeen = useRef(me?.feverSequence ?? 0);
  const landingSeen = useRef(me?.landingSequence ?? 0);
  const objectiveSeen = useRef(me?.objectiveSequence ?? 0);
  const nicknameOf = (playerId: string) => room.seats.find((seat) => seat.playerId === playerId)?.nickname ?? playerId.slice(0, 6);
  const players = Object.values(game.players);
  const pve = game.pve;
  const sharedFever = pve?.teamFever.phase === 'active';
  const teamFeverSeen = useRef(pve?.teamFever.sequence ?? 0);
  const bossSequenceSeen = useRef(pve?.encounter?.sequence ?? 0);
  useEffect(() => {
    if (game.feedbackSequence === feedbackSeen.current) return;
    feedbackSeen.current = game.feedbackSequence;
    const event = game.feedbackEvent;
    if (!event) return;
    if ((event === 'hurt' || event === 'spring') && navigator.vibrate) navigator.vibrate(event === 'hurt' ? 45 : 25);
    if (muted) return;
    const AudioCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    const context = new AudioCtor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const frequencies = { land: 180, spring: 420, hurt: 95, star: 660, skill: 520, eliminated: 75, bossWarning: 130, bossAttack: 105, bossClear: 740 } as const;
    oscillator.frequency.value = frequencies[event];
    oscillator.type = event === 'hurt' || event === 'bossAttack' ? 'sawtooth' : 'sine';
    gain.gain.setValueAtTime(.055, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .12);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(); oscillator.stop(context.currentTime + .13);
    oscillator.onended = () => void context.close();
  }, [game.feedbackEvent, game.feedbackSequence, muted]);
  useEffect(() => {
    if (pve) return;
    if (!me || me.feverSequence === feverSeen.current) return;
    feverSeen.current = me.feverSequence;
    if (me.feverResult === 'start' && navigator.vibrate) navigator.vibrate([30, 30, 55]);
    if (muted || !me.feverResult) return;
    const AudioCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    const context = new AudioCtor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = me.feverResult === 'start' ? 880 : me.feverResult === 'break' ? 120 : 620;
    oscillator.type = me.feverResult === 'break' ? 'sawtooth' : 'triangle';
    gain.gain.setValueAtTime(.07, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .22);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(); oscillator.stop(context.currentTime + .23);
    oscillator.onended = () => void context.close();
  }, [me, muted, pve]);
  useEffect(() => {
    const sequence = pve?.teamFever.sequence ?? 0;
    if (!pve || sequence === teamFeverSeen.current) return;
    teamFeverSeen.current = sequence;
    if (navigator.vibrate) navigator.vibrate([30, 30, 55]);
    if (muted) return;
    const AudioCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    const context = new AudioCtor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 880;
    oscillator.type = 'triangle';
    gain.gain.setValueAtTime(.07, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .25);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(); oscillator.stop(context.currentTime + .26);
    oscillator.onended = () => void context.close();
  }, [muted, pve]);
  useEffect(() => {
    if (!me || me.landingSequence === landingSeen.current) return;
    landingSeen.current = me.landingSequence;
    if (!me.landingGrade) return;
    if (me.landingGrade === 'perfect' && navigator.vibrate) navigator.vibrate(24);
    if (muted) return;
    const AudioCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    const context = new AudioCtor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = me.landingGrade === 'perfect' ? 760 : me.landingGrade === 'good' ? 480 : 260;
    oscillator.type = me.landingGrade === 'perfect' ? 'triangle' : 'sine';
    gain.gain.setValueAtTime(.045, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .1);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(); oscillator.stop(context.currentTime + .11);
    oscillator.onended = () => void context.close();
  }, [me, muted]);
  useEffect(() => {
    const encounter = pve?.encounter;
    if (!encounter || encounter.sequence === bossSequenceSeen.current) return;
    bossSequenceSeen.current = encounter.sequence;
    const emphasis = encounter.phase === 'defeat' ? 'defeat' : encounter.phase === 'staggered' ? 'stagger'
      : encounter.feedback === 'weakPointHit' ? 'hit' : null;
    if (!emphasis) return;
    if (navigator.vibrate) navigator.vibrate(emphasis === 'defeat' ? [45, 35, 70] : emphasis === 'stagger' ? [35, 25, 35] : 24);
    if (muted) return;
    const AudioCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    const context = new AudioCtor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = emphasis === 'defeat' ? 780 : emphasis === 'stagger' ? 145 : 540;
    oscillator.type = emphasis === 'defeat' ? 'triangle' : emphasis === 'stagger' ? 'sawtooth' : 'sine';
    gain.gain.setValueAtTime(.06, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .22);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(); oscillator.stop(context.currentTime + .23);
    oscillator.onended = () => void context.close();
  }, [muted, pve?.encounter]);
  useEffect(() => {
    if (!me || me.objectiveSequence === objectiveSeen.current) return;
    objectiveSeen.current = me.objectiveSequence;
    if (navigator.vibrate) navigator.vibrate([22, 25, 35]);
    if (muted) return;
    const AudioCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    const context = new AudioCtor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 820;
    oscillator.type = 'triangle';
    gain.gain.setValueAtTime(.055, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .18);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(); oscillator.stop(context.currentTime + .19);
    oscillator.onended = () => void context.close();
  }, [me, muted]);
  useEffect(() => {
    const tip = game.platforms.map((platform) => platform.kind).find((kind) => ['moving', 'fragile', 'conveyorLeft', 'conveyorRight', 'bossSwitch'].includes(kind));
    if (!tip) return;
    const key = `downstairs.tip.${tip}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
    const tips: Partial<Record<DownstairsPlatformKind, string>> = { moving: '移動台：預判滑軌位置', fragile: '脆弱台：落地後會碎裂', conveyorLeft: '輸送帶：反向操作可抵抗', conveyorRight: '輸送帶：反向操作可抵抗', bossSwitch: '發光開關：踩下造成 Boss 2 格傷害' };
    setPlatformTip(tips[tip] ?? null);
    const timer = window.setTimeout(() => setPlatformTip(null), 2800);
    return () => window.clearTimeout(timer);
  }, [game.platforms]);
  const upcomingZone = pve
    ? pve.progression.phase === 'bossWarning' ? `Boss 即將登場：${pve.encounter ? PVE_BOSSES[pve.encounter.bossId].counterTip : '注意場景機關'}` : null
    : game.elapsedMs >= 57_000 && game.elapsedMs < 60_000 ? 'Boss：踩下發光開關' : game.elapsedMs >= 42_000 && game.elapsedMs < 45_000 ? '下一區：風車屋頂 · 小心輸送帶' : game.elapsedMs >= 17_000 && game.elapsedMs < 20_000 ? '下一區：彈跳工坊 · 預判移動台' : null;
  const sceneClass = pve?.progression.sceneId === 'ruins' || pve?.progression.sceneId === 'rift' ? 'stars' : pve?.progression.sceneId ?? game.zone;
  return (
    <div className="downstairs__official">
      <div className="downstairs__scorebar">
        <strong>{pve ? `${Math.floor(pve.progression.worldDepthM)}m` : `${(game.elapsedMs / 1000).toFixed(1)}s`}</strong>
        <span>{pve ? PVE_SCENES[pve.progression.sceneId].name : ZONE_NAME[game.zone]}{game.event ? ` · ${EVENT_NAME[game.event]}` : ''}</span>
        <span>{players.filter((player) => player.alive).length} 人存活</span>
        <button type="button" className="downstairs__mute-live" aria-pressed={muted} onClick={() => setMuted((value) => { localStorage.setItem('downstairs.muted', String(!value)); return !value; })}>{muted ? '🔇' : '🔊'}</button>
      </div>
      <div data-fever={sharedFever || me?.feverRemainingMs ? true : undefined} data-me-hurt={me?.invulnerableMs && me.feverResult !== 'break' ? true : undefined} data-pve-impact={pve?.encounter?.phase === 'staggered' || pve?.encounter?.attackPhase === 'impact' || undefined} data-pve-defeat={pve?.encounter?.phase === 'defeat' || undefined} className={`downstairs__playfield downstairs__playfield--${sceneClass}`}>
        <div className="downstairs__sky downstairs__sky--far" />
        <div className="downstairs__sky downstairs__sky--near" />
        <div className="downstairs__danger downstairs__danger--top">▲ 小心頂端</div>
        {game.event && <EventHud event={game.event} remainingMs={game.eventRemainingMs} />}
        {(upcomingZone || platformTip) && <div className="downstairs__notice" role="status">{platformTip ?? upcomingZone}</div>}
        {pve && <TeamFeverHud fever={pve.teamFever} players={players} nicknameOf={nicknameOf} />}
        {me?.alive && <ComboHud player={me} teamFever={pve?.teamFever} />}
        {me?.alive && game.objective && <ObjectiveHud objective={game.objective} player={me} />}
        {sharedFever || me?.feverRemainingMs ? <div className="downstairs__fever-scene" aria-hidden="true"><i /><i /><i /><i /><i /></div> : null}
        {sharedFever && pve?.teamFever.remainingMs > 4_350 ? <div className="downstairs__fever-announcement is-start" role="status">TEAM FEVER!</div> : me?.feverFeedbackMs ? <div className={`downstairs__fever-announcement is-${me.feverResult}`} role="status">{me.feverResult === 'start' ? 'FEVER!' : me.feverResult === 'break' ? 'FEVER BREAK' : 'FEVER COMPLETE'}</div> : null}
        {me?.invulnerableMs && me.feverResult !== 'break' ? <div className="downstairs__damage-flash" role="alert">受傷！ -1 ♥</div> : null}
        {game.platforms.map((platform) => <Platform key={platform.id} platform={platform} boss={game.boss} encounter={pve?.encounter ?? null} elapsedMs={game.elapsedMs} impact={players.some((player) => player.lastPlatformId === platform.id && player.landingEffectMs > 0)} />)}
        {pve?.enemies.map((enemy) => <PveEnemy key={enemy.id} enemy={enemy} />)}
        {game.stars.filter((star) => !star.collectedBy.includes(meId)).map((star) => <span key={star.id} className="downstairs__collectible-star" style={{ left: `${star.x / 3.6}%`, top: `${star.y / 6.4}%` }} aria-label="可收集星星">★</span>)}
        {players.map((player) => player.alive && (
          <div key={player.playerId} data-character={player.characterId} data-fever={sharedFever || player.feverRemainingMs > 0 || undefined} data-fever-break={player.feverResult === 'break' && player.feverFeedbackMs > 0 || undefined} data-hurt={player.invulnerableMs > 0 && player.feverResult !== 'break' || undefined} data-skill-active={player.skillActiveMs > 0 || undefined} data-ceiling-danger={player.ceilingDangerMs > 0 || undefined} className={`downstairs__player ${player.playerId === meId ? 'downstairs__player--me' : ''}`} style={{ left: `${player.x / 3.6}%`, top: `${player.y / 6.4}%`, transform: `scaleX(${player.facing})` }}>
            <span className="downstairs__player-status" aria-label={`${nicknameOf(player.playerId)}，剩餘 ${player.health} 點生命`} style={{ transform: `translateX(-50%) scaleX(${player.facing})` }}>
              <b>{nicknameOf(player.playerId)}</b>{(sharedFever || player.feverRemainingMs > 0) && <em>{sharedFever ? 'TEAM' : 'FEVER'}</em>}<i>{player.ceilingDangerMs > 0 ? '⚠ 頂端' : '♥'.repeat(player.health)}</i>
            </span>
            {player.landingEffectMs > 0 && player.lastLandingKind !== 'normal' && <span className={`downstairs__platform-effect downstairs__platform-effect--${player.lastLandingKind}`} style={{ transform: `translateX(-50%) scaleX(${player.facing})` }} aria-live="polite">
              {player.lastLandingKind === 'spring' ? '↟ 彈跳！' : '▲ 尖刺！'}
            </span>}
            {player.starFeedbackMs > 0 && <span className="downstairs__star-feedback" style={{ transform: `translateX(-50%) scaleX(${player.facing})` }} aria-live="polite">{player.starReward === 'shield' ? '★ Combo 護符！' : player.starReward === 'heal' ? '★ 生命 +1！' : player.starReward === 'bonus' ? '★ 深度 +30！' : '★ +5m'}</span>}
            {player.landingGradeMs > 0 && player.landingGrade && <span data-grade={player.landingGrade} className="downstairs__landing-grade" style={{ transform: `translateX(-50%) scaleX(${player.facing})` }} aria-live={player.playerId === meId ? 'polite' : undefined}>{player.landingGrade.toUpperCase()}</span>}
            {(sharedFever || player.feverRemainingMs > 0) && <span className="downstairs__fever-aura" aria-hidden="true"><i /><i /><i /></span>}
            <span className="downstairs__player-face" aria-hidden="true">{player.feverResult === 'break' && player.feverFeedbackMs > 0 ? '✦﹏✦' : player.invulnerableMs > 0 ? '×﹏×' : player.playerId === meId ? '•ᴗ•' : '•‿•'}</span>
          </div>
        ))}
        <div className="downstairs__danger downstairs__danger--bottom">▼ 不要掉下去</div>
        {pve?.encounter ? <><PveBossAttackFx encounter={pve.encounter} /><PveBossAvatar encounter={pve.encounter} /><PveBossHud encounter={pve.encounter} />{pve.encounter.phase === 'defeat' && <div className="downstairs__pve-victory" role="status"><strong>區域守衛擊破！</strong><span>星光開路，準備前往下一區</span></div>}</> : game.boss && <><BossAvatar boss={game.boss} /><BossHud boss={game.boss} /></>}
        {game.boss?.phase === 'active' && <div className={`downstairs__boss-fx downstairs__boss-fx--${game.boss.attack}`} data-direction={game.boss.gustDirection}>{game.boss.attack === 'fallingRock' ? <><i /><i /><i /></> : null}</div>}
        {!game.over && !game.players[meId]?.alive && <div className="downstairs__spectating" role="status"><strong>觀戰中</strong><span>{REASON[game.players[meId]?.endReason ?? '']} · {game.players[meId]?.depth ?? 0}m · {((game.players[meId]?.survivedMs ?? 0) / 1000).toFixed(1)}s</span></div>}
        {game.over && <div className="downstairs__overlay downstairs__overlay--result"><span className="downstairs__mascot">🏁</span><h2>本局結束</h2>{pve ? <><strong>全隊深入 {Math.floor(pve.progression.worldDepthM)}m · 擊敗 {pve.progression.defeatedBosses} Boss</strong><ol>{game.ranking.map((id) => { const contribution = pve.contributions[id]; return <li key={id}>{nicknameOf(id)} · Combo {contribution?.highestCombo ?? 0} · 擊破 {contribution?.defeats ?? 0} · 助攻 {contribution?.assists ?? 0} · Boss 傷害 {contribution?.bossDamage ?? 0}</li>; })}</ol></> : <ol>{game.ranking.map((id, index) => { const player = game.players[id]; return <li key={id}>#{index + 1} {nicknameOf(id)} · {player?.depth ?? 0}m · {((player?.survivedMs ?? 0) / 1000).toFixed(1)}s · {REASON[player?.endReason ?? ''] ?? '完成'}</li>; })}</ol>}<small>{room.hostId === meId ? '可使用下方按鈕再來一局' : '等待房主再開一局'}</small></div>}
      </div>
    </div>
  );
}

function TeamFeverHud({ fever, players, nicknameOf }: { fever: TeamFeverState; players: Array<DownstairsGameView['players'][string]>; nicknameOf: (playerId: string) => string }) {
  const active = fever.phase === 'active';
  const readyPlayers = players.filter((player) => player.alive && player.combo >= 24);
  const expanded = active || readyPlayers.length > 0 || fever.phase === 'cooldown';
  const guardCount = Object.values(fever.perPlayerGuardUsed).filter((used) => !used).length;
  const progress = active ? fever.remainingMs / 5_000 * 100 : fever.phase === 'cooldown' ? (1 - fever.cooldownMs / 4_000) * 100 : Math.max(0, ...readyPlayers.map((player) => player.combo / 30 * 100));
  return <div className={`downstairs__team-fever is-${fever.phase}${expanded ? ' is-expanded' : ''}`} aria-live="polite" aria-label={active ? `Team Fever 剩餘 ${(fever.remainingMs / 1000).toFixed(1)} 秒，剩餘 ${guardCount} 次個人防護` : fever.phase === 'cooldown' ? `Team Fever 冷卻 ${(fever.cooldownMs / 1000).toFixed(1)} 秒` : 'Team Fever 能量'}>
    {expanded && <div><strong>{active ? `TEAM FEVER ${(fever.remainingMs / 1000).toFixed(1)}s` : fever.phase === 'cooldown' ? `TEAM FEVER 冷卻 ${(fever.cooldownMs / 1000).toFixed(1)}s` : 'TEAM FEVER'}</strong><span>{active ? `${nicknameOf(fever.sourcePlayerId ?? '')} 觸發 · ↔ +35% · ◆×${guardCount}` : readyPlayers.map((player) => `${nicknameOf(player.playerId)} ×${player.combo}`).join(' · ')}</span></div>}
    <i><b style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} /></i>
  </div>;
}

function ComboHud({ player, teamFever }: { player: DownstairsGameView['players'][string]; teamFever?: TeamFeverState }) {
  const shared = teamFever?.phase === 'active';
  const fever = !teamFever && player.feverRemainingMs > 0;
  const bonus = shared ? 35 : Math.round((downstairsComboSpeedMultiplier(player.combo, fever) - 1) * 100);
  const tier = fever ? player.feverRemainingMs <= 1_000 ? 'ending' : player.feverRemainingMs <= 2_000 ? 'warning' : 'fever' : player.combo >= 15 ? 'hot' : player.combo >= 5 ? 'warm' : 'base';
  const progress = fever ? player.feverRemainingMs / DOWNSTAIRS_FEVER_DURATION_MS * 100 : player.combo / DOWNSTAIRS_FEVER_THRESHOLD * 100;
  return <div className={`downstairs__combo-live is-${tier}`} aria-live="polite" aria-label={shared ? `我的 Combo ${player.combo}，Team Fever 移動控制增加 35%` : fever ? `Fever 剩餘 ${(player.feverRemainingMs / 1000).toFixed(1)} 秒，移動速度增加 45%${player.feverGuard ? '，具有一次傷害防護' : ''}` : `Combo ${player.combo}，移動速度增加 ${bonus}%${player.comboShield ? '，具有 Combo 保護' : ''}`}>
    <div><strong>{fever ? `FEVER ${(player.feverRemainingMs / 1000).toFixed(1)}s` : `COMBO ×${player.combo}`}</strong><b>速度 +{bonus}%</b>{fever ? player.feverGuard && <i>◆ 1 HIT</i> : player.comboShield && <i>◆ 保護</i>}</div>
    <span><i style={{ width: `${Math.min(100, progress)}%` }} /></span>
    {shared ? <small>TEAM FEVER：落地 +10m · 踩擊 +1</small> : fever ? <small>安全落地 +10m</small> : player.combo >= 24 ? <small>再 {DOWNSTAIRS_FEVER_THRESHOLD - player.combo} 次觸發全隊 FEVER</small> : player.combo >= 10 ? <small>↔ 高速制動強化</small> : null}
  </div>;
}

function EventHud({ event, remainingMs }: { event: NonNullable<DownstairsGameView['event']>; remainingMs: number }) {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1_000));
  return <div className={`downstairs__event-live is-${event}`} role="status" aria-label={`${EVENT_NAME[event]}，剩餘 ${seconds} 秒。${EVENT_TIP[event]}`}>
    <div><strong>{EVENT_NAME[event]}</strong><b>{seconds}s</b></div>
    <span>{EVENT_TIP[event]}</span>
    <i aria-hidden="true" style={{ width: `${Math.max(0, Math.min(100, remainingMs / 100))}%` }} />
  </div>;
}

function ObjectiveHud({ objective, player }: { objective: NonNullable<DownstairsGameView['objective']>; player: DownstairsGameView['players'][string] }) {
  const copy = OBJECTIVE_COPY[objective.kind];
  const reward = objective.reward === 'cooldown' ? `技能冷卻 -${objective.rewardAmount / 1_000}s` : `Combo +${objective.rewardAmount}`;
  const progress = Math.min(objective.target, player.objectiveProgress);
  return <div className="downstairs__objective-live" data-complete={player.objectiveCompleted || undefined} data-feedback={player.objectiveFeedbackMs > 0 || undefined} aria-live={player.objectiveFeedbackMs > 0 ? 'polite' : 'off'} aria-label={`${copy.title}，${progress}/${objective.target} ${copy.unit}，獎勵 ${reward}${player.objectiveCompleted ? '，已完成' : ''}`}>
    <div><strong>{player.objectiveCompleted ? '✓ 微目標完成' : `微目標 · ${copy.title}`}</strong><b>{progress}/{objective.target}</b></div>
    <span>{player.objectiveCompleted ? reward : `${copy.detail} ${objective.target} ${copy.unit}`}</span>
    <i aria-hidden="true"><b style={{ width: `${progress / objective.target * 100}%` }} /></i>
  </div>;
}

function Platform({ platform, boss, encounter, elapsedMs, impact }: { platform: DownstairsGameView['platforms'][number]; boss: DownstairsGameView['boss']; encounter: PveEncounterState | null; elapsedMs: number; impact: boolean }) {
  const detail = platform;
  const bossTarget = boss?.phase === 'active' && boss.targetPlatformId === platform.id || encounter?.phase === 'active' && encounter.targetPlatformId === platform.id;
  const bossBreaking = bossTarget && (boss?.attack === 'stomp' || ['shellStomp', 'phasePlatform', 'handClap'].includes(encounter?.attack ?? ''));
  const fragileStage = detail.fragileMs === undefined ? undefined : detail.fragileMs > 800 ? 'hairline' : detail.fragileMs > 400 ? 'split' : 'critical';
  const motionDirection = platform.kind === 'moving' ? (Math.cos((elapsedMs + platform.id * 370) / 900) >= 0 ? 1 : -1) : platform.kind === 'conveyorLeft' ? -1 : platform.kind === 'conveyorRight' ? 1 : undefined;
  // 新版彈簧已有線圈與壓縮動畫，舊版文字箭頭會疊成黑色線條，因此不再重複繪製。
  const mechanismLabels = ['①', '②', '③'];
  const label = detail.isStart ? '★' : detail.pveRole === 'bossWeakPoint' ? '✦' : platform.kind === 'spring' ? '' : platform.kind === 'spike' ? '▲▲▲' : platform.kind === 'moving' ? '↔' : platform.kind === 'fragile' ? '⌁' : platform.kind === 'conveyorLeft' ? '‹‹‹' : platform.kind === 'conveyorRight' ? '›››' : platform.kind === 'bossSwitch' ? (detail.switchUsed ? '◇' : mechanismLabels[detail.pveMechanismIndex ?? -1] ?? '◆') : '';
  return <div data-start={detail.isStart || undefined} data-pve-role={detail.pveRole} data-pve-mechanism={detail.pveMechanismIndex} data-pattern={detail.pattern} data-accent={detail.accent} data-impact={impact || undefined} data-cracking={detail.fragileMs !== undefined || undefined} data-fragile-stage={fragileStage} data-broken={detail.brokenMs !== undefined || undefined} data-used={detail.switchUsed || undefined} data-motion-direction={motionDirection} data-boss-target={bossTarget || undefined} data-boss-breaking={bossBreaking || undefined} className={`downstairs__platform downstairs__platform--${platform.kind}`} style={{ left: `${platform.x / 3.6}%`, top: `${platform.y / 6.4}%`, width: `${platform.width / 3.6}%` }}>
    <i className="downstairs__platform-motion" aria-hidden="true" />
    <i className="downstairs__platform-pattern" aria-hidden="true" />
    <i className="downstairs__platform-fixture" aria-hidden="true" />
    <i className="downstairs__platform-rollers" aria-hidden="true"><b /><b /></i>
    <i className="downstairs__platform-debris" aria-hidden="true"><b /><b /><b /></i>
    <span className="downstairs__platform-label">{bossBreaking && !detail.brokenMs ? '⚠ ' : ''}{label}</span>
  </div>;
}

function PveEnemy({ enemy }: { enemy: PveEnemyState }) {
  const content = PVE_ENEMIES[enemy.type];
  const entryIcon = { platformWake: '!', edgeLeap: enemy.entryDirection < 0 ? '↘' : '↙', ceilingDrop: '↓', portalPop: '◎' }[enemy.entry];
  const showHp = content.elite || enemy.hp < enemy.maxHp;
  const phaseCopy = enemy.phase === 'cue' ? '場景出現徵兆' : enemy.phase === 'telegraph' ? `將在 ${(enemy.phaseRemainingMs / 1000).toFixed(1)} 秒後進場` : enemy.phase === 'settling' ? '落地準備中，尚無傷害' : enemy.phase === 'active' ? '可從上方踩擊' : enemy.phase;
  return <div className={`downstairs__enemy is-${enemy.phase} is-${enemy.type}`} data-entry={enemy.entry} data-card={enemy.card} data-entry-direction={enemy.entryDirection} style={{ left: `${enemy.x / 3.6}%`, top: `${enemy.y / 6.4}%` }} aria-label={`${content.name}，${phaseCopy}`}>
    {enemy.phase === 'cue' ? <span className="downstairs__enemy-cue"><i />{entryIcon}</span> : enemy.phase === 'telegraph' ? <><span className="downstairs__enemy-entry"><b aria-hidden="true" />{entryIcon}<small>{(enemy.phaseRemainingMs / 1000).toFixed(1)}</small></span><i className="downstairs__enemy-telegraph" /></> : <>
      <span className="downstairs__enemy-body"><i /><b /></span>
      {enemy.phase === 'settling' && <span className="downstairs__enemy-ready">!</span>}
      {enemy.markedMs > 0 && <em className="downstairs__enemy-mark">✦</em>}
      {showHp && <span className="downstairs__enemy-hp">{Array.from({ length: enemy.maxHp }, (_, index) => <i key={index} data-full={index < enemy.hp || undefined} />)}</span>}
    </>}
  </div>;
}

function PveBossFigure({ encounter }: { encounter: PveEncounterState }) {
  if (encounter.bossId === 'budshield') return <svg viewBox="0 0 180 130" role="img" aria-label="苔甲巨龜芽盾完整造型">
    <g className="pve-boss__rig pve-boss__rig--turtle">
      <g className="pve-boss__leg pve-boss__leg--rear"><ellipse cx="43" cy="104" rx="25" ry="13" /></g><g className="pve-boss__leg pve-boss__leg--front"><ellipse cx="128" cy="104" rx="25" ry="13" /></g>
      <ellipse className="pve-boss__shell" cx="86" cy="70" rx="61" ry="45" /><path className="pve-boss__shell-mark" d="M40 67h92M57 36l12 65M91 27v82m30-69-13 65" />
      <g className="pve-boss__head"><ellipse cx="146" cy="72" rx="28" ry="25" /><circle cx="155" cy="66" r="5" /><path d="m163 79 12 4-13 5" /></g>
      <g className="pve-boss__weak"><path d="M82 28q-9-21 5-25 13 8 2 25M87 11q18-9 24 2-7 14-23 12" /><circle cx="87" cy="29" r="8" /></g>
    </g>
  </svg>;
  if (encounter.bossId === 'clangclang') return <svg viewBox="0 0 180 150" role="img" aria-label="發條巨像鏘鏘完整造型">
    <g className="pve-boss__rig pve-boss__rig--clockwork">
      <g className="pve-boss__arm pve-boss__arm--left"><circle cx="50" cy="54" r="10" /><rect x="21" y="51" width="34" height="16" rx="8" /><circle cx="20" cy="59" r="12" /></g>
      <g className="pve-boss__arm pve-boss__arm--right"><circle cx="130" cy="54" r="10" /><rect x="126" y="51" width="34" height="16" rx="8" /><circle cx="160" cy="59" r="12" /></g>
      <rect className="pve-boss__body" x="53" y="41" width="74" height="78" rx="17" /><rect className="pve-boss__head" x="64" y="13" width="52" height="39" rx="12" /><circle cx="79" cy="31" r="5" /><circle cx="101" cy="31" r="5" />
      <g className="pve-boss__weak"><circle cx="90" cy="78" r="22" /><path d="M90 60v36M72 78h36m-31-13 26 26m0-26-26 26" /></g>
      <g className="pve-boss__legs"><rect x="61" y="111" width="24" height="29" rx="8" /><rect x="96" y="111" width="24" height="29" rx="8" /></g>
    </g>
  </svg>;
  if (encounter.bossId === 'rumble') return <svg viewBox="0 0 190 135" role="img" aria-label="雷雲鯨轟隆完整造型">
    <g className="pve-boss__rig pve-boss__rig--whale">
      <path className="pve-boss__tail" d="M31 69Q3 46 8 26q26 6 35 27Q25 17 42 5q20 19 6 51" /><ellipse className="pve-boss__body" cx="105" cy="65" rx="68" ry="43" />
      <path className="pve-boss__fin pve-boss__fin--left" d="M87 76q-34 37-45 12 20-25 47-28" /><path className="pve-boss__fin pve-boss__fin--right" d="M122 77q31 36 43 9-19-23-42-27" />
      <circle cx="135" cy="55" r="6" /><path d="M153 66q10 8 20 0" /><path className="pve-boss__cloud" d="M63 101q5-18 23-11 12-20 29-5 22-5 24 17Z" />
      <g className="pve-boss__weak"><path d="m100 7-12 24h16l-9 25 29-34h-17l12-15Z" /></g>
    </g>
  </svg>;
  return <svg viewBox="0 0 190 150" role="img" aria-label="吞星龍夜曜完整造型">
    <g className="pve-boss__rig pve-boss__rig--dragon">
      <path className="pve-boss__wing pve-boss__wing--left" d="M78 63Q27 19 16 68l42-8-27 38 52-17Z" /><path className="pve-boss__wing pve-boss__wing--right" d="M111 63q51-44 62 5l-42-8 27 38-52-17Z" />
      <path className="pve-boss__tail" d="M104 112q46 26 63-2-9 32-42 31l-25-18" /><ellipse className="pve-boss__body" cx="95" cy="91" rx="42" ry="48" />
      <g className="pve-boss__head"><path d="M61 44q7-32 34-29 28-4 36 29l-13 28H73Z" /><path d="m72 24-9-20 22 15m33 5 10-20-23 15" /><circle cx="82" cy="43" r="5" /><circle cx="108" cy="43" r="5" /></g>
      <g className="pve-boss__claws"><path d="m66 113-17 24 24-9m49-15 17 24-24-9" /></g><g className="pve-boss__weak"><path d="m95 67 8 16 18 3-13 13 3 18-16-8-16 8 3-18-13-13 18-3Z" /></g>
    </g>
  </svg>;
}

function PveBossAvatar({ encounter }: { encounter: PveEncounterState }) {
  return <div className={`downstairs__pve-boss is-${encounter.bossId} is-${encounter.phase} is-${encounter.attackPhase}`} data-act={encounter.act} data-attack={encounter.attack} data-weak={encounter.weakPoint === 'exposed' || undefined}>
    <PveBossFigure encounter={encounter} />
    {encounter.phase === 'warning' && <span>Boss 登場</span>}
  </div>;
}

function PveBossHud({ encounter }: { encounter: PveEncounterState }) {
  const content = PVE_BOSSES[encounter.bossId];
  const percent = encounter.hp / encounter.maxHp * 100;
  const attack = PVE_BOSS_ATTACKS[encounter.attack] ?? { name: encounter.attack, warning: content.counterTip };
  const actCopy = { teach: '教學幕', mix: '混合幕', finale: '決戰幕' }[encounter.act];
  const stateCopy = encounter.attackPhase === 'telegraph' ? '預告' : encounter.attackPhase === 'impact' ? '閃避' : '反擊';
  const feedbackCopy = encounter.feedback === 'wrongOrder' ? '順序錯誤，機關退回一步' : encounter.feedback === 'alreadyHit' ? '本輪已命中' : encounter.feedback === 'damageCap' ? '本輪傷害已滿' : encounter.feedback === 'weakPointHit' ? '命中弱點！' : encounter.feedback === 'weakPointReady' ? '弱點已開啟！' : null;
  const phaseCopy = encounter.phase === 'warning' ? `登場 ${(encounter.attackRemainingMs / 1000).toFixed(1)}s` : encounter.phase === 'defeat' ? '擊敗！' : encounter.phase === 'staggered' ? '失衡！把握喘息時間' : encounter.weakPoint === 'exposed' ? `反擊 · 弱點 ${(encounter.weakPointRemainingMs / 1000).toFixed(1)}s` : `${stateCopy} · ${attack.name}`;
  const nextStep = encounter.mechanicOrder[encounter.mechanicProgress];
  return <div className={`downstairs__pve-boss-hud is-${encounter.phase}`} data-feedback={encounter.feedback || undefined}>
    <div><strong>{content.name}</strong><em>{actCopy}</em><span>{feedbackCopy ?? phaseCopy}</span><b>{encounter.hp}/{encounter.maxHp}</b></div>
    <i className="downstairs__pve-boss-health" aria-label={`Boss 生命 ${encounter.hp}/${encounter.maxHp}`}><b style={{ width: `${Math.max(0, percent)}%` }} /></i>
    <small>{encounter.weakPoint === 'locked' ? `${attack.warning} · ${content.counterTip} ${encounter.mechanicProgress}/${encounter.mechanicTarget}${nextStep !== undefined && (encounter.bossId === 'clangclang' || encounter.bossId === 'nightglow') ? ` · 下一個 ${nextStep + 1}` : ''}` : '弱點已暴露：從上方踩擊發光平台'}</small>
  </div>;
}

function PveBossAttackFx({ encounter }: { encounter: PveEncounterState }) {
  if (encounter.phase === 'warning' || encounter.phase === 'defeat') return null;
  return <div className={`downstairs__pve-attack-fx is-${encounter.attackPhase}`} data-attack={encounter.attack} data-direction={encounter.gustDirection} aria-hidden="true"><i /><i /><i /><b /></div>;
}

function BossAvatar({ boss }: { boss: NonNullable<DownstairsGameView['boss']> }) {
  return <div className={`downstairs__boss-avatar is-${boss.phase} is-${boss.attack}`} aria-label={`咚咚王，${boss.phase === 'active' ? '戰鬥中' : boss.phase === 'warning' ? '即將登場' : '戰鬥結束'}`}>
    <svg className="downstairs__boss-svg" viewBox="0 0 140 150" role="img" aria-hidden="true">
      <g className="downstairs__boss-crown-svg" stroke="#644112" strokeWidth="5" strokeLinejoin="round"><path fill="#ffd45b" d="M43 35 36 9l22 16L70 3l13 22 23-16-9 34Z"/><circle fill="#ff7b79" cx="70" cy="17" r="5"/></g>
      <path className="downstairs__boss-cape" fill="#d64d69" stroke="#67283b" strokeWidth="5" d="M38 61Q12 89 21 137l28-15 21 20 21-20 28 15q8-48-18-76Z"/>
      <g className="downstairs__boss-limbs" fill="#7b43a2" stroke="#3e245c" strokeWidth="6">
        <ellipse className="downstairs__boss-arm-svg downstairs__boss-arm-svg--left" cx="23" cy="91" rx="14" ry="30"/><ellipse className="downstairs__boss-arm-svg downstairs__boss-arm-svg--right" cx="117" cy="91" rx="14" ry="30"/>
        <ellipse className="downstairs__boss-foot-svg downstairs__boss-foot-svg--left" cx="48" cy="134" rx="24" ry="12"/><ellipse className="downstairs__boss-foot-svg downstairs__boss-foot-svg--right" cx="94" cy="134" rx="24" ry="12"/>
      </g>
      <path fill="#8b4cb4" stroke="#3e245c" strokeWidth="6" d="M30 70Q12 42 39 45M110 70q18-28-9-25"/>
      <path className="downstairs__boss-body-svg" fill="url(#bossBody)" stroke="#3e245c" strokeWidth="6" d="M70 37c36 0 49 23 47 57-2 35-18 43-47 43s-45-8-47-43c-2-34 11-57 47-57Z"/>
      <defs><linearGradient id="bossBody" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#c483e8"/><stop offset=".6" stopColor="#8b4cb4"/><stop offset="1" stopColor="#60317f"/></linearGradient></defs>
      <g className="downstairs__boss-face" stroke="#3e245c" strokeWidth="4" strokeLinecap="round">
        <ellipse fill="#fff" cx="50" cy="72" rx="10" ry="13"/><ellipse fill="#fff" cx="90" cy="72" rx="10" ry="13"/><circle fill="#58dbe6" stroke="none" cx="52" cy="76" r="5"/><circle fill="#58dbe6" stroke="none" cx="88" cy="76" r="5"/>
        <ellipse fill="#f28ab2" cx="70" cy="88" rx="7" ry="5"/><path fill="none" d="M56 99q14 14 28 0"/>
      </g>
      <g className="downstairs__boss-brows" fill="none" stroke="#3e245c" strokeWidth="5" strokeLinecap="round"><path d="m40 56 18 6M100 56l-18 6"/></g>
      <path fill="#ffd45b" stroke="#644112" strokeWidth="3" d="M55 111h30v17H55z"/><text x="70" y="125" textAnchor="middle" fill="#60317f" stroke="none" fontSize="15" fontWeight="900">咚</text>
    </svg>
    {boss.phase === 'active' && <span className="downstairs__boss-action" aria-hidden="true">{boss.attack === 'stomp' ? 'BOOM!' : boss.attack === 'gust' ? 'WHOOSH!' : boss.attack === 'fallingRock' ? '!!' : 'SHIFT!'}</span>}
  </div>;
}

function BossHud({ boss }: { boss: NonNullable<DownstairsGameView['boss']> }) {
  const attack = { stomp: '重踏平台', gust: `強風 ${boss.gustDirection > 0 ? '›››' : '‹‹‹'}`, fallingRock: '落石警告', safeShift: '安全台轉移' }[boss.attack];
  return <div className={`downstairs__boss-live is-${boss.phase}`}>
    <div><strong>咚咚王 {boss.shield}/{boss.maxShield}</strong><span>{boss.phase === 'warning' ? '即將出現' : boss.phase === 'cleared' ? '成功擊敗！' : boss.phase === 'survived' ? '成功撐過！' : `下一招：${attack}`}</span><b>{(boss.remainingMs / 1000).toFixed(1)}s</b></div>
    <div className="downstairs__boss-shield" aria-label={`Boss 生命 ${boss.shield}/${boss.maxShield}`}>{Array.from({ length: boss.maxShield }, (_, index) => <i key={index} className={index < boss.shield ? 'is-full' : undefined} />)}</div>
  </div>;
}
