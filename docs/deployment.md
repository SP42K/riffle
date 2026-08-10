# 部署評估：這個專案能不能架在 Vercel

## 結論

**前端可以上 Vercel，後端不建議上 Vercel。**

`client/dist` 是一包沒有 `base`、沒有環境變數的純靜態產物，丟上 Vercel 幾乎零成本。
但 `server/` 是一個**單一 Node 行程 + 全記憶體狀態 + 長駐計時器**的 socket.io 服務，
跟 Vercel 的 function 模型有結構性衝突 —— 不是「設定調一調就能跑」，而是要重寫 room layer。

三個可行方案，按推薦順序：

| | 方案 A：Vercel 前端 + 常駐容器後端 | 方案 B：全部上 Vercel | 方案 C：維持單一容器 |
|---|---|---|---|
| 改動量 | 小（前端一行 + CORS 白名單 + 兩個設定檔） | 極大（重寫 `rooms.ts` / `handlers.ts`） | 零 |
| 即時模式（貪食蛇／樓梯小勇者） | 完整 | 得砍掉或改成客戶端權威 | 完整 |
| 營運複雜度 | 兩個網域、一套 CORS | Vercel + 外部 Redis | 一個容器 |
| 成本形狀 | 前端免費額度 + 一台小容器 | Active CPU 計價 + Redis | 一台小容器 |

如果只是想找個地方把遊戲開起來給人玩，**方案 C 最省事**；
如果想吃 Vercel 的 CDN 與 preview deployment，走**方案 A**。

> **本專案採用方案 A**（Vercel 前端 + Render 後端），程式與設定檔都已就緒，
> 剩下的只有兩個平台上要填的環境變數。詳見下面的〈方案 A〉。

---

## 為什麼後端跟 Vercel 衝突

Vercel 在 2026/06/22 讓 Functions 支援 WebSocket（public beta，需開 Fluid compute，
官方列出的支援堆疊含 Socket.IO 與 Express）。所以「Vercel 不支援 WebSocket」已經不是理由了。
真正的問題在下面五點，按嚴重度排：

### 1. 跨 instance 無法廣播

Vercel 官方文件明講：一條 WS 連線被 pin 在單一 function instance，
**沒有內建方式把訊息廣播給其他 instance 持有的連線**，
durable state / presence / rooms / pub-sub 都必須放到外部資料存放（例如 Marketplace 的 Redis）。

這個專案完全建立在相反的假設上：

- `server/src/index.ts:36` 建 socket.io 時沒有指定 adapter，用的是**預設 in-memory adapter**。
- `server/src/handlers.ts:265` 的 `this.io.sockets.sockets.get(oldSocketId)?.disconnect(true)`
  直接翻本機 socket registry 來踢掉同一個 `playerId` 的舊連線 —— 這行**只在單行程成立**。
- `broadcastRoom` 逐一對每個成員送出各自的快照（因為每個 viewer 的 payload 不同），
  前提是這些 socket 都在同一個行程裡。

同一個房間的四個玩家不保證落在同一個 instance，落在不同 instance 就互相看不見。

### 2. 五分鐘連線上限

Vercel 的 WS 連線比照一般 function invocation 計算 duration，**預設 5 分鐘**上限，
Pro/Enterprise 的 beta 可拉到 30 分鐘，時間到就斷線。

一局大老二或大富翁遠超 5 分鐘，而 `DISCONNECT_GRACE_MS` 只有 30 秒
（`shared/src/types.ts:526`）—— 斷線超過 30 秒，`dropFromRoom` 就會把玩家踢出座位、
牌也收回。30 分鐘上限救不了這件事，只是把「每 5 分鐘掉線」變成「每 30 分鐘掉線」。

### 3. 長駐計時器無處可放

這不是「函式跑久一點」能解的，是「沒有請求進來的時候，誰在推進世界」的問題：

