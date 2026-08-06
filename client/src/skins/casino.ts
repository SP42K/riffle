import {
  BIG_TWO_PRESET_LABEL,
  BIG_TWO_RULE_LABEL,
  COMBO_LABEL,
  GAME_TYPE_LABEL,
  HOLDEM_CATEGORY_LABEL,
  HOLDEM_STREET_LABEL,
  RANK_LABEL,
  SUIT_SYMBOL,
  describeHoldemCategory,
  describeHoldemHand,
  parseCardId,
  type Card,
  type LogEvent,
  type SeatAction,
  type SystemNotice,
} from 'shared';
import { CodeBoss } from './chrome/BossScreens';
import { CASINO_TEXT } from './text';
import type { CardFace, Skin } from './types';

/** 花色 → 色調代號。四種外觀共用同一組對應，只是上的顏色不同。 */
export const SUIT_TONE = { S: 'a', H: 'b', D: 'c', C: 'd' } as const;

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
