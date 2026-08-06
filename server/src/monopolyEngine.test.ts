import { describe, expect, it } from 'vitest';
import {
  JAIL_BAIL,
  JAIL_POSITION,
  MONOPOLY_ESTATE_IDS,
  MONOPOLY_PHASE_MS,
  mortgageValue,
  netWorthOf,
  tileOf,
  type MonopolyCardId,
  type MonopolyEstateId,
  type MonopolyOptions,
  type MonopolyPhase,
  type MonopolyTileId,
} from 'shared';
import type { Seats } from './gameEngine.js';
import {
  applyMonopolyAction,
  autoActMonopoly,
  removePlayerFromMonopoly,
  startMonopoly,
  type MonopolyState,
} from './monopolyEngine.js';

const ID = (i: number) => String.fromCharCode(97 + i);

interface BoardInput {
  /** 每人的現金，長度決定人數。玩家 id 是 'a'、'b'、'c'…。 */
  cash: readonly number[];
  phase?: MonopolyPhase;
  active?: number;
  turn?: number;
  /** 玩家站在哪：可以給格子代號或位置編號。 */
  at?: Record<string, MonopolyTileId | number>;
  /** 'a': 'brown1 brown2' —— 誰擁有哪些地。 */
  own?: Record<string, string>;
  /** 格子代號 → 房子數（5 為飯店）。 */
  houses?: Partial<Record<MonopolyEstateId, number>>;
  mortgaged?: readonly MonopolyEstateId[];
  /** 玩家 id → 已經在獄中待幾巡。 */
  jail?: Record<string, number>;
  /** 死骰序列，一次取一顆。 */
  dice?: readonly number[];
  chance?: readonly MonopolyCardId[];
  fate?: readonly MonopolyCardId[];
  options?: Partial<MonopolyOptions>;
  /** buy 階段正在問的地。 */
  pending?: MonopolyEstateId;
}

/** 直接組出一個進行到一半的局面，不必真的從頭打。 */
function board(input: BoardInput): { seats: Seats; state: MonopolyState } {
  const seats: Seats = input.cash.map((_, i) => ID(i));
  const state = startMonopoly(
    seats,
    {
      startCash: 1500,
      lastStanding: true,
      roundLimit: 0,
      targetNetWorth: 0,
      auctions: true,
      allowTrades: true,
      freeParkingPot: false,
      ...input.options,
    },
    { dice: input.dice, chance: input.chance, fate: input.fate },
  );

  input.cash.forEach((amount, i) => state.cash.set(ID(i), amount));

  for (const [player, where] of Object.entries(input.at ?? {})) {
    state.position.set(player, typeof where === 'number' ? where : tileOf(where).position);
  }
  for (const [player, tiles] of Object.entries(input.own ?? {})) {
    for (const id of tiles.trim().split(/\s+/) as MonopolyEstateId[]) {
      state.estates[id].owner = player;
    }
  }
  for (const [id, count] of Object.entries(input.houses ?? {})) {
    state.estates[id as MonopolyEstateId].houses = count ?? 0;
  }
  for (const id of input.mortgaged ?? []) state.estates[id].mortgaged = true;
  for (const [player, turns] of Object.entries(input.jail ?? {})) {
    state.inJail.add(player);
    state.jailTurns.set(player, turns);
    state.position.set(player, JAIL_POSITION);
  }

  state.activeSeat = input.active ?? 0;
  state.phase = input.phase ?? 'roll';
  state.turnSeat = input.turn ?? state.activeSeat;
  state.turnDeadline = Date.now() + MONOPOLY_PHASE_MS[state.phase];
  if (input.pending) state.pending = input.pending;

  return { seats, state };
}

const act = (
  seats: Seats,
  state: MonopolyState,
  player: string,
  action: Parameters<typeof applyMonopolyAction>[3],
) => applyMonopolyAction(seats, state, player, action);

const cashOf = (state: MonopolyState, player: string) => state.cash.get(player) ?? 0;
const posOf = (state: MonopolyState, player: string) => state.position.get(player) ?? 0;
const ownerOf = (state: MonopolyState, id: MonopolyEstateId) => state.estates[id].owner;

// ---------------------------------------------------------------------------

