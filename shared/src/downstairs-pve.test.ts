import { describe, expect, it } from 'vitest';
import {
  activatePveBossMechanism,
  advanceDownstairs,
  advancePveEncounter,
  advancePveEnemies,
  advancePveProgression,
  consumeTeamFeverGuard,
  createPveDirector,
  createPveEncounter,
  createPveEnemy,
  createPveProgression,
  createTeamFever,
  damagePveBossWeakPoint,
  downstairsView,
  planPveEnemySpawn,
  pveEnemyLimit,
  pveScrollSpeedAtDepth,
  requestTeamFever,
  resolvePveEnemyContact,
  startDownstairs,
  teamFeverActive,
  tickTeamFever,
} from './downstairs';

describe('深度式 PvE 進度', () => {
  it('依 worldDepth 使用連續且有上限的速度曲線', () => {
    expect(pveScrollSpeedAtDepth(0)).toBe(26);
    expect(pveScrollSpeedAtDepth(200)).toBe(34);
    expect(pveScrollSpeedAtDepth(500)).toBe(46);
    expect(pveScrollSpeedAtDepth(900)).toBe(58);
    expect(pveScrollSpeedAtDepth(1_300)).toBe(66);
    expect(pveScrollSpeedAtDepth(2_000)).toBe(72);
    expect(pveScrollSpeedAtDepth(99_999)).toBe(72);
  });

  it('不同 delta 切片得到相同世界深度', () => {
    const batched = createPveProgression(17);
    const sliced = createPveProgression(17);
    for (let index = 0; index < 20; index += 1) advancePveProgression(batched, 50);
    for (let index = 0; index < 100; index += 1) advancePveProgression(sliced, 10);
    expect(batched.worldDepthM).toBe(sliced.worldDepthM);
    expect(batched.sceneDepthM).toBe(sliced.sceneDepthM);
  });

  it('正式模式在 view 暴露共享深度且不讓個人加分改動它', () => {
    const state = startDownstairs(['a', 'b'], 10, {}, 'pve');
    state.players.a!.scoreBonus = 5_000;
    advanceDownstairs(state, 100);
    const view = downstairsView(state);
    expect(view.pve?.progression.worldDepthM).toBeGreaterThan(0);
    expect(view.pve?.progression.worldDepthM).toBeLessThan(1);
    expect(view.players.a!.depth).toBeGreaterThan(view.players.b!.depth);
    expect(view.pve?.progression.sceneId).toBe('garden');
  });

  it('四人 compact snapshot 可 round-trip 且低於 24KB', () => {
    const state = startDownstairs(['a', 'b', 'c', 'd'], 10, {}, 'pve');
    for (const depth of [50, 100, 150, 200, 219]) {
      state.pve!.progression.worldDepthM = depth;
      state.pve!.progression.sceneDepthM = depth;
      advanceDownstairs(state, 0);
    }
    const json = JSON.stringify(downstairsView(state));
    expect(new TextEncoder().encode(json).byteLength).toBeLessThanOrEqual(24 * 1024);
    expect(JSON.parse(json).pve.progression.worldDepthM).toBe(219);
  });

  it('探索深度到達門檻才建立三秒 Boss 預告', () => {
    const state = startDownstairs(['a'], 10, {}, 'pve');
    state.pve!.progression.worldDepthM = 220;
    state.pve!.progression.sceneDepthM = 220;
    advanceDownstairs(state, 0);
    expect(state.pve!.progression.phase).toBe('bossWarning');
    expect(state.pve!.encounter).toMatchObject({ bossId: 'budshield', phase: 'warning', attackRemainingMs: 3_000 });
  });
});

describe('共享 Team Fever', () => {
  it('只重置觸發者並提供每人獨立 Guard', () => {
    const fever = createTeamFever();
    expect(requestTeamFever(fever, 'a', 30, ['a', 'b'])).toBe(true);
    expect(teamFeverActive(fever)).toBe(true);
    expect(fever.sourcePlayerId).toBe('a');
    expect(consumeTeamFeverGuard(fever, 'a')).toBe(true);
    expect(consumeTeamFeverGuard(fever, 'a')).toBe(false);
    expect(consumeTeamFeverGuard(fever, 'b')).toBe(true);
  });

  it('依序走完 active、cooldown、idle 且 READY 不會自動連鎖', () => {
    const fever = createTeamFever();
    requestTeamFever(fever, 'a', 30, ['a', 'b']);
    expect(requestTeamFever(fever, 'b', 30, ['a', 'b'])).toBe(false);
    expect(fever.readyPlayerIds).toContain('b');
    tickTeamFever(fever, 5_000);
    expect(fever.phase).toBe('cooldown');
    tickTeamFever(fever, 4_000);
    expect(fever.phase).toBe('idle');
    expect(fever.sequence).toBe(1);
    expect(requestTeamFever(fever, 'b', 30, ['a', 'b'])).toBe(true);
    expect(fever.sequence).toBe(2);
  });
});

