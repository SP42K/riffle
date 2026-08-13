import { createContext, useContext } from 'react';
import type { Skin, SkinId } from '../skins';
import { DEFAULT_SKIN_ID } from '../skins';
import type { TextKey } from '../skins/text';

/** 隱匿模式的偏好設定。存在 localStorage 的 'ws.prefs'。 */
export interface Prefs {
  skin: SkinId;
  /** 循環切換外觀的快捷鍵。 */
  hotkeyCycle: string;
  /** 老闆鍵：一鍵把整個畫面蓋掉，再按一次還原。 */
  hotkeyBoss: string;
  /** 切到別的分頁或視窗失焦時自動遮蔽。 */
  autoHideOnBlur: boolean;
  /** 滑鼠移出瀏覽器視窗時自動遮蔽。 */
  autoHideOnMouseLeave: boolean;
  autoHideDelayMs: number;
  /** 分頁標題與 favicon 跟著外觀換。 */
  swapTitle: boolean;
  /** 輪到自己時震動一下（只有行動裝置有效）。預設關：辦公室裡震動比畫面更容易穿幫。 */
  vibrateOnTurn: boolean;
}

export const PREFS_KEY = 'ws.prefs';

export const DEFAULT_PREFS: Prefs = {
  skin: DEFAULT_SKIN_ID,
  // 預設用 F 鍵：按起來快，而且瀏覽器沒有佔用
  hotkeyCycle: 'F8',
  hotkeyBoss: 'F9',
  autoHideOnBlur: true,
  autoHideOnMouseLeave: false,
  autoHideDelayMs: 800,
  swapTitle: true,
  vibrateOnTurn: false,
};

export interface SkinContextValue {
  skin: Skin;
  prefs: Prefs;
  setPrefs: (patch: Partial<Prefs>) => void;
  /** 取文案，第二個參數會代換 {name} 這種樣板。 */
  t: (key: TextKey, vars?: Record<string, string | number>) => string;
  /** 目前是否被遮蔽（老闆鍵或自動遮蔽）。 */
  hidden: boolean;
  toggleBoss: () => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
}

export const SkinContext = createContext<SkinContextValue | null>(null);

export function useSkin(): SkinContextValue {
  const value = useContext(SkinContext);
  if (!value) throw new Error('useSkin 必須在 SkinProvider 裡使用');
  return value;
}

/**
 * 把一次按鍵寫成 'Ctrl+Shift+Q' 這種字串。
 * 只按修飾鍵時回空字串，錄製快捷鍵時就不會把 Shift 自己記進去。
 */
export function hotkeyOf(event: KeyboardEvent): string {
  const key = event.key;
  if (key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta') return '';

  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Meta');
  parts.push(key === ' ' ? 'Space' : key.length === 1 ? key.toUpperCase() : key);
  return parts.join('+');
}

/** 焦點在輸入框裡時不吃快捷鍵，免得打字被攔截。 */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}
