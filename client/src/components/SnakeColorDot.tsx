/**
 * styles.css 裡定義了幾組 --snake-seat-N 色票。座位數（SEAT_LIMITS.snake.max）超過這個數字時
 * 顏色就會重複，兩位玩家會長得一模一樣，連地雷果實的歸屬都會認錯——加座位就要一起加色票。
 */
export const SNAKE_SEAT_COLORS = 6;

/** 座位顏色小圓點，跟棋盤上那個顏色對應——解決「搞不清楚自己是哪條蛇」的問題。 */
export function SnakeColorDot({ seat }: { seat: number }) {
  return <span className={`snake-color-dot snake-color-dot--seat${seat % SNAKE_SEAT_COLORS}`} />;
}
