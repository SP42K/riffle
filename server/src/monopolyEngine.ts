import {
  BOARD_SIZE,
  CHANCE_DECK,
  DEFAULT_MONOPOLY_OPTIONS,
  DOUBLES_TO_JAIL,
  FATE_DECK,
  HOTEL_SUPPLY,
  HOUSE_SUPPLY,
  JAIL_BAIL,
  JAIL_MAX_TURNS,
  JAIL_POSITION,
  MAX_HOUSES,
  MONOPOLY_CARD_EFFECT,
  MONOPOLY_ESTATE_IDS,
  MONOPOLY_GROUP_TILES,
  MONOPOLY_PHASE_MS,
  MONOPOLY_SALARY,
  NO_MONOPOLY_ACTIONS,
  buildBlock,
  emptyEstates,
  houseRefund,
  isEstateId,
  liquidValueOf,
  mortgageValue,
  nearestPosition,
  netWorthOf,
  ownedBy,
  rentOf,
  sellBlock,
  shuffle,
  tileAt,
  tileOf,
  unmortgageCost,
  type EstateTable,
  type MonopolyAction,
  type MonopolyActions,
  type MonopolyCardId,
  type MonopolyEndReason,
  type MonopolyEstateId,
  type MonopolyOptions,
  type MonopolyPhase,
  type MonopolyTileId,
  type PlayerId,
} from 'shared';
import type { Seats } from './gameEngine.js';
import type { TurnBased } from './turnBased.js';

// ---------------------------------------------------------------------------
// 狀態
// ---------------------------------------------------------------------------

/** 拍賣：單輪加價制，pass 掉就不再回來，所以一定收斂。 */
export interface AuctionState {
  tile: MonopolyEstateId;
  highBid: number;
  highBidder: PlayerId | null;
  /** 現在輪到哪個座位喊價。 */
  bidderSeat: number;
  passed: Set<number>;
}

export interface TradeState {
  fromSeat: number;
  toSeat: number;
  give: MonopolyEstateId[];
  giveCash: number;
  want: MonopolyEstateId[];
  wantCash: number;
}

export interface DebtState {
  debtorSeat: number;
  /** null 表示欠銀行。 */
  creditor: PlayerId | null;
  amount: number;
}

export interface MonopolyResult {
  reason: MonopolyEndReason;
  ranking: PlayerId[];
}

/**
 * 大富翁的整局狀態。
 *
 * turnSeat（來自 TurnBased）是「現在該送出動作的座位」，不是「輪到誰」——
 * 拍賣時是喊價者、交易時是被詢問的一方、償債時是欠錢的人。
 * 「這一巡輪到誰的回合」記在 activeSeat，房間層完全不必知道這件事。
 */
export interface MonopolyState extends TurnBased {
  options: MonopolyOptions;
  activeSeat: number;
  phase: MonopolyPhase;
  round: number;
  cash: Map<PlayerId, number>;
  position: Map<PlayerId, number>;
  inJail: Set<PlayerId>;
  jailTurns: Map<PlayerId, number>;
  jailCards: Map<PlayerId, number>;
  estates: EstateTable;
  bankrupt: Set<PlayerId>;
  /** 破產的先後，用來排名次（先破產的排後面）。 */
  bankruptOrder: PlayerId[];
  dice: [number, number] | null;
  /** 這一回合已經連續擲出幾次同點。大於 0 表示還有一次追加的擲骰。 */
  doublesCount: number;
  parkingPot: number;
  houseSupply: number;
  hotelSupply: number;
  chanceDeck: MonopolyCardId[];
  chanceAt: number;
  fateDeck: MonopolyCardId[];
  fateAt: number;
  /** buy 階段正在問的那塊地。 */
  pending: MonopolyEstateId | null;
  auction: AuctionState | null;
  trade: TradeState | null;
  debt: DebtState | null;
  result: MonopolyResult | null;
  rng: () => number;
  /** 測試用的死骰序列，用完就回到 rng。 */
  scriptedDice: number[];
  diceAt: number;
}

export type MonopolyError =
  | 'GAME_NOT_RUNNING'
  | 'NOT_YOUR_TURN'
  | 'WRONG_PHASE'
  | 'BANKRUPT'
  | 'NOT_ENOUGH_CASH'
  | 'NOT_FOR_SALE'
  | 'BAD_TILE'
  | 'NOT_OWNER'
  | 'NOT_FULL_SET'
  | 'BUILD_UNEVEN'
  | 'HOUSE_LIMIT'
  | 'NO_HOUSES'
  | 'HAS_HOUSES'
  | 'MORTGAGED'
  | 'NOT_MORTGAGED'
  | 'MORTGAGED_IN_GROUP'
  | 'NO_HOUSE_SUPPLY'
  | 'NO_HOTEL_SUPPLY'
  | 'BID_TOO_LOW'
  | 'BID_TOO_HIGH'
  | 'NOT_IN_JAIL'
  | 'NO_JAIL_CARD'
  | 'TRADES_DISABLED'
  | 'BAD_TRADE'
  | 'CAN_STILL_PAY';

export const MONOPOLY_ERROR_MESSAGE: Record<MonopolyError, string> = {
  GAME_NOT_RUNNING: '遊戲尚未開始',
  NOT_YOUR_TURN: '還沒輪到你',
  WRONG_PHASE: '現在不能做這個動作',
  BANKRUPT: '你已經破產了',
  NOT_ENOUGH_CASH: '現金不夠',
  NOT_FOR_SALE: '這塊地不能買',
  BAD_TILE: '找不到這塊地',
  NOT_OWNER: '這塊地不是你的',
  NOT_FULL_SET: '要先湊齊整個色組才能蓋房子',
  BUILD_UNEVEN: '同色組要平均蓋，先蓋房子少的那塊',
  HOUSE_LIMIT: '已經蓋到飯店了',
  NO_HOUSES: '這塊地上沒有房子',
  HAS_HOUSES: '要先把同色組的房子賣掉',
  MORTGAGED: '這塊地已經抵押了',
  NOT_MORTGAGED: '這塊地沒有抵押',
  MORTGAGED_IN_GROUP: '同色組裡有地還在抵押中',
  NO_HOUSE_SUPPLY: '銀行的房子不夠了',
  NO_HOTEL_SUPPLY: '銀行的飯店不夠了',
  BID_TOO_LOW: '出價要比目前最高價高',
  BID_TOO_HIGH: '出價不能超過手上的現金',
  NOT_IN_JAIL: '你不在監獄裡',
  NO_JAIL_CARD: '你沒有免費出獄卡',
  TRADES_DISABLED: '這個房間沒有開放交易',
  BAD_TRADE: '這筆交易的內容不合法',
  CAN_STILL_PAY: '你還付得出來，不能宣告破產',
};

