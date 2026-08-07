# 多人貪吃蛇（Snake）— 高階設計文件

> 狀態：**已實作**（`feature/snake` 分支）。這份是給多人開發用的高階脈絡文件，
> 不含逐行實作細節；規則與參數已在下方標註為定案。

## Context（為什麼做這個）

在現有的 riffle 線上牌桌上新增**第四款小遊戲：多人貪吃蛇**（2~4 人）。定位是輕量、規則乾淨的即時對戰，**不做任何道具、加速、特殊格**。

兩個硬性限制決定了整個設計方向：

1. **多人協作開發，不能大改既有程式碼** → 採「純新增」為主，沿用 repo 既有的「New game mode」配方（`CLAUDE.md` 的 "Adding a rule or event" 章節），現有大老二／德州／大富翁的邏輯一律不碰。
2. **三套外觀（casino / vscode / terminal）都要能顯示**，且產品核心是「在公司玩、能偽裝」→ 貪吃蛇的 2D 地圖是唯一與現有架構「氣質不合」的點，採**單寬字元格輕度偽裝**解決（見下方）。

## 可行性結論

**可行，且能做到幾乎只新增、不改動既有遊戲。** 貪吃蛇能以第四個 `GameType` 加入，型別層由編譯器強制補齊（`Record<GameType>` 與 `assertNeverGame` 會逼你在每個 dispatch 補上 `snake` case）。

唯一真正「新增的機制」是**每房一個 tick 迴圈**。目前整個 codebase 沒有任何 `setInterval`，所有計時都是一次性 `setTimeout`。這個 tick 迴圈會**加在既有計時器旁邊**（與 `turnTimer`／`handTimer` 平行），不是改進既有回合制流程裡。

## 已定案的遊戲規則

| 項目 | 規則 |
|---|---|
| 人數 | 2~4 人（`SEAT_LIMITS.snake = { min: 2, max: 4 }`） |
| 開局 | 按下開始後棋盤與出生位置立刻可見，倒數 3 秒（`SNAKE_START_DELAY_MS`）才真的開始移動 |
| 移動 | tick 制，所有蛇同時前進；玩家輸入只是「改變方向意圖」 |
| 果實 | 地圖上有果實，吃到 → 身體加長 + 分數 +1，果實重新生成 |
| 死亡 | 撞牆、撞到自己的身體、撞到別人的身體 → 出局 |
| 頭對頭 | **兩種情況都算，雙方都不死、這一拍都不前進（彈開），方向不變，下一拍自行轉向**：(a) 兩個以上的頭同一 tick 衝進同一格 (b) 兩條蛇正面對衝、交叉穿過彼此（互換位置）。這兩種在畫面上都是「兩顆頭撞在一起」，統一成同一種結果，不分裝置死亡 |
| 結局 | 最後一人存活即結束，走既有 `emitRanking` 排名結算 |
| 禁止 | 不能 180° 直接掉頭（會撞脖子）；反向輸入直接忽略 |

> **修訂記錄**：頭對頭原本只涵蓋「同格」情況，「正面互換位置」原設計為兩敗俱死；上線測試後改為兩種情況統一彈開、都不死（見 [server/src/snakeEngine.ts](../server/src/snakeEngine.ts) 的 `tickSnake`）。

## 架構契合（關鍵設計）

### 1. `SnakeState` 滿足 `TurnBased`，但「惰性」滿足

```ts
SnakeState extends TurnBased {
  turnSeat = -1        // 貪吃蛇沒有「輪到誰」，設為無效值
  turnDeadline = 0     // 沒有回合截止
  over: boolean        // 這個是真的（最後一人存活時 true）
  // ...蛇身、果實、分數、方向、grid 尺寸...
}
```

因為 `turnSeat` 無效、`turnDeadline = 0`，既有的 `scheduleTurn`（`handlers.ts`）對 snake 房會**自然 no-op**（它本來就會在沒有有效回合時提早 return）。回合制的計時／自動出手邏輯完全不會誤觸發到貪吃蛇。

### 2. 新增 `room.tickTimer`（唯一的新機制）

- 在 `Room` 型別加一個 `tickTimer` 欄位（比照既有的 `turnTimer` / `handTimer`）。
- 遊戲開始（start dispatch）時啟動；`over` 或房間拆除時清除。
- 每拍呼叫純引擎的 `tick()`，然後 `broadcastRoom` 推送快照。
- 建議實作為**自我重排的 `setTimeout`**（比 `setInterval` 好清、好對齊既有的 timer 管理慣例）。

### 3. 輸入是「意圖」，不是「指令」

- 新增一個 socket 事件 `game:snake`（payload：方向 `up/down/left/right`）。
- 它的 handler **只把方向寫進 state 的緩衝，然後 return**。
- **絕對不呼叫 `afterGameAction`**（那會重排回合計時器並對每個人做整包廣播——每次按鍵都做會爆量）。真正的「移動 + 廣播」由 tick 迴圈負責，不由按鍵負責。

### 4. 結局沿用既有排名

- `over` 轉 true 時，透過既有的 `checkGameOver` → `emitRanking` 出排名（與大老二／大富翁同一條路徑，德州才是特例）。

## Tick 迴圈每一拍做什麼（引擎純函式 `tickSnake()`）

1. 套用各蛇緩衝的方向（忽略 180° 反向）
2. 算出每條蛇的「下一個頭位置」
3. **頭對頭結算**：(a) 兩個以上的頭指向同一格，或 (b) 兩條蛇互換位置（交叉穿過彼此）→ 這些蛇這拍不前進（彈開），不死
4. 碰撞判定：其餘蛇的下一個頭若在牆外／自己身體／別人身體 → 標記死亡
5. 果實判定：吃到 → 身體不砍尾（加長）+ 分數 +1 + 重新生成果實；沒吃到 → 正常砍尾
6. 移除死亡的蛇
7. 存活數 ≤ 1 → `over = true`
8. `broadcastRoom` 推快照

