# 免費後端評估：那台常駐容器要放哪裡

`docs/deployment.md` 已經下了結論：前端上 Vercel、**後端要一台常駐容器**（方案 A）。
那份文件回答了「為什麼不能 serverless」，這份回答下一題 ——
**常駐容器要放哪裡，有沒有永久 0 元的**。

範圍限定在**永久免費**：試用額度、限時 credit、學生方案一律不算。
會睡的與不會睡的都寫進來，因為對這個專案來說「睡著」的代價跟一般網站不一樣（見下文）。

外部資訊查證日期：**2026-08**。免費方案的條款變動很快（光 2026 上半年 Render 與 Oracle 就各改過一次），
隔幾個月要重查一遍。

---

## 結論

| 想要的 | 選這個 | 代價 |
|---|---|---|
| 零維運、現在就能開來玩 | **Render Free** | 15 分鐘完全沒人連線就睡，睡了房間全消失 |
| 不要睡、即時模式滿血 | **Oracle Cloud Always Free（ARM）** | 要先搶得到機器（申請方式見第三節），之後 Node、TLS、反向代理都自己顧 |
| 免費裡 CPU 最闊的實驗場 | **Hugging Face Spaces（Docker）** | 平台定位是 ML demo，適用性與條款要自己確認 |

共同的底線只有一條：**這個服務不能水平擴展，只能開一台。**
狀態全在記憶體，多開一台就是兩個平行世界（`docs/deployment.md` 已詳述）。
所以挑免費方案時，「價格」不是變數 —— 真正的變數是 **CPU 配額、出站頻寬、睡眠條件**這三項。

---

## 一、先從 repo 推出硬條件

這份 survey 的篩選器不是通用的「支不支援 Node」，而是這個 repo 的事實：

| 需求 | 依據 |
|---|---|
| **只能一個 instance** | 狀態全在 `GameServer` 的 `Map`；`server/src/handlers.ts:265` 直接翻本機 socket registry 踢舊連線 |
| **長連線不能有時間上限** | 一局大老二／大富翁遠超 5 分鐘，而 `DISCONNECT_GRACE_MS` 只有 30 秒（`shared/src/types.ts:526`） |
| **要能跑常駐計時器** | 50 ms（`DOWNSTAIRS_TICK_MS`，`shared/src/downstairs.ts:51`）、150 ms（`SNAKE_TICK_MS`，`shared/src/snake.ts:12`）、45 s（`TURN_MS`，`types.ts:525`）、30 s 寬限 |
| **出站頻寬吃重** | `startDownstairsLoop`（`server/src/handlers.ts:880`）每 50 ms 就 `io.to(...).emit` 一份完整快照（`:893`） |
| 記憶體 512 MB 內可行 | 只有 `tsx` + `socket.io` + 記憶體房間，沒有 DB、沒有快取層 |
| 檔案系統可以是 ephemeral | 整個專案零持久化 —— 這反而是**加分項**，重開就重開，沒有資料要救 |
| Node 22 以上 | root `package.json` 沒有 `engines`／`.nvmrc`，版本目前只釘在 CI（Node 24） |
| PaaS 友善 | 已讀 `PORT`／`HOST` 環境變數（`server/src/index.ts:17-19`），已有 `GET /healthz`（`:25`） |

### 「睡著」對這個專案的意義

一般網站的 spin-down 代價是「第一個訪客要等一分鐘」。這個專案不是：
狀態全在記憶體，服務一睡，**所有房間、手牌、籌碼、大富翁的地契全部歸零**，
而且醒來時客戶端的 30 秒重連寬限（`DISCONNECT_GRACE_MS`）早就過了。

但反過來說：會睡的條件是「**一段時間內完全沒有人連線**」——
那個時間點本來就沒有人在玩，沒有牌局會被中斷。
對「朋友之間臨時開房」這種用法，睡眠是可接受的；
只有「想讓房間列表長期掛著」才會被它咬到。**別把會睡直接當成淘汰。**

---

## 二、把規格換算成這個專案的數字

規格表上的 `0.1 vCPU / 100 GB` 要對到實際負載才有意義。以下是估算，方法一併寫出來，
**是推算不是實測**，實測方法見第五節。

### 頻寬

