import { describe, expect, it } from 'vitest';
import {
  activateDownstairsSkill,
  advanceDownstairs,
  DOWNSTAIRS_SKILLS,
  DOWNSTAIRS_CHALLENGE_WIDTH,
  DOWNSTAIRS_MIN_PLATFORMS_PER_ROW,
  DOWNSTAIRS_PLATFORM_WIDTH,
  downstairsComboBrakeMultiplier,
  downstairsComboSpeedMultiplier,
  downstairsDifficultyAt,
  downstairsLandingGrade,
  downstairsNextEvent,
  downstairsView,
  downstairsPlatformLayout,
  downstairsZoneAt,
  removeDownstairsPlayer,
  setDownstairsDirection,
  startDownstairs,
} from './downstairs';

describe('小朋友下樓梯', () => {
  it('cycles deterministic formations while keeping safe platforms reachable', () => {
    const anchor = { x: 120, width: 120 };
    const layouts = [9, 13, 17, 21].map((id) => downstairsPlatformLayout(id, anchor, 'garden'));
    expect(layouts.map((layout) => layout.pattern)).toEqual(['zigzag', 'stairs', 'wave', 'rest']);
    for (const layout of layouts) {
      expect(layout.x).toBeGreaterThanOrEqual(18);
      expect(layout.x + layout.width).toBeLessThanOrEqual(342);
      expect(layout.route).toBe('safe');
      expect(layout.width).toBe(DOWNSTAIRS_PLATFORM_WIDTH);
      expect(layout.gap).toBeGreaterThanOrEqual(70);
      expect(layout.gap).toBeLessThanOrEqual(84);
    }
  });

  it('adds narrow challenge beats only in advanced zones', () => {
    const anchor = { x: 100, width: 130 };
    expect(downstairsPlatformLayout(10, anchor, 'garden').route).toBe('safe');
    const challenge = downstairsPlatformLayout(10, anchor, 'rooftop');
    expect(challenge.route).toBe('challenge');
    expect(challenge.width).toBe(DOWNSTAIRS_CHALLENGE_WIDTH);
    expect(challenge.gap).toBeGreaterThanOrEqual(82);
    expect(challenge.gap).toBeLessThanOrEqual(90);
    expect(downstairsPlatformLayout(21, anchor, 'garden').gap).toBe(70);
  });

  it('建立每位玩家且由伺服器接受方向輸入', () => {
    const state = startDownstairs(['a', 'b'], 0);
    expect(Object.keys(state.players)).toEqual(['a', 'b']);
    expect(setDownstairsDirection(state, 'a', -2)).toBe(true);
    expect(state.players.a?.direction).toBe(-1);
  });

  it('固定步進會推進時間與深度', () => {
    const state = startDownstairs(['a'], 0);
    advanceDownstairs(state, 50);
    expect(state.elapsedMs).toBe(50);
    expect(state.players.a?.depth).toBeGreaterThanOrEqual(0);
  });

  it('最後一位玩家離開後結束並產生排名', () => {
    const state = startDownstairs(['a'], 0);
    removeDownstairsPlayer(state, 'a');
    expect(state.over).toBe(true);
    expect(state.ranking).toEqual(['a']);
  });
});

it('starts every seat high enough to reach a safe opening platform', () => {
  const state = startDownstairs(['a', 'b', 'c', 'd'], 0);
  expect(Object.values(state.players).every((player) => player.y === 400 && player.vy === 0)).toBe(true);
  const starts = state.platforms.filter((platform) => platform.isStart);
  expect(starts).toHaveLength(4);
  expect(starts.every((platform) => platform.y === 478 && platform.width === DOWNSTAIRS_PLATFORM_WIDTH && platform.kind === 'spring')).toBe(true);
  Object.values(state.players).forEach((player, index) => {
    expect(player.x + 15).toBe(starts[index]!.x + starts[index]!.width / 2);
    expect(starts[index]!.x).toBeGreaterThanOrEqual(0);
    expect(starts[index]!.x + starts[index]!.width).toBeLessThanOrEqual(360);
  });
  for (let elapsed = 0; elapsed < 800; elapsed += 50) advanceDownstairs(state, 50);
  expect(Object.values(state.players).every((player, index) => player.alive && player.lastScoredPlatformId === starts[index]!.id)).toBe(true);
});

it.each([1, 2, 3, 4])('creates one centered start platform per player for %i players', (count) => {
  const ids = Array.from({ length: count }, (_, index) => `p${index}`);
  const state = startDownstairs(ids, 0);
  const starts = state.platforms.filter((platform) => platform.isStart);
  expect(starts).toHaveLength(count);
  ids.forEach((id, index) => expect(state.players[id]!.x + 15).toBe(starts[index]!.x + starts[index]!.width / 2));
});

it('clears the start-only visual state when that platform is recycled', () => {
  const state = startDownstairs(['a'], 0);
  const start = state.platforms.find((platform) => platform.isStart)!;
  start.y = -20;
  advanceDownstairs(state, 50);
  expect(start.isStart).toBe(false);
  expect(start.id).not.toBe(2);
});