describe('骰子與移動', () => {
  it('死骰序列可以完全重現一次擲骰', () => {
    const { seats, state } = board({ cash: [1500, 1500], dice: [1, 2] });

    const result = act(seats, state, 'a', { kind: 'roll' });
    expect(result.ok).toBe(true);
    expect(state.dice).toEqual([1, 2]);
    expect(posOf(state, 'a')).toBe(3);
    // 空地：停下來問買不買
    expect(state.phase).toBe('buy');
    expect(state.pending).toBe('brown2');
  });

  it('經過起點領薪水', () => {
    const { seats, state } = board({ cash: [1500, 1500], at: { a: 36 }, dice: [4, 3] });

    act(seats, state, 'a', { kind: 'roll' });
    expect(posOf(state, 'a')).toBe(3);
    expect(cashOf(state, 'a')).toBe(1700);
  });

  it('停在起點上也算經過', () => {
    const { seats, state } = board({ cash: [1500, 1500], at: { a: 36 }, dice: [2, 2] });

    act(seats, state, 'a', { kind: 'roll' });
    expect(posOf(state, 'a')).toBe(0);
    expect(cashOf(state, 'a')).toBe(1700);
  });

  it('擲出同點可以再走一次', () => {
    const { seats, state } = board({ cash: [1500, 1500], dice: [2, 2] });

    act(seats, state, 'a', { kind: 'roll' });
    expect(state.doublesCount).toBe(1);
    // 停在 brown2 前面的 4 號所得稅，付完進整理階段
    expect(state.phase).toBe('manage');

    act(seats, state, 'a', { kind: 'endTurn' });
    expect(state.activeSeat).toBe(0);
    expect(state.phase).toBe('roll');
  });

  it('連續三次同點就進監獄，而且回合直接結束', () => {
    const { seats, state } = board({
      cash: [1500, 1500],
      dice: [2, 2, 3, 3, 5, 5],
    });

    act(seats, state, 'a', { kind: 'roll' }); // 4 → 所得稅
    act(seats, state, 'a', { kind: 'endTurn' });
    act(seats, state, 'a', { kind: 'roll' }); // 再 6 → 10（只是路過監獄）
    act(seats, state, 'a', { kind: 'endTurn' });
    act(seats, state, 'a', { kind: 'roll' }); // 第三次同點

    expect(state.inJail.has('a')).toBe(true);
    expect(posOf(state, 'a')).toBe(JAIL_POSITION);
    expect(state.activeSeat).toBe(1);
    expect(state.doublesCount).toBe(0);
  });

  it('踩到進監獄格會被關起來', () => {
    const { seats, state } = board({ cash: [1500, 1500], at: { a: 25 }, dice: [2, 3] });

    act(seats, state, 'a', { kind: 'roll' });
    expect(posOf(state, 'a')).toBe(JAIL_POSITION);
    expect(state.inJail.has('a')).toBe(true);
    expect(state.activeSeat).toBe(1);
  });

  it('停在稅金格要繳稅', () => {
    const { seats, state } = board({ cash: [1500, 1500], at: { a: 0 }, dice: [2, 2] });

    act(seats, state, 'a', { kind: 'roll' });
    expect(posOf(state, 'a')).toBe(4);
    expect(cashOf(state, 'a')).toBe(1300);
  });

  it('開了獎金池時稅金會進池，停到免費停車場的人整碗端走', () => {
    const { seats, state } = board({
      cash: [1500, 1500],
      at: { a: 0 },
      dice: [2, 2],
      options: { freeParkingPot: true },
    });

    act(seats, state, 'a', { kind: 'roll' });
    expect(state.parkingPot).toBe(200);

    state.position.set('b', 16);
    state.activeSeat = 1;
    state.phase = 'roll';
    state.turnSeat = 1;
    state.scriptedDice = [2, 2];
    state.diceAt = 0;
    act(seats, state, 'b', { kind: 'roll' });

    expect(posOf(state, 'b')).toBe(20);
    expect(state.parkingPot).toBe(0);
    expect(cashOf(state, 'b')).toBe(1700);
  });
});

// ---------------------------------------------------------------------------

describe('租金', () => {
  it('素地滿貫租金加倍', () => {
    const { seats, state } = board({
      cash: [1500, 1500],
      at: { a: 0 },
      own: { b: 'brown1 brown2' },
      dice: [1, 2],
    });

    act(seats, state, 'a', { kind: 'roll' });
    // brown2 素地 4，滿貫加倍
    expect(cashOf(state, 'a')).toBe(1500 - 8);
    expect(cashOf(state, 'b')).toBe(1508);
  });

  it('沒滿貫就照原價', () => {
    const { seats, state } = board({
      cash: [1500, 1500],
      at: { a: 0 },
      own: { b: 'brown2' },
      dice: [1, 2],
    });

    act(seats, state, 'a', { kind: 'roll' });
    expect(cashOf(state, 'a')).toBe(1496);
  });

  it('蓋了房子就照級距，不再另外加倍', () => {
    const { seats, state } = board({
      cash: [1500, 1500],
      at: { a: 0 },
      own: { b: 'brown1 brown2' },
      houses: { brown2: 3 },
      dice: [1, 2],
    });

    act(seats, state, 'a', { kind: 'roll' });
    expect(cashOf(state, 'a')).toBe(1500 - 180);
  });

  it('抵押中的地不收租', () => {
    const { seats, state } = board({
      cash: [1500, 1500],
      at: { a: 0 },
      own: { b: 'brown2' },
      mortgaged: ['brown2'],
      dice: [1, 2],
    });

    act(seats, state, 'a', { kind: 'roll' });
    expect(cashOf(state, 'a')).toBe(1500);
    expect(state.phase).toBe('manage');
  });

  it('自己的地不用付錢', () => {
    const { seats, state } = board({
      cash: [1500, 1500],
      at: { a: 0 },
      own: { a: 'brown2' },
      dice: [1, 2],
    });

    act(seats, state, 'a', { kind: 'roll' });
    expect(cashOf(state, 'a')).toBe(1500);
  });

  it('機場租金依持有數 25/50/100/200', () => {
    for (const [count, rent] of [
      ['rail1', 25],
      ['rail1 rail2', 50],
      ['rail1 rail2 rail3', 100],
      ['rail1 rail2 rail3 rail4', 200],
    ] as const) {
      const { seats, state } = board({
        cash: [1500, 1500],
        at: { a: 0 },
        own: { b: count },
        dice: [2, 3],
      });
      act(seats, state, 'a', { kind: 'roll' });
      expect(cashOf(state, 'a')).toBe(1500 - rent);
    }
  });

  it('公用事業一座擲骰四倍、兩座十倍', () => {
    const one = board({
      cash: [1500, 1500],
      at: { a: 10 },
      own: { b: 'utility1' },
      dice: [1, 1],
    });
    act(one.seats, one.state, 'a', { kind: 'roll' });
    expect(cashOf(one.state, 'a')).toBe(1500 - 2 * 4);

    const two = board({
      cash: [1500, 1500],
      at: { a: 10 },
      own: { b: 'utility1 utility2' },
      dice: [1, 1],
    });
    act(two.seats, two.state, 'a', { kind: 'roll' });
    expect(cashOf(two.state, 'a')).toBe(1500 - 2 * 10);
  });

  it('付不出租金就進償債階段，待輸入的還是欠錢的人', () => {
    const { seats, state } = board({
      cash: [10, 1500],
      at: { a: 0 },
      own: { b: 'brown1 brown2' },
      houses: { brown2: 5 },
      dice: [1, 2],
    });

    act(seats, state, 'a', { kind: 'roll' });
    expect(state.phase).toBe('debt');
    expect(state.turnSeat).toBe(0);
    expect(state.debt).toMatchObject({ debtorSeat: 0, creditor: 'b', amount: 450 });
    // 錢還沒動，要等他變現
    expect(cashOf(state, 'a')).toBe(10);
  });
});