`downstairsView`（`shared/src/downstairs.ts:1476`）每 tick 送出一份完整快照：
platforms（每格約 15 個欄位）＋ players（每人約 35 個欄位）＋ stars／boss／objective／pve 區塊。
以場上約 15–25 塊平台、4 名玩家估算，一包 JSON 約 **4–6 KB**。
socket.io v4 預設**不啟用** `perMessageDeflate`，所以沒有壓縮折扣，線上就是這個大小。

一間 4 人樓梯小勇者（`SEAT_LIMITS.downstairs.max = 4`，`types.ts:244`）：

```
5 KB × 20 次/秒 × 4 人 ≈ 400 KB/s ≈ 1.4 GB/小時
```

對照各家額度：

- 100 GB/月（Render、Koyeb）→ 約 **70 小時**的樓梯小勇者，朋友開房綽綽有餘。
- 1 GB/月（GCE e2-micro）→ 約 **2.5 分鐘**。這一項就足以判它出局。
- 10 TB/月（Oracle）→ 實務上碰不到。

貪食蛇是 150 ms 一拍且快照小得多，回合制三款（大老二／德州撲克／大富翁）一局只有幾百 KB，
**頻寬問題基本上是樓梯小勇者一個人造成的**。

### CPU

每個 tick 做三件事：物理推進 → 建 view 物件（platforms 與 players 全部淺拷貝）→ 一次 JSON 序列化。
序列化量是 5 KB × 20 次/秒 = 100 KB/s，本身不重；主要成本在物理與物件配置。
粗估落在現代單核的 **5–15%**。

關鍵在於：**0.1 vCPU 是硬上限，不是可以 burst 的基準值。**
一核的 10% 對上「估 5–15%」，是**貼著天花板**的。因此本文的判定是：

- 貪食蛇（150 ms／約 7 Hz）在 0.1 vCPU 上**綽綽有餘**。
- 樓梯小勇者（50 ms／20 Hz）在 0.1 vCPU 上**屬於邊界，必須實測**。
  跑不動的症狀不是當機，是 tick 落後 —— 畫面變慢動作、`advanceDownstairs` 收到偏大的 delta。
- 回合制三款在任何免費規格上都不是問題。

---

## 三、永久 0 元候選

| 方案 | 規格 | 睡眠條件 | 長連線上限 | 出站頻寬 | 即時模式 | 主要代價 |
|---|---|---|---|---|---|---|
| **Render Free** | 512 MB／0.1 CPU | 15 分鐘無 HTTP 或 WS 訊息 | 無 | 100 GB/月 | 蛇 ✅／樓梯 ⚠️ 需實測 | 睡了房間全沒；750 小時/月只夠一個服務 |
| **Koyeb Free** | 512 MB／0.1 vCPU／2 GB SSD | 1 小時無流量，**不可關閉** | 無（WS 支援待確認） | 100 GB/月 | 蛇 ✅／樓梯 ⚠️ 需實測 | scale-to-zero 強制開啟 |
| **HF Spaces（Docker）** | 2 vCPU／16 GB／50 GB 暫存 | 48 小時無人使用 | 無 | 未明訂 | 蛇 ✅／樓梯 ✅ | 平台定位與條款（見下）|
| **Back4App Containers** | 256 MB／600 活躍小時 | 依活躍時數 | 無 | 有限 | 蛇 ⚠️／樓梯 ❌ | 記憶體與時數都太緊 |
| **Oracle Always Free** | 2 OCPU／12 GB ARM | **不睡** | 無 | 10 TB/月 | 全部 ✅ | 自架 VM 的全套維運 |
| **GCE e2-micro** | 共享核心／1 GB | **不睡** | 無 | **1 GB/月** | ❌ | 頻寬額度直接出局 |

### A 組：會睡，但零維運

#### 1. Render Free —— 首選

512 MB RAM／0.1 CPU，每個 workspace 每月 750 個 free instance 小時。
24/7 運轉一個月約 720 小時，**剛好只夠掛一個服務**（掛兩個會在月底前用完，屆時全部暫停到下個月）。
出站頻寬 100 GB/月，超額 $0.15/GB。原生支援 WebSocket 與 socket.io，**連線沒有時間上限** ——
這點正是 Vercel function 模型做不到的（那裡是 5 分鐘）。

