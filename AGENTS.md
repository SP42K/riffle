# Riffle agent 開發規範

本檔適用於整個 repository。所有 agent 開始工作前都必須先讀本檔；若子目錄另有
`AGENTS.md`，兩者同時適用，且以較具體、較嚴格者為準。

## Codebase discovery

- 尋找程式定義、呼叫關係與影響範圍時，依序優先使用 codebase-memory-mcp 的
  `search_graph`、`trace_path`、`get_code_snippet`、`query_graph`、`get_architecture`。
- 只有搜尋字串、設定、非程式檔案，或圖譜結果不足時，才使用 `rg` / 檔案搜尋。
- 修改架構邊界前，必須在工作紀錄中列出圖譜確認過的上游、下游與 shared contract。

## SDD（Spec-Driven Development）

- 功能實作必須對應已核准 Spec 的 requirement ID 與 acceptance criteria；Spec 是範圍與行為的
  single source of truth。
- 若實作需要改變已核准的互動、規則、資料契約或範圍，先更新 Spec 的 Decision Log 並取得使用者
  核准，不得自行擴張。
- 每次交接必須同步 Spec 的狀態、完成項目、未決事項、驗證結果與已知風險；不得只在聊天訊息中留下決策。
- 避免不同 agent 同時修改同一檔案；動工前檢查 `git status`，保留其他人既有變更，不覆寫、不回退。

## 小朋友下樓梯專案階段閘門

此功能的主 Spec 為 `docs/specs/kid-downstairs-game.md`。

1. **Phase 0 — 評估與 Spec：** 只允許研究、規格、wireframe、風險與驗收條件。
2. **Phase 1 — UI/UX 原型：** 只允許 `client/` 內的展示層、client-local mock state、樣式、素材與前端測試。
   原型不得新增或修改 Socket.IO event、server handler、server engine、room persistence 或正式 shared wire contract。
3. **UI approval gate：** 必須由使用者明確確認畫面、操作、responsive、文案與動態回饋。未在 Spec 的
   Decision Log 記錄 `UI_APPROVED` 前，不得開始 Phase 2。
4. **Phase 2 — domain/contract：** UI 核准後，才可設計 `shared/` 的遊戲規則、型別與測試；規則必須是
   deterministic、可單元測試，且不依賴 React 或 Socket.IO。
5. **Phase 3 — backend integration：** shared contract 核准且測試通過後，才可修改 `server/`、Socket.IO
   events、room lifecycle 與 authoritative validation。
6. **Phase 4 — end-to-end：** 最後才把原型 mock adapter 換成正式 transport，並驗證 reconnect、觀戰、
   錯誤、多人同步與 regression。

目前狀態：`FULL_IMPLEMENTATION_COMPLETE`、`PVE_DEPTH_FULL_IMPLEMENTATION_COMPLETE`。Phase 2–6 已完成；
後續修改須維持 shared deterministic domain、server authoritative simulation、client input-only transport、
個人 Combo／共享 Team Fever 與本 Spec 的驗收條件。任何擴張仍須先更新 Spec Decision Log。

## 架構與品質底線

- UI 文案、註解與測試名稱使用繁體中文；identifier 使用英文。
- `shared` 是 client/server 共用的 raw TypeScript source，不新增獨立 build artifact。
- server 是多人遊戲結果與合法性的最終權威；client 只負責呈現、預測與操作回饋。
- 前端原型的 mock state 必須置於可替換 adapter 後方，不得讓 mock shape 假冒已定案的 wire contract。
- 每個階段至少執行與改動相稱的驗證；進入正式整合後基本 gate 為 `npm test`、`npm run typecheck`、
  `npm run build`。