// ---------------------------------------------------------------------------

describe('買地與拍賣', () => {
  it('買下來就付錢過戶', () => {
    const { seats, state } = board({ cash: [1500, 1500], phase: 'buy', pending: 'brown2' });

    const result = act(seats, state, 'a', { kind: 'buy' });
    expect(result.ok).toBe(true);
    expect(ownerOf(state, 'brown2')).toBe('a');
    expect(cashOf(state, 'a')).toBe(1440);
    expect(state.phase).toBe('manage');
  });

  it('現金不夠不能買', () => {
    const { seats, state } = board({ cash: [10, 1500], phase: 'buy', pending: 'brown2' });

    const result = act(seats, state, 'a', { kind: 'buy' });
    expect(result).toEqual({ ok: false, error: 'NOT_ENOUGH_CASH' });
  });

  it('不買就開拍，由回合擁有者先喊', () => {
    const { seats, state } = board({ cash: [1500, 1500], phase: 'buy', pending: 'brown2' });

    act(seats, state, 'a', { kind: 'decline' });
    expect(state.phase).toBe('auction');
    expect(state.turnSeat).toBe(0);
    expect(state.auction?.tile).toBe('brown2');
  });

  it('關掉拍賣時不買就流標', () => {
    const { seats, state } = board({
      cash: [1500, 1500],
      phase: 'buy',
      pending: 'brown2',
      options: { auctions: false },
    });

    act(seats, state, 'a', { kind: 'decline' });
    expect(state.phase).toBe('manage');
    expect(ownerOf(state, 'brown2')).toBeNull();
  });

  it('出價不得超過現金 —— 得標付不出來這個狀態不存在', () => {
    const { seats, state } = board({ cash: [50, 1500], phase: 'buy', pending: 'brown2' });
    act(seats, state, 'a', { kind: 'decline' });

    expect(act(seats, state, 'a', { kind: 'bid', amount: 60 })).toEqual({
      ok: false,
      error: 'BID_TOO_HIGH',
    });
  });

  it('出價一定要高過目前最高價', () => {
    const { seats, state } = board({ cash: [1500, 1500], phase: 'buy', pending: 'brown2' });
    act(seats, state, 'a', { kind: 'decline' });
    act(seats, state, 'a', { kind: 'bid', amount: 30 });

    expect(act(seats, state, 'b', { kind: 'bid', amount: 30 })).toEqual({
      ok: false,
      error: 'BID_TOO_LOW',
    });
  });

  it('其他人都 pass 就由最高出價者得標，然後回到整理階段', () => {
    const { seats, state } = board({ cash: [1500, 1500], phase: 'buy', pending: 'brown2' });
    act(seats, state, 'a', { kind: 'decline' });
    act(seats, state, 'a', { kind: 'bid', amount: 30 });
    expect(state.turnSeat).toBe(1);

    act(seats, state, 'b', { kind: 'passBid' });
    expect(state.auction).toBeNull();
    expect(ownerOf(state, 'brown2')).toBe('a');
    expect(cashOf(state, 'a')).toBe(1470);
    expect(state.phase).toBe('manage');
    expect(state.turnSeat).toBe(state.activeSeat);
  });

  it('全部 pass 就流標，地留給銀行', () => {
    const { seats, state } = board({ cash: [1500, 1500], phase: 'buy', pending: 'brown2' });
    act(seats, state, 'a', { kind: 'decline' });
    act(seats, state, 'a', { kind: 'passBid' });
    act(seats, state, 'b', { kind: 'passBid' });

    expect(ownerOf(state, 'brown2')).toBeNull();
    expect(state.phase).toBe('manage');
  });

  it('pass 掉就不再回到競標', () => {
    const { seats, state } = board({ cash: [1500, 1500, 1500], phase: 'buy', pending: 'brown2' });
    act(seats, state, 'a', { kind: 'decline' });
    act(seats, state, 'a', { kind: 'passBid' });
    expect(state.turnSeat).toBe(1);

    act(seats, state, 'b', { kind: 'bid', amount: 40 });
    // a 已經退出，直接輪到 c
    expect(state.turnSeat).toBe(2);

    act(seats, state, 'c', { kind: 'passBid' });
    expect(ownerOf(state, 'brown2')).toBe('b');
  });
});

// ---------------------------------------------------------------------------