it('retires only the additional multiplayer start platforms after they leave the screen', () => {
  const state = startDownstairs(['a', 'b', 'c', 'd'], 0);
  const starts = state.platforms.filter((platform) => platform.isStart);
  starts.filter((platform) => platform.startOnly).forEach((platform) => { platform.y = -20; });
  advanceDownstairs(state, 0);
  expect(state.platforms.filter((platform) => platform.isStart)).toEqual([expect.objectContaining({ id: 2, startOnly: false })]);
  expect(state.platforms).toHaveLength(22);
});

it('offers at least two choices in every opening height band without drawing fixed lanes', () => {
  const state = startDownstairs(['a'], 0);
  const platforms = state.platforms.filter((item) => !item.isStart).sort((a, b) => a.y - b.y);
  const bands: Array<typeof state.platforms> = [];
  for (const platform of platforms) {
    const band = bands.at(-1);
    if (!band || platform.y - band[0]!.y > 24) bands.push([platform]);
    else band.push(platform);
  }
  expect(bands.length).toBeGreaterThanOrEqual(7);
  for (const band of bands) {
    expect(band.length).toBeGreaterThanOrEqual(DOWNSTAIRS_MIN_PLATFORMS_PER_ROW);
  }
  expect(new Set(platforms.map((platform) => platform.y)).size).toBe(platforms.length);
});

it('recycles platforms into scattered clusters with occasional three-way challenges', () => {
  const state = startDownstairs(['a'], 0);
  state.elapsedMs = 20_000;
  state.nextPlatformId = 14;
  const recycled = state.platforms.filter((platform) => !platform.isStart).slice(0, 3);
  recycled.forEach((platform) => { platform.y = -20; });
  advanceDownstairs(state, 0);
  const generated = recycled.filter((platform) => platform.id >= 14);
  expect(generated).toHaveLength(3);
  expect(new Set(generated.map((platform) => platform.y)).size).toBeGreaterThan(1);
  expect(Math.max(...generated.map((platform) => platform.y)) - Math.min(...generated.map((platform) => platform.y))).toBeLessThanOrEqual(24);
  expect(new Set(generated.map((platform) => platform.x)).size).toBe(3);
  expect(generated.filter((platform) => platform.route === 'safe')).toHaveLength(2);
  expect(generated.filter((platform) => platform.route === 'challenge')).toHaveLength(1);
});

