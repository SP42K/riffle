import { describe, expect, it } from 'vitest';
import { calcTai, canChi, canGang, canHu, canPeng } from './mahjong.js';

describe('canChi — 缺中間那張牌（嵌張）', () => {
  it('手上有 1m 與 3m，對手打出 2m 時可以吃出 1_3 的組合', () => {
    const options = canChi(['1m', '3m', '9p'], '2m');
    expect(options).toContainEqual(['1m', '3m']);
  });

  it('手上有 2m 與 3m，對手打出 1m 時可以吃出 2_3 的組合（邊張）', () => {
    const options = canChi(['2m', '3m'], '1m');
    expect(options).toContainEqual(['2m', '3m']);
  });

  it('手上有 4m 與 5m，對手打出 3m 時可以吃出 4_5 的組合（連張）', () => {
    const options = canChi(['4m', '5m'], '3m');
    expect(options).toContainEqual(['4m', '5m']);
  });

  it('字牌不能吃', () => {
    expect(canChi(['WE', 'WE'], 'WE')).toEqual([]);
  });
});

describe('canPeng / canGang', () => {
  it('手上兩張相同才能碰', () => {
    expect(canPeng(['3m', '3m', '5p'], '3m')).toBe(true);
    expect(canPeng(['3m', '5p'], '3m')).toBe(false);
  });

  it('別人棄牌時手上三張相同才能明槓', () => {
    const choices = canGang(['3m', '3m', '3m'], '3m', false);
    expect(choices).toEqual([{ kind: 'ming', tile: '3m' }]);
  });

  it('自己摸牌時手上四張相同可以暗槓', () => {
    const choices = canGang(['3m', '3m', '3m', '3m'], null, true);
    expect(choices).toContainEqual({ kind: 'an', tile: '3m' });
  });
});

describe('canHu', () => {
  // 沒有叫牌時（melds 為空）需要湊滿 5 組（15 張）＋ 1 對（2 張）＝ 17 張
  const STANDARD_17 = [
    '1m', '2m', '3m',
    '4m', '5m', '6m',
    '7m', '8m', '9m',
    '1p', '2p', '3p',
    '4p', '5p', '6p',
    '7p', '7p',
  ];

  it('標準五組加一對可以胡', () => {
    expect(canHu(STANDARD_17)).toBe(true);
  });

  it('少一張湊不齊就不能胡', () => {
    expect(canHu(STANDARD_17.slice(0, 16))).toBe(false);
  });
});

describe('calcTai — 台數表校正（比對坊間常見台數表）', () => {
  const base = {
    melds: [],
    winType: 'discard' as const,
    isDealer: false,
    flowers: [],
    seatWind: 'WS',
    roundWind: 'WE',
    isFirstTurnWin: false,
    isKongReplacement: false,
    isLastTile: false,
    isRobKong: false,
  };

  // 標準五組（3 順子 m + 2 順子 p）加一對，17 張，不觸發三元／四喜等額外牌型
  const STANDARD_17 = [
    '1m', '2m', '3m',
    '4m', '5m', '6m',
    '7m', '8m', '9m',
    '1p', '2p', '3p',
    '4p', '5p', '6p',
    '7p', '7p',
  ];

  it('槓上開花是 1 台，不是 2 台', () => {
    const result = calcTai({ ...base, concealedTiles: STANDARD_17, winType: 'selfDraw', isKongReplacement: true });
    expect(result.items.find((i) => i.name === '槓上開花')?.tai).toBe(1);
  });

  it('海底撈月／河底撈魚是 1 台，不是 2 台', () => {
    const result = calcTai({ ...base, concealedTiles: STANDARD_17, isLastTile: true });
    expect(result.items.find((i) => i.name === '河底撈魚')?.tai).toBe(1);
  });

  it('搶槓是 1 台，不是 2 台', () => {
    const result = calcTai({ ...base, concealedTiles: STANDARD_17, isRobKong: true });
    expect(result.items.find((i) => i.name === '搶槓')?.tai).toBe(1);
  });

  it('天胡是 24 台', () => {
    const result = calcTai({
      ...base,
      concealedTiles: STANDARD_17,
      winType: 'selfDraw',
      isDealer: true,
      isFirstTurnWin: true,
      seatWind: 'WE',
    });
    expect(result.items.find((i) => i.name === '天胡')?.tai).toBe(24);
  });

  it('莊家胡牌額外算 1 台', () => {
    const result = calcTai({ ...base, concealedTiles: STANDARD_17, isDealer: true, seatWind: 'WE' });
    expect(result.items.find((i) => i.name === '莊家')?.tai).toBe(1);
  });

  it('單組三元刻（未湊成小/大三元）算 1 台，不會跟小/大三元同時出現', () => {
    // 一組中刻子 + 4 組順子 + 一對，共 5 組加一對
    const single = [
      'DR', 'DR', 'DR',
      '1m', '2m', '3m',
      '4m', '5m', '6m',
      '7m', '8m', '9m',
      '1p', '2p', '3p',
      '9p', '9p',
    ];
    const result = calcTai({ ...base, concealedTiles: single });
    expect(result.items.find((i) => i.name === '三元牌')?.tai).toBe(1);
    expect(result.items.find((i) => i.name === '小三元')).toBeUndefined();
    expect(result.items.find((i) => i.name === '大三元')).toBeUndefined();
  });

  it('五暗刻是 8 台', () => {
    const tiles = [
      '1m', '1m', '1m',
      '2p', '2p', '2p',
      '3p', '3p', '3p',
      '4s', '4s', '4s',
      '6s', '6s', '6s',
      '5s', '5s',
    ];
    const result = calcTai({ ...base, concealedTiles: tiles });
    expect(result.items.find((i) => i.name === '五暗刻')?.tai).toBe(8);
  });
});