| 迴圈 | 週期 | 位置 |
|---|---|---|
| 樓梯小勇者 `startDownstairsLoop` | **50 ms**（`DOWNSTAIRS_TICK_MS`） | `server/src/handlers.ts:880` |
| 貪食蛇 tick（鏈式 `setTimeout`） | 150 ms（`SNAKE_TICK_MS`） | `server/src/handlers.ts:1184` |
| 回合鐘 `turnTimer` | 45 s／離線 3 s | `server/src/handlers.ts:103` |
| 德州撲克自動發下一手 `handTimer` | `HOLDEM_SHOWDOWN_MS` | `server/src/handlers.ts:1135` |
| 斷線寬限 `graceTimer` | 30 s | `server/src/rooms.ts:63` |

每個 `Room` 帶四個計時器 handle（`server/src/rooms.ts:105`）。
serverless 沒有「在兩次請求之間每 50 毫秒執行一次」這種東西，
Vercel Cron 的最小粒度也差了好幾個數量級。

### 4. 全記憶體狀態

`server/src/handlers.ts:207` 起，`GameServer` 把 `rooms` / `sessions` / `playerRoom` /
`lobbyChat` / `loggedHand` 全放在行程內的 `Map`；`Room` 再持有 `players` / `spectators` /
`chips`（`server/src/rooms.ts:208`）。整個專案沒有任何持久化。

搬到 Redis 不是加一個 adapter 就好 —— 是要把約 2000 行的 room layer
（`rooms.ts` + `handlers.ts`）從「同步操作記憶體物件」改寫成「非同步讀寫外部儲存 + 處理競態」。

### 5. 附帶摩擦

即使前四點都解決了，還有這些：

- 伺服器**沒有編譯步驟**，是用 `tsx` 直接跑 TypeScript（`tsx` 是 `server` 的 prod dependency），
  而 `shared` 的 `exports` 指向 `./src/index.ts` 原始碼。任何 bundling 流程都要能處理
  「從 workspace 相依 import 未編譯的 `.ts`」。
- root `package.json` 沒有 `engines` / `packageManager`，也沒有 `.nvmrc`；
  Node 版本目前只釘在 CI workflow 裡（Node 24）。

---

## 方案 A：Vercel 放前端，Render 放後端（採用中）

```
瀏覽器 ──── https://xxx.vercel.app ────► Vercel（靜態 client/dist）
   └────── wss://xxx.onrender.com/socket.io ────► Render（server，socket.io）
```

好處是**遊戲邏輯完全不動** —— 單行程、記憶體狀態、`turnSeat` 的語意、
`scheduleTurn` 的兩段時鐘，這些 `CLAUDE.md` 裡的架構前提全部維持原樣。

### 需要的改動（全部已完成）

| # | 改動 | 落點 |
|---|---|---|
| 1 | 前端能指向別的網域 | `client/src/net/socket.ts` 讀 `VITE_SERVER_URL`，沒設就走同源（方案 C 不受影響）；型別在 `client/src/vite-env.d.ts` |
| 2 | CORS 收緊 | `server/src/index.ts` 讀 `CORS_ORIGIN`。`cors` 只管得到 polling，所以白名單另外掛在 `allowRequest`，WebSocket 升級一起擋 |
| 3 | `vercel.json` | repo root。`installCommand: npm ci` 必須在 **repo root** 跑（`shared` 是 workspace 相依），所以 Vercel 的 Root Directory 要留 `./`，不能設成 `client/` |
| 4 | 後端容器 / 執行設定 | `Dockerfile`（`server` 與 `fullstack` 兩個 target）＋ `docker-compose.yml`；Render 走的是 `render.yaml` 的 Node 原生 runtime，不經過 Docker |
| 5 | Node 版本釘住 | root `package.json` 的 `engines.node: ">=22.12"`。client 用 vite 7，撞到平台的舊預設就是 build 失敗；Vercel 與 Render 都讀這一欄 |

`vercel.json` 的 `rewrites` 取代 `server/src/index.ts` 那個 SPA fallback（前端不再由後端吐出）。
Render 用 Node runtime 是因為**它沒有 Docker `--target` 設定**，直接指 Dockerfile 會建到最後一個
stage（`fullstack`，含前端）；Node runtime 下沒有 `client/dist`，`existsSync` 算不到就只跑 API。

要點：