真正讓它從「不能用」變成「首選」的是 2026 年的一次改動：

> **2026-02-24 起**，free web service 的閒置判定改成「15 分鐘內沒有收到 HTTP 請求
> **或既有連線上的 WebSocket 訊息**」才會 spin down。在此之前只有 HTTP 請求算數，
> 服務會在 WebSocket 正忙的時候睡著。

搭配 engine.io v4 的心跳方向 —— **伺服器每 25 秒發 ping、客戶端回 pong** —— 意味著
**只要還有任何一個分頁開著，服務就不會睡**。牌局中途被切斷的風險等於零，
睡眠只會發生在「真的沒人在線」的時候。

- 適用判定：貪食蛇沒問題；樓梯小勇者卡在 0.1 CPU 的邊界，**上線前先照第五節量一次**。
- 頻寬 100 GB/月 ≈ 70 小時樓梯遊玩，其餘模式幾乎不消耗。
- 部署方式：Git 直連或 Dockerfile 皆可；`/healthz` 直接拿來當 health check。

#### 2. Koyeb Free

512 MB RAM／0.1 vCPU／2 GB SSD，一個免費服務，100 GB/月出站。
閒置門檻比 Render 寬（**1 小時**無流量才 scale to zero），但 scale-to-zero
在免費 instance 上**不能關閉**，冷啟動躲不掉。
官方文件沒有把免費層的 WebSocket 行為講死，**採用前要自己驗一次長連線**。

CPU 規格與 Render 同級，所以樓梯小勇者的判定一樣是「需實測」。
定位：Render 的等價替代，適合當備援或 Render 額度用完時的第二家。

#### 3. Hugging Face Spaces（Docker SDK）

**2 vCPU／16 GB RAM／50 GB 非持久磁碟**，48 小時無人使用才休眠。
這是免費層裡 CPU 最闊的一個 —— 也是唯一能讓 50 ms 迴圈**跑得從容**、不必擔心 tick 落後的免費選項。
Docker SDK 可以跑任意 Node 服務，WebSocket 是平台本來就在用的東西。

代價要說清楚：

- 平台定位是 ML demo 的展示場，拿來掛遊戲伺服器是**擦邊用法**，條款風險自負。
- Space 預設是公開的，網址與內容誰都看得到。
- 有既定的 port 慣例與 Space 專屬的容器約定，Dockerfile 要照它的規矩寫。
- **2026 年有來源指出「跑 compute 的 Space（Gradio／Docker）需要付費方案，只有 static Space 對所有人免費」。**
  這與長年以來 cpu-basic 免費的認知衝突，**採用前必須自己向官方確認**，本文不把它當定論。

#### 4. Back4App Containers

256 MB RAM／每月 600 活躍小時。記憶體對 `tsx` + socket.io 偏緊（`tsx` 是在執行期轉譯 TypeScript 的），
活躍時數也不足以 24/7。列在這裡是為了完整性，**不建議**作為主力。

### B 組：不會睡，但要自己顧機器

#### 5. Oracle Cloud Always Free（Ampere A1 ARM）—— 唯一全綠

不睡、10 TB/月出站、完整 root 權限。所有模式全部滿血，`docs/deployment.md` 裡的架構前提
（單行程、記憶體狀態、常駐計時器）一條都不用讓步。技術上這是最好的答案。

三個必須先知道的坑：

- **2026-06-15 起，Always Free 的 ARM 額度從 4 OCPU/24 GB 砍半為 2 OCPU/12 GB**，Oracle 沒有發公告，
  只默默改了文件；月配額同步從 3,000 OCPU 小時／18,000 GB 小時降為 **1,500 OCPU 小時／9,000 GB 小時**。
  Oracle 另有寄信通知：**2026-08-18 起超出新額度的 Always Free 實例會被終止**。
  2 OCPU/12 GB 對這個專案仍然過剩 —— 但**配額只夠這一台**：2 OCPU 全天候跑 31 天是 1,488 OCPU 小時，
  剛好卡在 1,500 的天花板下，再開第二台就會超額。