describe('蓋房與抵押', () => {
  it('沒湊齊色組不能蓋', () => {
    const { seats, state } = board({ cash: [1500, 1500], phase: 'manage', own: { a: 'brown1' } });
    expect(act(seats, state, 'a', { kind: 'build', tile: 'brown1' })).toEqual({
      ok: false,
      error: 'NOT_FULL_SET',
    });
  });

  it('同色組要平均蓋', () => {
    const { seats, state } = board({
      cash: [1500, 1500],
      phase: 'manage',
      own: { a: 'brown1 brown2' },
      houses: { brown1: 1 },
    });
    expect(act(seats, state, 'a', { kind: 'build', tile: 'brown1' })).toEqual({
      ok: false,
      error: 'BUILD_UNEVEN',
    });
    expect(act(seats, state, 'a', { kind: 'build', tile: 'brown2' }).ok).toBe(true);
  });

  it('蓋到飯店就不能再蓋', () => {
    const { seats, state } = board({
      cash: [1500, 1500],
      phase: 'manage',
      own: { a: 'brown1 brown2' },
      houses: { brown1: 5, brown2: 5 },
    });
    expect(act(seats, state, 'a', { kind: 'build', tile: 'brown1' })).toEqual({
      ok: false,
      error: 'HOUSE_LIMIT',
    });
  });

  it('蓋飯店時把四棟房子還給銀行', () => {
    const { seats, state } = board({
      cash: [1500, 1500],
      phase: 'manage',
      own: { a: 'brown1 brown2' },
      houses: { brown1: 4, brown2: 4 },
    });
    state.houseSupply = 32 - 8;
    state.hotelSupply = 12;

    act(seats, state, 'a', { kind: 'build', tile: 'brown1' });
    expect(state.estates.brown1.houses).toBe(5);
    expect(state.houseSupply).toBe(32 - 8 + 4);
    expect(state.hotelSupply).toBe(11);
    expect(cashOf(state, 'a')).toBe(1450);
  });

  it('拆房子退回一半，飯店拆回四棟房子', () => {
    const { seats, state } = board({
      cash: [1000, 1000],
      phase: 'manage',
      own: { a: 'brown1 brown2' },
      houses: { brown1: 5, brown2: 4 },
    });
    state.houseSupply = 10;
    state.hotelSupply = 11;

    act(seats, state, 'a', { kind: 'sellHouse', tile: 'brown1' });
    expect(state.estates.brown1.houses).toBe(4);
    expect(state.houseSupply).toBe(6);
    expect(state.hotelSupply).toBe(12);
    expect(cashOf(state, 'a')).toBe(1025);
  });

  it('同色組上還有房子就不能抵押', () => {
    const { seats, state } = board({
      cash: [1500, 1500],
      phase: 'manage',
      own: { a: 'brown1 brown2' },
      houses: { brown2: 1 },
    });
    expect(act(seats, state, 'a', { kind: 'mortgage', tile: 'brown1' })).toEqual({
      ok: false,
      error: 'HAS_HOUSES',
    });
  });

  it('抵押拿一半，贖回要多付一成', () => {
    const { seats, state } = board({ cash: [1000, 1000], phase: 'manage', own: { a: 'blue2' } });

    act(seats, state, 'a', { kind: 'mortgage', tile: 'blue2' });
    expect(state.estates.blue2.mortgaged).toBe(true);
    expect(cashOf(state, 'a')).toBe(1200);

    act(seats, state, 'a', { kind: 'unmortgage', tile: 'blue2' });
    expect(state.estates.blue2.mortgaged).toBe(false);
    expect(cashOf(state, 'a')).toBe(1200 - 220);
  });

  it('不是自己的地不能動', () => {
    const { seats, state } = board({ cash: [1500, 1500], phase: 'manage', own: { b: 'brown1' } });
    expect(act(seats, state, 'a', { kind: 'mortgage', tile: 'brown1' })).toEqual({
      ok: false,
      error: 'NOT_OWNER',
    });
  });

  it('銀行房子用光就蓋不了', () => {
    const { seats, state } = board({
      cash: [1500, 1500],
      phase: 'manage',
      own: { a: 'brown1 brown2' },
    });
    state.houseSupply = 0;
    expect(act(seats, state, 'a', { kind: 'build', tile: 'brown1' })).toEqual({
      ok: false,
      error: 'NO_HOUSE_SUPPLY',
    });
  });
});

// ---------------------------------------------------------------------------

