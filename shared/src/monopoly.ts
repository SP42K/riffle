import type { PlayerId } from './types.js';

// ---------------------------------------------------------------------------
// 棋盤
// ---------------------------------------------------------------------------

/**
 * 色組。前八組是街道，鐵路（機場）與公用事業自成一組 ——
 * 它們也有「集滿加租」的規則，放同一個型別算租金才不必分支。
 */
export type MonopolyGroup =
  | 'brown'
  | 'lightBlue'
  | 'pink'
  | 'orange'
  | 'red'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'railroad'
  | 'utility';

export const MONOPOLY_GROUPS: readonly MonopolyGroup[] = [
  'brown',
  'lightBlue',
  'pink',
  'orange',
  'red',
  'yellow',
  'green',
  'blue',
  'railroad',
  'utility',
];

export const MONOPOLY_GROUP_LABEL: Record<MonopolyGroup, string> = {
  brown: '棕色組',
  lightBlue: '淺藍組',
  pink: '桃紅組',
  orange: '橘色組',
  red: '紅色組',
  yellow: '黃色組',
  green: '綠色組',
  blue: '深藍組',
  railroad: '機場',
  utility: '公用事業',
};

export type MonopolyTileKind =
  | 'go'
  | 'property'
  | 'railroad'
  | 'utility'
  | 'tax'
  | 'chance'
  | 'fate'
  | 'jail'
  | 'freeParking'
  | 'goToJail';

/** 買得到的格子。抵押、蓋房、租金都只作用在這些 id 上。 */
export type MonopolyEstateId =
  | 'brown1'
  | 'brown2'
  | 'lightBlue1'
  | 'lightBlue2'
  | 'lightBlue3'
  | 'pink1'
  | 'pink2'
  | 'pink3'
  | 'orange1'
  | 'orange2'
  | 'orange3'
  | 'red1'
  | 'red2'
  | 'red3'
  | 'yellow1'
  | 'yellow2'
  | 'yellow3'
  | 'green1'
  | 'green2'
  | 'green3'
  | 'blue1'
  | 'blue2'
  | 'rail1'
  | 'rail2'
  | 'rail3'
  | 'rail4'
  | 'utility1'
  | 'utility2';

/** 買不到的格子。 */
export type MonopolyPlainTileId =
  | 'go'
  | 'jail'
  | 'freeParking'
  | 'goToJail'
  | 'chance1'
  | 'chance2'
  | 'chance3'
  | 'fate1'
  | 'fate2'
  | 'fate3'
  | 'incomeTax'
  | 'luxuryTax';

export type MonopolyTileId = MonopolyEstateId | MonopolyPlainTileId;

export interface MonopolyTile {
  id: MonopolyTileId;
  /** 在棋盤上的位置，0 是起點。 */
  position: number;
  kind: MonopolyTileKind;
  group: MonopolyGroup | null;
  /** 買價；買不到的格子為 0。 */
  price: number;
  /**
   * 街道的租金級距：index 0 是素地、1~4 是房子數、5 是飯店。
   * 機場與公用事業不看這張表（各有自己的算法），為空陣列。
   */
  rent: readonly number[];
  /** 每棟房子（或飯店）的造價。非街道為 0。 */
  houseCost: number;
  /** 稅金格才有。 */
  tax: number;
}

function property(
  id: MonopolyEstateId,
  position: number,
  group: MonopolyGroup,
  price: number,
  rent: readonly number[],
  houseCost: number,
): MonopolyTile {
  return { id, position, kind: 'property', group, price, rent, houseCost, tax: 0 };
}

function plain(
  id: MonopolyPlainTileId,
  position: number,
  kind: MonopolyTileKind,
  tax = 0,
): MonopolyTile {
  return { id, position, kind, group: null, price: 0, rent: [], houseCost: 0, tax };
}

function railroad(id: MonopolyEstateId, position: number): MonopolyTile {
  return {
    id,
    position,
    kind: 'railroad',
    group: 'railroad',
    price: 200,
    rent: [],
    houseCost: 0,
    tax: 0,
  };
}

function utility(id: MonopolyEstateId, position: number): MonopolyTile {
  return {
    id,
    position,
    kind: 'utility',
    group: 'utility',
    price: 150,
    rent: [],
    houseCost: 0,
    tax: 0,
  };
}

/**
 * 40 格棋盤，index 即位置。這是遊戲資料（價格、租金、色組），不是文案 ——
 * 看得到的名字在 MONOPOLY_TILE_LABEL，各外觀自己覆寫。
 */
