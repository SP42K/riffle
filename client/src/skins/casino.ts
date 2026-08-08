import {
  BIG_TWO_PRESET_LABEL,
  BIG_TWO_RULE_LABEL,
  COMBO_LABEL,
  GAME_TYPE_LABEL,
  HOLDEM_CATEGORY_LABEL,
  HOLDEM_STREET_LABEL,
  MONOPOLY_CARD_LABEL,
  MONOPOLY_END_REASON_LABEL,
  MONOPOLY_GROUP_LABEL,
  MONOPOLY_OPTION_LABEL,
  MONOPOLY_PHASE_LABEL,
  MONOPOLY_TILE_LABEL,
  RANK_LABEL,
  SUIT_SYMBOL,
  describeHoldemCategory,
  describeHoldemHand,
  parseCardId,
  type Card,
  type LogEvent,
  type MonopolyGroup,
  type SeatAction,
  type SystemNotice,
} from 'shared';
import { CodeBoss } from './chrome/BossScreens';
import { CASINO_TEXT } from './text';
import type { CardFace, Skin } from './types';

/** 花色 → 色調代號。四種外觀共用同一組對應，只是上的顏色不同。 */
export const SUIT_TONE = { S: 'a', H: 'b', D: 'c', C: 'd' } as const;

/**
 * 色組 → 色調代號。刻意跟 CardFace.tone 分開 ——
 * 那組只有 a~d（來自四花色），被卡片元件與十幾條 CSS 消費，擴成十種會逼它們處理不可能的值。
 */
export const GROUP_TONE: Record<MonopolyGroup, string> = {
  brown: 'a',
  lightBlue: 'b',
  pink: 'c',
  orange: 'd',
  red: 'e',
  yellow: 'f',
  green: 'g',
  blue: 'h',
  railroad: 'i',
  utility: 'j',
};

/** 一塊地上的建物：0~4 是房子，5 是飯店。 */
export function houseMarks(n: number): string {
  if (n <= 0) return '';
  return n >= 5 ? '🏨' : '🏠'.repeat(n);
}

const RANK_MEDAL = ['🥇', '🥈', '🥉'];

function face(card: Card): CardFace {
  return {
    main: RANK_LABEL[card.rank],
    sub: SUIT_SYMBOL[card.suit],
    tone: SUIT_TONE[card.suit],
    label: `${SUIT_SYMBOL[card.suit]}${RANK_LABEL[card.rank]}`,
  };
}

/** 把戰報裡的牌 id 還原成這個外觀的寫法。 */
export function labelCards(ids: string[], render: (card: Card) => string): string {
  return ids
    .map((id) => {
      const card = parseCardId(id);
      return card ? render(card) : id;
    })
    .join(' ');
}

const cards = (ids: string[]) => labelCards(ids, (card) => face(card).label);

function action(a: SeatAction): string {
  const allIn = a.allIn ? '（all-in）' : '';
  switch (a.kind) {
    case 'sb':
      return `小盲 ${a.amount}`;
    case 'bb':
      return `大盲 ${a.amount}`;
    case 'fold':
      return '蓋牌';
    case 'check':
      return '過牌';
    case 'call':
      return `跟注 ${a.amount}${allIn}`;
    case 'bet':
      return `下注 ${a.to ?? a.amount}${allIn}`;
    case 'raise':
      return `加注到 ${a.to ?? a.amount}${allIn}`;
    case 'leave':
      return '離開';
  }
}

const tile = (id: keyof typeof MONOPOLY_TILE_LABEL) => MONOPOLY_TILE_LABEL[id];

const CASH_SOURCE = {
  salary: '經過起點',
  parking: '免費停車場',
  card: '機會命運',
  players: '玩家之間',
} as const;

const FREED_HOW = {
  bail: '交保',
  card: '出獄卡',
  doubles: '擲出同點',
  served: '關滿刑期',
} as const;

/** 交易的一邊：幾塊地加多少現金。 */
function tradeSide(tiles: readonly (keyof typeof MONOPOLY_TILE_LABEL)[], cash: number): string {
  const parts = tiles.map(tile);
  if (cash > 0) parts.push(`現金 ${cash}`);
  return parts.length > 0 ? parts.join('、') : '（什麼都沒有）';
}