- **Oracle 會回收長期閒置的 Always Free 實例**（依 CPU、記憶體、網路使用率綜合判定）。
  這個服務沒人玩的時候正好非常閒 —— 要留意，必要時安排一點常態負載。
- 熱門區域長期 out of host capacity，開機器本身可能要試很多次（處理方式見下）。

以及維運成本：Node 安裝、TLS 憑證、反向代理、開機自啟、安全性更新，全都是自己的事。
**這是「不睡」的真正價碼**，不是「免費 vs 付費」的差別，是「有人管 vs 自己管」的差別。

##### 申請方式

1. **註冊**：要一個 email 加一張國際信用卡（VISA／Master／AMEX）。卡只是驗證身分，
   會扣 US$1 再退回（有時顯示扣款失敗但驗證其實過了）。Always Free 資源本身不會扣款。
2. **選 home region —— 這一步不可逆。** 註冊時選的歸屬區域之後**不能改**，
   而 Always Free 的 ARM 容量是綁在 home region 上的。這是整個流程唯一無法重來的決定：
   - 從台灣連線，延遲最好的是東京／大阪／首爾／春川／新加坡。
   - 但**熱門區域正是最常 out of host capacity 的**。延遲與開得到機器之間要自己取捨；
     對這個專案來說延遲很重要（20 Hz 廣播），所以還是優先選鄰近區域，用下面的方式硬撐。
3. **建立實例**：Compute → Instances → Create instance，
   shape 選 **VM.Standard.A1.Flex**，手動把 OCPU 調到 **2**、記憶體 **12 GB**（別直接吃預設值，
   預設可能還是舊的 4/24，開下去就是 8/18 之後被終止的那一批）。
   映像用 Ubuntu 或 Oracle Linux 皆可，開機磁碟留在 Always Free 的 200 GB 總額內。
4. **遇到 Out of host capacity**：這是 Oracle 免費 ARM 的常態，不是帳號有問題。可行的做法依序是：
   - 換 availability domain／fault domain 再送一次；
   - 換時段重試（供給是浮動的，深夜與清晨常有）；
   - 社群普遍的做法是寫一支重試腳本定時打 API，直到搶到為止；
   - 最後手段是**升級成 Pay As You Go**。有報導指出 PAYG 帳號仍可維持 4 OCPU/24 GB 免額度，
     但 Oracle 沒有明文，**不要當成保證** —— 升級後超出 Always Free 額度的部分是**真的會計費**的。
5. **開通網路**：這是最常見的「明明開了 port 卻連不上」。要開**兩層**：
   - OCI 這一層：VCN 的 security list（或 NSG）加 ingress rule；
   - **作業系統這一層**：Oracle 的 Ubuntu／Oracle Linux 映像自帶 iptables／firewalld 規則，
     要另外放行。只開 security list 是不夠的。
6. **另外還有 2 台 AMD E2.1.Micro**（各 1/8 OCPU、1 GB RAM）也在 Always Free 內。
   對這個專案：回合制三款跑得動，**樓梯小勇者不用試**（1/8 OCPU 比 Render 的 0.1 CPU 還少）。
   它們適合拿來當備援或反向代理，主力還是 A1。

#### 6. GCE e2-micro Always Free

不睡，us-west1／us-central1／us-east1 各一台。但免費額度只含
**每月 1 GB 北美出站流量**（30 GB 標準磁碟）。

依第二節的估算，1 GB ≈ **2.5 分鐘**的四人樓梯小勇者。判定：

- 回合制三款（大老二／德州撲克／大富翁）可行 —— 一局幾百 KB，1 GB 夠玩很久。
- **即時模式出局。**

這一條是整份文件最好的示範：**規格看起來夠，不代表跑得動。**
CPU 與記憶體都不是問題，殺死它的是頻寬。

---

## 四、常被推薦、但這個專案不適用

- **Vercel／Netlify 的 function 模型** —— 跨 instance 無法廣播、連線 5 分鐘上限、
  沒有地方放 50 ms 迴圈。理由已在 `docs/deployment.md` 完整論證，此處不重複。
- **Cloudflare Workers + Durable Objects** —— 免費額度確實存在（100k requests/day、313k GB-s/day），
  DO 也真的擅長「每個房間一個物件」。但這等同 `deployment.md` 的**方案 B：重寫整個 room layer**，
  而且 50 ms 的節奏靠 alarm 推不動。要走這條路，先讀方案 B 那一節。
