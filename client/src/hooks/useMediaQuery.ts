import { useCallback, useSyncExternalStore } from 'react';

/**
 * 同一條 query 共用同一個 MediaQueryList。
 * 麻將桌上每顆牌都各自訂閱螢幕寬度（上百個 canvas × 每次 render），
 * 不快取的話 subscribe 跟 getSnapshot 每叫一次都生一個新物件。
 */
const mqlCache = new Map<string, MediaQueryList>();
function mqlOf(query: string): MediaQueryList {
  let list = mqlCache.get(query);
  if (!list) {
    list = window.matchMedia(query);
    mqlCache.set(query, list);
  }
  return list;
}

/**
 * 訂閱一條 media query。用 useSyncExternalStore 而不是 useState + useEffect：
 * 首次渲染就直接讀到正確答案，不會先畫成桌機版再閃一下改成手機版。
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined') return () => {};
      const list = mqlOf(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(
    () => typeof window !== 'undefined' && mqlOf(query).matches,
    [query],
  );
  // 伺服器端渲染時一律當成桌機（本專案沒有 SSR，這裡只是讓型別與行為完整）
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** 是不是用手指在操作。觸控裝置沒有鍵盤也沒有 hover，很多提示得換成看得見的按鈕。 */
export function useCoarsePointer(): boolean {
  return useMediaQuery('(pointer: coarse)');
}