/** 引擎只吐 playerId，暱稱由房間層換上 —— 一個動作可能生出好幾行戰報。 */
export type MonopolyEvent =
  | { t: 'move'; player: PlayerId; dice: [number, number]; tile: MonopolyTileId }
  | { t: 'buy'; player: PlayerId; tile: MonopolyEstateId; price: number }
  | { t: 'rent'; player: PlayerId; owner: PlayerId; tile: MonopolyEstateId; amount: number }
  | { t: 'tax'; player: PlayerId; tile: MonopolyTileId; amount: number }
  | { t: 'cash'; player: PlayerId; amount: number; source: 'salary' | 'parking' | 'card' | 'players' }
  | { t: 'auctionStart'; tile: MonopolyEstateId }
  | { t: 'bid'; player: PlayerId; amount: number }
  | { t: 'auctionEnd'; player: PlayerId | null; tile: MonopolyEstateId; amount: number }
  | { t: 'build'; player: PlayerId; tile: MonopolyEstateId; houses: number; sold: boolean }
  | { t: 'mortgage'; player: PlayerId; tile: MonopolyEstateId; amount: number; redeem: boolean }
  | { t: 'drawCard'; player: PlayerId; card: MonopolyCardId }
  | { t: 'jailed'; player: PlayerId }
  | { t: 'freed'; player: PlayerId; how: 'bail' | 'card' | 'doubles' | 'served' }
  | {
      t: 'trade';
      from: PlayerId;
      to: PlayerId;
      give: MonopolyEstateId[];
      giveCash: number;
      want: MonopolyEstateId[];
      wantCash: number;
    }
  | { t: 'bankrupt'; player: PlayerId; creditor: PlayerId | null }
  | { t: 'over'; reason: MonopolyEndReason; ranking: PlayerId[] };

type Result = { ok: true; events: MonopolyEvent[] } | { ok: false; error: MonopolyError };

// ---------------------------------------------------------------------------
// 座位與現金
// ---------------------------------------------------------------------------

function playerAt(seats: Seats, seat: number): PlayerId | null {
  return seats[seat] ?? null;
}

/** 還在場上的座位：有人坐、而且還沒破產。 */
export function solventSeats(seats: Seats, state: MonopolyState): number[] {
  return seats.flatMap((playerId, seat) =>
    playerId && !state.bankrupt.has(playerId) ? [seat] : [],
  );
}

function nextSolventSeat(seats: Seats, state: MonopolyState, from: number): number {
  const solvent = solventSeats(seats, state);
  for (let step = 1; step <= seats.length; step++) {
    const seat = (from + step) % seats.length;
    if (solvent.includes(seat)) return seat;
  }
  return from;
}

function cashOf(state: MonopolyState, playerId: PlayerId): number {
  return state.cash.get(playerId) ?? 0;
}

function addCash(state: MonopolyState, playerId: PlayerId, amount: number): void {
  state.cash.set(playerId, cashOf(state, playerId) + amount);
}

function positionOf(state: MonopolyState, playerId: PlayerId): number {
  return state.position.get(playerId) ?? 0;
}

/** 稅金與罰款進不進獎金池是房間選項；沒開就直接消失（回銀行）。 */
function toBank(state: MonopolyState, amount: number): void {
  if (state.options.freeParkingPot) state.parkingPot += amount;
}

function enterPhase(state: MonopolyState, phase: MonopolyPhase, seat: number): void {
  state.phase = phase;
  state.turnSeat = seat;
  state.turnDeadline = Date.now() + MONOPOLY_PHASE_MS[phase];
}

// ---------------------------------------------------------------------------
// 開局
// ---------------------------------------------------------------------------

export interface MonopolySetup {
  rng?: () => number;
  /** 死骰序列，一次取一顆；用完之後回到 rng。 */
  dice?: readonly number[];
  /** 指定牌堆順序，不給就洗牌。 */
  chance?: readonly MonopolyCardId[];
  fate?: readonly MonopolyCardId[];
}

export function startMonopoly(
  seats: Seats,
  options: MonopolyOptions = DEFAULT_MONOPOLY_OPTIONS,
  setup: MonopolySetup = {},
): MonopolyState {
  const rng = setup.rng ?? Math.random;
  const cash = new Map<PlayerId, number>();
  const position = new Map<PlayerId, number>();
  const jailTurns = new Map<PlayerId, number>();
  const jailCards = new Map<PlayerId, number>();

  for (const playerId of seats) {
    if (!playerId) continue;
    cash.set(playerId, options.startCash);
    position.set(playerId, 0);
    jailTurns.set(playerId, 0);
    jailCards.set(playerId, 0);
  }

  const first = seats.findIndex((id) => id !== null);
  const state: MonopolyState = {
    options,
    activeSeat: first === -1 ? 0 : first,
    phase: 'roll',
    round: 1,
    cash,
    position,
    inJail: new Set(),
    jailTurns,
    jailCards,
    estates: emptyEstates(),
    bankrupt: new Set(),
    bankruptOrder: [],
    dice: null,
    doublesCount: 0,
    parkingPot: 0,
    houseSupply: HOUSE_SUPPLY,
    hotelSupply: HOTEL_SUPPLY,
    chanceDeck: setup.chance ? setup.chance.slice() : shuffle(CHANCE_DECK, rng),
    chanceAt: 0,
    fateDeck: setup.fate ? setup.fate.slice() : shuffle(FATE_DECK, rng),
    fateAt: 0,
    pending: null,
    auction: null,
    trade: null,
    debt: null,
    result: null,
    turnSeat: first === -1 ? 0 : first,
    turnDeadline: 0,
    over: false,
    rng,
    scriptedDice: setup.dice ? setup.dice.slice() : [],
    diceAt: 0,
  };

  enterPhase(state, 'roll', state.activeSeat);
  return state;
}

// ---------------------------------------------------------------------------
// 骰子與移動
// ---------------------------------------------------------------------------

function rollDie(state: MonopolyState): number {
  const scripted = state.scriptedDice[state.diceAt];
  if (scripted !== undefined) {
    state.diceAt += 1;
    return scripted;
  }
  return Math.floor(state.rng() * 6) + 1;
}

function rollDice(state: MonopolyState): [number, number] {
  return [rollDie(state), rollDie(state)];
}