- **目錄結構不能動。** 後端是用相對路徑 `../../client/dist` 找前端的
  （`.github/workflows/release.yml` 的註解也點名這件事）。
- health check 直接用現成的 `GET /healthz`（`server/src/index.ts`）。
- 一個 instance，不要開 autoscaling —— 狀態在記憶體裡，多開一台就是兩個平行世界。

### 要填的環境變數

**Vercel — Project Settings → Environment Variables**

| 變數 | 值 | 環境 | 備註 |
|---|---|---|---|
| `VITE_SERVER_URL` | `https://<service>.onrender.com` | Production | **build 當下寫死進 bundle**，改值一定要重新 deploy 才生效 |

不是環境變數、但要在 Project Settings 對的欄位：Root Directory = `./`、
Framework Preset = Vite（Build / Install / Output 由 `vercel.json` 覆寫）。

**Render — Web Service → Environment**（其餘由 `render.yaml` 帶入）

| 變數 | 值 | 備註 |
|---|---|---|
| `CORS_ORIGIN` | `https://<project>.vercel.app` | 逗號分隔可多個。**設了卻解析不出任何來源會直接 `process.exit(1)`**，不要留空字串 |
| `HOST` | `0.0.0.0` | `render.yaml` 已帶 |
| `NODE_VERSION` | `24` | `render.yaml` 已帶 |
| `PORT` | 不要自己設 | Render 會注入，`server/src/index.ts` 已經讀 `process.env.PORT` |

第一次上線是雞生蛋順序，必定要來回兩趟：
Render 開服務拿到網域 → 填 Vercel 的 `VITE_SERVER_URL` → deploy Vercel 拿到網域 →
回填 Render 的 `CORS_ORIGIN` → Render 重新 deploy。

### 代價

- 多一個網域、多一套 CORS 設定。
- 玩家身分是 `sessionStorage` 的 `ws.sid`（`client/src/net/socket.ts`），不是 cookie，
  所以**不受第三方 cookie 政策影響**，跨網域沒有額外問題。
- **Render free 方案閒置 15 分鐘會停機**，喚醒約 50 秒。這個專案沒有任何持久化，
  停機一次所有房間、牌局、籌碼歸零，而 `DISCONNECT_GRACE_MS` 只有 30 秒，玩家一定被踢出座位。
  要能連著玩就把 `render.yaml` 的 `plan: free` 改成 `starter`（$7/月）。
  **每次 deploy 也一樣會清空**（換行程 = 換世界），這點付費方案不會變。
- **Vercel 的 preview deployment 連不上後端**：preview 網址是隨機的，而白名單是精確比對，
  一律被拒。preview 只驗「前端 build 得出來」；真要測某次 preview，把該網址手動加進
  `CORS_ORIGIN` 即可。

---

## 方案 B：全部上 Vercel（WS beta + Redis）

技術上做得到，但要付的代價：

1. `rooms` / `sessions` / `playerRoom` 全搬 Redis，socket.io 換 Redis adapter。
2. 所有 `setTimeout` / `setInterval` 改成「把 deadline 存在 Redis，由下一個進來的請求推進」。
   回合鐘可以這樣做，**但 50 ms 的樓梯小勇者迴圈沒有 serverless 解法** ——
   這個模式只能砍掉，或改成客戶端權威（違反「規則只有一份、伺服器說了算」的專案原則）。
3. 5 分鐘斷線要在 `GameProvider` 加自動重連與狀態重放。

等於重寫整個 room layer，還要犧牲兩個即時模式。除非有硬性「只能用 Vercel」的限制，否則不划算。

---

## 方案 C：不用 Vercel

現行的 `npm run serve` 本身就是一套可用的部署：先打包前端，
再讓後端綁 `0.0.0.0:80`，**同一個 port 同時提供 API 與前端**，
沒有 CORS、沒有第二個網域、沒有任何改動。

上面那份 `Dockerfile` 把 `CMD` 換成 `npm run serve` 就是方案 C 的容器版
（記得 `RUN npm ci` 不要 `--omit=dev`，打包前端需要 vite）。

需要 Node 22 以上。