function formatLog(event: LogEvent): string {
  switch (event.t) {
    case 'bigTwoStart':
      return `新的一局開始，共 ${event.players} 人`;
    case 'lead':
      return `${event.player} 持有最小的牌，先手`;
    case 'play':
      return `${event.player} 出 ${COMBO_LABEL[event.combo]} ${cards(event.cards)}`;
    case 'pass':
      return `${event.player} PASS`;
    case 'finished':
      return `${event.player} 出完了，第 ${event.rank} 名`;
    case 'bigTwoOver':
      return `本局結束：${event.ranking.map((n, i) => `第 ${i + 1} 名 ${n}`).join('、')}`;
    case 'rebuy':
      return `${event.player} 補碼 ${event.amount}`;
    case 'holdemStart':
      return `第 ${event.handNo} 手開始，小盲 ${event.smallBlind} / 大盲 ${event.bigBlind}`;
    case 'button':
      return `${event.player} 坐莊`;
    case 'bet':
      return `${event.player} ${action(event.action)}`;
    case 'street':
      return `${HOLDEM_STREET_LABEL[event.street]}　${cards(event.board)}`;
    case 'board':
      return `公共牌　${cards(event.board)}`;
    case 'showdown':
      return `${event.player}：${describeHoldemCategory(event.category, event.tiebreak)}${
        event.won > 0 ? `，贏得 ${event.won}` : ''
      }`;
    case 'uncontested':
      return `${event.player} 贏得 ${event.won}（其他人都蓋牌了）`;
    case 'timeout':
      return `${event.player} 逾時，自動${
        event.auto === 'pass' ? ' PASS' : event.auto === 'check' ? '過牌' : '蓋牌'
      }`;
    case 'timeoutPlay':
      return `${event.player} 逾時，自動出 ${COMBO_LABEL[event.combo]} ${cards(event.cards)}`;
    case 'monopolyStart':
      return `新的一局開始，共 ${event.players} 人，每人 ${event.startCash}`;
    case 'move':
      return `${event.player} 擲出 ${event.dice[0]}+${event.dice[1]}，走到 ${tile(event.tile)}`;
    case 'buy':
      return `${event.player} 買下 ${tile(event.tile)}，花了 ${event.price}`;
    case 'rent':
      return `${event.player} 付 ${event.owner} 租金 ${event.amount}（${tile(event.tile)}）`;
    case 'tax':
      return `${event.player} 繳 ${tile(event.tile)} ${event.amount}`;
    case 'monopolyCash':
      return `${event.player} ${event.amount >= 0 ? '收到' : '付出'} ${Math.abs(event.amount)}（${
        CASH_SOURCE[event.source]
      }）`;
    case 'auctionStart':
      return `${tile(event.tile)} 流入拍賣`;
    case 'bid':
      return `${event.player} 出價 ${event.amount}`;
    case 'auctionEnd':
      return event.player
        ? `${event.player} 以 ${event.amount} 標下 ${tile(event.tile)}`
        : `${tile(event.tile)} 流標`;
    case 'build':
      return event.sold
        ? `${event.player} 拆掉 ${tile(event.tile)} 一棟，剩 ${event.houses} 級`
        : `${event.player} 在 ${tile(event.tile)} 蓋到 ${event.houses} 級`;
    case 'mortgage':
      return event.redeem
        ? `${event.player} 花 ${event.amount} 贖回 ${tile(event.tile)}`
        : `${event.player} 抵押 ${tile(event.tile)}，拿到 ${event.amount}`;
    case 'drawCard':
      return `${event.player} 抽到：${MONOPOLY_CARD_LABEL[event.card]}`;
    case 'jailed':
      return `${event.player} 被關進監獄`;
    case 'freed':
      return `${event.player} 出獄（${FREED_HOW[event.how]}）`;
    case 'trade':
      return `${event.from} 與 ${event.to} 完成交易：${tradeSide(event.give, event.giveCash)} ⇄ ${tradeSide(event.want, event.wantCash)}`;
    case 'bankrupt':
      return event.creditor
        ? `${event.player} 破產，資產全數轉給 ${event.creditor}`
        : `${event.player} 破產，資產收歸銀行`;
    case 'monopolyOver':
      return `本局結束（${MONOPOLY_END_REASON_LABEL[event.reason]}）：${event.ranking
        .map((n, i) => `第 ${i + 1} 名 ${n}`)
        .join('、')}`;
    case 'timeoutMonopoly':
      return `${event.player} 在${MONOPOLY_PHASE_LABEL[event.phase]}階段逾時，自動處理`;
    case 'snakeStart':
      return `新的一局開始，共 ${event.players} 人`;
    case 'snakeRespawn':
      return `${event.player} 死了一次，重生倒數中`;
    case 'snakeDeath':
      return `${event.player} 出局了`;
    case 'snakeMineEaten':
      return `${event.player} 吃到自己的地雷果實，大加分`;
    case 'snakeOver':
      return `本局結束：${event.ranking.map((n, i) => `第 ${i + 1} 名 ${n}`).join('、')}`;
    case 'minesweeperStart':
      return `新的一局開始，共 ${event.players} 人`;
    case 'minesweeperReveal':
      return `${event.player} 點開了 (${event.r + 1}, ${event.c + 1})，${event.points > 0 ? '安全（+1 分）' : '踩雷（-1 分）'}`;
    case 'minesweeperFlag':
      return `${event.player} 在 (${event.r + 1}, ${event.c + 1}) ${event.flagged ? '插上旗子' : '拔掉旗子'}`;
    case 'minesweeperOver':
      return `遊戲結束：${event.ranking.map((n, i) => `第 ${i + 1} 名 ${n}`).join('、')}`;
    case 'timeoutMinesweeper':
      return `${event.player} 逾時，自動隨機點擊`;
    case 'dndStart':
      return `地下城冒險開始！隊伍共 ${event.players} 人`;
    case 'dndMove':
      return `${event.player} 往 ${event.dir === 'up' ? '上' : event.dir === 'down' ? '下' : event.dir === 'left' ? '左' : '右'} 移動了一格`;
    case 'dndAttack':
      return event.damage < 0
        ? `✨【治療】${event.player} 施放神聖治療，恢復了 ${event.target} ${-event.damage} 點生命值！`
        : `${event.player} 攻擊了 ${event.target}（ D20: ${event.roll}）— ${event.hit ? `命中！造成 ${event.damage} 點傷害` : '未命中'}`;
    case 'dndMonsterTurn':
      return `【怪物回合】哥布林開始行動！`;
    case 'dndOver':
      return `冒險結束！冒險者隊伍 ${event.won ? '勝利！' : '全軍覆沒…失敗！'}`;
    case 'timeoutDnd':
      return `${event.player} 行動逾時，由系統自動代打`;
  }
}