describe('downstairs difficulty curve', () => {
  it('grades center, controllable, and edge landings deterministically', () => {
    expect(downstairsLandingGrade(135, 100, 100)).toBe('perfect');
    expect(downstairsLandingGrade(110, 100, 100)).toBe('good');
    expect(downstairsLandingGrade(86, 100, 100)).toBe('edge');
    expect(downstairsLandingGrade(105, 100, 40)).toBe('perfect');
  });

  it('raises personal movement speed with combo and caps the bonus at thirty percent', () => {
    expect(downstairsComboSpeedMultiplier(0)).toBe(1);
    expect(downstairsComboSpeedMultiplier(12)).toBe(1.12);
    expect(downstairsComboSpeedMultiplier(30)).toBe(1.3);
    expect(downstairsComboSpeedMultiplier(99)).toBe(1.3);
    expect(downstairsComboSpeedMultiplier(30, true)).toBe(1.45);
    expect(downstairsComboBrakeMultiplier(0)).toBe(1);
    expect(downstairsComboBrakeMultiplier(30)).toBe(1.6);
    expect(downstairsComboBrakeMultiplier(30, true)).toBe(1.75);
  });

  it('adds stronger braking at high combo while preserving the speed reward', () => {
    const low = startDownstairs(['a'], 0);
    const high = startDownstairs(['a'], 0);
    for (const state of [low, high]) {
      state.players.a!.x = 120;
      state.players.a!.y = 280;
      state.players.a!.vx = 200;
      state.players.a!.direction = -1;
      state.platforms = [{ id: 90, x: 20, y: 580, width: 100, kind: 'normal' }];
    }
    high.players.a!.combo = 30;
    advanceDownstairs(low, 100);
    advanceDownstairs(high, 100);
    expect(Math.abs(high.players.a!.vx)).toBeLessThan(Math.abs(low.players.a!.vx));
  });

  it('ramps scroll speed and spike rate through three phases', () => {
    expect(downstairsDifficultyAt(0)).toEqual({ scrollSpeed: 26, spikeRate: 0 });
    expect(downstairsDifficultyAt(20_000)).toEqual({ scrollSpeed: 37, spikeRate: 0.1 });
    expect(downstairsDifficultyAt(60_000)).toEqual({ scrollSpeed: 54, spikeRate: 0.2 });
    expect(downstairsDifficultyAt(180_000).scrollSpeed).toBe(68);
  });

  it('keeps every opening height band reachable without prescribing a route', () => {
    const ids = ['brave', 'bubble', 'tangerine', 'star'] as const;
    const state = startDownstairs(ids, 0, Object.fromEntries(ids.map((id) => [id, id])));
    const platforms = state.platforms.filter((platform) => !platform.isStart).sort((a, b) => a.y - b.y);
    const bands: Array<typeof platforms> = [];
    for (const platform of platforms) {
      const band = bands.at(-1);
      if (!band || platform.y - band[0]!.y > 24) bands.push([platform]);
      else band.push(platform);
    }
    expect(bands).toHaveLength(7);
    for (const band of bands) {
      expect(band).toHaveLength(3);
      expect(band.filter((platform) => platform.kind !== 'spike')).toHaveLength(3);
      for (const player of Object.values(state.players)) {
        const playerCenter = player.x + 15;
        expect(Math.min(...band.map((platform) => Math.abs(platform.x + platform.width / 2 - playerCenter)))).toBeLessThanOrEqual(145);
      }
    }
  });

  it('varies late-game platform fields while preserving two safe choices per cluster', () => {
    const state = startDownstairs(['a'], 0);
    state.elapsedMs = 45_000;
    state.nextPlatformId = 30;
    const signatures = new Set<string>();
    for (let cluster = 0; cluster < 8; cluster += 1) {
      const recycled = state.platforms.filter((platform) => !platform.isStart).slice(0, 3);
      recycled.forEach((platform) => { platform.y = -20; });
      advanceDownstairs(state, 0);
      const baseY = Math.min(...recycled.map((platform) => platform.y));
      signatures.add(recycled.map((platform) => `${Math.round(platform.x)}:${Math.round(platform.y - baseY)}`).sort().join('|'));
      expect(recycled.filter((platform) => platform.route === 'safe')).toHaveLength(2);
      expect(recycled.every((platform) => platform.x >= 18 && platform.x + platform.width <= 342)).toBe(true);
      expect(Math.max(...recycled.map((platform) => platform.y)) - baseY).toBeLessThanOrEqual(24);
    }
    expect(signatures.size).toBeGreaterThanOrEqual(4);
    expect(downstairsDifficultyAt(90_000).scrollSpeed).toBeGreaterThan(downstairsDifficultyAt(60_000).scrollSpeed);
  });

  it('warns before eliminating a player at the ceiling', () => {
    const state = startDownstairs(['a'], 0);
    state.players.a!.y = 40;
    advanceDownstairs(state, 50);
    expect(state.players.a!.alive).toBe(true);
    expect(state.players.a!.ceilingDangerMs).toBe(50);
  });
});