describe('seeded 小怪 director 與戰鬥', () => {
  const platforms = [
    { id: 1, x: 20, y: 180, width: 48, safe: true },
    { id: 2, x: 120, y: 260, width: 48, safe: true },
    { id: 3, x: 250, y: 340, width: 48, safe: true },
  ];

  it.each([[1, 2], [2, 3], [3, 4], [4, 5]])('%i 人同屏上限為 %i', (players, limit) => {
    expect(pveEnemyLimit(players)).toBe(limit);
  });

  it('同 seed 產生相同敵人、入口與落點', () => {
    const left = createPveDirector();
    const right = createPveDirector();
    const a = planPveEnemySpawn(left, 99, 'garden', 50, 2, 0, platforms);
    const b = planPveEnemySpawn(right, 99, 'garden', 50, 2, 0, platforms);
    expect(a).toEqual(b);
    expect(a?.telegraphMs).toBeGreaterThanOrEqual(900);
  });

  it('平台不足兩個時公平性驗證會放棄生成', () => {
    const director = createPveDirector();
    expect(planPveEnemySpawn(director, 1, 'garden', 50, 1, 0, [platforms[0]!])).toBeNull();
  });

  it('預告與進場期間不產生接觸傷害', () => {
    const enemy = createPveEnemy(1, { type: 'sproutBall', entry: 'platformWake', platformId: 1, telegraphMs: 1_200, x: 20, y: 156 });
    const player = { playerId: 'a', characterId: 'brave' as const, x: 20, y: 140, size: 30, vy: 100, previousBottom: 150, skillActive: false, skillSequence: 0 };
    expect(resolvePveEnemyContact(enemy, player, false)).toEqual({ kind: 'none' });
    expect(enemy.phase).toBe('cue');
    advancePveEnemies([enemy], [{ id: 1, x: 20, y: 180, width: 48 }], 450, false);
    expect(enemy.phase).toBe('telegraph');
    advancePveEnemies([enemy], [{ id: 1, x: 20, y: 180, width: 48 }], 1_200, false);
    expect(enemy.phase).toBe('entering');
    expect(resolvePveEnemyContact(enemy, player, false)).toEqual({ kind: 'none' });
    advancePveEnemies([enemy], [{ id: 1, x: 20, y: 180, width: 48 }], 400, false);
    expect(enemy.phase).toBe('settling');
    expect(resolvePveEnemyContact(enemy, player, false)).toEqual({ kind: 'none' });
    advancePveEnemies([enemy], [{ id: 1, x: 20, y: 180, width: 48 }], 250, false);
    expect(enemy.phase).toBe('active');
  });

  it('排除玩家目前台、預測落點與接觸時間過短的平台', () => {
    const director = createPveDirector();
    const plan = planPveEnemySpawn(director, 8, 'garden', 50, 2, 0, [
      { ...platforms[0]!, playerOccupied: true, timeToContactMs: 2_000 },
      { ...platforms[1]!, predictedLanding: true, timeToContactMs: 2_000 },
      { ...platforms[2]!, timeToContactMs: 900 },
      { id: 4, x: 45, y: 420, width: 48, safe: true, timeToContactMs: 1_500 },
      { id: 5, x: 190, y: 460, width: 48, safe: true, timeToContactMs: 2_400 },
    ]);
    expect([4, 5]).toContain(plan?.platformId);
    expect(plan?.telegraphMs).toBeGreaterThanOrEqual(900);
  });

  it('以 seed 產生 38～62m 的平滑生成間距', () => {
    const director = createPveDirector();
    const plan = planPveEnemySpawn(director, 19, 'garden', 50, 2, 0, platforms);
    expect(plan).not.toBeNull();
    expect(director.nextSpawnDepthM - 50).toBeGreaterThanOrEqual(38);
    expect(director.nextSpawnDepthM - 50).toBeLessThanOrEqual(62);
  });

  it('多人深處可排入 crossfire，elite 每區只建立一次 escort card', () => {
    const crossfire = createPveDirector();
    crossfire.spawnIndex = 2;
    crossfire.nextSpawnDepthM = 100;
    expect(planPveEnemySpawn(crossfire, 21, 'garden', 100, 2, 0, platforms)?.card).toBe('crossfire');
    expect(crossfire.pendingCard).toHaveLength(1);
    expect(crossfire.pendingReadyDepthM).toBe(110);

    const escort = createPveDirector();
    escort.nextSpawnDepthM = 100;
    escort.enemyBag = ['mirrorWisp'];
    expect(planPveEnemySpawn(escort, 33, 'ruins', 100, 4, 0, platforms)?.card).toBe('eliteEscort');
    expect(escort.pendingCard).toHaveLength(1);
    expect(escort.eliteCardScene).toBe('ruins');
  });

  it('踩擊會傷害敵人且 Fever 增加一點傷害', () => {
    const enemy = createPveEnemy(1, { type: 'dewSlime', entry: 'ceilingDrop', platformId: 1, telegraphMs: 1_100, x: 20, y: 156 });
    enemy.phase = 'active';
    const result = resolvePveEnemyContact(enemy, { playerId: 'a', characterId: 'brave', x: 20, y: 140, size: 30, vy: 100, previousBottom: 150, skillActive: false, skillSequence: 0 }, true);
    expect(result).toMatchObject({ kind: 'enemyHit', damage: 2, defeated: true, stomp: true });
    expect(enemy.hp).toBe(0);
  });
});