export const MONOPOLY_BOARD: readonly MonopolyTile[] = [
  plain('go', 0, 'go'),
  property('brown1', 1, 'brown', 60, [2, 10, 30, 90, 160, 250], 50),
  plain('fate1', 2, 'fate'),
  property('brown2', 3, 'brown', 60, [4, 20, 60, 180, 320, 450], 50),
  plain('incomeTax', 4, 'tax', 200),
  railroad('rail1', 5),
  property('lightBlue1', 6, 'lightBlue', 100, [6, 30, 90, 270, 400, 550], 50),
  plain('chance1', 7, 'chance'),
  property('lightBlue2', 8, 'lightBlue', 100, [6, 30, 90, 270, 400, 550], 50),
  property('lightBlue3', 9, 'lightBlue', 120, [8, 40, 100, 300, 450, 600], 50),
  plain('jail', 10, 'jail'),
  property('pink1', 11, 'pink', 140, [10, 50, 150, 450, 625, 750], 100),
  utility('utility1', 12),
  property('pink2', 13, 'pink', 140, [10, 50, 150, 450, 625, 750], 100),
  property('pink3', 14, 'pink', 160, [12, 60, 180, 500, 700, 900], 100),
  railroad('rail2', 15),
  property('orange1', 16, 'orange', 180, [14, 70, 200, 550, 750, 950], 100),
  plain('fate2', 17, 'fate'),
  property('orange2', 18, 'orange', 180, [14, 70, 200, 550, 750, 950], 100),
  property('orange3', 19, 'orange', 200, [16, 80, 220, 600, 800, 1000], 100),
  plain('freeParking', 20, 'freeParking'),
  property('red1', 21, 'red', 220, [18, 90, 250, 700, 875, 1050], 150),
  plain('chance2', 22, 'chance'),
  property('red2', 23, 'red', 220, [18, 90, 250, 700, 875, 1050], 150),
  property('red3', 24, 'red', 240, [20, 100, 300, 750, 925, 1100], 150),
  railroad('rail3', 25),
  property('yellow1', 26, 'yellow', 260, [22, 110, 330, 800, 975, 1150], 150),
  property('yellow2', 27, 'yellow', 260, [22, 110, 330, 800, 975, 1150], 150),
  utility('utility2', 28),
  property('yellow3', 29, 'yellow', 280, [24, 120, 360, 850, 1025, 1200], 150),
  plain('goToJail', 30, 'goToJail'),
  property('green1', 31, 'green', 300, [26, 130, 390, 900, 1100, 1275], 200),
  property('green2', 32, 'green', 300, [26, 130, 390, 900, 1100, 1275], 200),
  plain('fate3', 33, 'fate'),
  property('green3', 34, 'green', 320, [28, 150, 450, 1000, 1200, 1400], 200),
  railroad('rail4', 35),
  plain('chance3', 36, 'chance'),
  property('blue1', 37, 'blue', 350, [35, 175, 500, 1100, 1300, 1500], 200),
  plain('luxuryTax', 38, 'tax', 100),
  property('blue2', 39, 'blue', 400, [50, 200, 600, 1400, 1700, 2000], 200),
];

export const BOARD_SIZE = MONOPOLY_BOARD.length;

const TILE_BY_ID = new Map<MonopolyTileId, MonopolyTile>(
  MONOPOLY_BOARD.map((tile) => [tile.id, tile]),
);

