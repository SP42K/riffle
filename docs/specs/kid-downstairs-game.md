# 小朋友下樓梯遊戲 Spec

- 狀態：`COMPLETION_HARDENING_COMPLETE`
- 階段：Phase 7 Boss／小怪體驗強化完成 — 等待產品實機遊玩驗收
- Spec owner：產品使用者
- 技術範圍：`client` →（核准後）`shared` →（再次核准後）`server`
- 暫定代號：`downstairs`

## 1. 目標與前提

在 Riffle 新增一款受「小朋友下樓梯」啟發的即時生存遊戲：角色隨畫面向上捲動而持續往下移動，
玩家以左右移動落到平台上，避免被畫面頂端夾到或跌出底部，存活越久、下降越深，分數越高。

本 Spec 將「小朋友下樓梯」解讀為上述 NS-SHAFT 類型玩法，而不是實體走樓梯、教學遊戲或純回合制
桌遊。名稱、視覺角色與素材必須原創，不複製第三方商標、美術或音效。此解讀需由使用者核准。

### 成功定義

- 新玩家在 10 秒內理解目標與左右操作。
- 手機與桌面都能完成一局，主要操作不依賴 hover。
- 遊戲狀態、危險、受傷、分數與結束原因在視覺上清楚可辨。
- UI 核准前不產生後端或正式 wire contract 的沉沒成本。

### 非目標（首版）

- 不做帳號、永久排行榜、付費道具、關卡編輯器或 AI 玩家。
- 不做精密物理引擎、橫向攻擊、跳躍鍵或複雜技能樹。
- Phase 1 不做多人同步、Socket.IO 新事件、server authoritative simulation。

## 2. Codebase-memory 評估

圖譜索引 `C-Users-user-riffle` 顯示專案由 `client`、`shared`、`server` 三個主要群集組成，共 830 nodes、
3,398 edges；現有入口與責任如下：

| 接點 | 現況 | 未來影響 |
|---|---|---|
| `client/src/App.tsx` | nickname → lobby → room 三態分流 | 不應為原型大幅改寫；正式版仍沿用 room flow |
| `client/src/pages/Lobby.tsx` | `GAME_TYPES` 驅動建房、座位數及個別玩法選項 | 正式整合時才加入遊戲卡/選項；Phase 1 用獨立 prototype entry |
| `client/src/pages/Room.tsx` | 依 `room.gameType` 分派不同桌面 | 正式版新增 `DownstairsRoom` 分支 |
| `client/src/pages/RoomShell.tsx` | 共用房名、座位、聊天、開始控制 | 是否沿用完整 shell 待 UI 原型驗證；遊戲中應優先保留 playfield 空間 |
| `shared/src/types.ts` | `GameType`、`GameView`、`RoomView` 是核心 discriminated contracts | UI 核准前禁止擴充，避免 contract 先鎖死 |
| `server/src/rooms.ts` | `createRoom`、`buildRoomView` 聚合玩法狀態 | 正式版需要新 game state/view builder |
| `server/src/handlers.ts` | `onCreateRoom` 正規化 payload；start/action 由 server 裁決 | Phase 3 才加入 action 與 validation |
| `client/src/state/GameProvider.tsx` | 訂閱 lobby/room state 與連線生命週期 | Phase 1 以 local mock adapter 隔離，不污染 provider |

評估結論：可行，但不是只加一個 React page。正式多人版至少橫跨 lobby、room router、shared domain、
room serialization、server simulation/action handler 與測試。最安全的切割點是先做獨立、可操作的 client-only
vertical slice，確認 viewport、控制與資訊層級後，再定義 domain contract。

### 主要風險

| 風險 | 等級 | 緩解方式 |
|---|---|---|
| 即時物理與網路延遲造成畫面抖動 | 高 | 正式版 server 固定 tick；client interpolation/prediction；契約核准後再定參數 |
| 手機 viewport 太矮、手指遮住遊戲 | 高 | 底部雙區觸控、safe-area、HUD 置頂、最小 360×640 驗收 |
| 每種平台辨識不清 | 中 | 形狀 + 圖示 + 色彩三重編碼，禁止只靠顏色 |
| 現有 RoomShell 擠壓 playfield | 中 | 原型同時驗證 compact shell / focus mode，再定案 |
| 單人原型與未來多人契約耦合 | 中 | `DownstairsGameAdapter` 隔離 mock；Phase 1 不匯出 shared types |
| 遊戲循環與 React render 綁死 | 中 | simulation 與 view rendering 分離，UI 以 snapshot 呈現 |

### 免費素材評估與授權策略