describe('downstairs level expansion', () => {
  it('ranks by depth, survived time, then stable insertion order', () => {
    const state = startDownstairs(['a', 'b', 'c'], 0);
    state.players.a!.depth = 40; state.players.b!.depth = 70; state.players.c!.depth = 70;
    state.elapsedMs = 10_000; removeDownstairsPlayer(state, 'c');
    state.elapsedMs = 12_000; removeDownstairsPlayer(state, 'b');
    state.elapsedMs = 15_000; removeDownstairsPlayer(state, 'a');
    expect(state.ranking).toEqual(['b', 'c', 'a']);
  });

  it('turns rescue into three authoritative single-width safe platforms with cooldown', () => {
    const state = startDownstairs(['a', 'b'], 0);
    state.players.a!.health = 1; state.players.b!.health = 1;
    state.nextEventAtMs = 30_000;
    state.eventBag = ['rescue'];
    state.elapsedMs = 29_950;
    advanceDownstairs(state, 50);
    expect(state.event).toBe('rescue');
    expect(state.rescueCooldownMs).toBe(30_000);
    const recycled = state.platforms.filter((platform) => !platform.isStart).slice(0, 3);
    for (const platform of recycled) {
      platform.y = -20;
      advanceDownstairs(state, 50);
      expect(platform.width).toBe(DOWNSTAIRS_PLATFORM_WIDTH);
      expect(platform.route).toBe('safe');
      expect(['spike', 'fragile']).not.toContain(platform.kind);
    }
    expect(state.rescuePlatformsRemaining).toBe(0);
  });

  it('does not force a labelled two-lane branch at fifteen-second milestones', () => {
    const state = startDownstairs(['a'], 0);
    state.elapsedMs = 14_950;
    state.platforms[0]!.y = -20;
    state.platforms[1]!.y = -20;
    advanceDownstairs(state, 50);
    expect('branchId' in state.platforms[0]!).toBe(false);
    expect('branchId' in state.platforms[1]!).toBe(false);
    expect(state.platforms[0]!.y).not.toBe(state.platforms[1]!.y);
  });

  it('increments feedback events once for authoritative actions', () => {
    const state = startDownstairs(['a'], 0);
    expect(activateDownstairsSkill(state, 'a')).toBe(true);
    expect(state.feedbackEvent).toBe('skill');
    expect(state.feedbackSequence).toBe(1);
  });

  it('selects the four approved zones at deterministic milestones', () => {
    expect(downstairsZoneAt(0)).toBe('garden');
    expect(downstairsZoneAt(20_000)).toBe('workshop');
    expect(downstairsZoneAt(45_000)).toBe('rooftop');
    expect(downstairsZoneAt(60_000)).toBe('boss');
    expect(downstairsZoneAt(60_000, true)).toBe('stars');
  });

  it('generates moving platforms in the workshop deterministically', () => {
    const state = startDownstairs(['a'], 0);
    state.elapsedMs = 20_000;
    state.nextPlatformId = 12;
    state.platforms[0]!.y = -20;
    advanceDownstairs(state, 50);
    expect(state.zone).toBe('workshop');
    expect(state.platforms.some((platform) => platform.id === 12 && platform.kind === 'moving')).toBe(true);
  });

  it('collects stars personally and grants a combo shield every three', () => {
    const state = startDownstairs(['a'], 0);
    const player = state.players.a!;
    const platform = state.platforms[1]!;
    player.x = platform.x + platform.width / 2 - 15;
    player.y = platform.y - 43;
    state.stars = [1, 2, 3].map((id) => ({ id, platformId: platform.id, collectedBy: [] }));
    advanceDownstairs(state, 50);
    expect(player.stars).toBe(3);
    expect(player.comboShield).toBe(true);
    expect(player.scoreBonus).toBe(15);
    expect(state.stars.every((star) => star.collectedBy.includes('a'))).toBe(true);
  });

  it('turns nine stars into healing, or bonus depth at full health', () => {
    const state = startDownstairs(['a'], 0);
    const player = state.players.a!;
    const platform = state.platforms[1]!;
    player.health = 2;
    player.x = platform.x + platform.width / 2 - 15;
    player.y = platform.y - 43;
    state.stars = Array.from({ length: 9 }, (_, index) => ({ id: index + 1, platformId: platform.id, collectedBy: [] }));
    advanceDownstairs(state, 0);
    expect(player.health).toBe(3);
    expect(player.starReward).toBe('heal');
  });

  it('rewards a perfect challenge landing with combo, depth, and cooldown reduction', () => {
    const state = startDownstairs(['a'], 0);
    const player = state.players.a!;
    player.skillCooldownMs = 1_000;
    player.x = 130; player.y = 500; player.vy = 100;
    state.platforms = [{ id: 90, x: 90, y: 535, width: 110, kind: 'normal', route: 'challenge' }];
    advanceDownstairs(state, 50);
    expect(player.landingGrade).toBe('perfect');
    expect(player.combo).toBe(3);
    expect(player.scoreBonus).toBe(5);
    expect(player.skillCooldownMs).toBe(250);
    expect(player.landingSequence).toBe(1);
    expect(downstairsView(state).players.a).toMatchObject({ landingGrade: 'perfect', landingSequence: 1 });
  });

  it('does not grade or reward the same platform twice', () => {
    const state = startDownstairs(['a'], 0);
    const player = state.players.a!;
    player.x = 130; player.y = 500; player.vy = 100;
    state.platforms = [{ id: 90, x: 90, y: 535, width: 110, kind: 'normal' }];
    advanceDownstairs(state, 50);
    const combo = player.combo;
    player.lastPlatformId = -1;
    player.x = 130; player.y = 500; player.vy = 100;
    advanceDownstairs(state, 50);
    expect(player.combo).toBe(combo);
    expect(player.landingSequence).toBe(1);
  });

  it('allows landing on the same platform again after clearing it without scoring twice', () => {
    const state = startDownstairs(['a'], 0);
    const player = state.players.a!;
    player.x = 130; player.y = 500; player.vy = 100;
    state.platforms = [{ id: 90, x: 90, y: 535, width: 110, kind: 'normal' }];
    advanceDownstairs(state, 50);
    expect(player.lastPlatformId).toBe(90);

    let clearedPlatform = false;
    let landedAgain = false;
    for (let elapsed = 0; elapsed < 2_000 && player.alive; elapsed += 50) {
      advanceDownstairs(state, 50);
      if (player.lastPlatformId === -1) clearedPlatform = true;
      if (clearedPlatform && player.lastPlatformId === 90) {
        landedAgain = true;
        break;
      }
    }

    expect(clearedPlatform).toBe(true);
    expect(landedAgain).toBe(true);
    expect(player.landingSequence).toBe(1);
    expect(player.combo).toBe(2);
  });

  it('starts a five-second fever on the thirtieth safe landing and exposes it in the view', () => {
    const state = startDownstairs(['a'], 0);
    const player = state.players.a!;
    player.combo = 29;
    player.x = 100;
    player.y = 500;
    player.vy = 100;
    state.platforms = [{ id: 90, x: 90, y: 535, width: 110, kind: 'normal' }];
    advanceDownstairs(state, 50);
    expect(player.combo).toBe(30);
    expect(player.feverRemainingMs).toBe(5_000);
    expect(player.feverGuard).toBe(true);
    expect(player.feverResult).toBe('start');
    expect(downstairsView(state).players.a).toMatchObject({ lastPlatformId: 90, feverRemainingMs: 5_000, feverGuard: true, feverSequence: 1 });
  });

  it('grants fever landing bonuses then banks combo score without losing depth', () => {
    const state = startDownstairs(['a'], 0);
    const player = state.players.a!;
    player.combo = 29;
    player.x = 100; player.y = 500; player.vy = 100;
    state.platforms = [{ id: 90, x: 90, y: 535, width: 110, kind: 'normal' }];
    advanceDownstairs(state, 50);
    player.lastPlatformId = -1;
    player.x = 100; player.y = 500; player.vy = 100;
    state.platforms = [{ id: 91, x: 90, y: 535, width: 110, kind: 'normal' }];
    advanceDownstairs(state, 50);
    expect(player.scoreBonus).toBe(10);
    const depthDuringFever = player.depth;
    advanceDownstairs(state, 5_000);
    expect(player.feverRemainingMs).toBe(0);
    expect(player.combo).toBe(0);
    expect(player.scoreBonus).toBe(70);
    expect(player.depth).toBeGreaterThanOrEqual(depthDuringFever);
    expect(player.feverResult).toBe('complete');
  });

  it('uses Fever Guard to block one damage and end fever without consuming Combo protection', () => {
    const state = startDownstairs(['a'], 0);
    const player = state.players.a!;
    player.combo = 29;
    player.x = 100; player.y = 500; player.vy = 100;
    state.platforms = [{ id: 90, x: 90, y: 535, width: 110, kind: 'normal' }];
    advanceDownstairs(state, 50);
    player.comboShield = true;
    player.lastPlatformId = -1;
    player.x = 100; player.y = 500; player.vy = 100;
    state.platforms = [{ id: 91, x: 90, y: 535, width: 110, kind: 'spike' }];
    advanceDownstairs(state, 50);
    expect(player.health).toBe(3);
    expect(player.feverRemainingMs).toBe(0);
    expect(player.feverResult).toBe('break');
    expect(player.comboShield).toBe(true);
    expect(player.invulnerableMs).toBe(900);
  });

  it('does not let Fever Guard prevent falling out of the playfield', () => {
    const state = startDownstairs(['a'], 0);
    const player = state.players.a!;
    player.combo = 30;
    player.feverRemainingMs = 5_000;
    player.feverGuard = true;
    player.y = 671;
    advanceDownstairs(state, 0);
    expect(player.alive).toBe(false);
    expect(player.endReason).toBe('fall');
    expect(player.feverRemainingMs).toBe(0);
  });

  it('does not trigger fever from a dangerous thirtieth landing', () => {
    const state = startDownstairs(['a'], 0);
    const player = state.players.a!;
    player.combo = 29;
    player.x = 100; player.y = 500; player.vy = 100;
    state.platforms = [{ id: 90, x: 90, y: 535, width: 110, kind: 'spike' }];
    advanceDownstairs(state, 50);
    expect(player.feverRemainingMs).toBe(0);
    expect(player.combo).toBe(0);
    expect(player.health).toBe(2);
  });

  it('keeps fever personal and does not multiply boss switch damage', () => {
    const state = startDownstairs(['a', 'b'], 0);
    const player = state.players.a!;
    player.combo = 30;
    player.feverRemainingMs = 5_000;
    player.feverGuard = true;
    player.x = 100; player.y = 500; player.vy = 100;
    state.platforms = [{ id: 90, x: 90, y: 535, width: 110, kind: 'bossSwitch', switchUsed: false }];
    state.boss = { phase: 'active', remainingMs: 30_900, shield: 20, maxShield: 24, attack: 'stomp', attackRemainingMs: 100, targetPlatformId: null, gustDirection: 1, cycle: 0, resolvedCycle: -1 };
    advanceDownstairs(state, 50);
    expect(state.boss?.shield).toBe(18);
    expect(player.feverRemainingMs).toBe(4_950);
    expect(state.players.b?.feverRemainingMs).toBe(0);
  });

  it.each([
    [['a'], 20],
    [['a', 'b'], 24],
    [['a', 'b', 'c'], 28],
    [['a', 'b', 'c', 'd'], 32],
  ] as const)('scales boss health for %s players', (players, expectedHealth) => {
    const state = startDownstairs([...players], 0);
    state.elapsedMs = 59_950;
    advanceDownstairs(state, 50);
    expect(state.boss).toMatchObject({ phase: 'warning', shield: expectedHealth, maxShield: expectedHealth });
    advanceDownstairs(state, 3_000);
    expect(state.boss?.phase).toBe('active');
    expect(state.boss?.remainingMs).toBe(32_000);
    expect(state.platforms.filter((platform) => platform.kind === 'bossSwitch')).toHaveLength(3);
  });

  it('lets the boss stomp break its targeted platform and restore it later', () => {
    const state = startDownstairs(['a'], 0);
    state.elapsedMs = 61_200;
    state.boss = { phase: 'active', remainingMs: 30_800, shield: 20, maxShield: 20, attack: 'stomp', attackRemainingMs: 0, targetPlatformId: null, gustDirection: 1, cycle: -1, resolvedCycle: -1 };
    advanceDownstairs(state, 0);
    const target = state.platforms.find((platform) => platform.id === state.boss?.targetPlatformId);
    expect(target?.brokenMs).toBe(2_200);
    advanceDownstairs(state, 2_200);
    expect(target?.brokenMs).toBeUndefined();
  });

  it('keeps the time-based scroll acceleration during the boss stage', () => {
    const state = startDownstairs(['a'], 0);
    state.elapsedMs = 60_000;
    state.boss = { phase: 'warning', remainingMs: 3_000, shield: 3, maxShield: 3, attack: 'stomp', attackRemainingMs: 1_200, targetPlatformId: null, gustDirection: 1, cycle: -1, resolvedCycle: -1 };
    const before = state.platforms[0]!.y;
    advanceDownstairs(state, 100);
    expect(before - state.platforms[0]!.y).toBeGreaterThan(4.9);
  });

  it('breaks and restores a fragile platform on authoritative timers', () => {
    const state = startDownstairs(['a'], 0);
    const player = state.players.a!;
    player.x = 100;
    player.y = 500;
    player.vy = 100;
    state.platforms = [{ id: 90, x: 90, y: 535, width: 110, kind: 'fragile' }];
    advanceDownstairs(state, 50);
    expect(state.platforms[0]?.fragileMs).toBe(1_200);
    advanceDownstairs(state, 1_200);
    expect(state.platforms[0]?.brokenMs).toBe(2_500);
    advanceDownstairs(state, 2_500);
    expect(state.platforms[0]?.brokenMs).toBeUndefined();
  });

  it('consumes a boss switch and clears the shield with a team heal', () => {
    const state = startDownstairs(['a'], 0);
    state.elapsedMs = 59_950;
    advanceDownstairs(state, 50);
    advanceDownstairs(state, 3_000);
    const boss = state.boss!;
    boss.shield = 2;
    const platform = state.platforms.find((item) => item.kind === 'bossSwitch')!;
    const player = state.players.a!;
    player.health = 2;
    player.x = platform.x + 10;
    player.y = platform.y - 31;
    player.vy = 100;
    advanceDownstairs(state, 50);
    expect(state.boss?.shield).toBe(0);
    advanceDownstairs(state, 50);
    expect(state.boss?.phase).toBe('cleared');
    expect(player.health).toBe(3);
  });
});