- **Fly.io** —— 2024 年起取消永久免費額度，新帳號只有 2 VM 小時／7 天的試用。不符合本文範圍。
- **Railway** —— $5／30 天試用，之後最低約 $1/月。同樣不是永久免費。
- **Google Cloud Run** —— 免費額度大方（2M requests、360k vCPU-秒/月），但三件事同時衝突：
  預設 scale-to-zero、單一請求最長 60 分鐘、以及會開多個 instance。
  `--min-instances=1` 不在免費額度內，設了就要付錢。
- **Glitch** —— 2025 年已停止專案託管。

### 非永久免費的額度一覽

上面幾家不是「不能用」，是**額度會到期**。既然遲早要看，數字放在這裡（查證日期 2026-08）：

| 平台 | 免費的部分 | 期限 | 之後最低要付 |
|---|---|---|---|
| **Fly.io** | 2 VM 小時的試用 | 7 天內用完 | shared-cpu-1x／256 MB 常駐約 **$1.94–2.02/月**，出站另計 **$0.02/GB**（北美、歐洲） |
| **Railway** | $5 credit，免信用卡 | 30 天 | 一個 0.5 vCPU／0.5 GB 常駐服務約 **$1/月** |
| **Render 付費** | —（免費層見第三節） | — | Starter **$7/月**，不睡、不受 750 小時限制 |
| **Heroku** | 無免費層（2022 起） | — | Eco **$5/月** 換 1,000 dyno 小時（所有 Eco dyno 共用），30 分鐘無流量仍會睡 |
| **AWS** | 2025-07-15 改制：$100 credits，做完五項上手任務可再拿 $100 | **6 個月**或 credit 用完，先到先算 | 之後按量計價（2025-07-15 前開的舊帳號仍是 12 個月舊制） |
| **Google Cloud** | $300 credits | 90 天 | 按量計價（e2-micro 的 always free 不受影響，見第三節） |
| **Azure** | $200 credits | 30 天 | 按量計價 |
| **DigitalOcean** | $200 credits | 60 天 | 最小 Droplet 約 $4/月 |

**看數字的方式：這個專案在用量計價的平台上，成本形狀是「頻寬 ≥ 機器」。**
依第二節的估算，樓梯小勇者一間房 1.4 GB/小時；在 Fly.io 的 $0.02/GB 之下就是 **$0.03/小時**，
玩到 100 GB（約 70 小時）要 $2 —— 已經和整台機器的月租（$1.94）同級。
機器選最小的那一檔省不了多少，真正決定帳單的是有沒有人在玩即時模式。
這也是為什麼試用 credit 常常比預期燒得快。

反過來說，這正是**永久免費方案要挑「頻寬額度」而不是「規格」**的原因 ——
Render／Koyeb 的 100 GB/月，換算過來就是每月約 70 小時的樓梯小勇者，
而且**超過了是停用或計費，不會偷偷扣你錢**。

---

## 五、怎麼自己實測（讓上面的判定可被推翻）

第二節的 CPU 與頻寬都是推算。要證實或推翻，做這三件事：

1. **量真實 payload。** 在 `startDownstairsLoop`（`server/src/handlers.ts:880`）的 emit 前後
   加一行臨時量測：`JSON.stringify(downstairsView(game.state)).length`，
   跑一局四人局看平均與峰值。乘上 `20 × 人數` 就是每秒實際出站量。
2. **量 tick 是否落後。** 同一個迴圈裡已經有 `previous` 與 `now`；
   把 `now - previous` 印出來，正常應該貼著 50 ms。
   在目標平台上如果穩定跑到 70–100 ms，就是 CPU 不夠 —— 那台機器上的樓梯小勇者判定為不可行。
3. **看平台自己的 metrics。** CPU 是否長時間貼著配額上限、記憶體是否接近 512 MB、
   當月出站是否逼近 100 GB。三張圖比任何估算都準。

量完之後回頭改這份文件的判定 —— 這裡的 ⚠️ 就是等著被實測換成 ✅ 或 ❌ 的。

---

## 六、不論選哪家都要做的事