describe('四場景 Boss encounter', () => {
  it.each([
    ['garden', 20, 38],
    ['workshop', 24, 42],
    ['rooftop', 28, 46],
    ['ruins', 32, 56],
  ] as const)('%s Boss 依玩家數鎖定 HP', (scene, soloHp, fourPlayerHp) => {
    expect(createPveEncounter(scene, 0, 1, 220).maxHp).toBe(soloHp);
    expect(createPveEncounter(scene, 0, 4, 220).maxHp).toBe(fourPlayerHp);
  });

  it('必須完成場景機關才暴露弱點', () => {
    const encounter = createPveEncounter('garden', 0, 2, 220);
    advancePveEncounter(encounter, 3_000, false);
    expect(encounter.phase).toBe('active');
    expect(activatePveBossMechanism(encounter)).toBe(true);
    expect(encounter.weakPoint).toBe('locked');
    expect(activatePveBossMechanism(encounter)).toBe(true);
    expect(encounter.weakPoint).toBe('exposed');
  });

  it('鏘鏘與夜曜要求依序啟動機關且錯誤不扣血', () => {
    const clockwork = createPveEncounter('workshop', 0, 2, 480);
    advancePveEncounter(clockwork, 3_000, false);
    expect(activatePveBossMechanism(clockwork, 1)).toBe(false);
    expect(clockwork.feedback).toBe('wrongOrder');
    expect(clockwork.mechanicProgress).toBe(0);
    expect(activatePveBossMechanism(clockwork, 0)).toBe(true);
    expect(activatePveBossMechanism(clockwork, 1)).toBe(true);
    expect(clockwork.weakPoint).toBe('exposed');

    const dragon = createPveEncounter('ruins', 0, 1, 1_060);
    advancePveEncounter(dragon, 3_000, false);
    expect(activatePveBossMechanism(dragon, 2)).toBe(false);
    for (const index of [0, 1, 2]) expect(activatePveBossMechanism(dragon, index)).toBe(true);
    expect(dragon.weakPoint).toBe('exposed');
  });

  it('Boss 依生命進入教學、混合與決戰幕', () => {
    const encounter = createPveEncounter('garden', 0, 1, 220);
    advancePveEncounter(encounter, 3_000, false);
    expect(encounter.act).toBe('teach');
    expect(encounter.attackRemainingMs).toBe(1_600);
    encounter.hp = 16;
    activatePveBossMechanism(encounter, 0); activatePveBossMechanism(encounter, 1);
    damagePveBossWeakPoint(encounter, 'a', 2, false);
    expect(encounter.act).toBe('mix');
    encounter.phase = 'active'; encounter.hp = 6; encounter.weakPoint = 'exposed'; encounter.cycleHitPlayerIds = []; encounter.cycleDamage = 0;
    damagePveBossWeakPoint(encounter, 'b', 2, false);
    expect(encounter.act).toBe('finale');
  });

  it('重複命中與傷害上限都有可呈現回饋', () => {
    const encounter = createPveEncounter('garden', 0, 1, 220);
    advancePveEncounter(encounter, 3_000, false);
    activatePveBossMechanism(encounter); activatePveBossMechanism(encounter);
    expect(damagePveBossWeakPoint(encounter, 'a', 1, false)).toBe(1);
    expect(damagePveBossWeakPoint(encounter, 'a', 1, false)).toBe(0);
    expect(encounter.feedback).toBe('alreadyHit');
    encounter.cycleHitPlayerIds = [];
    encounter.cycleDamage = encounter.damageCap;
    expect(damagePveBossWeakPoint(encounter, 'b', 1, false)).toBe(0);
    expect(encounter.feedback).toBe('damageCap');
  });

  it('同一 cycle 每位玩家只能命中一次且遵守團隊 damage cap', () => {
    const encounter = createPveEncounter('garden', 0, 2, 220);
    advancePveEncounter(encounter, 3_000, false);
    activatePveBossMechanism(encounter);
    activatePveBossMechanism(encounter);
    expect(damagePveBossWeakPoint(encounter, 'a', 2, false)).toBe(2);
    expect(damagePveBossWeakPoint(encounter, 'a', 2, false)).toBe(0);
    expect(damagePveBossWeakPoint(encounter, 'b', 2, false)).toBe(1);
    expect(encounter.hp).toBe(encounter.maxHp - 3);
  });

  it('無限裂隙 HP 隨輪次提高但不超過 80', () => {
    expect(createPveEncounter('rift', 3, 4, 2_000).maxHp).toBeLessThanOrEqual(80);
    expect(createPveEncounter('rift', 99, 4, 9_999).maxHp).toBe(80);
  });
});