describe('downstairs P1 event rhythm and micro objectives', () => {
  it('starts the first ten-second event at eighteen seconds', () => {
    const state = startDownstairs(['a'], 42);
    state.elapsedMs = 17_949;
    advanceDownstairs(state, 50);
    expect(state.event).toBeNull();
    advanceDownstairs(state, 1);
    expect(state.event).not.toBeNull();
    expect(state.eventRemainingMs).toBe(10_000);
    expect(state.nextEventAtMs).toBe(33_000);
  });

  it('replays deterministic shuffle bags with all events once and no consecutive repeats', () => {
    const first = startDownstairs(['a', 'b'], 12_345);
    const replay = startDownstairs(['a', 'b'], 12_345);
    for (const state of [first, replay]) {
      state.players.a!.health = 1;
      state.players.b!.health = 1;
    }
    const sequence = Array.from({ length: 6 }, () => downstairsNextEvent(first));
    const replayed = Array.from({ length: 6 }, () => downstairsNextEvent(replay));
    expect(replayed).toEqual(sequence);
    expect(new Set(sequence.slice(0, 3))).toEqual(new Set(['golden', 'springParty', 'rescue']));
    expect(new Set(sequence.slice(3, 6))).toEqual(new Set(['golden', 'springParty', 'rescue']));
    expect(sequence.every((event, index) => index === 0 || event !== sequence[index - 1])).toBe(true);
  });

  it('uses a non-repeating deterministic fallback when rescue is not eligible', () => {
    const state = startDownstairs(['a'], 5);
    state.eventBag = ['rescue'];
    state.lastEvent = 'golden';
    expect(downstairsNextEvent(state)).toBe('springParty');
  });

  it('completes two personal Perfect landings once and clamps the cooldown reward', () => {
    const state = startDownstairs(['a'], 0);
    const player = state.players.a!;
    player.skillCooldownMs = 5_000;
    for (const id of [90, 91]) {
      player.lastPlatformId = -1;
      player.x = 130; player.y = 500; player.vy = 100;
      state.platforms = [{ id, x: 90, y: 535, width: 110, kind: 'normal' }];
      advanceDownstairs(state, 50);
    }
    expect(state.objective).toMatchObject({ zone: 'garden', kind: 'perfectLandings', target: 2 });
    expect(player.objectiveProgress).toBe(2);
    expect(player.objectiveCompleted).toBe(true);
    expect(player.objectiveSequence).toBe(1);
    expect(player.skillCooldownMs).toBe(1_500);
    expect(downstairsView(state).players.a).toMatchObject({ objectiveCompleted: true, objectiveReward: 'cooldown' });
  });

  it('rewards a self-selected rooftop risky landing with Combo and can bridge into Fever', () => {
    const state = startDownstairs(['a'], 0);
    const player = state.players.a!;
    state.elapsedMs = 44_950;
    advanceDownstairs(state, 50);
    expect(state.objective).toMatchObject({ zone: 'rooftop', kind: 'riskyLandings', target: 1 });
    player.combo = 27;
    player.lastPlatformId = -1;
    player.x = 70; player.y = 500; player.vy = 100;
    state.platforms = [{ id: 90, x: 90, y: 535, width: 110, kind: 'normal', route: 'challenge' }];
    advanceDownstairs(state, 50);
    expect(player.landingGrade).toBe('edge');
    expect(player.objectiveCompleted).toBe(true);
    expect(player.objectiveReward).toBe('combo');
    expect(player.combo).toBe(30);
    expect(player.feverRemainingMs).toBe(5_000);
  });

  it('tracks workshop stars per player and never grants health for the objective', () => {
    const state = startDownstairs(['a', 'b'], 0);
    state.elapsedMs = 19_950;
    advanceDownstairs(state, 50);
    expect(state.objective).toMatchObject({ zone: 'workshop', kind: 'stars', target: 2 });
    const player = state.players.a!;
    const other = state.players.b!;
    const platform = state.platforms[1]!;
    player.health = 2;
    player.skillCooldownMs = 3_000;
    player.x = platform.x + platform.width / 2 - 15;
    player.y = platform.y - 43;
    other.x = 0; other.y = 0;
    state.stars = [1, 2].map((id) => ({ id, platformId: platform.id, collectedBy: [] }));
    advanceDownstairs(state, 0);
    expect(player.objectiveProgress).toBe(2);
    expect(player.objectiveCompleted).toBe(true);
    expect(player.skillCooldownMs).toBe(1_000);
    expect(player.health).toBe(2);
    expect(other.objectiveProgress).toBe(0);
  });

  it('clears the objective during the Boss encounter', () => {
    const state = startDownstairs(['a'], 0);
    state.elapsedMs = 59_950;
    advanceDownstairs(state, 50);
    expect(state.zone).toBe('boss');
    expect(state.objective).toBeNull();
  });
});

