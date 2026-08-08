/** 座位顏色小圓點，跟棋盤上那個顏色對應——解決「搞不清楚自己是哪條蛇」的問題。 */
export function SnakeColorDot({ seat }: { seat: number }) {
  return <span className={`snake-color-dot snake-color-dot--seat${seat % 4}`} />;
}
