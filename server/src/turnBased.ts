/**
 * 三種玩法的狀態共有的回合欄位。
 * handlers.ts 的計時、重連、房間狀態判斷只讀這三個欄位，所以不必為玩法分支。
 */
export interface TurnBased {
  /**
   * 現在該送出動作的座位。
   * 大老二與德州撲克就是「輪到誰」；大富翁在拍賣、交易、償債時會指向回合擁有者以外的人 ——
   * 房間層不必知道差別，它只要知道該催誰、該幫誰代打。
   */
  turnSeat: number;
  /** 這個回合的截止時間戳（ms）。沒有進行中的回合時為 0。 */
  turnDeadline: number;
  over: boolean;
}

/** 分派 switch 的收尾：漏掉一種玩法就會在這裡編譯失敗。 */
export function assertNeverGame(value: never): never {
  throw new Error(`未處理的玩法：${JSON.stringify(value)}`);
}
