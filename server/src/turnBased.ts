/**
 * 兩種玩法的狀態共有的回合欄位。
 * handlers.ts 的計時、重連、房間狀態判斷只讀這三個欄位，所以不必為玩法分支。
 */
export interface TurnBased {
  /** 輪到哪個座位。 */
  turnSeat: number;
  /** 這個回合的截止時間戳（ms）。沒有進行中的回合時為 0。 */
  turnDeadline: number;
  over: boolean;
}
