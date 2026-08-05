import type { ReactNode } from 'react';
import type {
  Card,
  ComboType,
  GameType,
  HoldemCategory,
  HoldemHand,
  HoldemStreet,
  LogEvent,
  SeatAction,
  SystemNotice,
} from 'shared';
import type { TextTable } from './text';

export type SkinId = 'casino' | 'vscode' | 'terminal';

/**
 * 一張牌長什麼樣。牌桌外觀是 'A' + '♠'，偽裝外觀則是看起來像檔名或指令輸出的字。
 * tone 由花色決定，四種色調由各外觀自己在 CSS 裡上色。
 */
export interface CardFace {
  main: string;
  sub: string;
  /** s/h/d/c 對應黑桃/紅心/方塊/梅花，但寫成中性代號免得 class 名稱本身洩漏。 */
  tone: 'a' | 'b' | 'c' | 'd';
  /** aria-label 與 title 用，不能留 '♠A' 這種寫法。 */
  label: string;
}

export interface Skin {
  id: SkinId;
  /** 設定面板用的名稱。 */
  label: string;
  /** 分頁標題。 */
  docTitle: string;
  /** favicon 的 data: URI。 */
  favicon: string;

  text: TextTable;
  combo: Record<ComboType, string>;
  gameType: Record<GameType, string>;
  street: Record<HoldemStreet, string>;
  holdemCategory: Record<HoldemCategory, string>;
  /** ack error code → 文案。查不到就退回伺服器給的訊息。 */
  errors: Partial<Record<string, string>>;

  card(card: Card): CardFace;
  /** 名次前綴，牌桌是獎牌 emoji，偽裝外觀要換成純文字。 */
  medal(rank: number): string;
  /** 德州撲克的牌力描述，例如「兩對 A 與 K」。 */
  describeHand(hand: HoldemHand): string;
  /** 一次下注動作的寫法。座位上的最近動作與戰報共用。 */
  action(action: SeatAction): string;
  /** 把結構化戰報組成一行字。 */
  formatLog(event: LogEvent): string;
  /** 聊天欄裡的系統通知。 */
  notice(notice: SystemNotice): string;

  /** 包在整個 app 外面的假視窗。牌桌外觀直接回傳 children。 */
  Chrome(props: { children: ReactNode }): ReactNode;
  /** 老闆鍵按下時蓋住畫面的靜態內容。 */
  Boss(): ReactNode;
}

/** 把 '{n}/{max} 人' 這種樣板套上值。 */
export function fill(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}
