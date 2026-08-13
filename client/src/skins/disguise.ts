import type { GameType } from 'shared';

/**
 * 這個玩法的畫面能不能被外觀藏住。
 *
 * 牌桌類的畫面本來就是一堆方塊與文字，換成編輯器或終端機都說得通；貪吃蛇是一張 2D 彩色格子圖，
 * 樓梯小勇者是一張橫向捲動的動作遊戲畫面，台灣麻將的牌面是 canvas 畫出來的像素牌，
 * 這三者三套外觀都只能照原樣畫出來，與其假裝有偽裝，
 * 不如在大廳的兩個決策點（選玩法、挑房間）先講清楚。
 * 注意這降低的是「不知情就開下去」的風險，不是「玩到一半被走過來看到」—— 後者靠老闆鍵。
 *
 * 寫成 Record<GameType, …>，新玩法忘了填會編譯失敗。
 */
export const GAME_DISGUISABLE: Record<GameType, boolean> = {
  bigTwo: true,
  holdem: true,
  monopoly: true,
  downstairs: false,
  snake: false,
  minesweeper: true,
  dnd: true,
  // 麻將牌面走 MahjongTileIcon 的像素畫，不經過外觀的 card()，換皮也藏不住
  taiwanMahjong: false,
};
