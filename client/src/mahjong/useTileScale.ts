import { useMediaQuery } from '../hooks/useMediaQuery';

/**
 * 窄螢幕的麻將牌縮放係數。
 *
 * 牌是 canvas 畫出來的像素圖，不能用 CSS transform 縮——放大縮小會糊掉，
 * 而且棄牌堆是 grid，格子尺寸看的是 canvas 的實際寬高，transform 之後排版會整個歪掉。
 * 所以只能在「畫之前」先把 scale 乘進去，這個 hook 就是那個乘數。
 * 各呼叫端傳進來的相對比例（0.7～1.3）維持不變，乘完才是最後畫出來的大小。
 */
export function useTileScale(): number {
  const narrow = useMediaQuery('(max-width: 860px)');
  const tiny = useMediaQuery('(max-width: 430px)');
  if (tiny) return 0.65;
  if (narrow) return 0.8;
  return 1;
}
