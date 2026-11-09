# Sam's Homepage：分工與工作方式

每個在這個程式庫工作的對話都會讀到這份。只寫分工和規則，不放任何持股、金額、帳號等私人資料（這個程式庫是公開的）。

## 分工：一條主線＋四個分支
- **主線**（對話「Sam 個人首頁｜主線開發」）：首頁整體架構、共用規則、排程、OneDrive 的 `Sam Homepage/首頁總覽.md`。跨領域的事、不確定歸誰的事，先到主線。
- **分支**（主線底下的子對話，各有標籤 `sam-homepage:<領域>`），各自只改自己範圍：
  - 投資：首頁「投資計畫」區、投資頁、`tools/invest_sync.py`、`tools/invest_plan.py`，OneDrive `投資資料/` 的計畫、規則、持股、選擇權與 `報告指示/`（早報、晚報、週回顧、同步）
  - 生活：旅行倒數（`life.json`）、TickTick 生活清單、天氣、農民曆
  - 和果與沁耘：和果交班統計與出席率（只用數字，不含姓名）、沁耘網站與社群數字
  - 新聞區：早晚報新聞與摘要（`tools/report_sync.py`）
  - 信箱：由主線維護（跨工作與私人兩個信箱，不屬單一領域）。排程「信箱分流」每天 00:10 與 12:10 掃描工作 Outlook 與私人 Gmail，寫 OneDrive `Sam Homepage/inbox.json`；規則與階段寫在 `投資資料/報告指示/信箱分流.md`（階段由 Sam 決定，排程自己不可升級）；首頁「待處理」讀 inbox.json（`js/app.js` 的 `inboxEntries`）。
- 分支做完一件事，更新 OneDrive `Sam Homepage/首頁總覽.md` 的「各分支目前狀態」，主線看這份就知道全局。

## 共用規則
- 首頁只負責「看」：資料都在 Sam 的 OneDrive（沁耘帳號，用 Microsoft 365 連接器讀寫）；網頁裡不放任何持股、金額、權杖。
- 改計畫、規則、指示一律**直接寫回 OneDrive**，不要只在對話裡回報。
- 排程的完整指示放在 OneDrive `投資資料/報告指示/*.md`（Sam 維護），排程提示詞只叫它去讀那個檔；要改排程內容就改檔，不用改排程。排程本身（claude.ai/code/routines）是 Sam 建立的，Claude 改不了，需要改時給 Sam 文字讓他貼。
- 改寫 OneDrive `報告指示/*.md` 一律先讀舊檔，改完比對長度：新檔不得比舊檔短 30% 以上（除非指示裡說明為何刪減）。2026-11-09 週回顧.md 曾被覆寫成只剩「placeholder」。
- 同步排程的時間以 `config.js` 的 `syncTimes` 為準，文件與提示文字都從它來，不要另外寫死。
- 程式改動要附自我測試（`python3 tools/invest_sync.py --selftest`），改完推到 `main`（GitHub Pages 約一分鐘上線），並遞增 `sw.js` 的 `VERSION`。
- 繁體中文回覆；不給買賣建議；漲跌用「漲／跌」，不用顏色說法。