### 開局倒數怎麼接進既有機制

`game:start` 觸發時立刻 `initSnake`（棋盤、出生位置、`startAt = now + SNAKE_START_DELAY_MS` 都算好），但**不會**馬上進 tick 迴圈——先用一個一次性 `setTimeout`（`scheduleSnakeStart`，一樣借 `room.tickTimer` 這個欄位）等到 `startAt`，才交棒給真正的 `scheduleSnakeTick`。這段等待期間玩家已經看得到棋盤與出生位置（可以先按方向鍵，輸入會被緩衝），只是蛇還不會動。

倒數要顯示給玩家看，但沒有另外開一條新的 wire 欄位：`SnakeGameView.turnDeadline`（本來對貪吃蛇是恆為 0 的惰性欄位）在倒數期間**借來**回傳 `startAt`，倒數結束後歸零。前端直接沿用大老二／德州早就有的 `useCountdown(turnDeadline)` hook，不必新增機制。

## 效能考量

- 現況：每次動作都會為**每個成員各自重建一份完整 `RoomView` 快照**並推送。貪吃蛇會把這個頻率拉到每秒數次。
- 對策（設計取捨，非阻礙）：
  - tick 速率保守，建議 **125~160ms（約 6~8 拍／秒）**，手感夠、負載可控。
  - grid 尺寸保守，建議 **20×20 上下**。
  - client 端可選擇性 memo 化 `RoomShell` 的座位／聊天／log 子樹，讓每拍只重繪 `table__center`。這是**優化，不是必要**——snapshot-push 模型本身撐得住這個頻率。

## 改動面（分「純新增」與「動到共用機制」）

### A. 純新增檔案（風險最低，多人開發最安全）

- `shared/src/snake.ts`（新）：`SnakeGameView`、方向 enum、grid/速度常數。
- `server/src/snakeEngine.ts`（新）：純引擎，`tick()` / `applyDir()` / 初始化，`SnakeState extends TurnBased`，無 I/O、無 socket——這層可單元測試。
- `client/src/pages/SnakeTable.tsx`（新）：比照 `BigTwoTable.tsx` 樣式；用 `useGame()` 取 state、以 `room.game?.type === 'snake'` 收斂型別、方向鍵 `useEffect` 監聽、`run(() => emitWithAck('game:snake', { dir }))` 送出、回傳 `<RoomShell center footer isMyTurn />`。

### B. 型別／設定（編譯器會強制補齊，漏了會編不過）

- `shared/src/types.ts`：`GameType` 加 `'snake'`、`GAME_TYPES`、`GAME_TYPE_LABEL`（`貪吃蛇`）、`SEAT_LIMITS`、`GameView` union 加 `SnakeGameView`、`ClientToServerEvents` 加 `game:snake`、`LogEvent` 加貪吃蛇變體（開始／死亡／結束）。
- `shared/src/index.ts`：`export * from './snake.js'`。

### C. 動到共用機制（唯一需要小心 review 的部分）

- `server/src/rooms.ts`：`Room` 型別加 `tickTimer`；`buildGameView` / `handOf` 各補 `snake` case（`handOf` 回 null，貪吃蛇無隱藏牌）。
- `server/src/handlers.ts`：
  - start dispatch 補 `case 'snake'` → 初始化 state + 啟動 tick 迴圈。
  - 新 `onSnake` handler（只寫入方向意圖）。
  - `register` 綁定 `game:snake`。
  - `checkGameOver` / `runAutoAct` / `removeFromGame` 各補 `snake` case（`assertNeverGame` 會逼你補）。`runAutoAct` 對貪吃蛇可為 no-op（tick 迴圈本身就會推進，離線玩家的蛇照樣被動前進直到撞死）。
  - 房間拆除／`emitRanking` 時一併清 `tickTimer`。
- 三套 skin（`casino.ts` / `vscode.ts` / `terminal.ts`）：補 `gameType.snake` 標籤；`text.ts` 的 `CASINO_TEXT` 補 `snake.*` 文案鍵，其餘兩套 skin 跟著補齊（編譯器強制）。

> 貪吃蛇**不需要**隱藏牌相關的 `hand` / `allHands` / `chips`（保持 `null`），也不需碰 `combo` / `bigTwo*` / `holdem*` / `monopoly*` 任何 label map。

## 已定案的參數

- 偽裝外觀：**單寬字元格（monospace）**——地圖用等寬字元繪製（`·` 空格、`■` 蛇身、`◆` 果實、頭再疊一個 CSS class 提亮），三套外觀共用同一套 DOM 結構，只有配色與 `gameType` 標籤／文案不同（vscode/terminal 顯示成 `watch`）。
- grid `20×20`、tick `150ms`、果實固定維持 2 顆、出生點四角朝內、開局倒數 `3` 秒（`SNAKE_START_DELAY_MS`）。

## 驗收方式（Verification）

- `npm run typecheck`：`Record<GameType>` 與 `assertNeverGame` 會把所有漏接的 dispatch 變成編譯錯誤——過了就代表接線齊全。
- `npx vitest run server/src/snakeEngine.test.ts`：涵蓋撞牆／撞自己／撞別人身體 → 死、頭對頭（同格＋互換位置兩種）→ 彈開不死、吃果實 → 加長+計分、最後一人 → `over`、`initSnake` 的開局倒數時間戳。
- 手動：`npm run dev`，開 2~4 個分頁（每個分頁是獨立玩家）、建貪吃蛇房、開始、方向鍵操作，確認 3 秒倒數、變長／死亡／排名結算，三套 skin 各看一遍。