前端指向、CORS 白名單、`vercel.json`、Dockerfile 的具體內容都在
**`docs/deployment.md` 的方案 A**，這裡不重複。只補三點所有免費方案共通的：

- **一律單一 instance，不要開 autoscaling／多副本。** 狀態在記憶體，多開一台就是兩個平行世界。
- **容器裡不需要 `client/dist`。** `existsSync` 在啟動時算一次（`server/src/index.ts:29`），
  算不到就只跑 API，前端交給 Vercel。
- **health check 直接用 `GET /healthz`**（`server/src/index.ts:25`），不用另外做。

如果最後決定連 Vercel 都不要（`deployment.md` 的方案 C），上面的 A 組同樣適用 ——
把 `client/dist` 一起放進容器、跑 `npm run serve` 就好，差別只在 `RUN npm ci` 不能加 `--omit=dev`。

---

## 來源

查證日期 2026-08。

- Render — [Deploy for Free](https://render.com/docs/free)、[Outbound Bandwidth](https://render.com/docs/outbound-bandwidth)、[WebSockets on Render](https://render.com/docs/websocket)、[Free web services now remain active while receiving WebSocket messages](https://render.com/changelog/free-web-services-now-remain-active-while-receiving-websocket-messages)
- Koyeb — [Instances](https://www.koyeb.com/docs/reference/instances)、[Pricing FAQ](https://www.koyeb.com/docs/faqs/pricing)
- Hugging Face — [Spaces Overview](https://huggingface.co/docs/hub/en/spaces-overview)、[Manage your Space](https://huggingface.co/docs/huggingface_hub/main/en/guides/manage-spaces)
- Oracle — [Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)、[Free Tier FAQ](https://www.oracle.com/cloud/free/faq/)、[Oracle Quietly Halves Free Tier Ampere A1 Compute Limits（InfoQ, 2026-07）](https://www.infoq.com/news/2026/07/oracle-cloud-free-tier-limits/)、[Oracle halves free cloud resources（heise）](https://www.heise.de/en/news/Oracle-halves-free-cloud-resources-11334516.html)、[Oracle Cloud free tier 2026: 4 OCPU/24GB cut to 2 OCPU/12GB](https://terminalbytes.com/oracle-cloud-free-tier-changes-2026/)、[Breaking down the free tier of OCI](https://fullmetalbrackets.com/blog/oci-free-tier-breakdown)
- Google Cloud — [Free Tier](https://cloud.google.com/free)、[Using WebSockets with Cloud Run](https://docs.cloud.google.com/run/docs/triggering/websockets)、[Cloud Run pricing](https://cloud.google.com/run/pricing)
- Cloudflare — [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing)、[Use WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- Fly.io — [Resource Pricing](https://fly.io/docs/about/pricing/)、[Cost Management](https://fly.io/docs/about/cost-management/)、[Fly.io Free Tier 2026: What's Left After the Cuts?](https://www.saaspricepulse.com/tools/flyio)
- Railway — [Railway Free Tier 2026](https://kuberns.com/blogs/railway-free-tier/)
- Heroku — [Removal of Heroku Free Product Plans FAQ](https://help.heroku.com/RSBRUH58/removal-of-heroku-free-product-plans-faq)、[New Low-Cost Plans（Eco／Mini）](https://www.heroku.com/blog/new-low-cost-plans/)
- AWS — [AWS Free Tier now offers $200 in credits and 6-month free plan（2025-07）](https://aws.amazon.com/about-aws/whats-new/2025/07/aws-free-tier-credits-month-free-plan/)、[Free Tier FAQs](https://aws.amazon.com/free/free-tier-faqs/)
- Azure／DigitalOcean 額度 — [Cloud Free Tier Comparison 2026](https://agentdeals.dev/cloud-free-tier-comparison-2026)、[DigitalOcean Free Tier 2026](https://agentdeals.dev/digitalocean-free-tier-2026)
- Back4App — [Heroku Alternatives](https://www.back4app.com/heroku-alternatives)
- Socket.IO — [The Engine.IO protocol](https://socket.io/docs/v4/engine-io-protocol/)、[Engine.IO 4 Release](https://socket.io/blog/engine-io-4-release/)（心跳方向與 25 秒預設）