function notice(n: SystemNotice): string {
  switch (n.t) {
    case 'created':
      return `${n.player} 建立了房間`;
    case 'joined':
      return `${n.player} 加入了房間`;
    case 'spectating':
      return `${n.player} 進來觀戰`;
    case 'left':
      return `${n.player} 離開了房間`;
    case 'disconnected':
      return `${n.player} 斷線離開`;
  }
}

/** 原本的牌桌外觀。所有文案與寫法都跟隱匿模式做出來以前一模一樣。 */
export const casinoSkin: Skin = {
  id: 'casino',
  label: '牌桌',
  docTitle: '線上牌桌 Online',
  favicon:
    'data:image/svg+xml,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#12241c"/><text x="16" y="23" font-size="20" text-anchor="middle" fill="#e3b341">♠</text></svg>',
    ),
  text: CASINO_TEXT,
  combo: COMBO_LABEL,
  gameType: GAME_TYPE_LABEL,
  bigTwoPreset: BIG_TWO_PRESET_LABEL,
  bigTwoRule: BIG_TWO_RULE_LABEL,
  street: HOLDEM_STREET_LABEL,
  holdemCategory: HOLDEM_CATEGORY_LABEL,
  monopolyTile: MONOPOLY_TILE_LABEL,
  monopolyGroup: MONOPOLY_GROUP_LABEL,
  monopolyOption: MONOPOLY_OPTION_LABEL,
  monopolyCard: MONOPOLY_CARD_LABEL,
  monopolyPhase: MONOPOLY_PHASE_LABEL,
  monopolyEnd: MONOPOLY_END_REASON_LABEL,
  monopolyHouses: houseMarks,
  errors: {},
  card: face,
  medal: (rank) => RANK_MEDAL[rank - 1] ?? '🎖',
  describeHand: describeHoldemHand,
  action,
  formatLog,
  notice,
  Chrome: ({ children }) => children,
  Boss: CodeBoss,
};