export function tileAt(position: number): MonopolyTile {
  return MONOPOLY_BOARD[((position % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE]!;
}

export function tileOf(id: MonopolyTileId): MonopolyTile {
  return TILE_BY_ID.get(id)!;
}

/** 買得到的格子，順序與棋盤一致。 */
export const MONOPOLY_ESTATE_IDS: readonly MonopolyEstateId[] = MONOPOLY_BOARD.filter(
  (tile) => tile.price > 0,
).map((tile) => tile.id as MonopolyEstateId);

export function isEstateId(id: MonopolyTileId): id is MonopolyEstateId {
  return tileOf(id).price > 0;
}

/** 同一色組的所有格子。 */
export const MONOPOLY_GROUP_TILES: Record<MonopolyGroup, readonly MonopolyEstateId[]> =
  MONOPOLY_GROUPS.reduce(
    (acc, group) => {
      acc[group] = MONOPOLY_ESTATE_IDS.filter((id) => tileOf(id).group === group);
      return acc;
    },
    {} as Record<MonopolyGroup, readonly MonopolyEstateId[]>,
  );

export const MONOPOLY_TILE_LABEL: Record<MonopolyTileId, string> = {
  go: '起點',
  jail: '監獄',
  freeParking: '免費停車場',
  goToJail: '進監獄',
  chance1: '機會',
  chance2: '機會',
  chance3: '機會',
  fate1: '命運',
  fate2: '命運',
  fate3: '命運',
  incomeTax: '所得稅',
  luxuryTax: '奢侈稅',
  brown1: '屏東中山路',
  brown2: '屏東民生路',
  lightBlue1: '嘉義文化路',
  lightBlue2: '嘉義中山路',
  lightBlue3: '嘉義垂楊路',
  pink1: '新竹東門街',
  pink2: '新竹北大路',
  pink3: '新竹光復路',
  orange1: '台南中正路',
  orange2: '台南民權路',
  orange3: '台南安平路',
  red1: '高雄五福路',
  red2: '高雄中山路',
  red3: '高雄愛河',
  yellow1: '台中公益路',
  yellow2: '台中台灣大道',
  yellow3: '台中七期',
  green1: '台北南京東路',
  green2: '台北忠孝東路',
  green3: '台北仁愛路',
  blue1: '台北信義計畫區',
  blue2: '台北一〇一',
  rail1: '松山機場',
  rail2: '台中機場',
  rail3: '小港機場',
  rail4: '桃園機場',
  utility1: '自來水公司',
  utility2: '電力公司',
};

// ---------------------------------------------------------------------------
// 規則常數
// ---------------------------------------------------------------------------

/** 起點薪水。經過或停在起點都領。 */
export const MONOPOLY_SALARY = 200;
/** 監獄的位置。 */
export const JAIL_POSITION = 10;
/** 保釋金。 */
export const JAIL_BAIL = 50;
/** 關滿幾巡就強制保釋。 */
export const JAIL_MAX_TURNS = 3;
/** 一塊地最多蓋到 5 級，5 就是飯店。 */
export const MAX_HOUSES = 5;
/** 銀行的房屋與飯店庫存。蓋光了就得等別人拆。 */
export const HOUSE_SUPPLY = 32;
export const HOTEL_SUPPLY = 12;
/** 機場租金：持有 1~4 座。 */
export const RAILROAD_RENT: readonly number[] = [25, 50, 100, 200];
/** 公用事業：持有 1 座擲骰 ×4，2 座 ×10。 */
export const UTILITY_MULTIPLIER: readonly number[] = [4, 10];
/** 贖回抵押要加的利息，用百分點表示 —— 寫成 0.1 的話 200 * 1.1 會算出 220.00000000000003。 */
export const MORTGAGE_INTEREST_PERCENT = 10;
/** 連續三次同點就進監獄。 */
export const DOUBLES_TO_JAIL = 3;

/** 抵押可以借到多少（買價的一半）。 */
export function mortgageValue(tile: MonopolyTile): number {
  return Math.floor(tile.price / 2);
}

/** 贖回要付多少（抵押金加一成）。 */
export function unmortgageCost(tile: MonopolyTile): number {
  return Math.ceil((mortgageValue(tile) * (100 + MORTGAGE_INTEREST_PERCENT)) / 100);
}

/** 拆房子退回多少（造價的一半）。 */
export function houseRefund(tile: MonopolyTile): number {
  return Math.floor(tile.houseCost / 2);
}

// ---------------------------------------------------------------------------
// 地產狀態
// ---------------------------------------------------------------------------

export interface MonopolyEstate {
  owner: PlayerId | null;
  /** 0~5，5 代表飯店。 */
  houses: number;
  mortgaged: boolean;
}

/**
 * 全部 28 塊地的狀態。用 Record 而不是 Map ——
 * key 是有限聯集，noUncheckedIndexedAccess 不會逼出 undefined，讀起來乾淨很多。
 */
export type EstateTable = Record<MonopolyEstateId, MonopolyEstate>;

export function emptyEstates(): EstateTable {
  const table = {} as EstateTable;
  for (const id of MONOPOLY_ESTATE_IDS) {
    table[id] = { owner: null, houses: 0, mortgaged: false };
  }
  return table;
}

export function ownedBy(estates: EstateTable, playerId: PlayerId): MonopolyEstateId[] {
  return MONOPOLY_ESTATE_IDS.filter((id) => estates[id].owner === playerId);
}

/** 這個人在這個色組裡持有幾塊（含抵押）。 */
export function groupCount(
  estates: EstateTable,
  group: MonopolyGroup,
  playerId: PlayerId,
): number {
  return MONOPOLY_GROUP_TILES[group].filter((id) => estates[id].owner === playerId).length;
}

/** 整組都在同一個人手上（滿貫）。 */
export function ownsFullGroup(
  estates: EstateTable,
  group: MonopolyGroup,
  playerId: PlayerId,
): boolean {
  return MONOPOLY_GROUP_TILES[group].every((id) => estates[id].owner === playerId);
}

/**
 * 停在這塊地要付多少租金。
 * 抵押中的地不收租；沒人的地也回 0（該進購買階段而不是收租）。
 * diceTotal 只有公用事業會用到。
 */
export function rentOf(id: MonopolyEstateId, estates: EstateTable, diceTotal: number): number {
  const estate = estates[id];
  if (!estate.owner || estate.mortgaged) return 0;

  const tile = tileOf(id);
  const owner = estate.owner;

  if (tile.kind === 'railroad') {
    const count = groupCount(estates, 'railroad', owner);
    return RAILROAD_RENT[count - 1] ?? 0;
  }
  if (tile.kind === 'utility') {
    const count = groupCount(estates, 'utility', owner);
    return diceTotal * (UTILITY_MULTIPLIER[count - 1] ?? 0);
  }

  const base = tile.rent[estate.houses] ?? 0;
  // 素地滿貫加倍；蓋了房子就照級距，不再加倍
  if (estate.houses === 0 && tile.group && ownsFullGroup(estates, tile.group, owner)) {
    return base * 2;
  }
  return base;
}

/**
 * 能不能在這塊地上再蓋一棟。
 * 平均蓋房：同色組內任兩塊地的房子數不能差超過一棟。
 */
export type BuildBlock =
  | 'notOwner'
  | 'notProperty'
  | 'notFullSet'
  | 'mortgagedInGroup'
  | 'houseLimit'
  | 'uneven'
  | null;

export function buildBlock(
  estates: EstateTable,
  id: MonopolyEstateId,
  playerId: PlayerId,
): BuildBlock {
  const estate = estates[id];
  const tile = tileOf(id);
  if (estate.owner !== playerId) return 'notOwner';
  if (tile.kind !== 'property' || !tile.group) return 'notProperty';
  if (!ownsFullGroup(estates, tile.group, playerId)) return 'notFullSet';
  if (MONOPOLY_GROUP_TILES[tile.group].some((other) => estates[other].mortgaged)) {
    return 'mortgagedInGroup';
  }
  if (estate.houses >= MAX_HOUSES) return 'houseLimit';
  const lowest = Math.min(
    ...MONOPOLY_GROUP_TILES[tile.group].map((other) => estates[other].houses),
  );
  if (estate.houses > lowest) return 'uneven';
  return null;
}

/** 能不能從這塊地拆掉一棟（平均拆房）。 */
export type SellBlock = 'notOwner' | 'noHouses' | 'uneven' | null;

export function sellBlock(
  estates: EstateTable,
  id: MonopolyEstateId,
  playerId: PlayerId,
): SellBlock {
  const estate = estates[id];
  const tile = tileOf(id);
  if (estate.owner !== playerId) return 'notOwner';
  if (estate.houses <= 0) return 'noHouses';
  if (!tile.group) return 'noHouses';
  const highest = Math.max(
    ...MONOPOLY_GROUP_TILES[tile.group].map((other) => estates[other].houses),
  );
  if (estate.houses < highest) return 'uneven';
  return null;
}

/**
 * 身家：現金 ＋ 地產價值 ＋ 房屋成本。
 * 抵押中的地只算一半（等於還掉貸款後剩下的部分），這樣抵押不會憑空增加身家。
 */
export function netWorthOf(cash: number, estates: EstateTable, playerId: PlayerId): number {
  let total = cash;
  for (const id of ownedBy(estates, playerId)) {
    const tile = tileOf(id);
    const estate = estates[id];
    total += estate.mortgaged ? tile.price - mortgageValue(tile) : tile.price;
    total += estate.houses * tile.houseCost;
  }
  return total;
}

/** 現在最多還能變現多少（抵押還沒抵押的地 ＋ 拆掉所有房子）。 */
export function liquidValueOf(estates: EstateTable, playerId: PlayerId): number {
  let total = 0;
  for (const id of ownedBy(estates, playerId)) {
    const tile = tileOf(id);
    const estate = estates[id];
    total += estate.houses * houseRefund(tile);
    if (!estate.mortgaged) total += mortgageValue(tile);
  }
  return total;
}

// ---------------------------------------------------------------------------
// 機會與命運
// ---------------------------------------------------------------------------

export type MonopolyCardEffect =
  /** 跟銀行收付，正數是收。 */
  | { kind: 'cash'; amount: number }
  /** 每位還在場上的玩家給你這麼多。 */
  | { kind: 'collectEach'; amount: number }
  /** 你給每位還在場上的玩家這麼多。 */
  | { kind: 'payEach'; amount: number }
  /** 移動到指定格子；salary 為 true 時經過起點照領。 */
  | { kind: 'moveTo'; tile: MonopolyTileId; salary: boolean }
  /** 相對移動，負數是後退。 */
  | { kind: 'moveBy'; steps: number }
  /** 前進到最近的機場／公用事業。 */
  | { kind: 'nearest'; group: 'railroad' | 'utility' }
  | { kind: 'goToJail' }
  /** 拿一張免費出獄卡。 */
  | { kind: 'jailCard' }
  /** 依房屋數修繕。 */
  | { kind: 'repairs'; perHouse: number; perHotel: number };

export type MonopolyCardId =
  // 機會
  | 'chanceGo'
  | 'chanceBlue2'
  | 'chanceLightBlue3'
  | 'chanceNearestRail'
  | 'chanceNearestUtility'
  | 'chanceDividend'
  | 'chanceJailCard'
  | 'chanceBack3'
  | 'chanceGoToJail'
  | 'chanceRepairs'
  | 'chanceSpeeding'
  | 'chanceRail1'
  | 'chanceChairman'
  | 'chanceLoan'
  | 'chanceCrossword'
  | 'chanceOrange2'
  // 命運
  | 'fateGo'
  | 'fateBankError'
  | 'fateDoctor'
  | 'fateStock'
  | 'fateJailCard'
  | 'fateGoToJail'
  | 'fateOpening'
  | 'fateTaxRefund'
  | 'fateBirthday'
  | 'fateInsurance'
  | 'fateHospital'
  | 'fateSchool'
  | 'fateConsultancy'
  | 'fateStreetRepairs'
  | 'fateBeauty'
  | 'fateInheritance';

export const MONOPOLY_CARD_EFFECT: Record<MonopolyCardId, MonopolyCardEffect> = {
  chanceGo: { kind: 'moveTo', tile: 'go', salary: true },
  chanceBlue2: { kind: 'moveTo', tile: 'blue2', salary: true },
  chanceLightBlue3: { kind: 'moveTo', tile: 'lightBlue3', salary: true },
  chanceNearestRail: { kind: 'nearest', group: 'railroad' },
  chanceNearestUtility: { kind: 'nearest', group: 'utility' },
  chanceDividend: { kind: 'cash', amount: 50 },
  chanceJailCard: { kind: 'jailCard' },
  chanceBack3: { kind: 'moveBy', steps: -3 },
  chanceGoToJail: { kind: 'goToJail' },
  chanceRepairs: { kind: 'repairs', perHouse: 25, perHotel: 100 },
  chanceSpeeding: { kind: 'cash', amount: -15 },
  chanceRail1: { kind: 'moveTo', tile: 'rail1', salary: true },
  chanceChairman: { kind: 'payEach', amount: 50 },
  chanceLoan: { kind: 'cash', amount: 150 },
  chanceCrossword: { kind: 'cash', amount: 100 },
  chanceOrange2: { kind: 'moveTo', tile: 'orange2', salary: true },

  fateGo: { kind: 'moveTo', tile: 'go', salary: true },
  fateBankError: { kind: 'cash', amount: 200 },
  fateDoctor: { kind: 'cash', amount: -50 },
  fateStock: { kind: 'cash', amount: 50 },
  fateJailCard: { kind: 'jailCard' },
  fateGoToJail: { kind: 'goToJail' },
  fateOpening: { kind: 'collectEach', amount: 50 },
  fateTaxRefund: { kind: 'cash', amount: 20 },
  fateBirthday: { kind: 'collectEach', amount: 10 },
  fateInsurance: { kind: 'cash', amount: 100 },
  fateHospital: { kind: 'cash', amount: -100 },
  fateSchool: { kind: 'cash', amount: -50 },
  fateConsultancy: { kind: 'cash', amount: 25 },
  fateStreetRepairs: { kind: 'repairs', perHouse: 40, perHotel: 115 },
  fateBeauty: { kind: 'cash', amount: 10 },
  fateInheritance: { kind: 'cash', amount: 100 },
};

export const MONOPOLY_CARD_LABEL: Record<MonopolyCardId, string> = {
  chanceGo: '前進到起點，領取薪水',
  chanceBlue2: '前進到台北一〇一',
  chanceLightBlue3: '前進到嘉義垂楊路',
  chanceNearestRail: '前進到最近的機場',
  chanceNearestUtility: '前進到最近的公用事業',
  chanceDividend: '銀行發放股利，收 50',
  chanceJailCard: '獲得一張免費出獄卡',
  chanceBack3: '後退三格',
  chanceGoToJail: '違規停車，直接入獄',
  chanceRepairs: '房屋修繕：每棟房子 25，每間飯店 100',
  chanceSpeeding: '超速罰款 15',
  chanceRail1: '前進到松山機場',
  chanceChairman: '當選董事長，付給每位玩家 50',
  chanceLoan: '建物貸款到期，收 150',
  chanceCrossword: '填字比賽獲勝，收 100',
  chanceOrange2: '前進到台南民權路',

  fateGo: '前進到起點，領取薪水',
  fateBankError: '銀行結算錯誤，得 200',
  fateDoctor: '看醫生，付 50',
  fateStock: '股票獲利，收 50',
  fateJailCard: '獲得一張免費出獄卡',
  fateGoToJail: '被檢舉逃漏稅，直接入獄',
  fateOpening: '開幕慶，向每位玩家收 50',
  fateTaxRefund: '退稅，收 20',
  fateBirthday: '你的生日，每位玩家給你 10',
  fateInsurance: '保險理賠，收 100',
  fateHospital: '住院費，付 100',
  fateSchool: '學費，付 50',
  fateConsultancy: '顧問費收入 25',
  fateStreetRepairs: '道路整修：每棟房子 40，每間飯店 115',
  fateBeauty: '選美比賽第二名，收 10',
  fateInheritance: '繼承遺產，收 100',
};

export const CHANCE_DECK: readonly MonopolyCardId[] = [
  'chanceGo',
  'chanceBlue2',
  'chanceLightBlue3',
  'chanceNearestRail',
  'chanceNearestUtility',
  'chanceDividend',
  'chanceJailCard',
  'chanceBack3',
  'chanceGoToJail',
  'chanceRepairs',
  'chanceSpeeding',
  'chanceRail1',
  'chanceChairman',
  'chanceLoan',
  'chanceCrossword',
  'chanceOrange2',
];

export const FATE_DECK: readonly MonopolyCardId[] = [
  'fateGo',
  'fateBankError',
  'fateDoctor',
  'fateStock',
  'fateJailCard',
  'fateGoToJail',
  'fateOpening',
  'fateTaxRefund',
  'fateBirthday',
  'fateInsurance',
  'fateHospital',
  'fateSchool',
  'fateConsultancy',
  'fateStreetRepairs',
  'fateBeauty',
  'fateInheritance',
];

/** 從 from 往前走，第一個屬於這個色組的格子位置。 */
export function nearestPosition(from: number, group: 'railroad' | 'utility'): number {
  for (let step = 1; step <= BOARD_SIZE; step++) {
    const tile = tileAt(from + step);
    if (tile.group === group) return tile.position;
  }
  return from;
}

// ---------------------------------------------------------------------------
// 房間選項
// ---------------------------------------------------------------------------

/**
 * 建房時決定，一局之內不變。
 * 三個結算條件（lastStanding / roundLimit / targetNetWorth）各自獨立，
 * 最先達成的那個結束整局，名次一律照身家排。
 */
export interface MonopolyOptions {
  /** 起始現金。 */
  startCash: number;
  /** 破產淘汰到只剩一人就結束。 */
  lastStanding: boolean;
  /** 巡數上限，0 表示不啟用。 */
  roundLimit: number;
  /** 身家目標，0 表示不啟用。 */
  targetNetWorth: number;
  /** 不買就拍賣；關掉的話沒人要的地就流標。 */
  auctions: boolean;
  /** 開放玩家之間交易。 */
  allowTrades: boolean;
  /** 稅金與罰款進獎金池，停到免費停車場的人整碗端走。 */
  freeParkingPot: boolean;
}

export type MonopolyOptionKey = keyof MonopolyOptions;

/** 顯示與消毒的固定順序。 */
export const MONOPOLY_OPTION_KEYS: readonly MonopolyOptionKey[] = [
  'startCash',
  'lastStanding',
  'roundLimit',
  'targetNetWorth',
  'auctions',
  'allowTrades',
  'freeParkingPot',
];

export const MONOPOLY_OPTION_LABEL: Record<MonopolyOptionKey, string> = {
  startCash: '起始現金',
  lastStanding: '破產淘汰制',
  roundLimit: '巡數上限',
  targetNetWorth: '身家目標',
  auctions: '不買就拍賣',
  allowTrades: '開放交易',
  freeParkingPot: '免費停車場獎金池',
};

/**
 * 每個選項的型別與範圍。選項不全是布林，所以比大老二多一張 spec 表 ——
 * 大廳表單與 normalizeMonopolyOptions 都照這張表跑，加選項不必動它們。
 */
export type MonopolyOptionSpec =
  | { kind: 'flag'; default: boolean }
  | { kind: 'number'; default: number; min: number; max: number; step: number };

export const MONOPOLY_OPTION_SPEC: Record<MonopolyOptionKey, MonopolyOptionSpec> = {
  startCash: { kind: 'number', default: 1500, min: 500, max: 5000, step: 100 },
  lastStanding: { kind: 'flag', default: true },
  roundLimit: { kind: 'number', default: 0, min: 0, max: 100, step: 5 },
  targetNetWorth: { kind: 'number', default: 0, min: 0, max: 50_000, step: 500 },
  auctions: { kind: 'flag', default: true },
  allowTrades: { kind: 'flag', default: true },
  freeParkingPot: { kind: 'flag', default: false },
};

export const DEFAULT_MONOPOLY_OPTIONS: MonopolyOptions = {
  startCash: 1500,
  lastStanding: true,
  roundLimit: 0,
  targetNetWorth: 0,
  auctions: true,
  allowTrades: true,
  freeParkingPot: false,
};

// ---------------------------------------------------------------------------
// 階段與動作
// ---------------------------------------------------------------------------

/**
 * 一個回合被切成好幾個階段。
 * roll / jail / buy / manage 的待輸入者就是回合擁有者；
 * auction / trade / debt 是中斷，待輸入者可能是別人 —— 這就是 turnSeat 與 activeSeat 分家的原因。
 */
export type MonopolyPhase = 'roll' | 'jail' | 'buy' | 'auction' | 'trade' | 'debt' | 'manage';

export const MONOPOLY_PHASE_LABEL: Record<MonopolyPhase, string> = {
  roll: '擲骰',
  jail: '獄中',
  buy: '購地',
  auction: '拍賣',
  trade: '交易',
  debt: '償債',
  manage: '整理資產',
};

/** 各階段的思考時間。買地與喊價要快一點，不然一局跑不完。 */
export const MONOPOLY_PHASE_MS: Record<MonopolyPhase, number> = {
  roll: 45_000,
  jail: 45_000,
  buy: 20_000,
  auction: 20_000,
  trade: 30_000,
  debt: 45_000,
  manage: 45_000,
};

/**
 * 一次玩家輸入。17 種動作走同一個 socket 事件，靠 kind 收窄 ——
 * 跟德州撲克的 game:action 同一個作法，少掉 17 組 handler 與守衛。
 */
export type MonopolyAction =
  | { kind: 'roll' }
  | { kind: 'buy' }
  | { kind: 'decline' }
  | { kind: 'bid'; amount: number }
  | { kind: 'passBid' }
  | { kind: 'build'; tile: MonopolyEstateId }
  | { kind: 'sellHouse'; tile: MonopolyEstateId }
  | { kind: 'mortgage'; tile: MonopolyEstateId }
  | { kind: 'unmortgage'; tile: MonopolyEstateId }
  | { kind: 'payBail' }
  | { kind: 'useJailCard' }
  | { kind: 'rollForDoubles' }
  | { kind: 'offerTrade'; to: PlayerId; give: MonopolyEstateId[]; giveCash: number; want: MonopolyEstateId[]; wantCash: number }
  | { kind: 'respondTrade'; accept: boolean }
  | { kind: 'declareBankrupt' }
  | { kind: 'endTurn' };

export const MONOPOLY_ACTION_KINDS: readonly MonopolyAction['kind'][] = [
  'roll',
  'buy',
  'decline',
  'bid',
  'passBid',
  'build',
  'sellHouse',
  'mortgage',
  'unmortgage',
  'payBail',
  'useJailCard',
  'rollForDoubles',
  'offerTrade',
  'respondTrade',
  'declareBankrupt',
  'endTurn',
];

/**
 * 伺服器逐觀看者算好的可用動作。
 * 跟德州撲克的 myActions 同一個理由：大富翁的合法性判斷要看整張桌子的狀態，
 * 前端重算一次等於把規則抄第二份。
 */
export interface MonopolyActions {
  canRoll: boolean;
  canBuy: boolean;
  buyPrice: number;
  canDecline: boolean;
  canBid: boolean;
  minBid: number;
  maxBid: number;
  canPassBid: boolean;
  canPayBail: boolean;
  bailAmount: number;
  canUseJailCard: boolean;
  canRollForDoubles: boolean;
  canRespondTrade: boolean;
  canOfferTrade: boolean;
  canDeclareBankrupt: boolean;
  canEndTurn: boolean;
  /** 可以蓋一棟的地。 */
  buildable: MonopolyEstateId[];
  /** 可以拆一棟的地。 */
  sellable: MonopolyEstateId[];
  mortgageable: MonopolyEstateId[];
  unmortgageable: MonopolyEstateId[];
}

export const NO_MONOPOLY_ACTIONS: MonopolyActions = {
  canRoll: false,
  canBuy: false,
  buyPrice: 0,
  canDecline: false,
  canBid: false,
  minBid: 0,
  maxBid: 0,
  canPassBid: false,
  canPayBail: false,
  bailAmount: JAIL_BAIL,
  canUseJailCard: false,
  canRollForDoubles: false,
  canRespondTrade: false,
  canOfferTrade: false,
  canDeclareBankrupt: false,
  canEndTurn: false,
  buildable: [],
  sellable: [],
  mortgageable: [],
  unmortgageable: [],
};

// ---------------------------------------------------------------------------
// 快照（伺服器 → 前端）
// ---------------------------------------------------------------------------

export interface MonopolySeatInfo {
  cash: number;
  position: number;
  inJail: boolean;
  /** 已經在監獄裡待了幾巡。 */
  jailTurns: number;
  jailCards: number;
  bankrupt: boolean;
  netWorth: number;
}

export interface MonopolyEstateView {
  tile: MonopolyEstateId;
  owner: PlayerId | null;
  houses: number;
  mortgaged: boolean;
}

export interface MonopolyAuctionView {
  tile: MonopolyEstateId;
  highBid: number;
  highBidderId: PlayerId | null;
  /** 現在輪到誰喊。 */
  bidderId: PlayerId | null;
}

export interface MonopolyTradeView {
  fromId: PlayerId;
  toId: PlayerId;
  /** 提議者交出的。 */
  give: MonopolyEstateId[];
  giveCash: number;
  /** 提議者想要的。 */
  want: MonopolyEstateId[];
  wantCash: number;
}

export interface MonopolyDebtView {
  debtorId: PlayerId;
  /** null 表示欠銀行。 */
  creditorId: PlayerId | null;
  amount: number;
  /** 現金還差多少。 */
  shortfall: number;
  /** 把地全抵押、房全拆掉最多還能生出多少。 */
  canRaise: number;
}

/** 為什麼結束。 */
export type MonopolyEndReason = 'lastStanding' | 'roundLimit' | 'targetNetWorth' | 'abandoned';

export const MONOPOLY_END_REASON_LABEL: Record<MonopolyEndReason, string> = {
  lastStanding: '只剩一位玩家還沒破產',
  roundLimit: '達到巡數上限',
  targetNetWorth: '有人達到身家目標',
  abandoned: '人數不足，提前結束',
};

export interface MonopolyResultView {
  reason: MonopolyEndReason;
  /** index 0 為第一名。破產的人依破產順序倒著排在後面。 */
  ranking: PlayerId[];
}

export interface MonopolyGameView {
  type: 'monopoly';
  /** 現在該送出動作的人。拍賣時是喊價者，不一定是回合擁有者。 */
  turnPlayerId: PlayerId | null;
  turnDeadline: number;
  over: boolean;
  phase: MonopolyPhase;
  /** 第幾巡（每個人各走一次算一巡）。 */
  round: number;
  /** 這一巡輪到誰的回合。 */
  activePlayerId: PlayerId | null;
  /** 最近一次擲骰。 */
  dice: [number, number] | null;
  /** 免費停車場獎金池，選項關著時恆為 0。 */
  parkingPot: number;
  /** 銀行剩下的房屋與飯店。 */
  houseSupply: number;
  hotelSupply: number;
  seats: Record<number, MonopolySeatInfo>;
  estates: MonopolyEstateView[];
  auction: MonopolyAuctionView | null;
  trade: MonopolyTradeView | null;
  debt: MonopolyDebtView | null;
  result: MonopolyResultView | null;
  /** 針對收訊者算好的可用動作。 */
  myActions: MonopolyActions | null;
}