describe('償債', () => {
  it('抵押到夠了就自動付掉並回到整理階段', () => {
    const { seats, state } = board({
      cash: [10, 1500],
      at: { a: 0 },
      own: { a: 'blue2', b: 'brown1 brown2' },
      houses: { brown2: 5 },
      dice: [1, 2],
    });

    act(seats, state, 'a', { kind: 'roll' });
    expect(state.phase).toBe('debt');

    act(seats, state, 'a', { kind: 'mortgage', tile: 'blue2' });
    // 10 + 200 = 210 還不夠 450
    expect(state.phase).toBe('debt');

    state.estates.rail1.owner = 'a';
    act(seats, state, 'a', { kind: 'mortgage', tile: 'rail1' });
    // 210 + 100 = 310，仍然不夠
    expect(state.phase).toBe('debt');

    state.cash.set('a', 460);
    state.estates.rail2.owner = 'a';
    act(seats, state, 'a', { kind: 'mortgage', tile: 'rail2' });
    expect(state.phase).toBe('manage');
    expect(state.debt).toBeNull();
    expect(cashOf(state, 'a')).toBe(460 + 100 - 450);
  });

  it('還變現得出來就不准宣告破產', () => {
    const { seats, state } = board({
      cash: [10, 1500],
      at: { a: 0 },
      own: { a: 'blue1 blue2 green1 green2', b: 'brown1 brown2' },
      houses: { brown2: 5 },
      dice: [1, 2],
    });

    act(seats, state, 'a', { kind: 'roll' });
    expect(state.phase).toBe('debt');
    expect(act(seats, state, 'a', { kind: 'declareBankrupt' })).toEqual({
      ok: false,
      error: 'CAN_STILL_PAY',
    });
  });

  it('真的付不出來就破產，資產轉給債主', () => {
    const { seats, state } = board({
      cash: [10, 1500, 1500],
      at: { a: 0 },
      own: { a: 'rail1', b: 'brown1 brown2' },
      houses: { brown2: 5 },
      dice: [1, 2],
    });

    act(seats, state, 'a', { kind: 'roll' });
    expect(state.phase).toBe('debt');

    const result = act(seats, state, 'a', { kind: 'declareBankrupt' });
    expect(result.ok).toBe(true);
    expect(state.bankrupt.has('a')).toBe(true);
    expect(ownerOf(state, 'rail1')).toBe('b');
    expect(cashOf(state, 'a')).toBe(0);
    expect(cashOf(state, 'b')).toBe(1510);
    // 破產的人不再輪到
    expect(state.activeSeat).toBe(1);
  });

  it('破產前房子先半價賣回銀行，錢跟著交給債主', () => {
    const { seats, state } = board({
      cash: [0, 0, 1500],
      phase: 'debt',
      own: { a: 'lightBlue1 lightBlue2 lightBlue3' },
      houses: { lightBlue1: 2, lightBlue2: 2, lightBlue3: 2 },
    });
    state.debt = { debtorSeat: 0, creditor: 'b', amount: 99_999 };
    state.houseSupply = 32 - 6;

    act(seats, state, 'a', { kind: 'declareBankrupt' });

    // 六棟房子 × 每棟造價 50 的一半 = 150
    expect(cashOf(state, 'b')).toBe(150);
    expect(state.houseSupply).toBe(32);
    expect(state.estates.lightBlue1.houses).toBe(0);
    expect(ownerOf(state, 'lightBlue1')).toBe('b');
  });

  it('賠給銀行時土地回到無主狀態，抵押也一併解除', () => {
    const { seats, state } = board({
      cash: [0, 1500, 1500],
      phase: 'debt',
      own: { a: 'rail1 rail2' },
      mortgaged: ['rail2'],
    });
    state.debt = { debtorSeat: 0, creditor: null, amount: 500 };

    act(seats, state, 'a', { kind: 'declareBankrupt' });

    expect(ownerOf(state, 'rail1')).toBeNull();
    expect(ownerOf(state, 'rail2')).toBeNull();
    expect(state.estates.rail2.mortgaged).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('交易', () => {
  it('接受後一次換完，現金與地產同時交割', () => {
    const { seats, state } = board({
      cash: [1000, 1000],
      phase: 'manage',
      own: { a: 'brown1', b: 'rail1' },
    });

    act(seats, state, 'a', {
      kind: 'offerTrade',
      to: 'b',
      give: ['brown1'],
      giveCash: 100,
      want: ['rail1'],
      wantCash: 0,
    });
    expect(state.phase).toBe('trade');
    expect(state.turnSeat).toBe(1);

    act(seats, state, 'b', { kind: 'respondTrade', accept: true });
    expect(ownerOf(state, 'brown1')).toBe('b');
    expect(ownerOf(state, 'rail1')).toBe('a');
    expect(cashOf(state, 'a')).toBe(900);
    expect(cashOf(state, 'b')).toBe(1100);
    expect(state.phase).toBe('manage');
    expect(state.turnSeat).toBe(0);
  });

  it('拒絕之後什麼都不變', () => {
    const { seats, state } = board({
      cash: [1000, 1000],
      phase: 'manage',
      own: { a: 'brown1', b: 'rail1' },
    });

    act(seats, state, 'a', {
      kind: 'offerTrade',
      to: 'b',
      give: ['brown1'],
      giveCash: 100,
      want: ['rail1'],
      wantCash: 0,
    });
    act(seats, state, 'b', { kind: 'respondTrade', accept: false });

    expect(ownerOf(state, 'brown1')).toBe('a');
    expect(ownerOf(state, 'rail1')).toBe('b');
    expect(cashOf(state, 'a')).toBe(1000);
    expect(cashOf(state, 'b')).toBe(1000);
    expect(state.phase).toBe('manage');
  });

  it('帶房子的色組不能拿出來交易', () => {
    const { seats, state } = board({
      cash: [1000, 1000],
      phase: 'manage',
      own: { a: 'brown1 brown2' },
      houses: { brown1: 1 },
    });

    expect(
      act(seats, state, 'a', {
        kind: 'offerTrade',
        to: 'b',
        give: ['brown2'],
        giveCash: 0,
        want: [],
        wantCash: 0,
      }),
    ).toEqual({ ok: false, error: 'BAD_TRADE' });
  });

  it('拿不出來的現金開不了價', () => {
    const { seats, state } = board({ cash: [10, 1000], phase: 'manage', own: { b: 'rail1' } });

    expect(
      act(seats, state, 'a', {
        kind: 'offerTrade',
        to: 'b',
        give: [],
        giveCash: 500,
        want: ['rail1'],
        wantCash: 0,
      }),
    ).toEqual({ ok: false, error: 'NOT_ENOUGH_CASH' });
  });

  it('關掉交易就不能提', () => {
    const { seats, state } = board({
      cash: [1000, 1000],
      phase: 'manage',
      own: { b: 'rail1' },
      options: { allowTrades: false },
    });

    expect(
      act(seats, state, 'a', {
        kind: 'offerTrade',
        to: 'b',
        give: [],
        giveCash: 100,
        want: ['rail1'],
        wantCash: 0,
      }),
    ).toEqual({ ok: false, error: 'TRADES_DISABLED' });
  });
});

// ---------------------------------------------------------------------------

describe('監獄', () => {
  it('交保後可以正常擲骰', () => {
    const { seats, state } = board({
      cash: [1500, 1500],
      phase: 'jail',
      jail: { a: 1 },
      dice: [1, 2],
    });

    act(seats, state, 'a', { kind: 'payBail' });
    expect(state.inJail.has('a')).toBe(false);
    expect(cashOf(state, 'a')).toBe(1500 - JAIL_BAIL);
    expect(state.phase).toBe('roll');
  });

  it('用免費出獄卡不用付錢', () => {
    const { seats, state } = board({ cash: [1500, 1500], phase: 'jail', jail: { a: 0 } });
    state.jailCards.set('a', 1);

    act(seats, state, 'a', { kind: 'useJailCard' });
    expect(state.inJail.has('a')).toBe(false);
    expect(state.jailCards.get('a')).toBe(0);
    expect(cashOf(state, 'a')).toBe(1500);
  });

  it('沒有卡就不能用', () => {
    const { seats, state } = board({ cash: [1500, 1500], phase: 'jail', jail: { a: 0 } });
    expect(act(seats, state, 'a', { kind: 'useJailCard' })).toEqual({
      ok: false,
      error: 'NO_JAIL_CARD',
    });
  });

  it('擲出同點就出獄並移動，但不多送一次擲骰', () => {
    const { seats, state } = board({
      cash: [1500, 1500],
      phase: 'jail',
      jail: { a: 0 },
      dice: [3, 3],
    });

    act(seats, state, 'a', { kind: 'rollForDoubles' });
    expect(state.inJail.has('a')).toBe(false);
    expect(posOf(state, 'a')).toBe(16);
    expect(state.doublesCount).toBe(0);
  });

  it('沒擲出同點就繼續關，回合換人', () => {
    const { seats, state } = board({
      cash: [1500, 1500],
      phase: 'jail',
      jail: { a: 0 },
      dice: [1, 2],
    });

    act(seats, state, 'a', { kind: 'rollForDoubles' });
    expect(state.inJail.has('a')).toBe(true);
    expect(state.jailTurns.get('a')).toBe(1);
    expect(state.activeSeat).toBe(1);
  });

  it('關滿三巡就強制交保並移動', () => {
    const { seats, state } = board({
      cash: [1500, 1500],
      phase: 'jail',
      jail: { a: 2 },
      dice: [1, 2],
    });

    act(seats, state, 'a', { kind: 'rollForDoubles' });
    expect(state.inJail.has('a')).toBe(false);
    expect(cashOf(state, 'a')).toBe(1500 - JAIL_BAIL);
    expect(posOf(state, 'a')).toBe(13);
  });
});

// ---------------------------------------------------------------------------

describe('機會與命運', () => {
  it('卡片可以把人移到別的格子並就地結算', () => {
    const { seats, state } = board({
      cash: [1500, 1500],
      at: { a: 5 },
      own: { b: 'blue2' },
      dice: [1, 1, 1, 1],
      chance: ['chanceBlue2'],
    });
    // 5 + 2 = 7 是機會格
    act(seats, state, 'a', { kind: 'roll' });

    expect(posOf(state, 'a')).toBe(39);
    // 7 → 39 是往前走，沒有經過起點，所以只付了 blue2 的素地租金 50
    expect(cashOf(state, 'a')).toBe(1450);
  });

  it('卡片把人送回起點時領得到薪水', () => {
    const { seats, state } = board({
      cash: [1500, 1500],
      at: { a: 5 },
      dice: [1, 1],
      chance: ['chanceGo'],
    });

    act(seats, state, 'a', { kind: 'roll' });
    expect(posOf(state, 'a')).toBe(0);
    expect(cashOf(state, 'a')).toBe(1700);
  });

  it('免費出獄卡會存起來', () => {
    const { seats, state } = board({
      cash: [1500, 1500],
      at: { a: 5 },
      dice: [1, 1],
      chance: ['chanceJailCard'],
    });

    act(seats, state, 'a', { kind: 'roll' });
    expect(state.jailCards.get('a')).toBe(1);
  });

  it('卡片叫你入獄就直接關，回合結束', () => {
    const { seats, state } = board({
      cash: [1500, 1500],
      at: { a: 5 },
      dice: [1, 1],
      chance: ['chanceGoToJail'],
    });

    act(seats, state, 'a', { kind: 'roll' });
    expect(state.inJail.has('a')).toBe(true);
    expect(state.activeSeat).toBe(1);
  });

  it('向每位玩家收錢', () => {
    const { seats, state } = board({
      cash: [1500, 1500, 1500],
      at: { a: 0 },
      dice: [1, 1],
      fate: ['fateOpening'],
    });
    // 0 + 2 = 2 是命運格
    act(seats, state, 'a', { kind: 'roll' });

    expect(cashOf(state, 'a')).toBe(1600);
    expect(cashOf(state, 'b')).toBe(1450);
    expect(cashOf(state, 'c')).toBe(1450);
  });

  it('修繕費依房屋數計算', () => {
    const { seats, state } = board({
      cash: [1500, 1500],
      at: { a: 0 },
      own: { a: 'brown1 brown2' },
      houses: { brown1: 2, brown2: 5 },
      dice: [1, 1],
      fate: ['fateStreetRepairs'],
    });

    act(seats, state, 'a', { kind: 'roll' });
    expect(cashOf(state, 'a')).toBe(1500 - (2 * 40 + 115));
  });
});

// ---------------------------------------------------------------------------

describe('結算條件', () => {
  it('破產淘汰：只剩一位就結束，名次照身家排', () => {
    const { seats, state } = board({
      cash: [0, 1500],
      phase: 'debt',
      options: { lastStanding: true },
    });
    state.debt = { debtorSeat: 0, creditor: 'b', amount: 500 };

    act(seats, state, 'a', { kind: 'declareBankrupt' });
    expect(state.over).toBe(true);
    expect(state.result).toMatchObject({ reason: 'lastStanding', ranking: ['b', 'a'] });
  });

  it('巡數上限：走完最後一巡就結束', () => {
    const { seats, state } = board({
      cash: [1500, 2000],
      phase: 'manage',
      options: { roundLimit: 1 },
    });

    act(seats, state, 'a', { kind: 'endTurn' });
    expect(state.over).toBe(false);
    expect(state.activeSeat).toBe(1);

    state.phase = 'manage';
    act(seats, state, 'b', { kind: 'endTurn' });
    expect(state.over).toBe(true);
    expect(state.result?.reason).toBe('roundLimit');
    expect(state.result?.ranking).toEqual(['b', 'a']);
  });

  it('身家目標：有人達標就結束', () => {
    const { seats, state } = board({
      cash: [1500, 1500],
      phase: 'manage',
      own: { a: 'blue1 blue2' },
      options: { targetNetWorth: 2000 },
    });

    act(seats, state, 'a', { kind: 'endTurn' });
    expect(state.over).toBe(true);
    expect(state.result?.reason).toBe('targetNetWorth');
    expect(state.result?.ranking[0]).toBe('a');
  });

  it('三個條件可以同時開，最先觸發的那個結束整局', () => {
    const { seats, state } = board({
      cash: [1500, 1500],
      phase: 'manage',
      own: { a: 'blue1 blue2' },
      options: { lastStanding: true, roundLimit: 20, targetNetWorth: 2000 },
    });

    act(seats, state, 'a', { kind: 'endTurn' });
    expect(state.result?.reason).toBe('targetNetWorth');
  });

  it('身家把抵押算成一半', () => {
    const { seats, state } = board({
      cash: [1000],
      own: { a: 'blue2' },
      mortgaged: ['blue2'],
    });
    expect(netWorthOf(cashOf(state, 'a'), state.estates, 'a')).toBe(
      1000 + tileOf('blue2').price - mortgageValue(tileOf('blue2')),
    );
  });
});

// ---------------------------------------------------------------------------

describe('逾時代打', () => {
  const PHASES: MonopolyPhase[] = ['roll', 'jail', 'buy', 'auction', 'trade', 'debt', 'manage'];

  /** 把局面擺到指定階段。這是「代打一定讓局面前進」那條測試的素材。 */
  function stagedFor(phase: MonopolyPhase): { seats: Seats; state: MonopolyState } {
    switch (phase) {
      case 'roll':
        return board({ cash: [1500, 1500], dice: [1, 2] });
      case 'jail':
        return board({ cash: [1500, 1500], phase: 'jail', jail: { a: 0 }, dice: [1, 2] });
      case 'buy':
        return board({ cash: [1500, 1500], phase: 'buy', pending: 'brown2' });
      case 'auction': {
        const staged = board({ cash: [1500, 1500], phase: 'buy', pending: 'brown2' });
        act(staged.seats, staged.state, 'a', { kind: 'decline' });
        return staged;
      }
      case 'trade': {
        const staged = board({
          cash: [1000, 1000],
          phase: 'manage',
          own: { a: 'brown1', b: 'rail1' },
        });
        act(staged.seats, staged.state, 'a', {
          kind: 'offerTrade',
          to: 'b',
          give: ['brown1'],
          giveCash: 0,
          want: ['rail1'],
          wantCash: 0,
        });
        return staged;
      }
      case 'debt': {
        // 三人才看得出代打之後回合有沒有繼續走；兩人的話 a 一破產整局就結束了
        const staged = board({
          cash: [10, 1500, 1500],
          at: { a: 0 },
          own: { b: 'brown1 brown2' },
          houses: { brown2: 5 },
          dice: [1, 2],
        });
        act(staged.seats, staged.state, 'a', { kind: 'roll' });
        return staged;
      }
      case 'manage':
        return board({ cash: [1500, 1500], phase: 'manage' });
    }
  }

  it.each(PHASES)('%s 階段的代打一定讓局面前進', (phase) => {
    const { seats, state } = stagedFor(phase);
    expect(state.phase).toBe(phase);

    const before = { phase: state.phase, turnSeat: state.turnSeat, over: state.over };
    const acted = autoActMonopoly(seats, state);

    expect(acted).not.toBeNull();
    const changed =
      state.phase !== before.phase ||
      state.turnSeat !== before.turnSeat ||
      state.over !== before.over;
    expect(changed).toBe(true);
  });

  it('償債階段的代打一次做到底：變現不夠就直接破產', () => {
    const { seats, state } = stagedFor('debt');

    autoActMonopoly(seats, state);
    expect(state.bankrupt.has('a')).toBe(true);
    expect(state.debt).toBeNull();
    expect(state.phase).not.toBe('debt');
    // 破產的人不再輪到，回合換給下一位
    expect(state.activeSeat).toBe(1);
  });

  it('償債階段的代打湊得出來就付掉，不必破產', () => {
    const { seats, state } = board({
      cash: [10, 1500],
      at: { a: 0 },
      own: { a: 'blue1 blue2 green1 green2 green3', b: 'brown1 brown2' },
      houses: { brown2: 5 },
      dice: [1, 2],
    });
    act(seats, state, 'a', { kind: 'roll' });
    expect(state.phase).toBe('debt');

    autoActMonopoly(seats, state);
    expect(state.bankrupt.has('a')).toBe(false);
    expect(state.phase).toBe('manage');
    expect(cashOf(state, 'b')).toBe(1950);
  });

  it('買地階段逾時視同不買', () => {
    const { seats, state } = stagedFor('buy');
    autoActMonopoly(seats, state);
    expect(state.phase).toBe('auction');
  });

  it('交易階段逾時視同拒絕', () => {
    const { seats, state } = stagedFor('trade');
    autoActMonopoly(seats, state);
    expect(state.trade).toBeNull();
    expect(ownerOf(state, 'brown1')).toBe('a');
    expect(state.phase).toBe('manage');
  });
});

// ---------------------------------------------------------------------------

describe('中途離開', () => {
  it('地產全部還給銀行', () => {
    const { seats, state } = board({
      cash: [1500, 1500, 1500],
      phase: 'manage',
      own: { a: 'brown1 brown2' },
      houses: { brown1: 2 },
    });
    state.houseSupply = 30;

    removePlayerFromMonopoly(seats, state, 'a');
    expect(ownerOf(state, 'brown1')).toBeNull();
    expect(state.estates.brown1.houses).toBe(0);
    expect(state.houseSupply).toBe(32);
    expect(seats[0]).toBeNull();
  });

  it('離開的是回合擁有者就換下一位', () => {
    const { seats, state } = board({ cash: [1500, 1500, 1500], phase: 'manage', active: 0 });

    removePlayerFromMonopoly(seats, state, 'a');
    expect(state.activeSeat).toBe(1);
    expect(state.phase).toBe('roll');
  });

  it('最高出價者離場就整場拍賣作廢', () => {
    const { seats, state } = board({ cash: [1500, 1500, 1500], phase: 'buy', pending: 'brown2' });
    act(seats, state, 'a', { kind: 'decline' });
    act(seats, state, 'a', { kind: 'bid', amount: 50 });
    expect(state.turnSeat).toBe(1);

    removePlayerFromMonopoly(seats, state, 'a');
    expect(state.auction).toBeNull();
    expect(ownerOf(state, 'brown2')).toBeNull();
    expect(state.phase).toBe('roll');
  });

  it('喊價中的人離場就換下一位喊，拍賣繼續', () => {
    const { seats, state } = board({ cash: [1500, 1500, 1500], phase: 'buy', pending: 'brown2' });
    act(seats, state, 'a', { kind: 'decline' });
    act(seats, state, 'a', { kind: 'bid', amount: 50 });
    expect(state.turnSeat).toBe(1);

    removePlayerFromMonopoly(seats, state, 'b');
    expect(state.phase).toBe('auction');
    expect(state.turnSeat).toBe(2);

    act(seats, state, 'c', { kind: 'passBid' });
    expect(ownerOf(state, 'brown2')).toBe('a');
    expect(state.phase).toBe('manage');
  });

  it('交易對象離場就取消交易', () => {
    const { seats, state } = board({
      cash: [1000, 1000, 1000],
      phase: 'manage',
      own: { a: 'brown1', b: 'rail1' },
    });
    act(seats, state, 'a', {
      kind: 'offerTrade',
      to: 'b',
      give: ['brown1'],
      giveCash: 0,
      want: ['rail1'],
      wantCash: 0,
    });

    removePlayerFromMonopoly(seats, state, 'b');
    expect(state.trade).toBeNull();
    expect(state.phase).toBe('manage');
    expect(state.turnSeat).toBe(0);
    expect(ownerOf(state, 'brown1')).toBe('a');
  });

  it('走到剩一個人就結束', () => {
    const { seats, state } = board({ cash: [1500, 1500], phase: 'manage' });

    removePlayerFromMonopoly(seats, state, 'b');
    expect(state.over).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('輸入守衛', () => {
  it('不是待輸入的座位就不能動作', () => {
    const { seats, state } = board({ cash: [1500, 1500] });
    expect(act(seats, state, 'b', { kind: 'roll' })).toEqual({ ok: false, error: 'NOT_YOUR_TURN' });
  });

  it('階段不對就擋下來', () => {
    const { seats, state } = board({ cash: [1500, 1500], phase: 'manage' });
    expect(act(seats, state, 'a', { kind: 'roll' })).toEqual({ ok: false, error: 'WRONG_PHASE' });
  });

  it('遊戲結束後不再收動作', () => {
    const { seats, state } = board({ cash: [1500, 1500], phase: 'manage' });
    state.over = true;
    expect(act(seats, state, 'a', { kind: 'endTurn' })).toEqual({
      ok: false,
      error: 'GAME_NOT_RUNNING',
    });
  });

  it('破產的人不能再動作', () => {
    const { seats, state } = board({ cash: [1500, 1500, 1500], phase: 'manage' });
    state.bankrupt.add('a');
    expect(act(seats, state, 'a', { kind: 'endTurn' })).toEqual({ ok: false, error: 'BANKRUPT' });
  });
});

// ---------------------------------------------------------------------------

describe('棋盤資料', () => {
  it('28 塊地都買得到，其餘 12 格不能買', () => {
    expect(MONOPOLY_ESTATE_IDS).toHaveLength(28);
    for (const id of MONOPOLY_ESTATE_IDS) expect(tileOf(id).price).toBeGreaterThan(0);
  });

  it('每塊街道都有六級租金', () => {
    for (const id of MONOPOLY_ESTATE_IDS) {
      const tile = tileOf(id);
      if (tile.kind !== 'property') continue;
      expect(tile.rent).toHaveLength(6);
      expect(tile.houseCost).toBeGreaterThan(0);
    }
  });
});