/** 移動到指定位置。collectSalary 為 true 且經過起點時領薪水。 */
function moveTo(
  state: MonopolyState,
  playerId: PlayerId,
  target: number,
  collectSalary: boolean,
  events: MonopolyEvent[],
): void {
  const from = positionOf(state, playerId);
  const to = ((target % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE;
  state.position.set(playerId, to);
  if (collectSalary && to < from) {
    addCash(state, playerId, MONOPOLY_SALARY);
    events.push({ t: 'cash', player: playerId, amount: MONOPOLY_SALARY, source: 'salary' });
  }
}

function sendToJail(
  seats: Seats,
  state: MonopolyState,
  playerId: PlayerId,
  events: MonopolyEvent[],
): void {
  state.position.set(playerId, JAIL_POSITION);
  state.inJail.add(playerId);
  state.jailTurns.set(playerId, 0);
  state.doublesCount = 0;
  events.push({ t: 'jailed', player: playerId });
  advanceTurn(seats, state, events);
}

// ---------------------------------------------------------------------------
// 收付
// ---------------------------------------------------------------------------

/**
 * 當前回合玩家付錢。付不出來就開一個償債階段讓他自己挑要賣什麼，回傳 false。
 * 只有 activeSeat 走這條路 —— 別人被迫付錢時不能讓全桌停下來等他挑。
 */
function settle(
  seats: Seats,
  state: MonopolyState,
  seat: number,
  creditor: PlayerId | null,
  amount: number,
): boolean {
  const player = playerAt(seats, seat);
  if (!player || amount <= 0) return true;

  if (cashOf(state, player) >= amount) {
    addCash(state, player, -amount);
    if (creditor) addCash(state, creditor, amount);
    else toBank(state, amount);
    return true;
  }

  state.debt = { debtorSeat: seat, creditor, amount };
  enterPhase(state, 'debt', seat);
  return false;
}

/** 依固定順序拆房、抵押，直到現金足夠或者再也擠不出東西。 */
function liquidateUntil(state: MonopolyState, playerId: PlayerId, target: number): void {
  for (let guard = 0; guard < MONOPOLY_ESTATE_IDS.length * (MAX_HOUSES + 1); guard++) {
    if (cashOf(state, playerId) >= target) return;

    // 先拆房子：從房子最多的那塊拆，才不會違反平均蓋房
    const owned = ownedBy(state.estates, playerId);
    const withHouses = owned
      .filter((id) => sellBlock(state.estates, id, playerId) === null)
      .sort((a, b) => state.estates[b].houses - state.estates[a].houses);
    const house = withHouses[0];
    if (house) {
      sellHouseAt(state, house);
      addCash(state, playerId, houseRefund(tileOf(house)));
      continue;
    }

    // 再抵押：從抵押金額最高的開始，把次數壓到最少
    const free = owned
      .filter((id) => !state.estates[id].mortgaged)
      .sort((a, b) => mortgageValue(tileOf(b)) - mortgageValue(tileOf(a)));
    const land = free[0];
    if (land) {
      state.estates[land].mortgaged = true;
      addCash(state, playerId, mortgageValue(tileOf(land)));
      continue;
    }
    return;
  }
}

/**
 * 沒得商量的償付：先自動變現，還是不夠就直接破產。
 * 用在「不是當前回合的人被迫付錢」與逾時代打 —— 兩者都不能停下來等他挑。
 */
function forceSettle(
  seats: Seats,
  state: MonopolyState,
  seat: number,
  creditor: PlayerId | null,
  amount: number,
  events: MonopolyEvent[],
): void {
  const player = playerAt(seats, seat);
  if (!player || amount <= 0) return;

  liquidateUntil(state, player, amount);
  if (cashOf(state, player) >= amount) {
    addCash(state, player, -amount);
    if (creditor) addCash(state, creditor, amount);
    else toBank(state, amount);
    return;
  }
  bankruptPlayer(seats, state, seat, creditor, events);
}

// ---------------------------------------------------------------------------
// 房屋庫存
// ---------------------------------------------------------------------------

/** 蓋一棟（4 → 5 是換飯店，會把四棟房子還給銀行）。 */
function buildAt(state: MonopolyState, id: MonopolyEstateId): MonopolyError | null {
  const estate = state.estates[id];
  if (estate.houses === MAX_HOUSES - 1) {
    if (state.hotelSupply < 1) return 'NO_HOTEL_SUPPLY';
    state.hotelSupply -= 1;
    state.houseSupply += MAX_HOUSES - 1;
  } else {
    if (state.houseSupply < 1) return 'NO_HOUSE_SUPPLY';
    state.houseSupply -= 1;
  }
  estate.houses += 1;
  return null;
}

/** 拆一棟（5 → 4 要從銀行拿回四棟房子）。 */
function sellHouseAt(state: MonopolyState, id: MonopolyEstateId): MonopolyError | null {
  const estate = state.estates[id];
  if (estate.houses === MAX_HOUSES) {
    if (state.houseSupply < MAX_HOUSES - 1) return 'NO_HOUSE_SUPPLY';
    state.houseSupply -= MAX_HOUSES - 1;
    state.hotelSupply += 1;
  } else {
    state.houseSupply += 1;
  }
  estate.houses -= 1;
  return null;
}

/** 把地上的建物整批還給銀行（破產或離開房間時用）。 */
function releaseBuildings(state: MonopolyState, id: MonopolyEstateId): void {
  const estate = state.estates[id];
  if (estate.houses === MAX_HOUSES) state.hotelSupply += 1;
  else state.houseSupply += estate.houses;
  estate.houses = 0;
}

// ---------------------------------------------------------------------------
// 落地結算
// ---------------------------------------------------------------------------

/**
 * 結算停留的格子。
 * 回傳 true 表示流程已經被接管（進了 buy／auction／debt，或直接把回合結束掉），
 * 呼叫端就不要再自己推進到 manage 階段。
 */
function resolveLanding(
  seats: Seats,
  state: MonopolyState,
  seat: number,
  events: MonopolyEvent[],
  depth = 0,
): boolean {
  const player = playerAt(seats, seat);
  if (!player) return true;

  const tile = tileAt(positionOf(state, player));

  switch (tile.kind) {
    case 'go':
    case 'jail':
      return false;

    case 'freeParking': {
      if (!state.options.freeParkingPot || state.parkingPot <= 0) return false;
      const pot = state.parkingPot;
      state.parkingPot = 0;
      addCash(state, player, pot);
      events.push({ t: 'cash', player, amount: pot, source: 'parking' });
      return false;
    }

    case 'goToJail':
      sendToJail(seats, state, player, events);
      return true;

    case 'tax': {
      events.push({ t: 'tax', player, tile: tile.id, amount: tile.tax });
      return !settle(seats, state, seat, null, tile.tax);
    }

    case 'chance':
    case 'fate':
      return drawCard(seats, state, seat, tile.kind, events, depth);

    case 'property':
    case 'railroad':
    case 'utility': {
      const id = tile.id as MonopolyEstateId;
      const estate = state.estates[id];
      if (estate.owner === null) {
        state.pending = id;
        enterPhase(state, 'buy', seat);
        return true;
      }
      if (estate.owner === player || estate.mortgaged) return false;

      const dice = state.dice;
      const amount = rentOf(id, state.estates, dice ? dice[0] + dice[1] : 0);
      if (amount <= 0) return false;
      events.push({ t: 'rent', player, owner: estate.owner, tile: id, amount });
      return !settle(seats, state, seat, estate.owner, amount);
    }
  }
}

/** 抽一張機會或命運並立刻結算。牌堆抽完就從頭再來（不重洗，順序固定）。 */
function drawCard(
  seats: Seats,
  state: MonopolyState,
  seat: number,
  kind: 'chance' | 'fate',
  events: MonopolyEvent[],
  depth: number,
): boolean {
  const player = playerAt(seats, seat);
  if (!player) return true;

  const deck = kind === 'chance' ? state.chanceDeck : state.fateDeck;
  if (deck.length === 0) return false;
  const at = kind === 'chance' ? state.chanceAt : state.fateAt;
  const card = deck[at % deck.length]!;
  if (kind === 'chance') state.chanceAt = (at + 1) % deck.length;
  else state.fateAt = (at + 1) % deck.length;

  events.push({ t: 'drawCard', player, card });
  return applyCard(seats, state, seat, card, events, depth);
}

function applyCard(
  seats: Seats,
  state: MonopolyState,
  seat: number,
  card: MonopolyCardId,
  events: MonopolyEvent[],
  depth: number,
): boolean {
  const player = playerAt(seats, seat)!;
  const effect = MONOPOLY_CARD_EFFECT[card];

  switch (effect.kind) {
    case 'cash': {
      if (effect.amount >= 0) {
        addCash(state, player, effect.amount);
        events.push({ t: 'cash', player, amount: effect.amount, source: 'card' });
        return false;
      }
      events.push({ t: 'cash', player, amount: effect.amount, source: 'card' });
      return !settle(seats, state, seat, null, -effect.amount);
    }

    case 'collectEach': {
      // 付不出來的人不能讓全桌停下來等他挑要賣什麼，所以走自動變現那條路
      let total = 0;
      for (const otherSeat of solventSeats(seats, state)) {
        if (otherSeat === seat) continue;
        const other = playerAt(seats, otherSeat)!;
        const before = cashOf(state, player);
        forceSettle(seats, state, otherSeat, player, effect.amount, events);
        total += cashOf(state, player) - before;
      }
      if (total > 0) events.push({ t: 'cash', player, amount: total, source: 'players' });
      return state.over;
    }

    case 'payEach': {
      const others = solventSeats(seats, state).filter((s) => s !== seat);
      const owed = effect.amount * others.length;
      if (owed <= 0) return false;

      liquidateUntil(state, player, owed);
      const available = cashOf(state, player);
      if (available >= owed) {
        addCash(state, player, -owed);
        for (const otherSeat of others) addCash(state, playerAt(seats, otherSeat)!, effect.amount);
        events.push({ t: 'cash', player, amount: -owed, source: 'players' });
        return false;
      }

      // 變現完還是不夠：把剩下的現金平分給債主，然後破產
      const share = Math.floor(available / others.length);
      state.cash.set(player, available - share * others.length);
      for (const otherSeat of others) addCash(state, playerAt(seats, otherSeat)!, share);
      events.push({ t: 'cash', player, amount: -share * others.length, source: 'players' });
      bankruptPlayer(seats, state, seat, null, events);
      return true;
    }

    case 'moveTo': {
      moveTo(state, player, tileOf(effect.tile).position, effect.salary, events);
      return resolveNested(seats, state, seat, events, depth);
    }

    case 'moveBy': {
      const target = positionOf(state, player) + effect.steps;
      // 後退不領薪水，前進才領
      moveTo(state, player, target, effect.steps > 0, events);
      return resolveNested(seats, state, seat, events, depth);
    }

    case 'nearest': {
      const target = nearestPosition(positionOf(state, player), effect.group);
      moveTo(state, player, target, true, events);
      return resolveNested(seats, state, seat, events, depth);
    }

    case 'goToJail':
      sendToJail(seats, state, player, events);
      return true;

    case 'jailCard':
      state.jailCards.set(player, (state.jailCards.get(player) ?? 0) + 1);
      return false;

    case 'repairs': {
      let owed = 0;
      for (const id of ownedBy(state.estates, player)) {
        const houses = state.estates[id].houses;
        if (houses === MAX_HOUSES) owed += effect.perHotel;
        else owed += houses * effect.perHouse;
      }
      if (owed <= 0) return false;
      events.push({ t: 'cash', player, amount: -owed, source: 'card' });
      return !settle(seats, state, seat, null, owed);
    }
  }
}

/** 卡片把人移到別的格子之後再結算一次。限制深度，避免「後退三格又踩到卡片」無限接力。 */
function resolveNested(
  seats: Seats,
  state: MonopolyState,
  seat: number,
  events: MonopolyEvent[],
  depth: number,
): boolean {
  if (depth >= 2) return false;
  return resolveLanding(seats, state, seat, events, depth + 1);
}

// ---------------------------------------------------------------------------
// 回合推進
// ---------------------------------------------------------------------------

function advanceTurn(seats: Seats, state: MonopolyState, events: MonopolyEvent[]): void {
  if (state.over) return;

  state.doublesCount = 0;
  state.pending = null;

  if (checkEnd(seats, state, events)) return;

  const next = nextSolventSeat(seats, state, state.activeSeat);
  if (next <= state.activeSeat) {
    state.round += 1;
    if (state.options.roundLimit > 0 && state.round > state.options.roundLimit) {
      endGame(seats, state, 'roundLimit', events);
      return;
    }
  }
  state.activeSeat = next;

  const player = playerAt(seats, next);
  if (player && state.inJail.has(player)) enterPhase(state, 'jail', next);
  else enterPhase(state, 'roll', next);
}

/** 一步走完之後回到整理階段；除非中間已經被 buy／auction／debt 接管。 */
function toManage(state: MonopolyState): void {
  if (state.over) return;
  enterPhase(state, 'manage', state.activeSeat);
}

// ---------------------------------------------------------------------------
// 破產與結束
// ---------------------------------------------------------------------------

function bankruptPlayer(
  seats: Seats,
  state: MonopolyState,
  seat: number,
  creditor: PlayerId | null,
  events: MonopolyEvent[],
): void {
  const player = playerAt(seats, seat);
  if (!player || state.bankrupt.has(player)) return;

  // 房子一律先半價賣回銀行，賣得的錢跟著現金一起交給債主
  for (const id of ownedBy(state.estates, player)) {
    const estate = state.estates[id];
    while (estate.houses > 0) {
      sellHouseAt(state, id);
      addCash(state, player, houseRefund(tileOf(id)));
    }
  }

  const remaining = cashOf(state, player);
  state.cash.set(player, 0);
  if (creditor) addCash(state, creditor, remaining);
  else toBank(state, remaining);

  for (const id of ownedBy(state.estates, player)) {
    const estate = state.estates[id];
    releaseBuildings(state, id);
    if (creditor) {
      estate.owner = creditor;
    } else {
      // 賠給銀行：地回到無主狀態，抵押一併解除，之後可以重新買賣
      estate.owner = null;
      estate.mortgaged = false;
    }
  }

  state.bankrupt.add(player);
  state.bankruptOrder.push(player);
  state.inJail.delete(player);
  events.push({ t: 'bankrupt', player, creditor });

  clearInterruptsFor(seats, state, seat, player, events);

  if (checkEnd(seats, state, events)) return;
  if (seat === state.activeSeat) advanceTurn(seats, state, events);
  else if (state.turnSeat === seat) toManage(state);
}

/**
 * 有人破產或離場時，把還掛著他的拍賣／交易／債務清乾淨。
 * player 得由呼叫端帶進來 —— 離開房間的路徑會先把 seats[seat] 清成 null，
 * 這裡再去查就查不到人了。
 */
function clearInterruptsFor(
  seats: Seats,
  state: MonopolyState,
  seat: number,
  player: PlayerId | null,
  events: MonopolyEvent[],
): void {
  if (state.debt?.debtorSeat === seat) state.debt = null;

  if (state.trade && (state.trade.fromSeat === seat || state.trade.toSeat === seat)) {
    state.trade = null;
    if (state.phase === 'trade') toManage(state);
  }

  const auction = state.auction;
  if (auction) {
    if (player && auction.highBidder === player) {
      // 最高出價者不見了，整場拍賣作廢，地留給銀行
      events.push({ t: 'auctionEnd', player: null, tile: auction.tile, amount: 0 });
      state.auction = null;
      if (state.phase === 'auction') toManage(state);
    } else {
      auction.passed.add(seat);
      if (state.phase === 'auction' && auction.bidderSeat === seat) {
        auctionStep(seats, state, events);
      }
    }
  }
}

function checkEnd(seats: Seats, state: MonopolyState, events: MonopolyEvent[]): boolean {
  if (state.over) return true;

  const solvent = solventSeats(seats, state);
  if (solvent.length <= 1) {
    endGame(seats, state, state.options.lastStanding ? 'lastStanding' : 'abandoned', events);
    return true;
  }

  if (state.options.targetNetWorth > 0) {
    const reached = solvent.some((seat) => {
      const player = playerAt(seats, seat)!;
      return (
        netWorthOf(cashOf(state, player), state.estates, player) >= state.options.targetNetWorth
      );
    });
    if (reached) {
      endGame(seats, state, 'targetNetWorth', events);
      return true;
    }
  }
  return false;
}

function endGame(
  seats: Seats,
  state: MonopolyState,
  reason: MonopolyEndReason,
  events: MonopolyEvent[],
): void {
  if (state.over) return;

  const alive = solventSeats(seats, state)
    .map((seat) => playerAt(seats, seat)!)
    .sort(
      (a, b) =>
        netWorthOf(cashOf(state, b), state.estates, b) -
        netWorthOf(cashOf(state, a), state.estates, a),
    );
  // 破產的排在後面，越晚破產名次越前
  const busted = state.bankruptOrder.slice().reverse();
  const ranking = [...alive, ...busted];

  state.over = true;
  state.turnDeadline = 0;
  state.auction = null;
  state.trade = null;
  state.debt = null;
  state.pending = null;
  state.result = { reason, ranking };
  events.push({ t: 'over', reason, ranking });
}

// ---------------------------------------------------------------------------
// 拍賣
// ---------------------------------------------------------------------------

function startAuction(
  seats: Seats,
  state: MonopolyState,
  id: MonopolyEstateId,
  events: MonopolyEvent[],
): void {
  state.pending = null;
  state.auction = {
    tile: id,
    highBid: 0,
    highBidder: null,
    bidderSeat: state.activeSeat,
    passed: new Set(),
  };
  events.push({ t: 'auctionStart', tile: id });

  const first = solventSeats(seats, state);
  if (first.length === 0) {
    state.auction = null;
    toManage(state);
    return;
  }
  state.auction.bidderSeat = first.includes(state.activeSeat)
    ? state.activeSeat
    : nextSolventSeat(seats, state, state.activeSeat);
  enterPhase(state, 'auction', state.auction.bidderSeat);
}

function nextBidderSeat(seats: Seats, state: MonopolyState, from: number): number | null {
  const auction = state.auction;
  if (!auction) return null;
  const solvent = solventSeats(seats, state);
  for (let step = 1; step <= seats.length; step++) {
    const seat = (from + step) % seats.length;
    if (solvent.includes(seat) && !auction.passed.has(seat)) return seat;
  }
  return null;
}

/** 換下一位喊價，或在剩不到兩位時收槌。 */
function auctionStep(seats: Seats, state: MonopolyState, events: MonopolyEvent[]): void {
  const auction = state.auction;
  if (!auction) return;

  const remaining = solventSeats(seats, state).filter((seat) => !auction.passed.has(seat));
  const highSeat = auction.highBidder ? seats.indexOf(auction.highBidder) : -1;

  if (remaining.length === 0 || (remaining.length === 1 && remaining[0] === highSeat)) {
    finishAuction(seats, state, events);
    return;
  }

  const next = nextBidderSeat(seats, state, auction.bidderSeat);
  if (next === null) {
    finishAuction(seats, state, events);
    return;
  }
  auction.bidderSeat = next;
  enterPhase(state, 'auction', next);
}

function finishAuction(seats: Seats, state: MonopolyState, events: MonopolyEvent[]): void {
  const auction = state.auction;
  if (!auction) return;
  state.auction = null;

  if (auction.highBidder && auction.highBid > 0) {
    addCash(state, auction.highBidder, -auction.highBid);
    state.estates[auction.tile].owner = auction.highBidder;
    events.push({
      t: 'auctionEnd',
      player: auction.highBidder,
      tile: auction.tile,
      amount: auction.highBid,
    });
  } else {
    events.push({ t: 'auctionEnd', player: null, tile: auction.tile, amount: 0 });
  }
  toManage(state);
}

// ---------------------------------------------------------------------------
// 動作
// ---------------------------------------------------------------------------

export function applyMonopolyAction(
  seats: Seats,
  state: MonopolyState,
  playerId: PlayerId,
  action: MonopolyAction,
): Result {
  if (state.over) return { ok: false, error: 'GAME_NOT_RUNNING' };
  if (state.bankrupt.has(playerId)) return { ok: false, error: 'BANKRUPT' };
  if (playerAt(seats, state.turnSeat) !== playerId) return { ok: false, error: 'NOT_YOUR_TURN' };

  const seat = state.turnSeat;
  const events: MonopolyEvent[] = [];

  switch (action.kind) {
    case 'roll': {
      if (state.phase !== 'roll') return { ok: false, error: 'WRONG_PHASE' };
      doRoll(seats, state, seat, events);
      break;
    }

    case 'rollForDoubles': {
      if (state.phase !== 'jail') return { ok: false, error: 'WRONG_PHASE' };
      doJailRoll(seats, state, seat, events);
      break;
    }

    case 'payBail': {
      if (state.phase !== 'jail') return { ok: false, error: 'WRONG_PHASE' };
      if (cashOf(state, playerId) < JAIL_BAIL) return { ok: false, error: 'NOT_ENOUGH_CASH' };
      addCash(state, playerId, -JAIL_BAIL);
      toBank(state, JAIL_BAIL);
      state.inJail.delete(playerId);
      state.jailTurns.set(playerId, 0);
      events.push({ t: 'freed', player: playerId, how: 'bail' });
      enterPhase(state, 'roll', seat);
      break;
    }

    case 'useJailCard': {
      if (state.phase !== 'jail') return { ok: false, error: 'WRONG_PHASE' };
      if ((state.jailCards.get(playerId) ?? 0) < 1) return { ok: false, error: 'NO_JAIL_CARD' };
      state.jailCards.set(playerId, (state.jailCards.get(playerId) ?? 0) - 1);
      state.inJail.delete(playerId);
      state.jailTurns.set(playerId, 0);
      events.push({ t: 'freed', player: playerId, how: 'card' });
      enterPhase(state, 'roll', seat);
      break;
    }

    case 'buy': {
      if (state.phase !== 'buy' || !state.pending) return { ok: false, error: 'WRONG_PHASE' };
      const id = state.pending;
      const price = tileOf(id).price;
      if (cashOf(state, playerId) < price) return { ok: false, error: 'NOT_ENOUGH_CASH' };
      addCash(state, playerId, -price);
      state.estates[id].owner = playerId;
      state.pending = null;
      events.push({ t: 'buy', player: playerId, tile: id, price });
      toManage(state);
      break;
    }

    case 'decline': {
      if (state.phase !== 'buy' || !state.pending) return { ok: false, error: 'WRONG_PHASE' };
      const id = state.pending;
      state.pending = null;
      if (state.options.auctions) startAuction(seats, state, id, events);
      else toManage(state);
      break;
    }

    case 'bid': {
      const auction = state.auction;
      if (state.phase !== 'auction' || !auction) return { ok: false, error: 'WRONG_PHASE' };
      const amount = Math.floor(action.amount);
      if (!Number.isFinite(amount) || amount <= auction.highBid) {
        return { ok: false, error: 'BID_TOO_LOW' };
      }
      // 出價不得超過現金，「得標卻付不出來」這個狀態就不存在
      if (amount > cashOf(state, playerId)) return { ok: false, error: 'BID_TOO_HIGH' };
      auction.highBid = amount;
      auction.highBidder = playerId;
      events.push({ t: 'bid', player: playerId, amount });
      auctionStep(seats, state, events);
      break;
    }

    case 'passBid': {
      const auction = state.auction;
      if (state.phase !== 'auction' || !auction) return { ok: false, error: 'WRONG_PHASE' };
      auction.passed.add(seat);
      auctionStep(seats, state, events);
      break;
    }

    case 'build': {
      if (state.phase !== 'manage') return { ok: false, error: 'WRONG_PHASE' };
      const error = doBuild(state, playerId, action.tile, events);
      if (error) return { ok: false, error };
      break;
    }

    case 'sellHouse': {
      if (state.phase !== 'manage' && state.phase !== 'debt') {
        return { ok: false, error: 'WRONG_PHASE' };
      }
      const error = doSellHouse(state, playerId, action.tile, events);
      if (error) return { ok: false, error };
      settleDebtIfPossible(seats, state, events);
      break;
    }

    case 'mortgage': {
      if (state.phase !== 'manage' && state.phase !== 'debt') {
        return { ok: false, error: 'WRONG_PHASE' };
      }
      const error = doMortgage(state, playerId, action.tile, events);
      if (error) return { ok: false, error };
      settleDebtIfPossible(seats, state, events);
      break;
    }

    case 'unmortgage': {
      if (state.phase !== 'manage') return { ok: false, error: 'WRONG_PHASE' };
      const error = doUnmortgage(state, playerId, action.tile, events);
      if (error) return { ok: false, error };
      break;
    }

    case 'offerTrade': {
      if (state.phase !== 'manage') return { ok: false, error: 'WRONG_PHASE' };
      const error = doOfferTrade(seats, state, playerId, action);
      if (error) return { ok: false, error };
      break;
    }

    case 'respondTrade': {
      const trade = state.trade;
      if (state.phase !== 'trade' || !trade) return { ok: false, error: 'WRONG_PHASE' };
      if (action.accept) applyTrade(seats, state, trade, events);
      state.trade = null;
      toManage(state);
      break;
    }

    case 'declareBankrupt': {
      if (state.phase !== 'debt' || !state.debt) return { ok: false, error: 'WRONG_PHASE' };
      const debt = state.debt;
      // 還有東西可以變現就不准擺爛
      if (cashOf(state, playerId) + liquidValueOf(state.estates, playerId) >= debt.amount) {
        return { ok: false, error: 'CAN_STILL_PAY' };
      }
      state.debt = null;
      bankruptPlayer(seats, state, seat, debt.creditor, events);
      break;
    }

    case 'endTurn': {
      if (state.phase !== 'manage') return { ok: false, error: 'WRONG_PHASE' };
      endTurn(seats, state, events);
      break;
    }
  }

  checkEnd(seats, state, events);
  return { ok: true, events };
}

function doRoll(seats: Seats, state: MonopolyState, seat: number, events: MonopolyEvent[]): void {
  const player = playerAt(seats, seat)!;
  const dice = rollDice(state);
  state.dice = dice;

  if (dice[0] === dice[1]) {
    state.doublesCount += 1;
    if (state.doublesCount >= DOUBLES_TO_JAIL) {
      sendToJail(seats, state, player, events);
      return;
    }
  } else {
    state.doublesCount = 0;
  }

  moveTo(state, player, positionOf(state, player) + dice[0] + dice[1], true, events);
  events.push({ t: 'move', player, dice, tile: tileAt(positionOf(state, player)).id });
  if (!resolveLanding(seats, state, seat, events)) toManage(state);
}

function doJailRoll(
  seats: Seats,
  state: MonopolyState,
  seat: number,
  events: MonopolyEvent[],
): void {
  const player = playerAt(seats, seat)!;
  const dice = rollDice(state);
  state.dice = dice;
  const total = dice[0] + dice[1];

  if (dice[0] === dice[1]) {
    // 擲出同點就出獄，但不因此多一次擲骰
    state.inJail.delete(player);
    state.jailTurns.set(player, 0);
    state.doublesCount = 0;
    events.push({ t: 'freed', player, how: 'doubles' });
  } else {
    const served = (state.jailTurns.get(player) ?? 0) + 1;
    state.jailTurns.set(player, served);
    if (served < JAIL_MAX_TURNS) {
      // 還沒關滿，這一回合就到這裡
      advanceTurn(seats, state, events);
      return;
    }
    // 關滿了強制保釋。這裡不開償債階段 —— 交保是規則強制的，沒有可以挑的選項
    forceSettle(seats, state, seat, null, JAIL_BAIL, events);
    if (state.over || state.bankrupt.has(player)) return;
    state.inJail.delete(player);
    state.jailTurns.set(player, 0);
    events.push({ t: 'freed', player, how: 'served' });
  }

  moveTo(state, player, positionOf(state, player) + total, true, events);
  events.push({ t: 'move', player, dice, tile: tileAt(positionOf(state, player)).id });
  if (!resolveLanding(seats, state, seat, events)) toManage(state);
}

function endTurn(seats: Seats, state: MonopolyState, events: MonopolyEvent[]): void {
  const player = playerAt(seats, state.activeSeat);
  // 擲出同點的人可以再走一次（第三次會在 doRoll 直接進監獄）
  if (state.doublesCount > 0 && player && !state.inJail.has(player)) {
    state.pending = null;
    enterPhase(state, 'roll', state.activeSeat);
    return;
  }
  advanceTurn(seats, state, events);
}

function doBuild(
  state: MonopolyState,
  playerId: PlayerId,
  id: MonopolyEstateId,
  events: MonopolyEvent[],
): MonopolyError | null {
  if (!isEstateId(id)) return 'BAD_TILE';
  const block = buildBlock(state.estates, id, playerId);
  if (block === 'notOwner') return 'NOT_OWNER';
  if (block === 'notProperty') return 'NOT_FOR_SALE';
  if (block === 'notFullSet') return 'NOT_FULL_SET';
  if (block === 'mortgagedInGroup') return 'MORTGAGED_IN_GROUP';
  if (block === 'houseLimit') return 'HOUSE_LIMIT';
  if (block === 'uneven') return 'BUILD_UNEVEN';

  const cost = tileOf(id).houseCost;
  if (cashOf(state, playerId) < cost) return 'NOT_ENOUGH_CASH';
  const supplyError = buildAt(state, id);
  if (supplyError) return supplyError;

  addCash(state, playerId, -cost);
  events.push({ t: 'build', player: playerId, tile: id, houses: state.estates[id].houses, sold: false });
  return null;
}

function doSellHouse(
  state: MonopolyState,
  playerId: PlayerId,
  id: MonopolyEstateId,
  events: MonopolyEvent[],
): MonopolyError | null {
  if (!isEstateId(id)) return 'BAD_TILE';
  const block = sellBlock(state.estates, id, playerId);
  if (block === 'notOwner') return 'NOT_OWNER';
  if (block === 'noHouses') return 'NO_HOUSES';
  if (block === 'uneven') return 'BUILD_UNEVEN';

  const supplyError = sellHouseAt(state, id);
  if (supplyError) return supplyError;
  addCash(state, playerId, houseRefund(tileOf(id)));
  events.push({ t: 'build', player: playerId, tile: id, houses: state.estates[id].houses, sold: true });
  return null;
}

function doMortgage(
  state: MonopolyState,
  playerId: PlayerId,
  id: MonopolyEstateId,
  events: MonopolyEvent[],
): MonopolyError | null {
  if (!isEstateId(id)) return 'BAD_TILE';
  const estate = state.estates[id];
  if (estate.owner !== playerId) return 'NOT_OWNER';
  if (estate.mortgaged) return 'MORTGAGED';

  const group = tileOf(id).group;
  if (group && MONOPOLY_GROUP_TILES[group].some((other) => state.estates[other].houses > 0)) {
    return 'HAS_HOUSES';
  }

  estate.mortgaged = true;
  const amount = mortgageValue(tileOf(id));
  addCash(state, playerId, amount);
  events.push({ t: 'mortgage', player: playerId, tile: id, amount, redeem: false });
  return null;
}

function doUnmortgage(
  state: MonopolyState,
  playerId: PlayerId,
  id: MonopolyEstateId,
  events: MonopolyEvent[],
): MonopolyError | null {
  if (!isEstateId(id)) return 'BAD_TILE';
  const estate = state.estates[id];
  if (estate.owner !== playerId) return 'NOT_OWNER';
  if (!estate.mortgaged) return 'NOT_MORTGAGED';

  const cost = unmortgageCost(tileOf(id));
  if (cashOf(state, playerId) < cost) return 'NOT_ENOUGH_CASH';
  addCash(state, playerId, -cost);
  estate.mortgaged = false;
  events.push({ t: 'mortgage', player: playerId, tile: id, amount: cost, redeem: true });
  return null;
}

/** 償債階段：只要現金補到夠了就自動付掉，不必再多一個「付款」動作。 */
function settleDebtIfPossible(
  seats: Seats,
  state: MonopolyState,
  events: MonopolyEvent[],
): void {
  const debt = state.debt;
  if (state.phase !== 'debt' || !debt) return;
  const player = playerAt(seats, debt.debtorSeat);
  if (!player || cashOf(state, player) < debt.amount) return;

  addCash(state, player, -debt.amount);
  if (debt.creditor) addCash(state, debt.creditor, debt.amount);
  else toBank(state, debt.amount);
  state.debt = null;
  toManage(state);
  void events;
}

function doOfferTrade(
  seats: Seats,
  state: MonopolyState,
  playerId: PlayerId,
  action: Extract<MonopolyAction, { kind: 'offerTrade' }>,
): MonopolyError | null {
  if (!state.options.allowTrades) return 'TRADES_DISABLED';

  const fromSeat = seats.indexOf(playerId);
  const toSeat = seats.indexOf(action.to);
  if (toSeat === -1 || toSeat === fromSeat) return 'BAD_TRADE';
  const to = playerAt(seats, toSeat);
  if (!to || state.bankrupt.has(to)) return 'BAD_TRADE';

  const giveCash = Math.floor(action.giveCash);
  const wantCash = Math.floor(action.wantCash);
  if (!Number.isFinite(giveCash) || !Number.isFinite(wantCash)) return 'BAD_TRADE';
  if (giveCash < 0 || wantCash < 0) return 'BAD_TRADE';
  if (giveCash > cashOf(state, playerId) || wantCash > cashOf(state, to)) {
    return 'NOT_ENOUGH_CASH';
  }
  if (action.give.length === 0 && action.want.length === 0 && giveCash === 0 && wantCash === 0) {
    return 'BAD_TRADE';
  }

  if (!tradableFrom(state, action.give, playerId)) return 'BAD_TRADE';
  if (!tradableFrom(state, action.want, to)) return 'BAD_TRADE';

  state.trade = {
    fromSeat,
    toSeat,
    give: action.give.slice(),
    giveCash,
    want: action.want.slice(),
    wantCash,
  };
  enterPhase(state, 'trade', toSeat);
  return null;
}

/** 帶房子的地不能交易 —— 要先把整組的房子拆光。 */
function tradableFrom(
  state: MonopolyState,
  tiles: readonly MonopolyEstateId[],
  owner: PlayerId,
): boolean {
  const seen = new Set<MonopolyEstateId>();
  for (const id of tiles) {
    if (!isEstateId(id) || seen.has(id)) return false;
    seen.add(id);
    const estate = state.estates[id];
    if (estate.owner !== owner) return false;
    const group = tileOf(id).group;
    if (group && MONOPOLY_GROUP_TILES[group].some((other) => state.estates[other].houses > 0)) {
      return false;
    }
  }
  return true;
}

function applyTrade(
  seats: Seats,
  state: MonopolyState,
  trade: TradeState,
  events: MonopolyEvent[],
): void {
  const from = playerAt(seats, trade.fromSeat);
  const to = playerAt(seats, trade.toSeat);
  if (!from || !to) return;

  for (const id of trade.give) state.estates[id].owner = to;
  for (const id of trade.want) state.estates[id].owner = from;
  addCash(state, from, trade.wantCash - trade.giveCash);
  addCash(state, to, trade.giveCash - trade.wantCash);

  events.push({
    t: 'trade',
    from,
    to,
    give: trade.give.slice(),
    giveCash: trade.giveCash,
    want: trade.want.slice(),
    wantCash: trade.wantCash,
  });
}

// ---------------------------------------------------------------------------
// 可用動作
// ---------------------------------------------------------------------------

export function actionsForMonopoly(
  seats: Seats,
  state: MonopolyState,
  playerId: PlayerId,
): MonopolyActions {
  if (state.over || state.bankrupt.has(playerId)) return { ...NO_MONOPOLY_ACTIONS };
  if (playerAt(seats, state.turnSeat) !== playerId) return { ...NO_MONOPOLY_ACTIONS };

  const cash = cashOf(state, playerId);
  const owned = ownedBy(state.estates, playerId);
  const actions: MonopolyActions = {
    ...NO_MONOPOLY_ACTIONS,
    buildable: [],
    sellable: [],
    mortgageable: [],
    unmortgageable: [],
  };

  switch (state.phase) {
    case 'roll':
      actions.canRoll = true;
      break;

    case 'jail':
      actions.canRollForDoubles = true;
      actions.canPayBail = cash >= JAIL_BAIL;
      actions.canUseJailCard = (state.jailCards.get(playerId) ?? 0) > 0;
      break;

    case 'buy': {
      if (!state.pending) break;
      const price = tileOf(state.pending).price;
      actions.buyPrice = price;
      actions.canBuy = cash >= price;
      actions.canDecline = true;
      break;
    }

    case 'auction': {
      const auction = state.auction;
      if (!auction) break;
      actions.canPassBid = true;
      actions.minBid = auction.highBid + 1;
      actions.maxBid = cash;
      actions.canBid = cash >= auction.highBid + 1;
      break;
    }

    case 'trade':
      actions.canRespondTrade = true;
      break;

    case 'debt': {
      const debt = state.debt;
      actions.sellable = owned.filter((id) => sellBlock(state.estates, id, playerId) === null);
      actions.mortgageable = owned.filter((id) => canMortgage(state, id, playerId));
      actions.canDeclareBankrupt = debt
        ? cash + liquidValueOf(state.estates, playerId) < debt.amount
        : false;
      break;
    }

    case 'manage':
      actions.canEndTurn = true;
      actions.canOfferTrade = state.options.allowTrades && solventSeats(seats, state).length > 1;
      actions.buildable = owned.filter(
        (id) =>
          buildBlock(state.estates, id, playerId) === null &&
          cash >= tileOf(id).houseCost &&
          hasSupplyFor(state, id),
      );
      actions.sellable = owned.filter((id) => sellBlock(state.estates, id, playerId) === null);
      actions.mortgageable = owned.filter((id) => canMortgage(state, id, playerId));
      actions.unmortgageable = owned.filter(
        (id) => state.estates[id].mortgaged && cash >= unmortgageCost(tileOf(id)),
      );
      break;
  }

  return actions;
}

function canMortgage(state: MonopolyState, id: MonopolyEstateId, playerId: PlayerId): boolean {
  const estate = state.estates[id];
  if (estate.owner !== playerId || estate.mortgaged) return false;
  const group = tileOf(id).group;
  return !group || MONOPOLY_GROUP_TILES[group].every((other) => state.estates[other].houses === 0);
}

function hasSupplyFor(state: MonopolyState, id: MonopolyEstateId): boolean {
  return state.estates[id].houses === MAX_HOUSES - 1
    ? state.hotelSupply > 0
    : state.houseSupply > 0;
}

// ---------------------------------------------------------------------------
// 逾時代打
// ---------------------------------------------------------------------------

/**
 * 逾時代打。
 * 不變量：呼叫之後 (phase, turnSeat, over) 至少要變動一項，否則房間會卡在同一個階段
 * 一路重排計時器。debt 是唯一可能違反的階段，所以它一次就把變現做到底或直接破產。
 */
export function autoActMonopoly(
  seats: Seats,
  state: MonopolyState,
): { phase: MonopolyPhase; events: MonopolyEvent[] } | null {
  if (state.over) return null;
  const playerId = playerAt(seats, state.turnSeat);
  if (!playerId) return null;

  const phase = state.phase;
  const seat = state.turnSeat;
  const events: MonopolyEvent[] = [];

  switch (phase) {
    case 'roll':
      doRoll(seats, state, seat, events);
      break;
    case 'jail':
      doJailRoll(seats, state, seat, events);
      break;
    case 'buy': {
      const id = state.pending;
      state.pending = null;
      if (id && state.options.auctions) startAuction(seats, state, id, events);
      else toManage(state);
      break;
    }
    case 'auction': {
      const auction = state.auction;
      if (!auction) {
        toManage(state);
        break;
      }
      auction.passed.add(seat);
      auctionStep(seats, state, events);
      break;
    }
    case 'trade':
      state.trade = null;
      toManage(state);
      break;
    case 'debt': {
      const debt = state.debt;
      state.debt = null;
      if (debt) forceSettle(seats, state, seat, debt.creditor, debt.amount, events);
      // forceSettle 走破產那條路時已經把回合推走了，這裡只補沒破產的情況
      if (!state.over && state.phase === 'debt') toManage(state);
      break;
    }
    case 'manage':
      endTurn(seats, state, events);
      break;
  }

  checkEnd(seats, state, events);
  return { phase, events };
}

// ---------------------------------------------------------------------------
// 離開房間
// ---------------------------------------------------------------------------

/**
 * 玩家中途離開：地產全部還給銀行，視同退出。
 * 離開的人可能正好是 turnSeat 卻不是 activeSeat（拍賣、交易、償債），所以兩個座位都要收拾。
 */
export function removePlayerFromMonopoly(
  seats: Seats,
  state: MonopolyState,
  playerId: PlayerId,
): MonopolyEvent[] {
  const seat = seats.indexOf(playerId);
  if (seat === -1) return [];

  const events: MonopolyEvent[] = [];

  for (const id of ownedBy(state.estates, playerId)) {
    releaseBuildings(state, id);
    state.estates[id].owner = null;
    state.estates[id].mortgaged = false;
  }
  state.cash.delete(playerId);
  state.position.delete(playerId);
  state.inJail.delete(playerId);
  state.jailTurns.delete(playerId);
  state.jailCards.delete(playerId);
  state.bankrupt.delete(playerId);
  const bankruptAt = state.bankruptOrder.indexOf(playerId);
  if (bankruptAt !== -1) state.bankruptOrder.splice(bankruptAt, 1);
  seats[seat] = null;

  if (state.over) return events;

  clearInterruptsFor(seats, state, seat, playerId, events);
  if (checkEnd(seats, state, events)) return events;

  if (state.activeSeat === seat) advanceTurn(seats, state, events);
  else if (state.turnSeat === seat) toManage(state);

  return events;
}

/** 排行榜用：每個人現在的身家。 */
export function netWorthTable(seats: Seats, state: MonopolyState): Map<PlayerId, number> {
  const table = new Map<PlayerId, number>();
  for (const playerId of seats) {
    if (!playerId) continue;
    table.set(playerId, netWorthOf(cashOf(state, playerId), state.estates, playerId));
  }
  return table;
}

export { cashOf as monopolyCashOf, positionOf as monopolyPositionOf };