素材採「一致性優先、CC0 優先、可追溯」原則。首選 [Kenney](https://kenney.nl/support)：其 asset pages 上的
遊戲素材為 CC0，可修改及商用且不強制署名；仍應保留下載包內 license，並可在 credits 禮貌標示來源。

| 體驗用途 | 候選素材 | 授權／評估 | 建議 |
|---|---|---|---|
| 角色、平台、尖刺、彈簧 | [Kenney Platformer Art Pixel](https://kenney.nl/assets/platformer-art-pixel) | CC0；900+ 個 21×21 2D sprites，同一套風格、適合快速組 prototype | **首選**；挑選少量素材並重新配色，不整包搬入 |
| 較大、非純 pixel 的角色 | [Kenney Platformer Characters](https://kenney.nl/assets/platformer-characters) | CC0；150 個 2D files，角色輪廓清楚 | 備選；若 21px sprite 在手機辨識度不足時比較 A/B |
| HUD、按鈕、面板 | [Kenney UI Pack – Adventure](https://kenney.nl/assets/ui-pack-adventure) | CC0；130 個 UI files | 選用 icon/框線，不直接用圖片取代可存取的 HTML button |
| 點擊、倒數、切換 | [Kenney Interface Sounds](https://kenney.nl/assets/interface-sounds) 或 [UI Audio](https://kenney.nl/assets/ui-audio) | CC0；分別 100／50 個短音效 | **首選**；挑短、柔和、不疲勞的聲音 |
| 落地、彈簧、受傷 | [Kenney Impact Sounds](https://www.kenney.nl/assets/impact-sounds) | CC0；130 個 impact/foley | **首選**；經音量正規化後映射事件強度 |
| 開始、破紀錄、結算 | [Kenney Music Jingles](https://kenney.nl/assets/music-jingles) | CC0；85 個短樂句 | 適合事件 stinger；首版不建議長時間背景音樂 |
| 補缺的單一圖像／音效 | [OpenGameArt](https://opengameart.org/node/5571)、[Freesound](https://freesound.org/help/faq/) | 同站素材有多種授權，必須逐項核對；只採明示 CC0 | 僅在 Kenney 無合適項目時使用，不得只憑搜尋篩選或預覽圖判定授權 |

不採用來源不明的 Google 圖片、社群轉貼、遊戲截圖／擷取音效，亦不採 `NC`、`SA`、GPL 或授權不明素材。
下載素材必須建立 `client/public/assets/downstairs/ATTRIBUTION.md`，逐項記錄檔名、作者、原始頁面、下載日期、
license、是否修改；即使是 CC0 也保留紀錄。素材進 repository 前需刪除未使用檔案並壓縮，避免把整包素材納入。

### 趣味與豐富度設計原則

- **每秒可讀：** 落地有 2–4px squash、微粒與短音效；受傷有短暫閃白／震動；彈簧有預備壓縮與清楚拋物線。
- **逐步變化：** 以深度區間改變背景層、色溫、平台組合與捲動速度，不依賴大量新規則製造內容感。
- **短期目標：** 顯示下一個里程碑與個人最佳；連續安全落地可形成 combo，但不得掩蓋生存主目標。
- **驚喜但公平：** 危險平台出現前須有可讀預告；隨機生成不得產生無解落點。正式規則留待 Phase 2 測試。
- **失敗可理解：** 每次淘汰指出原因並給一個簡短改善提示，例如「注意畫面底部」而不是只顯示 Game Over。
- **節制回饋：** screen shake、粒子、音效可個別減弱或關閉；同時事件需做 priority/cooldown，避免視聽轟炸。

## 3. 使用者流程

1. 玩家在大廳看到「小朋友下樓梯」遊戲卡，讀到一句玩法摘要與支援人數。
2. 建房後進入等待畫面，看見控制教學、平台圖例、玩家名單與開始按鈕。
3. 房主開始；3、2、1 倒數期間顯示左右操作提示。
4. 遊戲中玩家左右移動，角色自動受重力影響並落上平台；畫面持續向上捲動。
5. HUD 即時顯示生命、樓層/深度、存活時間與個人狀態。
6. 玩家生命歸零、被頂端夾住或跌出底部時淘汰，進入觀戰；所有玩家淘汰後結算。
7. 結算顯示排名、深度、時間、淘汰原因，房主可「再來一局」，所有人可回房間。

## 4. UI/UX requirements（Phase 1）

### R-UI-01 大廳遊戲入口

- 遊戲選擇改為可掃讀的卡片/segmented cards；本遊戲需呈現原創 icon、名稱、短描述、`1–4 人`。
- 選中時顯示清楚 focus/selected state；鍵盤可操作。
- Phase 1 按「預覽玩法」進 client-only prototype，不送出 `room:create`。

驗收：360px 與 1280px 寬度皆不橫向溢出；只用鍵盤可選取並進入預覽。

### R-UI-02 等待與教學

- 顯示桌面 `← → / A D`、行動裝置左右觸控區。
- 平台圖例首版只展示三類：普通、彈簧、尖刺；效果文案保持一行。
- 開始 CTA 與返回 CTA 不可混淆；非房主看到等待狀態。

驗收：第一次進入無需開說明 modal，即可指出目標與操作方式。

### R-UI-03 Playfield

- 中央使用固定邏輯座標的直向 playfield；桌面置中，手機盡量滿寬並尊重 safe area。
- 背景、平台、角色、危險物與前景 HUD 分層；角色不可被 HUD 遮擋。
- 平台類型用造型、符號及色彩辨識；提供 reduced-motion 模式。

驗收：360×640、768×1024、1440×900 三種 viewport 都可看見角色、下一個可落平台與完整核心 HUD。

### R-UI-04 控制與回饋

- 桌面支援 ArrowLeft/ArrowRight 與 A/D；按住連續移動，放開停止加速。
- 手機底部左、右各至少 44×44 CSS px，支援 pointer down/up/cancel，不觸發頁面捲動。
- 倒數、落地、受傷、彈跳、淘汰都有不同的視覺回饋；音效預設遵循既有偏好並可靜音。

驗收：控制不因游標離開按鈕或視窗失焦而卡住；關閉動畫後仍能靠靜態狀態理解事件。

### R-UI-05 HUD 與無障礙

- 必要資訊：生命（數值 + 圖形）、深度/樓層、時間、暫停/靜音。
- 不用紅綠色作唯一生死辨識；互動元素具可見 focus；狀態訊息以非干擾式 live region 宣告。
- 純裝飾 canvas/SVG 不進 accessibility tree；必要狀態另有文字表示。

驗收：200% zoom 仍可操作；鍵盤 focus 順序合理；文字與背景至少符合 WCAG AA 對比。

### R-UI-06 淘汰、觀戰與結算

- 淘汰 overlay 明確列出原因與成績，不遮住觀戰主要資訊。
- 結算依深度優先、存活時間次之排列；平手規則在 Phase 2 定案。
- 「再來一局」僅房主可用；其他玩家顯示等待房主。

驗收：使用者可分辨「自己淘汰但遊戲仍在進行」與「整局結束」。

### R-UI-07 Responsive 與視覺方向

- 視覺方向：溫暖童趣的原創街機風；大形狀、清楚輪廓、有限色盤，避免恐怖或血腥表現。
- 桌面可使用右側玩家/事件欄；窄螢幕收成 top bar 或 bottom sheet，不壓縮 playfield 到不可玩。
- touch 與 keyboard 必須共用相同行為語意，不能形成兩套規則。

### R-UI-08 F8/F9 外觀與遮蔽切換

- 沿用全站既有可自訂快捷鍵語意：預設 `F8` 循環切換 skin／整體外觀，預設 `F9` 切換老闆鍵遮蔽畫面；
  本遊戲不得另行攔截或改寫這兩個按鍵。
- `F8` 切換時，等待、遊戲中、淘汰、觀戰與結算畫面都必須立即套用新 skin；playfield、HUD、平台與角色
  在每個既有 skin 下都須保持可辨識，且不得重置位置、生命、分數、計時或輸入狀態。
- `F9` 遮蔽時只替換視覺呈現，不卸載遊戲元件、不離開房間、不斷線、不重置狀態；再次按下相同快捷鍵應回到
  最新狀態。client-only 原型的 simulation 與正式多人版的 server simulation 都持續進行，不因遮蔽而暫停。
- 遮蔽期間必須清除當下 held input，避免玩家看不見畫面時持續向左或向右移動；恢復後需重新按鍵才會移動。
- 焦點位於 input、textarea、select 或可編輯元素時，F8/F9 遵循既有全站規則，不觸發快捷鍵。
- 若使用者在設定頁自訂快捷鍵，本遊戲必須跟隨 `SkinProvider` 設定，不可硬編碼監聽 F8/F9。

驗收：在遊戲進行中切換所有既有 skin，狀態與操作不中斷；F9 遮蔽後放開方向鍵並恢復，角色不會保持移動；
自訂快捷鍵後，新按鍵生效而原預設鍵不再觸發。

### R-UI-09 趣味性、動態回饋與聲音

- Phase 1 原型至少呈現普通、彈簧、尖刺三類平台，以及落地、彈跳、受傷、里程碑、淘汰五種不同回饋；
  每種事件至少有兩種通道（視覺／聲音／觸覺）表達，靜音時仍可理解。
- 使用 parallax 或分層背景表達下降速度與深度區間，但前景對比不可因此降低；背景不得干擾落點判讀。
- 里程碑、個人最佳與安全落地 combo 提供短期成就感；正式 HUD 固定顯示 Combo、個人速度加成、0–30 的進度與 Combo 保護，分數動畫不得遮住角色或下一個平台。
- 實際扣血時，受傷角色需閃紅、短促位移並切換受傷表情；本機玩家另顯示紅色畫面脈衝與 `-1 ♥` 浮字。靜音或 reduced-motion 下仍保留文字、輪廓與生命變化。
- 音效須由使用者互動後才啟用，遵守瀏覽器 autoplay 限制；提供 master mute，並沿用既有偏好持久化方式。
- 有震動能力的裝置可對受傷／彈簧提供短促 haptic，但必須是 progressive enhancement，關閉或不支援時不影響操作。
- `prefers-reduced-motion` 下停用 screen shake、強烈 parallax 與非必要粒子，改用輪廓、圖示及文字狀態。
- 素材需在 360×640 實機尺寸檢查，不得以高細節換取低辨識；pixel art 必須採整數倍率或關閉平滑，避免模糊。

驗收：進行一場 60 秒 prototype playtest，測試者能只看／只聽主要回饋辨識落地、彈跳與受傷；靜音與 reduced
motion 模式仍完整可玩；重複音效不削波、不爆音，連續落地不產生明顯聽覺疲勞。

### R-UI-10 素材效能與來源

- Phase 1 首屏新增素材壓縮後總量目標不超過 1.5 MB；非首屏音效／結算素材延遲載入。若超標，需在 Decision
  Log 記錄實測與理由後才能核准。
- 優先使用 sprite atlas、WebP／AVIF（bitmap）及壓縮後 OGG/MP3；保留原始來源檔於 repository 外或獨立設計
  source，不讓 production bundle 同時帶入原檔與輸出檔。
- 素材載入中要有不依賴素材本身的 fallback；單一音效或圖片失敗不得阻止遊戲開始。
- 每個第三方檔案都必須能追溯至 `ATTRIBUTION.md`；CI／review 應拒絕來源或 license 欄位空白的新增素材。

驗收：slow 3G 模擬下先出現可操作 shell 與載入狀態；素材失敗時仍可用基本幾何與文字完成一局；逐項抽查
repository 素材都能對應來源與 license。

### R-UI-11 等待畫面與角色選擇

- 樓梯小勇者正式房間在遊戲開始前顯示 4 個原創角色：小勇（紅）、泡泡（藍）、阿橘（橘）、星仔（紫）。
- 選角卡同時使用輪廓／配色、名稱與描述；具 keyboard focus、radio semantics 與明確的已選擇狀態。
- 房內隊伍 roster 即時顯示每位玩家的角色與準備狀態；角色選擇由 server 保存並透過完整 RoomView 廣播。
- 允許不同玩家選擇相同角色，不做搶角或鎖角。角色具有 R-GAME-01 定義的主動技能；基礎生命與碰撞一致，Combo 每增加 1 提供個人水平移動速度 +1%（最多 +30%），
  計分規則仍完全一致，避免角色形成隱藏的常駐數值優勢。
- 遊戲開始後鎖定選角，角色造型顯示於正式 playfield；回到等待／結算狀態後可再次更換。

驗收：兩個 client 在等待畫面互相看見選角變更；非法 character id 與遊戲進行中的選角不生效；360px 寬度下
角色卡改為 2×2 且不橫向溢出；四個角色在三套 skin 中仍可分辨。

### R-GAME-01 角色獨特技能

四個角色各有一個容易理解、用途不同的主動技能；所有技能共用同一操作：鍵盤 `Space`／`E`，觸控裝置使用
playfield 下方的「技能」按鈕。Client 只送出「嘗試施放」command，實際角色、可用狀態、效果時間與冷卻均由
server authoritative simulation 判定。

| 角色 | 技能 | 草案效果 | 冷卻 | 設計目的 |
|---|---|---|---:|---|
| 小勇（紅） | 勇氣護盾 | 1.5 秒內免疫一次平台或 Boss 環境傷害（尖刺、重踏、落石），觸發後護盾立即消失；不免疫頂端／底部淘汰 | 10 秒 | 適合新手，提供一次可預期的失誤容錯 |
| 泡泡（藍） | 泡泡緩降 | 2 秒內將重力降至基準值的 45%，並限制最大下落速度；不改變水平控制 | 8 秒 | 延長觀察與微調落點的時間 |
| 阿橘（橘） | 活力衝刺 | 0.35 秒內提高水平加速度與最大速度；方向取目前按鍵，無輸入時取最後面向 | 6 秒 | 用於跨越較大的水平距離，但不能穿越邊界 |
| 星仔（紫） | 星光牽引 | 1.5 秒內由 server 排除尖刺、破壞中與目前同層平台，選擇下方可用安全路線並給予溫和水平導引；玩家有方向輸入時優先採用手動控制，不瞬移且不保證落地 | 12 秒 | 幫助精準修正落點，同時保留玩家操作與失敗可能 |

共同規則：

- 每局開始技能立即可用；施放後的技能冷卻在 server simulation time 推進，暫停、結算或離線時不得由 client 自行縮短。
- 淘汰、觀戰、倒數、F9 遮蔽期間不能施放；回到等待畫面可換角，新一局依新角色重設技能狀態。
- 同角色重複選擇仍合法；技能不能改變最大生命、基礎速度、分數倍率或其他常駐屬性。
- 任何技能生效時都不得凍結或清除既有方向輸入；焦點位於 input／textarea／contenteditable 時，`Space`／`E` 不得誤觸技能。
- HUD 顯示技能名稱、可用／冷卻秒數與短暫生效狀態；角色與技能按鈕都需有非色彩提示。`prefers-reduced-motion`
  下以外框、圖示與文字取代閃爍或大幅位移特效。
- 輕量 `game:downstairsState` snapshot 必須包含必要的 cooldown／active state；不得為技能倒數恢復高頻完整
  `RoomView` 廣播。音效與粒子僅是回饋，不得成為判讀技能是否成功的唯一方式。

驗收：四個技能在 deterministic unit tests 中具有精確的有效時間與冷卻；偽造角色、效果參數或冷卻值不生效；
兩個 client 對施放、消耗、命中與結束看見一致結果；重連後 cooldown 與 active state 正確；F9 開啟前按住技能鍵不會
在恢復畫面時補施放；以固定 seeds 進行平衡測試時，各角色的中位存活深度差距目標不超過 15%。技能數值與呈現需先
由使用者核准，才可進入 shared/server/client 實作。

### R-GAME-02 關卡難度曲線與可達性

- 關卡採三階段捲動速度：0–20 秒由 26 線性增加至 37；20–60 秒由 37 增加至 54；60 秒後逐步增加並以 68
  為上限。前 20 秒不生成尖刺，20–60 秒尖刺比例為 10%，60 秒後為 20%。
- 新平台以目前最下方平台為 anchor；一般 safe 間距為 74–84px、challenge 為 82–90px、休息節點為 70px。水平中心位移
  依 formation 控制在 0–70px，接近邊界時必須
  反向生成，不能因 clamp 產生幾乎完全重疊、無法離開的下一階。
- 開局出生位置集中於畫面中央附近，四個座位到第一、第二平台的可達性一致。畫面底部預先保留一層平台，避免
  第一批 procedural platform 尚未進場時出現空窗。
- 普通、尖刺與彈簧平台的反彈力依所在高度降低；越靠近頂端，向上速度越小。泡泡緩降只在角色下落時生效，
  不得延長上升時間而增加撞頂風險。
- 玩家離開平台後可再次落回同一平台等待下一階進場，但同一平台只計算一次 combo；星光牽引不得把玩家導回
  剛完成計分的平台。
- 角色進入頂端危險區先顯示「⚠ 頂端」警告，連續停留 800ms 才淘汰；完全離開畫面仍可立即淘汰。

驗收：加速版 deterministic guidance 的四個座位在 10 秒前不得淘汰，30／60 秒至少 3 席仍存活；90 秒測試可進入
高難度階段並正常結束，且至少一席到達 60 秒。上述測試只用於驗證平台可達性及座位公平，不代表保證真人玩家的固定存活時間。

### R-GAME-03 主題區域與關卡多樣性（UI/UX 待核准）

一般關卡維持無縫、無限生存形式，不切換頁面或重置玩家狀態。Server 依 authoritative elapsed time 與 seed 決定
目前區域、平台狀態、事件及收集物；client 不得自行決定平台消失、移動方向、星星得分或區域完成時間。

| 時間 | 區域 | 核心組合 | 難度目的 |
|---:|---|---|---|
| 0–20 秒 | 晨光庭院 | 寬普通台、開局彈跳台、無尖刺 | 教學與建立操作節奏 |
| 20–45 秒 | 彈跳工坊 | 彈跳台、水平移動台 | 練習預判與空中修正 |
| 45–60 秒 | 風車屋頂 | 輸送帶、少量碎裂台、10% 尖刺 | 導入狀態平台與風險選擇 |
| Boss 結束後 | 星空遺跡 | 混合平台、安全／挑戰分岔、20% 尖刺 | 高難度無限循環 |

新增平台：

- `moving`：在 server 定義的水平範圍內往返；平台位置包含於輕量 downstairs snapshot。移動範圍的任一端都必須
  保留至少一條可達路線，不得在 snapshot 間由 client 猜測碰撞位置。
- `fragile`：第一次有效落地後進入 `cracking`，1.2 秒後成為 `broken` 並暫時不可碰撞；平台重新生成時恢復。
  所有玩家共用狀態，但同一 tick 多人落地只能觸發一次倒數。
- `conveyorLeft`／`conveyorRight`：落地期間施加有限水平推力；方向需以箭頭、紋理及文字圖例表達。玩家反向輸入
  可以抵抗，推力不得超過玩家基礎水平控制能力。

平台以連續自然高度帶生成，不再每 15 秒建立命名分岔。每群至少兩個寬且無尖刺的候選，第三個候選可使用窄台、機關或配置
星星。Generator 必須先驗證至少兩個落點可達；不能以星星位置誘導玩家進入無解落點。

星星由 server 保存唯一 id 與 collected state。單顆提供 `+5m` 深度分數；每累積 3 顆提供一次「Combo 保護」：
下一次失去 combo 時只消耗保護，不維持生命、不免疫淘汰，也不形成永久能力。每累積 9 顆另回復 1 點生命（上限 3）；
若觸發時已滿血，改為 `+30m` 深度分數。多人可各自收集自己的星星，首版不做
互相搶奪，避免延遲決定歸屬。

低頻事件首版包含：

- `golden`：10 秒內提高窄台與機關平台的星星密度。
- `springParty`：提高彈跳台比例，但不提高尖刺比例。
- `rescue`：場上過半存活玩家只剩 1 點生命時，提高下一批寬安全平台比例；同局有 cooldown，不能持續觸發。

UI/UX：區域切換前 3 秒顯示名稱與一句玩法提示；新平台第一次出現時顯示一次 dismiss-free 短提示，之後只保留圖例。
危險與方向不能只依顏色表達。F8 切換 skin 後區域與平台仍可辨識；F9、blur、reconnect 不得補觸發收集或平台狀態。
特效優先使用 CSS geometry、opacity、transform；新增首屏資產仍受 R-UI-10 的 1.5MB 預算與 attribution 約束。

驗收：所有新平台具 deterministic state transition tests；固定 seed replay 的區域、路線、星星與事件一致；1–4 人在
20Hz 輕量 snapshot 下平台碰撞結果一致；安全路線在 360×640 viewport 可見且可達；碎裂倒數、移動平台與輸送帶不使
多人 RoomView 回到 frame loop；30／60／90 秒既有公平測試仍通過。

### 平台視覺實作完成追蹤（2026-08-07）

八種 `DownstairsPlatformKind` 與起點 variant 均已接入正式 `Platform` DOM；材質層、方向／危險辨識、互動狀態、動畫觸發、
編排相容性與 reduced-motion fallback 已完成。formation、fixture、roller、debris 使用獨立結構層，不再互相覆蓋。
**程式實作、自動 gate 與產品端主觀視覺 acceptance 均已完成。**

| 平台 | 已完成 | 尚缺／已確認問題 | 狀態 |
|---|---|---|---|
| 普通平台 `normal` | 草皮、土層、垂落邊緣、低頻光澤 | wave 改用獨立 formation layer，土層不再被覆蓋 | 實作完成 |
| 彈跳平台 `spring` | 黃色金屬踏板、鉚釘、線圈、底座、彈力規則 | 依實際 landing state 播放壓縮／回彈兩段動畫 | 實作完成 |
| 尖刺平台 `spike` | 紅色底座、CSS 尖齒、警示脈衝、扣血規則 | 不再依賴 glyph 呈現尖齒；命中具有一次性亮起／抬升反應 | 實作完成 |
| 移動平台 `moving` | 藍色機械外殼、滑槽、獨立雙輪、移動紋理 | wave 不再覆蓋輪組；輪組依 authoritative 移動曲線方向旋轉 | 實作完成 |
| 易碎平台 `fragile` | 磚塊材質、權威 cracking／broken timer | hairline／split／critical 三段裂紋、臨界震動、透明斷面與材質碎片 | 實作完成 |
| 左／右輸送帶 `conveyor*` | 鋼製底盤、分節帶面、靜態 chevron、兩端滾輪 | 帶面與滾輪依左右方向運動；reduced-motion 仍可由結構辨識方向 | 實作完成 |
| Boss 開關 `bossSwitch` | 未使用時具符文、發光、脈衝與 2 格傷害規則 | used 狀態保留厚底盤，呈現按下凹槽、熄滅核心與落地按壓動畫 | 實作完成 |
| 起點平台 `[data-start]` | 藍白軟墊、星徽、支架、呼吸邊光與星光；1–4 人各自生成一個 48px 起點 | 額外多人起點離場退休，主起點回收並清除狀態 | 實作完成／已驗收 |

完成項目：

1. **P0 材質完整性（完成）：** formation 獨立成結構層；普通台土層、移動輪組與 Boss used 材質皆保留。
2. **P1 互動動畫（完成）：** RoomView 僅新增 `lastPlatformId`，配合既有短生命週期 `landingEffectMs` 觸發 impact；fragile
   直接以 authoritative `fragileMs` 映射三段強度，不新增高頻 server event。
3. **P1 方向辨識（完成）：** 輸送帶具有分節帶面、CSS chevron 與方向滾輪；移動輪方向由既有 deterministic 曲線推導。
4. **P2 自動 gate（完成）：** typecheck、280 tests、production build 與 selector 靜態稽核通過，未改變平台座標、高度或碰撞規則。
5. **產品 acceptance（完成）：** 使用者已確認新版平台可接受並記錄 `PLATFORM_VISUAL_ACCEPTED`；正式發布前仍保留
   garden／workshop／rooftop／stars／boss、F8 三套 skin、360×640、200% zoom 與 reduced-motion 的裝置矩陣回歸清單。

完成定義：每一列的程式缺口清零、不得再有 pseudo-element selector collision，且自動 gate 通過後記錄
`PLATFORM_VISUAL_IMPLEMENTATION_COMPLETE`；使用者完成人工目視確認後另記錄 `PLATFORM_VISUAL_ACCEPTED`。

### R-GAME-03A Combo Fever（已核准並實作）

Fever 是個人 Combo 的五秒爆發回饋，不改變多人共用平台的捲動速度。玩家存活且在非危險平台完成第 30 次唯一有效落地時，
由 server 啟動 `5,000ms` Fever；同一平台重複落地、尖刺／Boss 重踏落地、重連 snapshot 與 client 動畫不得重複觸發。

權威規則：

1. 一般狀態維持每 1 Combo 提供水平移動速度 `+1%`、上限 `+30%`；Fever 期間改為固定 `+45%`，取代 Combo 加成而非相乘。
2. Fever 期間每次新的安全落地額外取得 `+10m`，但不再增加 Combo；星星、治療、角色技能與 Boss 開關傷害維持原值。
3. Fever 提供一次「Fever Guard」：首次原本會扣生命的尖刺、Boss 重踏或落石改為不扣血並立即結束 Fever，顯示
   `FEVER BREAK`。Guard 不防止跌出畫面或被頂端追上，也不消耗既有 Combo 保護。
4. Fever 自然結束時，把當前 30 Combo 已提供的深度分數轉存至累積分數後將 Combo 歸零，避免總深度倒退；受傷中斷時
   使用相同結算。玩家需重新完成 30 次有效落地才能再次觸發。
5. Fever 與主動技能可同時存在，但移動倍率只套用在各技能既有基礎值上一次；不得形成無上限乘算。Boss 關卡可觸發
   Fever，但踩開關仍只造成 2 格傷害。
6. `feverRemainingMs`、Guard 是否存在、開始／結束序號與累積獎勵皆由 server 保存。斷線期間計時照常推進，重連只恢復
   剩餘時間；淘汰或離開立即清除 Fever。

UI/UX 狀態：

- `0–29 Combo`：既有 HUD 顯示 Combo、速度加成與充能條；24 Combo 起顯示「再 N 次進入 FEVER」，不得遮住下一階。
- `30 Combo／進場`：中央顯示不超過 600ms 的 `FEVER!` 字樣，本機角色加入金色／青色雙層輪廓與短尾跡；其他玩家只看見
  該角色的小型 `FEVER` 徽章，不出現全螢幕閃光。
- `active`：Combo HUD 切換為 `FEVER 5.0s` 倒數條，同時標示 `速度 +45%`、`落地 +10m`、`◆ 1 HIT GUARD`；倒數必須直接
  取用 server snapshot，不由 client 自行延長。
- 剩餘 2 秒時倒數條轉橙，1 秒時轉紅並提供低頻脈衝；不使用會妨礙平台判讀的持續 screen shake。
- 自然結束顯示 `FEVER COMPLETE`；被攻擊中斷顯示 `FEVER BREAK`、護盾碎裂與既有受傷方向提示，但不得錯誤顯示 `-1 ♥`。
- 音效採短進場 stinger、低音量循環層與結束音；master mute 關閉全部 Fever 聲音。支援時進場提供一次短 haptic。
- `prefers-reduced-motion` 下移除尾跡、脈衝、縮放與畫面閃光，只保留高對比輪廓、徽章、倒數、文字與狀態色。

建議正式 HUD 線框：

```text
┌ FEVER 4.2s ──────────────┐
│ ███████████████░░░░░     │
│ 速度 +45%  落地 +10m  ◆1 │
└──────────────────────────┘
```

驗收：需有 threshold、5 秒 server timer、自然結束、受傷中斷、Guard 不扣血、fall／ceiling 不防護、分數不倒退、技能倍率
上限、Boss 傷害不翻倍、disconnect／reconnect 不重觸發與多人獨立 Fever 的 deterministic tests。360×640、200% zoom、靜音與
reduced-motion 下，玩家仍能辨識充能、啟動、剩餘時間與結束原因。本功能已完成 authoritative state、正式 UI 與 wire contract。

### R-GAME-03B 核心遊戲性優化（P0／P1 已核准並實作）

本輪不更改既有區域 → 分岔 → Boss → 星空遺跡流程，而是提高每一次落地的決策、操作回饋與短期回報。目前平台種類雖多，
主要操作仍多為左右修正；前 20 秒無尖刺、首個低頻事件在 30 秒，Fever 需要 30 Combo，且 Combo 增加最大速度後沒有同步強化
反向煞車。結果是早期回饋偏慢、特殊平台偏被動，表現越好反而越容易因操作變滑而失誤。

#### P0：Landing Quality 精準落地（已實作）

每次第一次落在非危險平台時，由 server 依「角色中心距平台中心的正規化偏差」判定，不使用 client viewport 座標：

| 等級 | 判定 | 一般寬台 | 窄台／機關 | 即時回饋 |
|---|---|---:|---:|---|
| `PERFECT` | 落在中央甜蜜區（建議中央 35%） | Combo +2、技能冷卻 -0.7s、+3m | Combo +3、技能冷卻 -0.7s、+5m | 金色環、清脆音、`PERFECT` |
| `GOOD` | 落在可控主區域 | Combo +1 | Combo +2、+2m | 青色短環、`GOOD` |
| `EDGE` | 只在邊緣有效接觸 | Combo +1 | Combo +1 | 白色邊緣火花，不額外懲罰 |

尖刺、Boss 重踏及同一平台重複落地不產生 grade。平台太窄時甜蜜區仍需保留至少角色中心可辨識的 12px，不得形成理論上
存在但無法穩定命中的 Perfect。Landing grade 只增加短期技巧回報，不改變碰撞成功與否。

#### P0：高 Combo 可控高速（已實作）

- 保留既有每 Combo `+1%`、最高 `+30%` 與 Fever `+45%`，尊重已核准的速度成長。
- 當輸入方向與目前 `vx` 相反時，提高反向制動係數；Combo 越高，制動補償越高，30 Combo 建議達一般狀態的 `1.6×`，
  Fever 達 `1.75×`。放開輸入時的摩擦同步提高，使速度變快但停止距離不隨 Combo 失控。
- 加速、最高速度與制動需各自 clamp；角色技能只套一次 Combo／Fever multiplier，避免阿橘衝刺產生不可控乘算。
- HUD 除 `速度 +N%` 外，10 Combo 起顯示小型「操控強化」標記；不新增操作按鍵。

#### P0：風險／回報選擇（已實作；明示雙路線已由 R-GAME-03E 取代）

- 寬度、材質、動畫與機關本身傳達風險，不顯示 `SAFE`／`RISK + REWARD` 路牌、挑戰外框或指定落點。
- 每個自然平台群至少保留兩個寬且無強制尖刺／fragile 的落點；窄台或機關平台提供較高 Combo、深度分數與既有星星回報。
- 不建立固定左右分支或強制合流；多人可從平台場中自行組合不同走法，獎勵依個人實際 landing 判定。
- 下一個高度帶必須在玩家離開目前平台前可見，但 client 不替玩家選定目標；若生成結果無至少兩個可達落點則重排該平台群。

#### P1：事件節奏與微目標（已核准並實作）

- 第一個事件固定於 `18,000ms` 開始，事件持續 `10,000ms`，後續每 `15,000ms` 嘗試開始一次。事件順序使用由
  `startedAt + playerIds` 產生的 deterministic seed 與三項 shuffle bag，而不是固定 `golden → springParty → rescue` 輪替。
  在三種事件皆可用時每袋各出現一次，跨袋邊界也不得連續出現同一事件；相同起始參數與輸入必須能 replay 相同順序。
- `rescue` 僅在過半存活玩家剩 1 點生命且不在 30 秒 cooldown 時成立；不成立時消耗該候選，依相同 seed 在 `golden` 與
  `springParty` 中選擇一個不與上次重複的 fallback，避免阻塞後續事件節拍。
- 非 Boss 區域同時至多一個共享題目的個人微目標；每位玩家具有獨立進度、完成狀態與一次性獎勵，死亡、重連 snapshot 或
  同平台重複落地不得重複入帳。區域題目依序為：庭院「2 次 Perfect」、工坊「收集 2 顆星」、屋頂「完成 1 次機關落地」、
  星空遺跡「2 次 Perfect」。
- Perfect 與星星目標完成時技能 cooldown 減少 `2,000ms`（clamp 至 0）；機關落地目標完成時 Combo `+2`，達 30 時可依既有
  規則進入 Fever。微目標不提供生命、深度分數或永久能力，避免取代生存主目標。
- 進入 Boss 時暫停並隱藏微目標；Boss 結束進入星空遺跡時建立新目標。每次區域切換清除上一區未完成進度，不跨區累積。
- 暫不新增平台種類、攻擊按鍵、永久升級或玩家碰撞；先驗證既有素材能否因更好的判定與回報變得有趣。

#### UI/UX 與驗收 gate

- 平台甜蜜區只在預告／落地瞬間短暫顯示，不能持續蓋住材質或替玩家自動瞄準；其他玩家只顯示小型 grade，不播放本機全畫面特效。
- `PERFECT／GOOD／EDGE` 同時以文字、形狀與音高區分；mute、色弱與 reduced-motion 下仍能理解。
- 360×640 時 grade、Combo、技能與 Fever HUD 不互相遮擋；高頻落地回饋需節流，兩個 snapshot 不得重播同一 landing event。
- 微目標 HUD 顯示題目、個人 `目前/目標` 進度、獎勵與完成狀態；完成以文字、色彩與一次 sequence 回饋，不能只依賴動畫。
  事件開始時顯示名稱、10 秒倒數與一句玩法提示；reduced-motion 停用位移／脈衝後仍須保留文字及進度。
- Deterministic tests 覆蓋中心／邊緣閾值、窄台下限、同台去重、challenge multiplier、cooldown clamp、30 Combo 反向制動、
  Fever／阿橘速度上限、分岔 fallback、事件首發時間、rescue 可用時的 shuffle bag 唯一性／跨袋去重、rescue eligibility、微目標同台去重、
  cooldown clamp、Combo/Fever 銜接與多人獨立獎勵。
- 建議 playtest 指標：玩家 8 秒內收到第一次技巧回饋；有意走 challenge 的比例達 25–60%；高 Combo 的反向煞車失誤率
  不高於低 Combo；至少一半完成 45 秒的玩家曾看見 Fever 充能提示。未達標先調數值，不新增更多規則。

三個 P0 已完成 authoritative landing grade／score／movement、輕量個人 sequence、正式 HUD／特效與 deterministic tests。
P1 已於 2026-08-08 完成：事件與微目標皆由 server-authoritative state 推進，正式 UI 具有文字／進度／完成回饋，並通過
291 tests、typecheck 與 production build。尖刺同平台反覆彈落亦限制為同一唯一落地只扣血一次，避免事件節奏改變放大既有傷害。

### R-GAME-03C 單人寬度平台與多人起點（已核准並實作）

- 一般／安全／救援／Boss 開關平台統一為 `48px`，即 `30px` 角色本體加左右各 `9px` 的單人落地容錯；挑戰平台為
  `38px`，保留風險差異。平台碰撞高度、垂直間距、移動速度與角色尺寸不變。
- 遊戲開始時依 1–4 名玩家建立相同數量的獨立 `48px` 起點彈跳平台，水平等距分布於 360px 場地；每位玩家必須置中出生在
  自己的起點上方，不得重疊或共用起點碰撞。
- 第一個起點離開畫面後可依既有規則回收為一般平台；額外的多人起點離開畫面後直接退休，避免多人局永久增加平台密度。
- 起點平台共用既有 `[data-start]` 材質與動畫，不新增高頻 wire event；server snapshot 中只傳平台結構，client 不自行推算人數或位置。

驗收：1／2／3／4 人分別建立 1／2／3／4 個起點，玩家與起點中心一一對齊且全部位於邊界內；一般、safe、rescue、Boss
switch 寬度為 48px，challenge 為 38px；額外起點退休、主起點回收、首跳可達、30／60／90 秒 deterministic 生存測試通過。

本功能已完成 server-authoritative layout、1–4 人起點配置、額外起點退休與 Rescue／branch 寬度同步；296 tests、typecheck
與 production build 通過。

### R-GAME-03D 平台密度與捲動加速（已核准並實作）

- 不改變 R-GAME-03C 的 48px／38px 寬度；procedural safe gap 由原本 78–103px 收斂為 74–84px，challenge 保留
  82–90px，rest 為 70px，讓畫面穩定維持更多可選落點。
- 本階段先保留初始八階位置與起點反應空間；後續 R-GAME-03E 將每一階擴充為錯落高度帶，不改變首跳高度。
- 捲動曲線調整為 `26 → 37 → 54 → 68`：0–20 秒、20–60 秒維持線性加速，60–120 秒到達 68 上限；Boss
  與星空區沿用同一曲線，不另行降速。
- 不提高尖刺比例、角色水平速度、重力或 Boss 攻擊頻率；密度增加用來提供更多決策與失誤修正空間，抵銷窄台及加速壓力。
- 本階段曾將單一路徑相對 anchor 的水平中心位移上限收斂至 70px；R-GAME-03E 改以整個平台群的多個可達候選驗證取代
  單一路徑位移限制，仍不使用自動導引。

驗收：layout tests 覆蓋 safe／challenge／rest gap 邊界，首屏下一階可見；1–4 人首跳可達，10 秒前全員存活、30／60 秒
至少 3 席存活，且至少一席可到達 60 秒後高難度階段；test、typecheck、production build 全數通過後記錄完成狀態。

本功能已完成 procedural gap、水平位移上限與全區共用捲動曲線調整；296 tests、typecheck 與 production build 通過。

### R-GAME-03E 自然平台場與技能穩定性（已核准並實作）

- 起點以外的首屏與 procedural 內容皆以「高度帶」生成，每個高度帶固定提供 3 個錯落平台；三者的 x 與 `0–24px` y 微差由
  deterministic hash 從多組 formation／offset 中獨立選擇，不形成持續的左／右／中軌道。
- 每個平台群至少 2 個 `48px` safe 候選；進階區可把其中 1 個轉成 `38px` 高回報窄台，位置隨 seed 改變。平台種類、星星與
  機關可交錯，但不得把視覺場切成系統命名的 safe／challenge 路線。
- 常駐回收池擴充為 22 個平台，額外多人起點退休後仍維持 7 個三平台高度帶。新平台群完整出現在 360×640 底部邊界內，
  且相鄰群至少提供兩個不同水平距離的可達候選。
- client 移除下一階甜蜜區、挑戰外框與 `SAFE`／`RISK + REWARD` 路牌；server 不再建立 branch id、15 秒雙線分岔或合流。
- 角色落地後只在尚未明確離開台面時忽略同一平台；向上越過平台上緣後即恢復碰撞資格，可依玩家選擇再次落回。
  同一平台僅首次落地計入分數、Combo 與個人目標，避免原地刷分但不限制玩家自行創造走法。
  屋頂微目標改為玩家自行選擇窄台／moving／fragile／conveyor 的「機關落地」，不要求走系統指定支線。
- 四技能共用傷害與輸入規則：勇氣護盾可攔截一次尖刺、Boss 重踏或落石；泡泡緩降不改變水平輸入；阿橘衝刺保留目前方向或
  最後面向；星光牽引只在沒有手動方向時介入。技能快捷鍵在文字輸入焦點中不生效。

驗收：首屏 7 個非起點高度帶各有 3 個平台；連續 8 個 procedural 群至少出現 4 種 x／y signature，每群 y span 不超過
24px、平台不重疊且位於 18–342 邊界，每群至少 2 個 safe 候選；15 秒時不得產生 branch id 或同高度雙線。四角色逐一驗證
技能期間仍可移動，星光牽引不選 broken／目前平台，勇氣護盾攔截 spike 與 Boss falling rock。

本功能已完成 22 個常駐平台、7 個三平台高度帶、deterministic 自然散佈、無 branch 生成與無路線提示 UI；四角色技能輸入、
目標選擇及共用傷害防護亦已完成稽核與修正。305 tests、typecheck、production build 與 diff check 通過。

### R-GAME-04 Boss 關卡：樓梯守衛「咚咚王」（UI/UX 待核准）

首次遊戲時間達 60 秒時進入 Boss encounter，以明確里程碑取代一般關卡直接升至後期尖刺密度。Boss 是合作型環境
關卡，不增加攻擊按鍵；玩家藉由移動與落上發光開關削減共享護盾。

流程與狀態：

1. `warning` 3 秒：顯示 Boss 名稱、合作目標與倒數；清除尚未落地的隨機危險事件。
2. `active` 最長 32 秒：延續全局時間加速曲線、停用一般隨機尖刺生成，改用固定 seed 的 Boss arena 與攻擊排程。
3. `cleared`：護盾歸零；所有存活玩家恢復 1 點生命（上限 3），全隊取得 Boss 深度獎勵並進入星空遺跡。
4. `survived`：時間結束但護盾未歸零；玩家進入下一區但只取得基本獎勵、不回血。
5. 全員淘汰時沿用一般結算；單一玩家淘汰轉觀戰，不中止其他玩家的 Boss 流程。

Boss 生命依開局時的有效玩家數設定：1／2／3／4 人分別為 20／24／28／32 格。每個發光開關有唯一 id；第一次有效落地
造成 2 格傷害後即消耗，同一 tick 多人落地不得重複扣血。玩家離線或淘汰後不動態降低生命，避免利用斷線改變難度；
重連必須恢復 phase、remainingMs、shield、switches 與 attack schedule。

首版攻擊：

- `stomp`：目標平台先以形狀與文字預告 1.2 秒，再短暫轉為尖刺；不可同時標記全部安全平台。
- `gust`：先顯示風向，再施加可被反向操作抵抗的水平推力；Boss 風力與輸送帶推力需有明確上限與合成規則。
- `fallingRock`：先顯示落點警告線才生成落石；命中扣 1 點生命並沿用既有 invulnerability，不能直接淘汰滿血玩家。
- `safeShift`：後半段移動安全平台位置；server 必須先驗證轉移前後至少一條路線可達。

Boss UI 固定顯示階段倒數、共享護盾、已啟動開關及下一個攻擊預告；不能遮住角色、下一階或既有生命／技能 HUD。
音效、震動與粒子只是補充，靜音、reduced-motion 或素材載入失敗時仍能靠文字、圖示與平台輪廓完成關卡。

驗收：1–4 人護盾 scaling 正確；固定 seed 下攻擊順序一致；攻擊預告時間不得短於 Spec；任一攻擊組合均保留安全
路線；開關同 tick 去重；clear／survive／wipe／disconnect／reconnect 均有測試；Boss snapshot 不含不必要的 RoomView、
聊天或 log；模擬高延遲時 client 可插值顯示，但傷害、護盾與通關結果只採 server state。

### 關卡擴充 UI approval gate

實作前需先完成並由使用者核准下列 UI-first 產物：四區域 playfield mockup、三種新平台各 normal／active／disabled
狀態、安全／挑戰分岔、星星與 Combo 保護、Boss warning／active／clear／survive 畫面，以及 360×640 多人 HUD 壓力
測試。核准前只能製作 client-only static fixtures，不得新增 shared domain、Socket.IO event 或 server timer。

## 4.1 Phase 5 完整性補完需求

本節優先於 Phase 1 原型敘述及較早的 `FULL_IMPLEMENTATION_COMPLETE` 紀錄。2026-08-07 review 確認核心玩法可運作，
但下列九項仍未滿足產品驗收；全部完成並通過本節測試前，不得再次標記完整完成。

### R-COMP-01 正式音效、靜音與觸覺回饋

- 正式多人畫面至少為落地、彈跳、受傷、星星、技能、淘汰、Boss warning／attack／clear 提供合成音效；不得依賴已移除的 prototype。
- 音訊只能在使用者首次互動後建立或 resume；master mute 必須可從正式 HUD 操作，並使用既有偏好儲存機制持久化。
- 同類音效需節流或限制 voice 數，20Hz snapshot 不得重複播放同一 server event。建議由 view 增加單調遞增 event sequence，
  client 只對新 sequence 播放一次；音效不能影響權威狀態。
- 支援時，受傷與強彈跳可呼叫短促 `navigator.vibrate`；靜音不必關閉觸覺，但 reduced-motion／使用者偏好可停用。

驗收：重新渲染及重連不重播舊事件；mute 重新整理後維持；無 AudioContext／vibration 環境仍可完成一局；連續多人落地不爆音。

### R-COMP-02 權威排名與完整結算

- `DownstairsPlayerState` 保存 `survivedMs`／`eliminatedAt` 與淘汰原因；結算由 shared/server 產生，不由 client 排序。
- 排名鍵依序為：深度高者優先、存活時間長者次之、最後以 deterministic player insertion order 平手裁決。
- 個人淘汰時顯示不遮擋主要觀戰區的摘要，包含原因、深度、時間與「觀戰中」；全局結算包含所有玩家名稱、名次、
  深度、存活時間、原因，以及僅房主可用的再來一局。

驗收：深度不同、時間不同、完全平手、同 tick 淘汰、玩家離線五種 unit tests；client 不得以本地時間修正名次。

### R-COMP-03 Rescue 事件完整規則

- `rescue` 只能在過半存活玩家為 1 HP 時觸發；觸發後 10 秒內，下一批至少 3 個平台須採 R-GAME-03C 的 48px
  單人 safe 寬度，且不可為 spike、fragile 或 challenge。
- 同局 rescue cooldown 為 30 秒；event state 必須包含剩餘時間與 cooldown，重連後一致。
- 若觸發時沒有足夠平台回收機會，效果延續到完成 3 個救援平台，不因 UI 計時歸零而提前消失。

驗收：資格、三平台配額、cooldown、事件結束後恢復一般生成及 1–4 人 deterministic tests。

### R-COMP-04 自然平台場（取代明示安全／挑戰分岔）

- 每個 procedural 高度帶生成 3 個具有不同 x 與微小 y 差的平台，不建立 branch id、左右雙線或固定合流點。
- 每群至少 2 個寬平台且無 spike／fragile；第三個候選可較窄並包含機關或星星，但不得與其他平台重疊或封鎖可達候選。
- formation、offset、窄台位置與星星皆由 server deterministic seed 決定；相鄰群不得長時間重複同一排列 signature。
- client 不顯示路線名稱、指定落點或 challenge outline；風險僅透過平台自身材質、寬度與動畫表達。

驗收：首屏七群、連續八群 formation 多樣性、邊界／重疊、每群 safe 候選、移動平台、Boss 期間及 360×640 可視性測試。

### R-COMP-05 區域轉場與首次平台教學

- 區域切換前 3 秒顯示下一區名稱、主要機關及靜態圖示；提示不得遮住角色或下一階。
- moving、fragile、conveyor、star、bossSwitch 第一次出現時各顯示一次 2–3 秒提示；dismiss-free，之後同一瀏覽器不重複。
- 教學已讀屬於 client preference，不進權威 simulation；清除網站資料後可重新出現。reduced-motion 以淡入淡出或靜態顯示。

驗收：每區提示時序、已讀持久化、窄螢幕、F8 skin 切換及重連不重複彈出。

### R-COMP-06 Boss 攻擊完整呈現與安全路線

- `stomp`：1.2 秒目標外框與文字倒數，命中後擊碎目標平台 2.2 秒；同時至少保留一個可達平台。
- `gust`：預告風向並顯示低干擾風線；風力與 conveyor 合成後 clamp，反向基礎輸入仍可抵抗。
- `fallingRock`：server 保存 warning／falling／impact phase、落點與 event id；client 顯示警告線、落石本體及命中特效，
  只有 server impact 可扣血，同一 event 每位玩家最多一次。
- `safeShift`：server 在移動前驗證起點與終點皆至少一條可達路線；驗證失敗則選替代平台或跳過本次攻擊。
- Boss HUD 顯示已使用／總開關、目前攻擊階段與下一招；所有攻擊提供文字／形狀雙重辨識。

驗收：四招 phase transition、預告下限、傷害去重、平台破壞復原、安全路線 fallback、clear／survive／wipe／reconnect tests。

### R-COMP-07 自訂快捷鍵與輸入釋放

- Downstairs 不得硬編碼 `F8`／`F9`；由 `SkinProvider` 提供目前 skin／boss-key shortcut 或統一的遮蔽狀態事件。
- 任一設定後的遮蔽快捷鍵、window blur、visibility hidden、boss screen 顯示，都必須送出一次 direction `0` 並清除 held keys。
- 恢復畫面後不得補送技能或恢復舊方向；focus 位於可編輯元素時沿用全站規則。

驗收：預設鍵、自訂鍵、恢復、按住雙方向、輸入框 focus 與遊戲中 F8 換 skin integration tests。

### R-COMP-08 Pointer 控制生命週期

- 左右控制共用 pointer capture；處理 `pointerdown`、`pointerup`、`pointercancel`、`lostpointercapture` 及元件卸載。
- 每個 pointer 獨立追蹤方向；多點觸控放開其中一側時，另一側仍有效。所有取消路徑最終必須送 direction `0` 或剩餘方向。
- 控制區至少 44×44px、設定 `touch-action: none`，不得因滑出按鈕或系統手勢造成持續移動。

驗收：單指滑出、系統 cancel、雙指相反方向、視窗失焦及卸載 tests。

### R-COMP-09 移除 prototype dead code 與完成驗證

- 刪除未被正式入口使用的 `LevelExpansionPreview`、`LEVEL_ZONES` 及全部 `.level-preview*` CSS；保留正式遊戲元件。
- 移除或 gitignore runtime log；不得刪除使用者其他未提交變更。production bundle 不得包含 `CLIENT-ONLY UI MOCKUP`。
- 更新本文件中過時的 Phase 1「待定」與完成狀態；建立完成矩陣，逐項連到自動測試或人工驗收證據。

最終 gate：`npm run typecheck`、`npm test`、`npm run build`、`git diff --check` 全數通過；完成 1–4 人 Socket.IO smoke、
F8/F9 自訂鍵、pointer cancel、360×640／200% zoom、mute persistence、Boss 四招與短暫重連人工走查。全部通過後才記錄
`COMPLETION_HARDENING_COMPLETE`。

### Phase 5 完成矩陣（2026-08-07）

| Requirement | 實作證據 | 驗證 |
|---|---|---|
| R-COMP-01 | 輕量 snapshot feedback sequence、正式 Web Audio、持久化 mute、受傷／彈跳 haptic | typecheck、Socket smoke |
| R-COMP-02 | shared 權威排序；結算顯示名稱、深度、時間、原因；淘汰觀戰摘要 | depth／time／tie unit tests |
| R-COMP-03 | rescue 三個 48px 單人 safe 平台配額與 30 秒 cooldown | deterministic rescue test |
| R-COMP-04 | 三平台自然高度帶、無 branch id／路牌／指定落點、連續 formation 多樣性 | scattered cluster unit tests |
| R-COMP-05 | 3 秒區域預告；平台首次提示以 localStorage 去重 | typecheck、production build |
| R-COMP-06 | stomp 破壞、gust 風線、fallingRock 警告／落石、safeShift clamp 與文字預告 | Boss domain tests、reduced-motion |
| R-COMP-07 | 由 SkinContext prefs 讀取自訂快捷鍵；hidden／blur 清除方向 | typecheck、既有全站快捷鍵流程 |
| R-COMP-08 | pointer capture、up／cancel／lost capture、multi-pointer map、unmount release | typecheck、44px touch CSS |
| R-COMP-09 | 移除 LevelExpansionPreview 與 `.level-preview*`；runtime logs 加入 gitignore | 零關鍵字檢查、diff check |

自動 gate：270 tests、typecheck、production build、diff check 全數通過；Socket.IO smoke 實際完成 hello → create → character →
start → direction → skill → authoritative snapshot，snapshot 含新 feedback sequence。仍需產品端以實機完成聲音感受、震動、
360×640、200% zoom 與自訂快捷鍵的主觀驗收。

## 4.2 Phase 6：深度式多人 PvE、怪物與新 Boss（完整實作完成）

本階段把現有 1–4 人生存玩法擴充為合作 PvE：玩家共同下降、處理小怪、擊破區域 Boss 並挑戰更深處。個人仍保有操作技術、
角色技能、Combo 與貢獻統計，但世界進度、Boss 生命與 Fever 獎勵皆為全隊共享。client-only UI/UX mockup 已由使用者核准，
並記錄 `PVE_DEPTH_UI_APPROVED`；shared deterministic domain、server authoritative integration 與正式 client 整合依本章進行。

本章在 PvE 模式啟用時取代 R-GAME-03A 的「個人 Fever」、R-GAME-03D 的「時間驅動速度」及 R-GAME-04 的單一 60 秒
Boss 觸發；既有角色、平台物理、F8/F9、權威碰撞及斷線規則除非本章明示，不因擴充而失效。首版不新增攻擊按鍵：
玩家以踩擊、精準落地、場景機關及既有技能的 PvE 效果戰鬥，維持左右移動 + 技能的低門檻。

### R-PVE-01 合作核心循環與深度進度

權威流程為 **探索 → Boss 預告 → Boss 戰 → 區域結算 → 下一區探索**；全員淘汰才結束本局，個人淘汰後轉為觀戰。
擊敗第四區 Boss 後進入無限裂隙，每深入一輪提高速度、敵人預算與 Boss 等級。PvE 結算以全隊最深世界深度、擊敗 Boss
數與存活狀態為主，不把隊友排成勝負名次；個人卡片只列最高 Combo、擊破、助攻、Boss 傷害與承受傷害。

必須拆開兩種深度：

- **worldDepthM：** server 依世界實際捲動距離單調累加；驅動場景、生成、Boss 里程碑與捲動速度，星星、Fever、分數獎勵
  不得修改此值。
- **scoreDepthM：** 個人表現分數；承接既有 player.depth、落地品質、星星及擊破獎勵，只用於個人貢獻與紀錄。
- 每區另保存 sceneStartDepthM 與 sceneDepthM；sceneDepthM 達探索長度後開始 Boss，Boss 戰期間 worldDepthM 仍持續增加，
  但下一區必須等 Boss defeated 才能開始。

| 區域 | 探索長度 | 首次預估 Boss 深度 | 內容目的 |
|---|---:|---:|---|
| 苔芽庭園 | 220m | 220m | 教學踩擊、單一行為與清楚入場提示 |
| 齒輪工坊 | 260m | 約 480m + 前戰鬥深度 | 移動／輸送平台與水平壓力 |
| 暴風屋頂 | 280m | 約 760m + 前戰鬥深度 | 風向、落雷與垂直預判 |
| 星光遺跡 | 300m | 約 1060m + 前戰鬥深度 | 混合機關、幻影與完整團隊協作 |
| 無限裂隙 | 每 320m 一輪 | 動態 | 從已解鎖內容建立 seeded remix，不新增無預告規則 |

捲動速度只由 worldDepthM 決定，玩家數、個人 Combo、Fever 或 client FPS 都不得改變。每段線性插值且跨段連續：

| worldDepthM | scrollSpeed | 敵人壓力 |
|---:|---:|---|
| 0–199m | 26 → 34 | 0–1 隻；40m 前不生成主動敵人 |
| 200–499m | 34 → 46 | 1–2 隻；開始側邊入場 |
| 500–899m | 46 → 58 | 2–3 隻；加入組合攻擊 |
| 900–1299m | 58 → 66 | 2–4 隻；可生成 elite |
| 1300–1999m | 66 → 72 | 3–5 隻；提高 director 預算 |
| 2000m 以上 | 固定上限 72 | 只增加組合與 elite 權重，不再提高捲動速度 |

驗收：相同 seed 與輸入序列在不同 tick 切片下得到相同 worldDepthM、場景、平台、敵人與 Boss 結果；個人加分不得提早
觸發區域或改變速度；1–4 人使用相同深度曲線。

### R-PVE-02 個人 Combo

Combo 永遠屬於個人，不做全隊平均或共用數字。每個唯一事件只能記一次：

| 個人事件 | Combo | scoreDepthM |
|---|---:|---:|
| 新安全平台 EDGE／GOOD | +1 | 既有值 |
| 新安全平台 PERFECT | +2 | 既有值 + 精準落地獎勵 |
| 成功踩擊一般小怪 | +2 | +8m |
| 擊破 elite 或 Boss 弱點 | +3 | +15m |
| 對隊友控制中的敵人完成擊破 | 擊破者 +2、助攻者 +1 | 擊破者 +8m、助攻者 +3m |

同平台重複落地、同敵人同一 hit event、Boss 同一弱點 cycle 不得重複計算。真正扣血時沿用既有規則清空 Combo；
Combo 保護、角色護盾或 Team Fever Guard 成功擋傷時不清空。個人達 30 Combo 時觸發全隊 Fever，只有觸發者將 30 Combo
結算並歸零；其他玩家的 Combo 保留。Fever 期間個人仍顯示 Combo，但落地與擊破不增加 Combo，只累積個人獎勵分數。

### R-PVE-03 Team Fever 共享獎勵

Team Fever 是 server-authoritative 的房間狀態，狀態機為 idle → active(5,000ms) → cooldown(4,000ms) → idle。
任一存活玩家首次到達 30 Combo 且狀態為 idle 時立即觸發；active／cooldown 期間到達 30 的玩家保留 READY 狀態，
冷卻結束後必須再完成一次有效 Combo 事件才可觸發，禁止無操作自動連鎖。

Fever active 時，所有當下存活玩家共享以下五秒獎勵：

1. 每位玩家取得獨立 1 次 Team Fever Guard；某位玩家消耗自己的 Guard 不會終止其他人的 Fever。
2. 水平移動與反向制動固定 +35%，取代個人 Combo 速度加成而不相乘；世界捲動速度不變。
3. 踩擊與 Boss 弱點傷害 +1，單次總傷害仍受 target damage cap 限制。
4. 新安全落地 +10m、一般小怪擊破額外 +5m；獎勵各自歸入完成事件的玩家。
5. 敵人 active 移動速度 -20%，但 attack telegraph 的實際毫秒數不得縮短；Boss 本體速度不減，只延長可反擊窗口 20%。

觸發時全隊看到同一 Fever sequence、來源玩家、開始時間、剩餘時間與 guard 狀態。重連只恢復剩餘狀態，不重播獎勵；
Fever 中淘汰者不再獲得落地／擊破獎勵，Fever 中重連的原玩家恢復自己的未消耗 Guard。隊友離線不提前結束 Fever。

UI 必須同時呈現「我的 Combo」與「全隊 Fever」：自己的 Combo 卡維持角色色；共享 Fever 採全寬金青能量條、顯示觸發者
名稱、5 秒倒數與全隊增益。不得把其他玩家 Combo 全部常駐展開；只在其達 24 Combo 後，以角色色小 marker 顯示接近 READY。

### R-PVE-04 無新增攻擊鍵的戰鬥規則

- **踩擊：** 玩家向下移動且腳部 hitbox 穿越敵人 head hitbox 時造成傷害並向上彈；側面／底部接觸造成玩家 1 點傷害。
- **命中去重：** enemyId + attackSequence + playerId 組成唯一命中鍵；同一 tick 多人踩中可各自造成一次傷害，但 Boss
  弱點另有每 cycle 總傷害 cap，避免四人瞬間略過整段動畫。
- **受傷：** 沿用 900ms invulnerability、生命、角色護盾、Combo 保護與 Team Fever Guard 的固定優先序；
  敵人不得繞過既有傷害函式直接扣血。
- **掉落：** 一般敵人只掉 score orb；elite 可 deterministic 掉落星星。生命回復仍受既有 3 點上限，禁止隨機付費或永久強化。
- **玩家碰撞：** 玩家彼此不碰撞、不推擠、不擋路；技能與敵人控制只由 server 結算。

既有四角色增加 PvE 交互，但不改按鍵：

| 角色 | PvE 效果 | 去重／限制 |
|---|---|---|
| 小勇 | 勇氣護盾有效期間首次碰到敵人會 Shield Bash 造成 1 傷害並消耗護盾；仍可擋一次環境傷害 | 每次技能最多命中 1 個敵人 |
| 泡泡 | 緩降期間半徑 60px 內一般敵人移動 -35%，標記 bubble assist | 不影響 Boss；同敵人只記一次助攻 |
| 阿橘 | 衝刺接觸一般敵人造成 1 傷害且自身不受該次接觸傷害 | 每敵人／每次技能最多一次 |
| 小星 | 無手動方向時仍優先導引可達安全平台；範圍 120px 內最近敵人會被星標 1.5 秒，下一次踩擊 +1 傷害 | 不自動改變玩家方向追敵；Boss 只標暴露弱點 |

### R-PVE-05 Seeded Enemy Director 與隨機入場

enemy director 只在 server/shared deterministic domain 運行。每次選擇使用 runSeed、sceneId、50m depthBand 與
spawnIndex 派生 PRNG；以不立即重複的 weighted bag 決定敵人、入場方式與候選平台。所謂隨機只改變組合，不得移除預告、
生成在玩家身上或製造不可達局面。

| 入場方式 | 基礎權重 | 最短預告 | 表現與規則 |
|---|---:|---:|---|
| platformWake | 40% | 1,200ms | 即將進入畫面的平台先出現睡眠輪廓與驚嘆號，再站起 |
| edgeLeap | 25% | 900ms | 左／右邊界顯示箭頭與拋物線，敵人跳向已驗證平台 |
| ceilingDrop | 20% | 1,100ms | 平台顯示落點圈，敵人從頂端繩索／光束降下；預告期無碰撞 |
| portalPop | 15% | 1,300ms | 工坊後才可用；平台後方先形成符文門，再彈出敵人 |

生成預算以 alive player count 與深度計算，不直接提高普通怪 HP：1／2／3／4 人同屏上限為 2／3／4／5 隻，
Boss 召喚物包含在上限。elite 佔 2 點預算、普通怪佔 1 點；任何時候至多 1 隻 elite。director 每 50m 最多嘗試一次，
若公平性驗證失敗就跳過，不補發 burst。

每次生成前必須驗證：

1. 不選目前有玩家腳部重疊、即將 broken、Boss target 或畫面最底部唯一可見的平台。
2. 生成後仍至少有兩個不含主動敵人的可達候選平台；單人至少保留一個 48px safe landing。
3. 預告圖形在 360×640 下不被 HUD 擋住，敵人 active 前至少經過規定毫秒數。
4. 玩家無輸入站在候選平台時不會在同 tick 被平台機關與敵人必中特效同時傷害。
5. 同一 formation 連續兩個高度帶不得都使用 ceilingDrop；同一 entry 不得連續三次。

敵人生命週期為 scheduled → telegraph → entering → active → staggered／defeated／escaped。telegraph 與 entering
期間不造成接觸傷害；離開可視區或所屬平台回收時標為 escaped，不給 Combo 或分數。

### R-PVE-06 場景、平台、小怪與 Boss 內容聖經

整體視覺採「柔和幾何童話 + 深色 2px 外輪廓 + 高亮弱點」；每個敵人必須靠輪廓、移動節奏與圖示即可辨識，不只靠顏色。
場景以二層 parallax、前景小裝飾與平台材質形成深度，不用高對比背景干擾落點。

| 場景 | 平台材質映射 | 小怪 | Boss |
|---|---|---|---|
| 苔芽庭園 | normal=樹根土台、spring=蘑菇芽、spike=荊棘、moving=藤蔓滑台、fragile=枯木 | 芽跳球、露珠史萊姆 | 苔甲巨龜「芽盾」 |
| 齒輪工坊 | normal=鉚釘鋼板、spring=活塞、spike=熱鉚釘、moving=吊軌、fragile=裂齒輪、conveyor=方向皮帶 | 齒輪小鬼、磁鐵蝠 | 發條巨像「鏘鏘」 |
| 暴風屋頂 | normal=屋瓦、spring=積雲墊、spike=避雷針、moving=吊牌、fragile=裂瓦、conveyor=風帶 | 風羽鴉、雨雲精 | 雷雲鯨「轟隆」 |
| 星光遺跡 | normal=星砂石、spring=星核、spike=水晶、moving=軌道台、fragile=虛空裂板、conveyor=星流 | 彗星蟲、鏡光靈 | 吞星龍「夜曜」 |
| 無限裂隙 | 依 50m band 混合已解鎖材質，但同一平台功能保持固定輪廓與圖示 | 已解鎖怪物 + 單一 elite modifier | 依序重戰四 Boss，增加一個已知 modifier |

小怪規格：

| 小怪 | HP | 行為／入場偏好 | 玩家讀法與反制 |
|---|---:|---|---|
| 芽跳球 | 1 | platformWake；每 1.6 秒向相鄰平台小跳 | 壓低身體 500ms 後跳；從上方踩擊 |
| 露珠史萊姆 | 2 | ceilingDrop；沿平台來回滑動 | 移動前朝向伸長；泡泡可顯著減速 |
| 齒輪小鬼 | 2 | portalPop；短距衝刺後停頓 | 頭上齒輪加速 700ms；停頓時踩擊 |
| 磁鐵蝠 | 1 | edgeLeap；短暫拉動最近 moving／conveyor 平台 12px | 平台先顯示磁力線；擊破即解除，不拉玩家 |
| 風羽鴉 | 1 | edgeLeap；扇出可抵抗的小型水平風 | 翅膀先後收再張；反向輸入或阿橘衝刺穿越 |
| 雨雲精 | 2 | ceilingDrop；標記一塊平台落下單次雨滴 | 1,100ms 圓形落點；離開標記平台 |
| 彗星蟲 | 2 | platformWake／edgeLeap；沿已顯示弧線跨兩台 | 路徑全程可見；在落點踩擊 |
| 鏡光靈 | 3 elite | portalPop；延遲複製最近一次平台機關效果 | 複製前顯示對應平台圖示；每區最多一隻 |

Boss 共通規則：

- 進場 warning 至少 3 秒，顯示名稱、輪廓、共享 HP 與一句反制提示；攻擊預告至少 1,000ms。
- HP 依 encounter 開始時有效玩家數鎖定，離線或淘汰不降低：第一至第四 Boss 的單人基礎 HP 為 20／24／28／32，
  每增加一名玩家分別 +6／+6／+6／+8；無限輪迴每輪 +8，最高 80。
- Boss 本體平時不可接觸傷害；完成場景反制後暴露 2.2 秒弱點。弱點每 cycle 最多承受 alivePlayers + 1 傷害，
  Team Fever 可再提高 cap 1，確保多人有回饋但不跳過完整演出。
- 每 25% HP 進入不超過 900ms 的 stagger，不扣捲動進度；最後一擊進入 defeat 動畫 2.5 秒並停止生成新敵人。
- 擊敗後所有存活玩家回復 1 點生命、全員取得區域完成紀錄；個人 scoreDepthM 依 Boss 傷害與助攻結算，觀戰者不獲得
  未參與的個人分數，但全隊仍一起進入下一區。

| Boss | 完整造型與動畫骨架 | 攻擊循環 | 弱點／反制 |
|---|---|---|---|
| 苔甲巨龜「芽盾」 | 大龜殼、四足、頭尾、背上幼芽；idle、walk、shellGuard、vineCast、stagger、defeat | 藤蔓橫掃、種子雨、龜殼震地、召喚芽跳球 | 踩亮 2 個花苞平台使背甲開花；踩背上星形芽芯 |
| 發條巨像「鏘鏘」 | 頭、胸腔齒輪、左右肩軸／上臂／前臂／手掌、雙腿；手臂以肩軸父子 transform 移動，不允許手掌獨立漂移 | 活塞拳、磁力拉台、齒輪雨、雙手拍擊 | 依箭頭踩下左右斷電台；胸口發條停轉後暴露 |
| 雷雲鯨「轟隆」 | 鯨身、左右鰭、尾鰭、雲腹、背上雷冠；swim、charge、gust、thunder、stagger、defeat | 左右強風、三點落雷、降雨幕、召喚風羽鴉 | 先踩兩個避雷平台導走電荷，再踩發光雷冠 |
| 吞星龍「夜曜」 | 頭頸、身體、雙翼、尾巴、四爪與胸口星核；hover、wingBeat、beam、orbit、stagger、defeat | 暗影光束、軌道彗星、平台相位、鏡光靈召喚 | 依序收集三枚場景星符，使胸口星核實體化 |

所有 Boss 動作須由 root → joint → limb 的階層或一致 sprite frame 驅動；手、翅膀、尾巴不可各自使用不同週期的無關
CSS animation。攻擊起手、命中、收招三段需共享 authoritative attack phase，client 只插值，不自行決定命中時刻。

### R-PVE-07 平台與關卡契合規則

各場景優先重用 normal、spring、spike、moving、fragile、conveyorLeft／Right 的既有物理，只替換材質、formation、fixture
與功能動畫，避免同一外觀在不同區域改變規則。新增語意欄位只允許 enemyPerch、bossWeakPoint、bossMechanism；
它們不是新碰撞種類。

- 每個高度帶維持 3 個錯落平台，至少 2 個 safe candidate；Boss 機關只可替換其中一個，不得吞掉唯一可達落點。
- enemyPerch 必須保留角色寬度 + 左右各 8px 的踩擊空間；怪物 hitbox 不可覆蓋整個 48px 平台。
- bossWeakPoint 使用場景高亮材質、形狀圖示與短 pulse；inactive 時仍保留普通平台碰撞。
- 背景色、平台頂面、危險物與敵人輪廓在三套 F8 skin 中皆需達可辨識對比；F9 恢復後不得重播入場或攻擊。
- 無限裂隙混搭時，功能輪廓與圖示優先於場景材質，例如所有 spring 仍保留中央彈簧／上箭頭。

### R-PVE-08 UI/UX 資訊架構

360×640 直向基準 wireframe：

~~~text
┌  386m  暴風屋頂       3 人存活  ┐
│ TEAM FEVER 3.8s  [███████░] ◆×3 │
│ 我：COMBO ×18   技能 6.2s   ♥♥♥  │
│ Boss：轟隆  34/40  下一招：落雷 │
├──────────────────────────────────┤
│       ↘ 0.9s                     │
│         [風羽鴉]                 │
│   玩家A       ⚡預告圈            │
│ ──屋瓦──    ──避雷台◆──          │
│       我  PERFECT + 踩擊          │
│ ─積雲墊↟─       ─裂瓦⌁─          │
│                                  │
│ ▼ 更深處：Boss 弱點 2/3          │
└──────────────────────────────────┘
~~~

資訊優先級：

1. 危險預告、玩家位置、下一階與敵人 hit silhouette 永遠在最上層可讀。
2. 上方第一列顯示 worldDepthM、場景與存活數；不再把 elapsed time 當主進度。
3. Team Fever 只有 active 或隊友達 24 Combo 時展開；一般狀態縮成 6px team rail，避免常駐遮擋。
4. 個人 Combo／技能／生命共用一列；其他玩家生命跟隨角色 nameplate，不建立四份大型 HUD。
5. Boss HUD 在 warning／active 顯示，採連續 HP bar + 10 個 major ticks，不繪製 80 個 DOM 格。
6. 一般 1 HP 小怪不顯示血條；2–3 HP 與 elite 只在受傷後顯示短小 HP pips。

回饋：

- 入場提示同時使用方向箭頭／落點形狀、敵人剪影與音高，不依賴單一顏色或音效。
- 踩擊提供 100–140ms squash、向上 hit spark、短音與可選 haptic；多人同 tick 命中只播放一次全局低音，每位玩家保留
  自己的文字回饋。
- Team Fever 進場有 600ms 金青邊框、場景星屑與 TEAM FEVER 文字；active 不閃爍全畫面，reduced-motion 改為靜態邊框、
  倒數與色帶。
- Boss 受傷需有部位反應、HP 下降、弱點關閉與短 hit-stop 視覺；server simulation 不暫停。
- 所有文字支援 200% zoom；提示不得遮住下一個可達高度帶。F8 切換 skin 不重置動畫 sequence；F9 隱藏時清除 held input，
  恢復後以最新 snapshot 呈現。

### R-PVE-09 免費素材、自行生成與授權

採「CC0 優先、逐檔追溯、同場景一致」策略。Kenney 官方說明 asset pages 上的遊戲素材皆為 CC0、可用於商業專案且不強制
署名；仍須保留每個下載包的 license 與來源紀錄。候選如下：

| 用途 | 候選 | 授權與採用方式 |
|---|---|---|
| 小怪組件／Boss 組裝參考 | [Kenney Monster Builder Pack](https://kenney.nl/assets/monster-builder-pack) | CC0；優先用於輪廓探索，重新配色與組裝，不直接混入不同像素密度 |
| 一般敵人動畫 | [Kenney Platformer Art Extended Enemies](https://kenney.nl/assets/platformer-art-extended-enemies) | CC0；165 個檔案，只挑選實際使用 frame |
| 庭園／抽象平台基底 | [Kenney Abstract Platformer](https://kenney.nl/assets/abstract-platformer) | CC0；可作幾何材質與敵人占位 |
| 工坊平台 | [Kenney Pixel Platformer Industrial Expansion](https://kenney.nl/assets/pixel-platformer-industrial-expansion) | CC0；18×18 tiles，若採用則全場以整數倍率渲染 |
| Fever／命中特效 | [Kenney Particle Pack](https://kenney.nl/assets/particle-pack) | CC0；只匯入需要的 spark／ring／smoke |
| 戰鬥音效 | [Kenney Impact Sounds](https://www.kenney.nl/assets/impact-sounds) | CC0；轉成短 WebM／OGG，保留 Web Audio fallback |
| 補缺素材 | [OpenGameArt FAQ](https://opengameart.org/node/5571)、[Freesound FAQ](https://freesound.org/help/faq/) | 兩站授權逐檔不同；只採素材頁明示 CC0 的下載檔，不以預覽或搜尋 filter 代替稽核 |

Kenney 授權總則以其 [官方 Support](https://kenney.nl/support) 與下載包 license 為準；CC0 法律文字記錄
[Creative Commons CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/legalcode.en)。不得採用 NC、SA、GPL、
來源不明、搜尋引擎圖片、其他遊戲截圖／音效或「仿某知名作品風格」生成提示。

四隻 Boss 建議以自行生成的原創透明 PNG concept 為起點，再由人工整理為一致 sprite／分層 rig；生成時不得點名在世藝術家、
現有角色或品牌。每項生成資產必須保存 assetId、工具／模型、完整 prompt、生成日期、原圖 hash、人工修改摘要與 reviewer。
生成圖只在人工確認輪廓、手腳連接、透明邊、各 frame 一致及兒童友善後進 runtime。

建議目錄：

~~~text
client/public/assets/downstairs/pve/
  ATTRIBUTION.md
  manifest.json
  common/{fx,audio,ui}/
  garden/{background,platforms,enemies,boss}/
  workshop/{background,platforms,enemies,boss}/
  rooftop/{background,platforms,enemies,boss}/
  ruins/{background,platforms,enemies,boss}/
~~~

每個場景 atlas 壓縮後目標 ≤ 450KB、Boss atlas ≤ 300KB、該場景音效 ≤ 250KB；首區連同 common 首屏新增量 ≤ 1.5MB。
下一區在距 Boss 80m 時低優先預載，失敗時使用現有 CSS 幾何 fallback；不得因圖片或音效載入失敗停止權威遊戲。
repository 只納入使用中的裁切檔，不提交整個素材包。

### R-PVE-10 Domain、wire contract 與模組邊界

目前 advanceDownstairs 同時處理生成、玩家物理、Boss 與回饋，新增 PvE 前必須先以不改行為的測試保護重構：

~~~text
shared/src/downstairs/
  progression.ts      // worldDepth、scene、scroll curve
  platforms.ts        // formation、回收與場景材質語意
  combat.ts           // hit、damage、Combo、reward 去重
  fever.ts            // Team Fever state machine
  enemies.ts          // enemy lifecycle 與 movement
  director.ts         // seeded spawn bag 與公平性驗證
  encounters.ts       // Boss phase、attack、weak point
  content.ts          // 純資料場景／敵人／Boss 定義
  view.ts             // compact wire view
~~~

權威狀態至少新增：

- progression：worldDepthM、sceneId、sceneStartDepthM、sceneDepthM、runSeed、loopTier。
- teamFever：phase、remainingMs、cooldownMs、sourcePlayerId、sequence、perPlayerGuardUsed。
- enemies：id、type、entry、phase、x／y／vx／vy、hp／maxHp、platformId、telegraphMs、attackSequence、status。
- encounter：bossId、phase、hp／maxHp、attack、attackPhase、weakPoint、cycle、sceneArenaDepthM。
- director：spawnIndex、bag、budget、lastEntries；以上皆可由 snapshot 完整恢復。

client 只能送既有方向與技能 command；不得上傳位置、命中、敵人 HP、Combo、Fever 或深度。server 50ms tick 維持唯一結算者。
DownstairsGameView 只包含渲染所需 compact fields；content 名稱、sprite key、顏色與固定 hitbox 可由 client 依 type 查表，
不得每個 snapshot 重送。高頻畫面以 x／y／phase 插值，傷害、掉落、Fever 與 Boss 結果以 sequence 去重。

### R-PVE-11 多人效能與同步預算

- 保留 20Hz authoritative tick／snapshot；client 對玩家、敵人與 Boss 使用 100ms interpolation buffer，不推測命中。
- 4 人、22 平台、5 敵人、1 Boss 的 JSON snapshot p95 目標 ≤ 24KB；server 單房 tick p95 ≤ 8ms、p99 ≤ 15ms。
- 同畫面 active DOM：玩家 ≤4、平台 ≤24、敵人 ≤5、Boss 1、粒子節點 ≤32；裝飾粒子不得進 wire state。
- hidden/F9 時 client 停止非必要粒子與音效，但保持 socket；恢復後丟棄舊 interpolation buffer，從最新 snapshot 開始。
- 高延遲測試使用 150ms RTT + 3% packet loss；命中、Guard、Boss HP、Fever sequence 與場景不得在 client 間分歧。
- 若 payload 超標，先移除重複 content metadata 與改用 event sequence；不得降低危險預告時間或把結算移到 client。

### R-PVE-12 驗收矩陣

自動測試：

1. worldDepth speed 段點、上限、sceneDepth 與 Boss gate；scoreDepth 加分不影響世界進度。
2. 1–4 人個人 Combo 獨立、同事件去重、傷害清空、三種 Guard 優先序與同平台重踩不刷分。
3. 任一玩家 30 Combo 觸發共享 Fever、其他 Combo 保留、每人 Guard、READY／cooldown、重連與淘汰。
4. 每種 enemy lifecycle、四種 entry 最短預告、spawn bag 不連續重複、預算與公平性 fallback。
5. 踩擊／側撞、技能 PvE 效果、助攻、elite、同 tick 多人命中與 Boss damage cap。
6. 四 Boss 全 phase、25% stagger、四套弱點、HP scaling、離線不降血、defeat 後 scene transition。
7. 固定 seed replay、不同 delta 切片、snapshot round-trip 及 150ms RTT 模擬一致。
8. 既有平台、角色技能、F8/F9、其他三種遊戲及 room lifecycle regression。

人工 UI/UX：

- 360×640、768×1024、1440×900、200% zoom 下，下一階、敵人預告、個人 Combo、Team Fever 與 Boss HUD 不遮擋。
- 四場景的平台功能可由輪廓辨識；色弱、靜音、reduced-motion 與素材載入失敗仍可完成一局。
- 1–4 人各跑至少一個 Boss；Team Fever 的共享感明確，但不會因隊友觸發而突然加快世界捲動。
- Boss 手腳／翅膀／尾巴動畫關節連續，起手、命中、收招與 server phase 一致；弱點與反制不需猜測。
- F8 三套 skin 及 F9 隱藏／恢復不重置 worldDepth、敵人、Combo、Fever、Boss 或 held input。

### Phase 6 UI-first 交付與核准閘門

1. **6A Spec（本次）：** 完成需求、數值、內容、素材與驗收定義；狀態 PVE_DEPTH_SPEC_DRAFT。
2. **6B Client-only UI/UX（已完成並核准）：** 使用固定 mock snapshots 展示四場景、探索／小怪入場／Boss 戰／
   Team Fever、個人 Combo 與四 Boss 弱點；不得新增 shared state、server handler 或 Socket.IO event。
3. **UI approval gate（已通過）：** 使用者確認資訊層級、怪物／Boss 造型、平台材質、動畫節奏、360×640 與 F8/F9，
   Decision Log 已記錄 `PVE_DEPTH_UI_APPROVED`。
4. **6C Shared domain（已完成）：** 已拆出並測試 progression、combat、Fever、director、enemy、encounter 與 content。
5. **6D Server integration（已完成）：** authoritative room tick、既有 commands、compact snapshots、reconnect 與效能 gate 已整合。
6. **6E Asset／E2E（已完成）：** 已核准素材紀錄、runtime CSS／SVG fallback、dev-only 實際元件 fixture、跨尺寸與多人驗收完成。

Phase 6B 實作證據（2026-08-08）：

- 新增 dev-only fixture：開發服務使用 ?dev=downstairs-pve，可再加 scene=garden|workshop|rooftop|ruins 與
  moment=explore|entry|boss|fever；正式 production build 會 tree-shake 整個 fixture，且大廳沒有預覽入口。
- UI 可互動切換 4 場景 × 4 狀態，固定展示 world depth、個人 Combo、Team Fever rail、多人生命、小怪入場、
  場景平台、Boss HP／弱點與核准清單；F8/F9 由既有 SkinProvider 驗證，不建立 GameProvider 或 socket。
- 以 imagegen 產生四 Boss 原創完整造型概念板，檔案、prompt 與後製紀錄位於
  client/src/features/downstairs-pve/assets/；此圖標記 runtimeReady=false，只供 UI 核准，不視為正式 sprite。
- client typecheck、production build 與桌面／窄視窗截圖稽核通過；等待使用者確認造型、資訊層級與特效後記錄
  PVE_DEPTH_UI_APPROVED。

Phase 6C～6E 實作證據（2026-08-08）：

- Codebase Memory 圖譜確認上游為 `GameServer.onStartGame`／`startDownstairsLoop`／既有方向與技能 handlers，下游為
  `downstairsView`／`buildRoomView`／`DownstairsBoard`；shared contract 只擴充 `DownstairsState`／`DownstairsGameView.pve`，
  沒有新增可讓 client 上傳位置、命中、敵人 HP、Combo、Fever 或 worldDepth 的 Socket event。
- `shared/src/downstairs/` 已拆出 content、progression、fever、director、enemies、combat、encounters；worldDepth 使用 10ms
  deterministic accumulator、速度上限 72，個人 scoreDepth 不會驅動場景；Team Fever 具 active／cooldown／idle、每人 Guard、
  READY 與 sequence；seeded director 具 50m budget、公平平台篩選、入口預告與 1～4 人上限。
- 四場景、八種小怪、四 Boss HP scaling、場景機關、2.2 秒弱點、per-cycle 玩家去重與 damage cap、25% stagger、2.5 秒 defeat、
  scene transition、elite 星星掉落及四角色 PvE 技能交互已由 shared authoritative domain 結算。
- server 正式建房改以 `startDownstairs(..., 'pve')` 啟動，保留 50ms tick、`game:downstairs` 與
  `game:downstairsSkill`；四個真實 Socket client 建房／加入／準備／開始／方向／技能 smoke 通過，四人 snapshot 6,524 bytes。
- client 正式畫面已接 `pve` snapshot：worldDepth／場景／存活數、個人 Combo、Team Fever rail、READY marker、敵人預告／HP、
  Boss 機關／弱點／連續 HP 與合作結算；四 Boss 使用完整 code-native SVG rig，root／joint／limb 共用 attack phase 動畫。
  dev-only `?dev=downstairs-runtime` 以正式元件完成 desktop 與窄視窗截圖；F8/F9、200% zoom 與 reduced-motion 沿用核准邊界。
- imagegen 概念板仍維持 `runtimeReady=false` 並保留 manifest／ATTRIBUTION；runtime 不直接使用未整理 concept raster，改用
  原創 SVG／CSS 幾何 fallback，因此沒有新增第三方授權或載入失敗風險，production build 仍不含兩個 dev fixture。
- 2,000 次 4 人／22 平台／5 敵人／1 Boss benchmark：tick p95 0.084ms、p99 0.313ms、max 2.352ms；低於 8／15ms 預算。
  327 tests、完整 typecheck、production build、diff check、單人與四人 Socket smoke 全部通過。

自動測試、typecheck、production build、diff check、Socket smoke、效能預算、素材稽核與核准後 UI 矩陣均已通過，狀態記錄為
`PVE_DEPTH_FULL_IMPLEMENTATION_COMPLETE`。

## 4.3 Phase 7：Boss 戰與小怪入場體驗強化（P0–P2 已核准）

本階段不新增攻擊按鍵、不改變 server authoritative 邊界，也不增加新的 Socket command。使用者已核准一次完成 P0～P2；
實作依 shared deterministic domain → server snapshot → client presentation 進行，並以本節作為行為 single source of truth。

### R-PVE-13 P0：安全生成與四段式小怪入場

- director 不再只依固定 50m 脈衝選台；生成間距由 seed 決定在 38～62m，並可排入 deterministic encounter card。
- 候選台必須排除玩家目前站立台、腳部重疊台、預測的下一落點、broken／Boss target／畫面裁切台；敵人預計接觸時間須在
  1.2～3.0 秒之間，且生成後仍保留至少兩個無敵人的安全候選。
- 入場依序為 `cue → telegraph → entering → settling → active`。cue 顯示環境徵兆；telegraph 顯示剪影、方向／路徑與倒數；
  entering 必須有實際位移；settling 至少 250ms 且不可造成傷害。四種 entry 的總安全反應時間不得短於 1.6 秒。
- platformWake 使用震動與逐漸長出的輪廓；edgeLeap 顯示邊界來源與拋物線；ceilingDrop 顯示頂端連線與落點陰影；portalPop
  顯示由小到大的傳送門及門後剪影。reduced-motion 改為靜態分段圖示、倒數與落點框。

驗收：相同 seed、depth 與玩家位置產生相同計畫；玩家目前台／預測落點永不生成；四 entry 依序經過全部 phase，active 前
接觸傷害為零；高速深度仍符合預告下限；360×640 可辨識來源與落點。

### R-PVE-14 P1：三幕式 Boss 與四套獨立反制

- Boss 流程為 3 秒 `warning`，再依 HP 分成 `teach`（100～75%）、`mix`（75～25%）、`finale`（25% 以下）。warning
  將既有小怪安全退場並把世界捲動暫降 10%；teach 只出前兩招、預告 1,600ms；mix 使用完整招式、預告 1,200ms；
  finale 預告不得短於 1,000ms、收招縮短但每輪仍保證反擊窗口。Team Fever 只延長反擊／收招，不改短預告。
- HUD 必須以繁體中文顯示「預告 → 閃避 → 反擊」、幕別、攻擊名稱、機關步驟及弱點倒數。玩家已在本 cycle 命中或全隊達
  damage cap 時不得靜默失敗，需顯示「本輪已命中」或「本輪傷害已滿」。
- 芽盾的兩個花苞可任意點亮；鏘鏘必須依 HUD 箭頭順序踩左右斷電台，踩錯退回一步但不扣血；轟隆需啟動兩座避雷台；
  夜曜須依序收集三枚星符。平台以 mechanism index、圖形與連線同時表達順序，不只靠顏色。
- 每跨越 25% HP 進入 1,200ms stagger，呈現部位受擊、HP notch、鏡頭衝擊與反擊喘息；最後一擊播放 2.5 秒完整 defeat，
  權威 simulation 不做 hit-stop。Boss 攻擊不得破壞玩家目前台、預測下一落點或任一高度帶的唯一安全台。

驗收：四 Boss 的機關順序、錯誤回饋、三幕 attack pool／時間、damage cap、25% stagger、warning 清場、安全 target fallback、
Fever 與 defeat transition 均具 deterministic tests；正式 HUD 不顯示 internal attack id。

### R-PVE-15 P2：戰鬥事件組合、Boss 召喚與完整感官回饋

- 一般探索採 `solo`、`crossfire`、`eliteEscort` encounter card；前 80m 只使用 solo，crossfire 兩名敵人至少間隔 10m 且不可
  夾住唯一安全路線，eliteEscort 每區至多一次並沿用 elite 上限。card 內容、順序與間隔皆由 seed 決定，公平性失敗可放棄，
  不補發 burst。
- Boss 召喚物由 Boss 的 authoritative attack impact 建立，沿用四段式入場並帶 `bossSummon` card；造型入場須與場景一致，
  不可使用一般 director 的突現動畫。
- client 依既有 feedback／encounter sequence 播放合成音：cue、Boss 預告、命中、stagger 與 defeat；mute persistence、沒有
  AudioContext 或 vibration 時仍可完整遊玩。鏡頭震動只套在 playfield presentation，reduced-motion 完全停用位移震動。
- Boss 攻擊視覺必須與 authoritative `telegraph／impact／recover` 同步；每隻 Boss 的肢體、場景波紋與 mechanism beam 使用同一
  phase，不自行推測命中。defeat 顯示 Boss 崩解、星屑、區域完成文字及下一區提示。

驗收：三種 encounter card、Boss summon、entry sequence、stagger／defeat 音畫去重、mute／reduced-motion、F8/F9、多人 snapshot
與 24KB／8ms 效能預算均通過；完成後 Decision Log 記錄 `BOSS_ENEMY_EXPERIENCE_COMPLETE`。

Phase 7 實作證據（2026-08-08）：

- Codebase Memory 圖譜確認上游為 `updatePveWorld`／`advanceDownstairs`／`GameServer.startDownstairsLoop`，下游為
  `downstairsView`／正式 `DownstairsBoardContent`；shared contract 擴充 `PveEnemyState`、`PveDirectorState`、
  `PveEncounterState` 與平台 `pveMechanismIndex`，沒有新增 client command、Socket event 或 client-authoritative 命中。
- director 已採 seed 派生的 38～62m threat interval、玩家目前台／預測落點／1.2～3.0 秒接觸時間篩選、recent platform
  cooldown，以及 solo／crossfire／eliteEscort pending card；Boss summon 使用獨立 `bossSummon` card。
- 小怪正式生命週期為 cue／telegraph／entering／settling／active；edgeLeap 與 ceilingDrop 在 shared snapshot 內具有實際移動，
  platformWake／portalPop 具場景徵兆、剪影、倒數、落地無傷緩衝與 reduced-motion 靜態讀法。
- Boss 已具 teach／mix／finale 三幕、1,600／1,200／1,000ms 預告、10% warning 緩速、安全退怪、安全 target band、四套
  mechanism order、繁中攻擊名稱、重複命中／damage cap 回饋、1.2 秒 stagger、attack phase FX 與 2.5 秒 defeat／區域完成演出。
- 正式 client 依 encounter sequence 去重 stagger／命中／defeat 合成音與 vibration；mute persistence、無 AudioContext fallback、
  reduced-motion、F8/F9 與既有 input-only transport 均維持。
- 驗證：333 tests、shared／server／client typecheck、production build 通過；產物 CSS 104.49KB（gzip 21.22KB）、JS
  335.37KB（gzip 106.70KB），四人 compact snapshot 測試持續低於 24KB。已知剩餘風險只有主觀節奏與音量平衡，需產品以
  1～4 人各完成至少一場 Boss 實機遊玩驗收，不影響自動化功能完成狀態。

## 5. UI prototype 技術邊界

Phase 1 建議新增：

```text
client/src/features/downstairs/
  DownstairsPrototype.tsx
  DownstairsPlayfield.tsx
  DownstairsHud.tsx
  DownstairsControls.tsx
  downstairsPrototypeAdapter.ts
  downstairs.css
```

`DownstairsGameAdapter` 只描述 UI 所需命令與 snapshot，例如 `moveLeft(active)`、
`moveRight(active)`、`restart()`、`subscribe(listener)`。mock 可產生平台、生命與淘汰狀態，但其資料 shape
不是正式 shared/wire contract。Phase 6 mock 只能放在 dev-only route／fixture，不得恢復已移除的大廳「預覽玩法」
入口，也不得讓使用者誤以為已建立多人房間。

### UI 核准清單

- [ ] 大廳入口與遊戲命名
- [ ] 等待/教學畫面
- [ ] playfield 比例、視覺方向與平台辨識
- [ ] desktop / mobile 控制手感
- [ ] HUD 資訊層級
- [ ] 淘汰、觀戰、結算流程
- [ ] 360×640、768×1024、1440×900 responsive
- [ ] reduced motion、鍵盤與對比
- [ ] F8／自訂快捷鍵切換所有 skin，遊戲狀態不重置且各 skin 清楚可讀
- [ ] F9／自訂老闆鍵遮蔽與恢復，不卸載、不斷線、不暫停 simulation，且不殘留 held input
- [ ] 三類平台與五種核心事件具有清楚、節制且可關閉的多通道回饋
- [ ] 深度變化、里程碑、個人最佳、combo 與失敗提示的資訊層級
- [ ] 素材體積、fallback、lazy loading 與 360×640 實機辨識度
- [ ] 所有第三方素材均有來源、license、修改紀錄，且不包含未使用的整包檔案

全部勾選並由使用者明確回覆核准後，才在 Decision Log 加上 `UI_APPROVED`。

## 6. 核准後的 domain/backend 草案（不可在目前階段實作）

### Phase 2：shared domain

- `GameType` / `GameView` 增加 discriminant `downstairs`。
- 定義 deterministic simulation：固定 timestep、seeded platform generation、碰撞、傷害、淘汰、計分。
- 定義 command，而不是相信 client position：client 只傳左右輸入與 sequence/timestamp。
- 單元測試涵蓋平台碰撞、邊界、尖刺傷害、彈簧、淘汰、seed replay 與 tie-break。

### Phase 3：server integration

- server 持有 authoritative state 與 tick；驗證 input rate/sequence。
- 房間生命週期支援開始、斷線寬限、重連、淘汰轉觀戰、全員淘汰、再來一局。
- snapshot/delta 頻率、插值 buffer 與 reconnect payload 需用實測決定，不能由本草案直接視為核准值。
- Lobby summary、RoomView builder、Room router、log 與錯誤碼加入對應分支。

### Phase 4：整合驗收

- 1–4 人同房可開始並一致看見結果。
- 高延遲/短暫斷線不造成 server/client 結果分岔。
- 舊有大老二、德州撲克、大富翁建房與遊戲流程 regression 通過。
- `npm test`、`npm run typecheck`、`npm run build` 全數通過。

## 7. 待使用者定案

既有產品名稱、1–4 人房間、左右邊界停止、3 點生命及 F8/F9 skin 規則皆沿用目前已實作版本，不再視為待定。
Phase 6 進入 domain/backend 前，只需在 client-only UI/UX mockup 定案以下內容：

1. 四場景、八小怪與四 Boss 的名稱、輪廓、色彩及兒童友善程度。
2. 維持「左右移動 + 既有技能」、以踩擊與機關戰鬥，不新增攻擊鍵。
3. 個人 30 Combo 觸發 5 秒 Team Fever，以及每人 Guard、+35% 水平控制、+1 PvE 傷害與共享特效。
4. worldDepthM 速度曲線、各區探索長度、Boss HP scaling 與無限裂隙節奏。
5. Kenney CC0 基底 + 原創生成 Boss + CSS fallback 的素材方向與載入體積。

以上五項可一次整體核准或逐項調整；全部確認後記錄 PVE_DEPTH_UI_APPROVED，才可開始 Phase 6C／6D。

## 8. Decision Log

### Phase 1 實作紀錄

- 2026-08-06：建立 `client/src/features/downstairs/` client-only prototype，以 local adapter 隔離未定案的
  simulation shape；未修改 `shared`、Socket.IO 或 `server`。
- 大廳新增「預覽玩法」入口；以 hash `#downstairs-preview` 進出，重新整理可保留預覽入口狀態，但不建立房間。
- 已實作鍵盤／pointer controls、三類平台、生命、深度、combo、個人最佳、倒數、淘汰原因、responsive、
  reduced-motion、合成音效／haptic progressive enhancement，以及 F8/F9 切換時清除 held input。
- 第一版先用 CSS 原創幾何 fallback 與 Web Audio 合成提示音，尚未加入第三方素材；待 UI 方向初審後再從素材評估表
  選定同一套視覺資產，避免在方向未定案前引入無用檔案。
- 驗證：`npm run typecheck`、`npm test`（235 tests）、`npm run build`、`git diff --check` 通過。
- Phase 1 UI 已獲使用者核准；仍建議在正式發布前補做實機 360×640 操作與跨瀏覽器視覺走查。

### Phase 2–4 完整實作紀錄

- `shared/src/downstairs.ts` 定義正式 discriminated view、platform/player state、方向 command、固定步進、碰撞、
  傷害、淘汰、排名與離場規則；client 不上傳位置、生命或分數。
- `server` 房間加入 downstairs state 與獨立 timer；50ms authoritative tick、最慢每 100ms 廣播 snapshot，
  空房時清理 timer，重連沿用房間最新狀態。
- 正式 `game:downstairs` event 只接受 `-1 | 0 | 1`；未知玩家、觀戰者、已淘汰玩家與非 downstairs 房間的輸入
  都不會改變 simulation。
- Lobby 正式加入 `downstairs`（1–4 人），Room exhaustive router、三套 skin 名稱、等待／準備、桌面鍵盤、
  pointer controls、淘汰觀戰、排名與房主再開一局均已串接。
- 排名依淘汰逆序排列，最後存活者第一；同一 server tick 淘汰時依 deterministic player insertion order 處理。
- 驗證：`npm run typecheck`、`npm test`（238 tests）、`npm run build`、production Socket.IO smoke test 通過；
  smoke test 已實際完成 hello → 建立 downstairs 房 → 開始 → 方向輸入 → 收到 authoritative snapshot → 離房。

### 多人流暢度修正

- 2026-08-06 實測發現完整 `RoomView` 以 10Hz 廣播會讓 RoomShell、座位、聊天與 log 跟著重繪，且角色移動呈
  階梯感。高頻路徑已拆成 `game:downstairsState` 輕量 snapshot，只包含 downstairs game view。
- Server 維持 50ms authoritative tick 並以 20Hz 發送輕量 snapshot；完整 `RoomView` 只在開始、結束、房間成員或
  其他低頻狀態變更時發送。Client 將 live board/controls 隔離成局部 state，平台與角色以 55ms linear interpolation
  平滑顯示，不影響 server 判定。
- 兩個真實 Socket.IO client smoke test 在約 550ms 內收到 8 個輕量 snapshot、僅 1 個完整 RoomView，雙方方向輸入
  與 authoritative elapsed state 正常；typecheck、238 tests 與 production build 重新通過。
- 2026-08-06：四角色技能完成 shared authoritative simulation、server activation command 與 20Hz 輕量狀態同步；
  client 加入 `Space`／`E`／觸控施放、冷卻 HUD、角色效果與 reduced-motion fallback。技能角色由 server 的開局
  seat snapshot 決定，client 無法指定效果或冷卻；typecheck、246 tests 與 production build 通過。

| 日期 | 狀態 | 決策 | 核准者 |
|---|---|---|---|
| 2026-08-06 | `SPEC_DRAFT` | 完成 codebase 評估與 UI-first 分階段草案；尚未授權實作 | — |
| 2026-08-06 | `SPEC_DRAFT` | 新遊戲沿用全站 F8 skin 循環與 F9 老闆鍵語意，切換不得重置遊戲狀態 | 使用者 |
| 2026-08-06 | `SPEC_DRAFT` | 素材採 CC0 優先與逐項追溯；以動態回饋、深度變化、短期目標提升趣味性 | 使用者 |
| 2026-08-06 | `PROTOTYPE_IN_PROGRESS` | 核准開始 Phase 1 client-only UI/UX 原型；尚未構成 `UI_APPROVED`，禁止 shared/server 實作 | 使用者 |
| 2026-08-06 | `UI_APPROVED` | 使用者確認 UI 設計可接受，核准進入 Phase 2–4 完整實作 | 使用者 |
| 2026-08-06 | `FULL_IMPLEMENTATION_COMPLETE` | shared domain、server authoritative loop、正式多人 UI 與 transport 完成並通過自動驗證 | Codex |
| 2026-08-06 | `PERFORMANCE_FIXED` | 多人高頻同步改為輕量 20Hz snapshot，client 局部更新並插值，完整 RoomView 退出 frame loop | Codex |
| 2026-08-06 | `FULL_IMPLEMENTATION_COMPLETE` | 正式多人玩法完成後移除大廳預覽入口、hash route 與 client-only mock prototype | 使用者 |
| 2026-08-06 | `FEATURE_ADDED` | 正式等待畫面加入 4 個 server-synced 原創角色；允許重複選角且能力完全一致 | 使用者 |
| 2026-08-06 | `SKILL_IMPLEMENTATION_COMPLETE` | 使用者核准技能草案；四角色主動技能、共用操作、權威冷卻與多人輕量同步完成 | 使用者 |
| 2026-08-06 | `DIFFICULTY_TUNED` | 開局角色出生高度上移並取消初始上拋速度，確保四個座位都有時間落上安全起始平台 | 使用者 |
| 2026-08-06 | `OPENING_PLATFORM_TUNED` | 角色正下方配置全座位可見且可達的寬彈跳平台，並保留下層安全平台降低開局失敗率 | 使用者 |
| 2026-08-06 | `INPUT_BUG_FIXED` | 放開技能鍵不再清除方向輸入；方向鍵分別追蹤，施放技能期間可持續移動 | 使用者 |
| 2026-08-06 | `SKILL_PERFORMANCE_FIXED` | 技能特效移除移動角色上的 animated filter，改用 compositor-friendly 偽元素；星光牽引改為單次平台掃描 | 使用者 |
| 2026-08-06 | `MULTIPLAYER_HEALTH_FIXED` | 場上每位角色顯示暱稱與剩餘生命，朝向鏡像時標籤維持可讀 | 使用者 |
| 2026-08-07 | `LEVEL_CURVE_REBALANCED` | 完成三階段速度／尖刺曲線、可達平台生成、高度反彈限制、頂端緩衝與長局公平測試 | 使用者 |
| 2026-08-07 | `SPECIAL_PLATFORM_FEEDBACK_FIXED` | 強化彈跳台與普通台的反彈差距，特殊平台觸發時同步顯示短暫文字回饋 | 使用者 |
| 2026-08-07 | `SPRING_HEIGHT_INCREASED` | 一般彈跳台再提高反彈高度；開局彈跳台維持安全力度並保留高度限制 | 使用者 |
| 2026-08-07 | `SPRING_REACH_CALCULATED` | 彈跳力依最近上一層平台高度差動態計算並加入安全餘量，危險頂端區維持力度保護 | 使用者 |
| 2026-08-07 | `SPRING_LANDING_GUARANTEED` | 彈跳高度餘量提高至 50px、最大彈力提高，並以完整飛行後落上上一層平台作為驗收 | 使用者 |
| 2026-08-07 | `SKILL_STARTUP_FIXED` | 移除容易被誤認為失效的開局 2 秒技能冷卻，所有角色開局即可施放 | 使用者 |
| 2026-08-07 | `LEVEL_EXPANSION_SCOPE_APPROVED` | 核准四主題、新平台、分岔、星星、低頻事件與 60 秒合作 Boss 納入 Spec；尚未核准實作 | 使用者 |
| 2026-08-07 | `LEVEL_EXPANSION_SPEC_DRAFT` | 完成 R-GAME-03／04 與 UI approval gate；下一步為 client-only UI/UX mockup | Codex |
| 2026-08-07 | `LEVEL_EXPANSION_UI_MOCKUP_READY` | 等待畫面提供四區域、新平台、雙路線與 Boss 三階段 client-only mockup；等待使用者 UI 核准 | Codex |
| 2026-08-07 | `LEVEL_EXPANSION_UI_APPROVED` | 使用者確認關卡設計可進入實作；正式遊戲畫面取代等待大廳中的 client-only 預覽入口 | 使用者 |
| 2026-08-07 | `STAR_REWARD_APPROVED_BASELINE` | 星星單顆 `+5m`、每 3 顆提供 Combo 保護、每 9 顆補 1 點生命；滿血時轉為 `+30m` | Codex |
| 2026-08-07 | `LEVEL_EXPANSION_IMPLEMENTATION_COMPLETE` | 完成四區域、新平台、事件、星星回饋與 60 秒合作 Boss 的 authoritative state、正式 UI 與 deterministic tests | Codex |
| 2026-08-07 | `BOSS_VISUAL_AND_PLATFORM_VARIETY` | 咚咚王加入完整頭身、皇冠、四肢、表情與依攻擊切換的低成本動畫；台階生成改為之字、階梯、波浪、休息段四種 deterministic 編排，進階區域才出現窄版挑戰路線 | Codex |
| 2026-08-07 | `BOSS_VISIBILITY_FIX` | 修正部分瀏覽器未穩定呈現空 span 拼圖的問題；Boss 本體改為固定 viewBox 的 inline SVG，明確指定可見尺寸與場景層級，攻擊動畫維持由 authoritative state 驅動 | Codex |
| 2026-08-07 | `BOSS_DESTRUCTION_AND_SPEED_RAMP` | Boss 補上披風、腿部與戰鬥表情；重踏目標台先顯示警告、命中後由 server 擊碎 2.2 秒再復原。Boss 階段延續全局時間速度曲線，不再降為固定速度 | Codex |
| 2026-08-07 | `PLATFORM_MOTION_LANGUAGE` | 平台動畫改為功能導向：普通台低頻光澤、彈跳台蓄力、尖刺警示、移動台滑軌、脆弱台裂紋、輸送帶方向流動、Boss 開關脈衝與碎裂坍塌；僅使用合成友善屬性並支援 reduced-motion | Codex |
| 2026-08-07 | `PLATFORM_TEXTURE_UI_APPROVED` | 使用者核准八種平台材質方向與第二版藍白安全起點台，可進入正式實作 | 使用者 |
| 2026-08-07 | `START_PLATFORM_IMPLEMENTED` | 起點台新增 authoritative `isStart` 狀態、藍白軟墊、中央星徽、固定支架、呼吸邊光與少量星光；保留已驗證的四人集中出生碰撞區與開局彈力，回收時清除專用狀態 | Codex |
| 2026-08-07 | `IMPLEMENTATION_GAPS_FOUND` | 完整 review 確認核心玩法與 266 tests 正常，但音效、權威結算、rescue、真正分岔、轉場教學、Boss 完整攻擊呈現、自訂快捷鍵、pointer cancel 與 prototype 清理尚未符合 Spec | Codex |
| 2026-08-07 | `COMPLETION_SPEC_READY` | 使用者要求補完全部缺口；新增 R-COMP-01～09、server/client 責任、deterministic tests 與最終人工驗收 gate，尚未開始 Phase 5 實作 | 使用者 |
| 2026-08-07 | `COMPLETION_HARDENING_COMPLETE` | 完成權威排名、Rescue、成對分岔、回饋序號、正式音效／mute／haptic、轉場教學、Boss 特效、自訂快捷鍵、pointer lifecycle、完整結算及 prototype 清理；270 tests 與 Socket smoke 通過 | Codex |
| 2026-08-07 | `BOSS_ARM_MOTION_REFINED` | 修正 SVG attribute transform 與 CSS transform 互相覆寫造成的手臂跳格；披風移至手臂後方，左右肩採獨立 transform origin，四種攻擊使用連續且不同步的關節動畫 | Codex |
| 2026-08-07 | `COMBO_FEVER_SPEC_PROPOSED` | 提案 30 Combo 觸發 5 秒個人 Fever：速度 +45%、安全落地 +10m、一次 Fever Guard、完整 HUD 倒數與多人／reduced-motion 規則；等待 UI/UX 核准，尚未實作 | Codex |
| 2026-08-07 | `COMBO_FEVER_UI_APPROVED` | 使用者核准完整 Fever 實作，並要求進入 Fever 時提供明確特效 | 使用者 |
| 2026-08-07 | `COMBO_FEVER_IMPLEMENTATION_COMPLETE` | 完成 server-authoritative 5 秒 Fever、個人 +45% 速度、安全落地獎勵、一次 Guard、分數入帳、專屬 HUD／音效／觸覺、角色光環／尾跡／場景粒子與 reduced-motion；280 tests 通過 | Codex |
| 2026-08-07 | `PLATFORM_VISUAL_AUDIT_GAPS_CONFIRMED` | 重新稽核八種平台與起點 variant：確認全部已有基礎材質，但 wave pseudo-element 覆蓋、Boss used 樣式、互動觸發、fragile 階段與 conveyor 結構仍未完整；Spec 改列部分完成並建立 P0／P1／P2 gate | Codex |
| 2026-08-07 | `PLATFORM_VISUAL_IMPLEMENTATION_COMPLETE` | 補完獨立 formation／fixture／roller／debris 結構層、Boss used 材質、landing-driven spring／spike／moving impact、fragile 三階段裂紋與材質碎片、conveyor 分節與方向滾輪；typecheck、280 tests、production build 通過，待使用者目視 acceptance | Codex |
| 2026-08-07 | `CORE_GAMEPLAY_OPTIMIZATION_PROPOSED` | 保留既有關卡流程，提案 P0 精準落地等級、高 Combo 制動補償、明確安全／挑戰回報；P1 為 seeded event bag 與微目標。等待 UI/UX 與數值核准，尚未實作 | Codex |
| 2026-08-07 | `CORE_GAMEPLAY_P0_APPROVED` | 使用者確認遊戲性優化提案可開始實作；範圍為 Landing Quality、高 Combo 制動補償與安全／挑戰路線回報，P1 暫不納入 | 使用者 |
| 2026-08-07 | `CORE_GAMEPLAY_P0_IMPLEMENTATION_COMPLETE` | 完成 server-authoritative PERFECT／GOOD／EDGE、safe／challenge 個人獎勵、技能冷卻縮短、Combo／Fever 制動補償、甜蜜區、路牌、個人音效／觸覺與去重 sequence；typecheck、284 tests、production build 通過 | Codex |
| 2026-08-08 | `PLATFORM_VISUAL_ACCEPTED` | 使用者完成新版平台材質、動畫、起點 variant 與整體遊戲畫面的人工驗收，確認本版可接受 | 使用者 |
| 2026-08-08 | `CORE_GAMEPLAY_P1_APPROVED` | 使用者確認 P1 可開始；鎖定 18 秒首發 seeded shuffle bag、跨袋事件去重、非 Boss 區個人微目標及 cooldown／少量 Combo 獎勵 | 使用者 |
| 2026-08-08 | `CORE_GAMEPLAY_P1_IMPLEMENTATION_COMPLETE` | 完成 18 秒首發／15 秒節拍 deterministic event bag、rescue eligibility fallback、四區個人微目標、一次性 cooldown／Combo 獎勵、事件倒數、進度與完成 HUD、音效／觸覺／reduced-motion；修正同尖刺重複扣血；291 tests、typecheck、production build 通過 | Codex |
| 2026-08-08 | `SINGLE_WIDTH_MULTIPLAYER_START_APPROVED` | 使用者要求平台縮小為單人寬度，並依多人數量生成各自的起始平台；鎖定 48px safe／38px challenge、1–4 個獨立起點與額外起點退休規則 | 使用者 |
| 2026-08-08 | `SINGLE_WIDTH_MULTIPLAYER_START_IMPLEMENTATION_COMPLETE` | 一般／safe／rescue／Boss switch 統一 48px、challenge 38px；完成 1–4 人獨立起點、玩家置中出生、額外起點退休與主起點回收，更新 Rescue UI 文案；296 tests、typecheck、production build 通過 | Codex |
| 2026-08-08 | `DENSITY_SPEED_TUNING_APPROVED` | 使用者要求增加平台密度並提高遊戲捲動速度；playability 回歸後鎖定 safe 74–84px、challenge 82–90px、rest 70px 與 26→37→54→68 三階段曲線 | 使用者 |
| 2026-08-08 | `DENSITY_SPEED_TUNING_IMPLEMENTATION_COMPLETE` | 完成 procedural 平台密度提升、水平中心位移上限 70px 與 26→37→54→68 捲動曲線；初始八階維持既有節奏，10／30／60／90 秒公平性回歸通過；296 tests、typecheck、production build 通過 | Codex |
| 2026-08-08 | `MULTI_ROUTE_SKILL_AUDIT_APPROVED` | 使用者要求同層提供更多平台與多樣路線，並重新檢視四角色技能是否有缺陷；鎖定一般層至少雙平台、進階區偶爾三平台及技能輸入／傷害／導引稽核 | 使用者 |
| 2026-08-08 | `MULTI_ROUTE_SKILL_AUDIT_COMPLETE` | 完成首屏與 procedural 同層多路線、相鄰層錯位、底部下一層可見、落點提示修正；勇氣護盾涵蓋 Boss 傷害、星光牽引排除 broken／同層且尊重手動輸入、文字焦點不誤觸技能；304 tests、typecheck、production build、diff check 通過 | Codex |
| 2026-08-08 | `EMERGENT_PLATFORM_FIELD_APPROVED` | 使用者否決明顯雙路線體驗，要求系統只提供豐富可挑戰的平台場，由玩家自行想像與創造走法，不再由路牌或落點提示引導 | 使用者 |
| 2026-08-08 | `EMERGENT_PLATFORM_FIELD_COMPLETE` | 以 22 個常駐平台建立 7 個三平台錯落高度帶；移除 branch id、15 秒雙線、SAFE／RISK 路牌、challenge outline 與指定落點；新增多 formation／offset hash 與機關落地目標；305 tests、typecheck、production build、diff check 通過 | Codex |
| 2026-08-08 | `SAME_PLATFORM_RELAND_FIXED` | 修正平台碰撞鎖定過久：角色向上越過台面後可再次落回同一平台，同平台仍只首次計分、累積 Combo 與個人目標；305 tests、typecheck、production build、diff check 通過 | Codex |
| 2026-08-08 | `PVE_DEPTH_SPEC_DRAFT` | 定義 1–4 人深度式合作 PvE：個人 Combo、全隊共享 Fever、worldDepth 速度曲線、seeded 小怪入場、四場景／八小怪／四 Boss、平台材質、CC0／生成素材流程、domain 邊界、效能與驗收矩陣；等待 client-only UI/UX mockup 與使用者核准，尚未授權 shared/server 實作 | Codex |
| 2026-08-08 | `PVE_DEPTH_UI_MOCKUP_READY` | 完成 dev-only 4 場景 × 4 狀態互動 fixture、個人 Combo／Team Fever／Boss HUD、小怪入場與場景平台設計；imagegen 四 Boss 原創概念板已含 manifest／來源紀錄，production build 不含 fixture；305 tests、typecheck、production build、diff check 通過；等待使用者 UI/UX 核准，尚未授權 shared/server 實作 | Codex |
| 2026-08-08 | `PVE_DEPTH_UI_APPROVED` | 使用者回覆「繼續完成」，核准 Phase 6B 的四場景、八小怪、四 Boss、個人 Combo／共享 Team Fever、深度曲線、平台材質與原創素材方向；授權依 R-PVE-01～12 進入 shared／server／正式 client 整合 | 使用者 |
| 2026-08-08 | `PVE_DEPTH_DOMAIN_COMPLETE` | 完成 modular deterministic progression、Team Fever、seeded director、八小怪戰鬥、四 Boss encounter、技能 PvE 效果及 22 個新增測試；classic compatibility 70 tests 保持通過 | Codex |
| 2026-08-08 | `PVE_DEPTH_SERVER_COMPLETE` | 正式 downstairs 房間啟用 pve mode；沿用 input-only Socket contract 與 20Hz authoritative tick；單人／四人 Socket smoke、6,524-byte 四人 snapshot 與 tick p95／p99 效能 gate 通過 | Codex |
| 2026-08-08 | `PVE_DEPTH_CLIENT_E2E_COMPLETE` | 正式 client 接上 worldDepth、個人 Combo、共享 Team Fever、小怪、四 Boss、場景平台與合作結算；code-native SVG rig、reduced-motion、F8/F9、desktop／窄視窗 runtime fixture 稽核通過 | Codex |
| 2026-08-08 | `PVE_DEPTH_FULL_IMPLEMENTATION_COMPLETE` | R-PVE-01～12 完成；327 tests、typecheck、production build、diff check、素材稽核、Socket smoke 與效能 gate 全數通過；本機正式服務已更新 | Codex |
| 2026-08-08 | `SPRING_ARROW_RESIDUE_REMOVED` | 移除新版彈跳平台上與線圈／壓縮動畫重疊的舊版黑色 `↟` 文字符號；保留彈簧結構、材質、落地回饋與物理規則 | Codex |
| 2026-08-08 | `BOSS_ENEMY_EXPERIENCE_P0_P2_APPROVED` | 使用者核准一次完成三幕式 Boss、四套獨立反制、安全 arena、四段式小怪入場、time-to-contact director、encounter cards、Boss 專屬召喚、音效／震動／reduced-motion 與 defeat 演出；依 R-PVE-13～15 進入完整實作 | 使用者 |
| 2026-08-08 | `BOSS_ENEMY_EXPERIENCE_COMPLETE` | 完成 R-PVE-13～15：安全 time-to-contact director、五狀態入場、solo／crossfire／eliteEscort／bossSummon、三幕式四 Boss、獨立順序機關、繁中 HUD、damage cap 回饋、攻擊／stagger／defeat 音畫與 reduced-motion；333 tests、typecheck、production build 通過 | Codex |