describe('downstairs character skills', () => {
  it.each([
    ['brave', 10_000, 1_500],
    ['bubble', 8_000, 2_000],
    ['tangerine', 6_000, 350],
    ['star', 12_000, 1_500],
  ] as const)('%s activates with authoritative timing', (characterId, cooldownMs, activeMs) => {
    const state = startDownstairs(['a'], 0, { a: characterId });
    expect(activateDownstairsSkill(state, 'a')).toBe(true);
    expect(state.players.a!.skillCooldownMs).toBe(cooldownMs);
    expect(state.players.a!.skillActiveMs).toBe(activeMs);
    expect(DOWNSTAIRS_SKILLS[characterId].cooldownMs).toBe(cooldownMs);
    expect(activateDownstairsSkill(state, 'a')).toBe(false);
  });

  it('bubble reduces falling acceleration while active', () => {
    const normal = startDownstairs(['a'], 0, { a: 'brave' });
    const bubble = startDownstairs(['a'], 0, { a: 'bubble' });
    normal.players.a!.skillCooldownMs = 0;
    bubble.players.a!.skillCooldownMs = 0;
    normal.players.a!.vy = 100;
    bubble.players.a!.vy = 100;
    activateDownstairsSkill(bubble, 'a');
    advanceDownstairs(normal, 50);
    advanceDownstairs(bubble, 50);
    expect(bubble.players.a!.vy).toBeLessThan(normal.players.a!.vy);
  });

  it.each(['brave', 'bubble', 'tangerine', 'star'] as const)('%s keeps manual steering responsive while active', (characterId) => {
    const state = startDownstairs(['a'], 0, { a: characterId });
    const player = state.players.a!;
    player.x = 150;
    player.y = 250;
    player.vy = 0;
    state.platforms = [{ id: 90, x: 260, y: 430, width: 48, kind: 'normal' }];
    setDownstairsDirection(state, 'a', -1);
    activateDownstairsSkill(state, 'a');
    advanceDownstairs(state, 50);
    expect(player.vx).toBeLessThan(0);
  });

  it('star guidance ignores broken platforms and selects a usable route while idle', () => {
    const state = startDownstairs(['a'], 0, { a: 'star' });
    const player = state.players.a!;
    player.x = 150;
    player.y = 250;
    state.platforms = [
      { id: 90, x: 20, y: 340, width: 48, kind: 'normal', brokenMs: 1_000 },
      { id: 91, x: 280, y: 350, width: 48, kind: 'normal' },
    ];
    activateDownstairsSkill(state, 'a');
    advanceDownstairs(state, 50);
    expect(player.vx).toBeGreaterThan(0);
  });

  it('brave shield consumes one spike hit without changing health', () => {
    const state = startDownstairs(['a'], 0, { a: 'brave' });
    const player = state.players.a!;
    player.skillCooldownMs = 0;
    player.x = 100;
    player.y = 500;
    player.vy = 100;
    state.platforms = [{ id: 99, x: 90, y: 535, width: 100, kind: 'spike' }];
    activateDownstairsSkill(state, 'a');
    advanceDownstairs(state, 50);
    expect(player.health).toBe(3);
    expect(player.skillShieldCharges).toBe(0);
    expect(player.skillActiveMs).toBe(0);
  });

  it('brave shield also blocks a boss falling-rock hit', () => {
    const state = startDownstairs(['a'], 0, { a: 'brave' });
    const player = state.players.a!;
    player.x = 100;
    player.y = 300;
    state.elapsedMs = 60_000;
    state.bossCompleted = false;
    state.platforms = [{ id: 99, x: 90, y: 500, width: 100, kind: 'normal' }];
    state.boss = {
      phase: 'active', remainingMs: 22_800, shield: 20, maxShield: 20,
      attack: 'fallingRock', attackRemainingMs: 0, targetPlatformId: 99,
      gustDirection: 1, cycle: 2, resolvedCycle: 2,
    };
    activateDownstairsSkill(state, 'a');
    advanceDownstairs(state, 0);
    expect(player.health).toBe(3);
    expect(player.skillShieldCharges).toBe(0);
    expect(player.skillActiveMs).toBe(0);
  });

  it('spring platforms provide a clearly stronger bounce and a synced effect', () => {
    const normal = startDownstairs(['a'], 0);
    const spring = startDownstairs(['a'], 0);
    for (const [state, kind] of [[normal, 'normal'], [spring, 'spring']] as const) {
      const player = state.players.a!;
      player.x = 100;
      player.y = 500;
      player.vy = 100;
      state.platforms = [{ id: 99, x: 90, y: 535, width: 100, kind }];
      advanceDownstairs(state, 50);
    }
    expect(spring.players.a!.vy).toBeLessThanOrEqual(normal.players.a!.vy - 130);
    expect(spring.players.a!.lastLandingKind).toBe('spring');
    expect(spring.players.a!.landingEffectMs).toBe(450);
    expect(normal.players.a!.landingEffectMs).toBe(0);
  });

  it('spring force reaches the nearest platform on the layer above', () => {
    const state = startDownstairs(['a'], 0);
    const player = state.players.a!;
    player.x = 100;
    player.y = 500;
    player.vy = 100;
    state.platforms = [
      { id: 98, x: 90, y: 435, width: 100, kind: 'normal' },
      { id: 99, x: 90, y: 535, width: 100, kind: 'spring' },
    ];
    advanceDownstairs(state, 50);
    const availableRise = (player.vy * player.vy) / (2 * 980);
    expect(availableRise).toBeGreaterThanOrEqual(149.99);
  });

  it('completes the spring arc by landing on the platform above', () => {
    const state = startDownstairs(['a'], 0);
    const player = state.players.a!;
    player.x = 110;
    player.y = 500;
    player.vy = 100;
    state.platforms = [
      { id: 98, x: 90, y: 435, width: 120, kind: 'normal' },
      { id: 99, x: 90, y: 535, width: 120, kind: 'spring' },
    ];
    advanceDownstairs(state, 50);
    for (let elapsed = 0; elapsed < 2_000 && player.lastScoredPlatformId !== 98; elapsed += 50) {
      advanceDownstairs(state, 50);
    }
    expect(player.lastScoredPlatformId).toBe(98);
    expect(player.alive).toBe(true);
  });

  it('tangerine dash accelerates even from the last facing direction', () => {
    const state = startDownstairs(['a'], 0, { a: 'tangerine' });
    state.players.a!.skillCooldownMs = 0;
    setDownstairsDirection(state, 'a', -1);
    setDownstairsDirection(state, 'a', 0);
    activateDownstairsSkill(state, 'a');
    advanceDownstairs(state, 50);
    expect(state.players.a!.vx).toBeLessThan(0);
  });

  it('rejects activation while cooling down or eliminated', () => {
    const state = startDownstairs(['a'], 0);
    state.players.a!.skillCooldownMs = 1_000;
    expect(activateDownstairsSkill(state, 'a')).toBe(false);
    state.players.a!.skillCooldownMs = 0;
    removeDownstairsPlayer(state, 'a');
    expect(activateDownstairsSkill(state, 'a')).toBe(false);
  });
});
