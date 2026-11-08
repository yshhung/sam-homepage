# Sam's Homepage 設定與上線

目前的內容：
- **第 1 階段**：今日重點（可完成、延後、編輯、問 Claude）、天氣、美元匯率、Outlook 今明行程、三張領域卡片一列排（生活、投資、工作；工作＝沁耘＋和果＋信件行程，並排顯示和果本月出席率與沁耘網站瀏覽。手機上只留大數字、重點件數與詳細，2026-11-07 改）
- **第 2 階段**：
  - 需回覆信件：Outlook 收件匣裡加了旗標的信，加上最近 3 天未讀且重要性高的信。按「已回覆」只會從首頁拿掉；在 Outlook 取消旗標或標成完成，首頁也會自動拿掉。
  - 和果日照營運異常：讀和果的交班匯出檔，異常事件、出席率偏低、員工請假偏多、還沒點名、平日 18:00 後還沒交班，都會列進重點。工作卡片會自動顯示和果本月出席率。
  - 只讀統計數字，不讀長輩或員工的姓名。

想讓某封信出現在今日重點，在 Outlook 幫它加旗標就好。

- **每日同步**（claude.ai 雲端排程「Sam 首頁：每日同步」，跑在雲端環境「Sam 首頁同步」，不用開任何電腦）：每天台北 07:30、12:30、15:30、18:30、21:30 各跑一次，工作指示都在 OneDrive `投資資料/報告指示/同步.md`（排程只負責叫它去讀這個檔，要改做法就改這個檔）。07:30 全做：TickTick（`ticktick.json`）、網站與社群（`company_stats.json`、`company_history.json`）、價格與總資產與四池與計畫書警報（`invest.json`）、天氣警報（`alerts_weather.json`）；12:30、18:30、21:30 只做 TickTick 與天氣警報；15:30（台股收盤後）另外更新價格與總資產（不重新判斷計畫書警報）。這個環境的網路只放行證交所、櫃買中心、Yahoo Finance、jsDelivr、currency-api，加上天氣警報要用的 `opendata.cwa.gov.tw`、`www.dgpa.gov.tw`；連接器接 Microsoft 365、TickTick、WordPress.com、Metricool。
- **天氣與營運警報**（2026-11-08 加，取代舊的「天氣加報」與「生活晨間」排程；規則在 `投資資料/報告指示/警報.md`）：天氣（颱風五階段、新北停班停課、氣象署特報）由每日同步五次檢查，寫 `Sam Homepage/alerts_weather.json`；營運（停水停電、空品、疫情、道路，颱風期間晚報另查明天停班停課）由早報、晚報檢查，寫 `alerts_ops.json`。首頁把兩個檔放進今日重點：紅的（risk）排最上面、黃的（warn）排在前面、ok 不顯示、過了 `until` 的不顯示，檔案超過 30 小時沒更新會提醒。只有新出現的紅色警報才推播。格式：`{updated, by, alerts:[{tag, lvl, title, text?, until?, src?, url?}]}`。舊的「天氣加報」（22:55、05:55）與「停班停課場」（20:15）排程確認新的跑通後再關閉。
- **早報、晚報、週回顧**（claude.ai 雲端排程，跑在可以連任何網站的「Sam 報告」環境）：早報每天 08:50（美股收盤、盤後、台股盤前）、晚報每天冬令 22:05／夏令 21:05（台股盤後、三大法人、美股盤前、今晚時程、Cover Call、事件行事曆，週六不跑）、週回顧每週日 03:03（本週回顧、下週行事曆、集中度）。各自更新價格與總資產（`tools/invest_sync.py`），把市場資料寫進 OneDrive `投資資料/市場/<報別>/`（`tools/report_sync.py`），並推播一則。早報、晚報另外寫 `news_<星期幾 1～7>.json`（財經＋生活新聞），每週同一天自動蓋掉舊檔，不用另外刪；也寫 `news_digest.json`（摘要，句子裡的連結只留新聞列過的網址）。摘要的類別、順序、哪些先看都由 `報告指示/早報.md`、`晚報.md` 決定，首頁程式不寫死：`news_digest` 每筆是 `{cat, text, more?, tag?}`，照出現的順序顯示（最多 8 類、類別名稱最長 8 字），同一類寫多筆就合併；`text` 一定顯示，`more` 預設收起來、點「更多」才展開，`tag` 是額外的小標籤（最長 12 字，例如「持股」「日照」）；台股／美股／總經／持股／財經用藍色、其他類別用綠色。首頁「新聞」區顯示最新一份摘要（最新那份缺的類別用 24 小時內另一份補，位置照它在那份裡的前後順序），7 天內的新聞列表收在下面，點了開原文。完整的工作指示放在 OneDrive `投資資料/報告指示/*.md`（私人，不在 GitHub），要改報告內容就改那三個檔。
- **沁耘網站與社群**：每日同步 07:30 從 WordPress.com（qinyunhealth.com）和 Metricool（hecho.daycare 的 IG、FB、Google 商家）抓數字，寫進 OneDrive 的 `Sam Homepage/company_stats.json`（本月數字）與 `company_history.json`（網站每月、社群每日的歷史，最多留 24 個月與 150 天）。首頁只讀這兩個檔，網頁裡不存任何 WordPress 或 Metricool 的權杖。
  - 工作卡片顯示沁耘網站本月瀏覽（電腦上另有訪客、文章數，以及 IG、FB 追蹤人數）。
  - 網站兩週沒有新文章、IG 或 FB 兩週沒發文、數字超過 3 天沒更新，都會列進重點。
  - **沁耘頁**（`company.html`，工作卡片的「詳細 →」；取代舊工作儀表板的網站與社群部分）：本月瀏覽、訪客、IG／FB 追蹤、網站每月瀏覽與訪客、追蹤人數與每日觸及（近 35 天）、Google 商家曝光與點擊。和果的出席、營收、交班趨勢不在首頁，以 YunCare 為主。
- **投資**：每日同步把 OneDrive `投資資料/holdings.json`（持股，只在買賣時由 Claude 修改）和 `state.json`（最新價格、最近 70 天總資產）抄到雲端暫存，執行 `tools/invest_sync.py`，用公開收盤價（都不用登入）算出總資產、國泰、嘉信、今日與本月變動，寫回 `state.json` 和 `Sam Homepage/invest.json`。抄的時候會核對檔案大小，不對就不更新。`history.json` 是 11/4 以前的舊紀錄，不再更新。首頁只讀這個彙總檔，看不到股數、代號或帳號；持股檔不在 GitHub。
  - 總資產單日或本月變動超過「投資變動門檻」（Excel「設定」表，預設 2%）、數字超過 3 天沒更新、有價格沒抓到，都會列進重點。
  - 買賣或入金出金後，在 Claude App 告訴 Claude，由「首頁投資與旅行」技能改持股檔；隔天 07:30 首頁就會更新。
- **投資計畫（四池與觸發警報，2026-11-06 投資計畫書 v1）**：投資頁「計畫」分頁最上面的「四池配置」顯示四池（大盤／信念／波段・待處理／現金）目前比例、目標與偏離，超出容許區間標黃；首頁投資卡只留一句狀態（「四池都在區間內」，或哪一池超出、幾個警報，標黃），點了打開這個分頁（2026-11-07 從首頁搬過去）。分頁裡列觸發中的警報（信念股從 52 週收盤高點 −25%、S&P 500 從 52 週收盤高點 −10%／−20%／−30%、VIX > 30、單一信念股 > 25%、現金低於底線），沒觸發就不顯示；最下面是樂透額度、美金累積、下次半年檢查、PLTR 賣出進度。警報照樣列進首頁今日重點。
  - 計算在 `tools/invest_plan.py`（`invest_sync.py` 呼叫）：規則讀 `投資資料/rules.json`（kind：pool、cap＋each、drawdown、floor、budget、playbook、fx、schedule），歸池讀 `plans.json` 的 `pool`。
  - 07:30 每日同步帶 `--alerts` 重新判斷警報（另抓 S&P 500、VIX 與信念股一年的日收盤，52 週高點用收盤高點）；早報帶 `--alerts-if-stale`，只在同步當天沒判斷過時補判斷；晚報沿用。沒有新收盤（休市日）就不重算。
  - 第一次觸發或升級到下一級的警報標 `new`，早報把它們併入推播；之後首頁持續顯示、不再推播，條件解除自動消失。
- **家屬提醒**（2026-11-09 加，規則在 `投資資料/報告指示/警報.md` 的「家屬提醒」）：每日同步用土城區預報加特報，判斷明天（或今天）會不會偏冷、溫差大、下雨、高溫、風大（日照有開的週一到週五），寫進 `alerts_weather.json` 的 `tag:"家屬提醒"` 項目，附一段給家屬的訊息草稿（`family`，洋蔥式穿法等）。首頁在今日狀態下面列出草稿，按「複製訊息」或「用 LINE 傳」交給護理師群發；新出現時推播一則「🧥 提醒家屬」。
- **投資頁**（`invest.html`，投資卡片的「詳細 →」）：原本 claude.ai「Sam的投資儀表板」整頁搬過來，分頁有總覽（總資產、目標進度、資產趨勢、配置、產業與集中度）、市場、持股、計畫、行事曆、交易紀錄。登入後直接讀 OneDrive「投資資料」（只讀），網頁裡沒有任何數字或代號；補進度標的、定期定額金額等私人設定放在 `投資資料/page_config.json`。圖表用本站的 `vendor/d3-7.9.0.min.js`（npm 官方 d3@7.9.0，已核對 sha512）。
- **生活**：大數字是距離下一趟旅行的天數（`Sam Homepage/life.json`，行程確定或改變時由 Claude 更新；還在規劃中的旅行 3 週內會提醒還沒確定）。說明列出 TickTick「🏠我的家庭」「🏃我的生活」「📦生活瑣事」近 7 天的扣款、帳單與下一件事，直接用 ticktick.json，沒有另外一份資料。

資料存在你 OneDrive 的 `Sam Homepage/SamHomepage.xlsx`，第一次登入時會自動建立。

沒設定之前，首頁是**示範模式**：可以操作，但資料只存在那台裝置的瀏覽器。

---

## 步驟一：建立 Microsoft「App 註冊」（約 10 分鐘，只做一次）

1. 用你的公司帳號（裕勝）登入 <https://entra.microsoft.com>
2. 左側選單：**應用程式** → **應用程式註冊** → 上方 **＋ 新增註冊**
3. 填寫：
   - 名稱：`Sam Homepage`
   - 支援的帳戶類型：**僅此組織目錄中的帳戶（單一租用戶）**
   - 重新導向 URI：平台選 **單頁應用程式 (SPA)**，網址填 `http://localhost:5173/`
   - 按 **註冊**
4. 註冊完成的頁面上，複製這兩個值：
   - **應用程式 (用戶端) 識別碼**
   - **目錄 (租用戶) 識別碼**
5. 左側 **API 權限** → **＋ 新增權限** → **Microsoft Graph** → **委派的權限**，勾選：
   - `Files.ReadWrite`：讀寫你自己 OneDrive 裡的首頁資料
   - `Files.Read.All`：讀和果 SharePoint「土城和果儀表板資料」裡的出勤與交班匯出檔
   - `Calendars.Read`：讀你的 Outlook 行事曆
   - `Mail.Read`：只讀需回覆的信（不能改、不能刪、不能寄）
   - （`User.Read` 預設已經有）
   - 按 **新增權限**，再按 **代表 沁耘健康企業有限公司 授與管理員同意** → 是

## 步驟二：把識別碼填進 `config.js`

```js
clientId: '貼上「應用程式 (用戶端) 識別碼」',
tenantId: '貼上「目錄 (租用戶) 識別碼」',
```

## 步驟三：在辦公室電腦測試

在 PowerShell 執行（或請 Claude 幫你開）：

```
powershell -ExecutionPolicy Bypass -File tools/serve.ps1
```

打開 <http://localhost:5173/> → 右上角 **登入** → 選裕勝的帳號。
登入後狀態會變成綠燈「已同步」，OneDrive 裡會多一個 `Sam Homepage` 資料夾。

## 步驟四：上線（已完成）

- 正式網址：<https://yshhung.github.io/sam-homepage/>
- 程式放在 GitHub：<https://github.com/yshhung/sam-homepage>（公開，GitHub Pages 自動發佈）
- Entra 的重新導向 URI 已加上 `https://yshhung.github.io/sam-homepage/`

之後改了程式，commit 並 push 到 `main`，大約一分鐘後網站就會更新。

> 網站上只有程式，沒有你的資料。資料都在你的 OneDrive，要用沁耘帳號登入才讀得到。

## 步驟五：裝到各裝置

- **iPhone 15**：用 Safari 打開網址 → 下方分享鈕 → **加入主畫面**。之後從主畫面圖示打開，像 App 一樣全螢幕。
- **MacBook Air**：Safari 選單 **檔案 → 加入 Dock**；或 Chrome 網址列右邊的「安裝」圖示。
- **Windows 桌機**：Edge 或 Chrome 網址列右邊的「安裝」圖示。

三台都用裕勝的帳號登入一次，之後會記住。

---

## 資安設定（2026-11-04 已完成）

| 防線 | 狀態 |
|---|---|
| 只有你能用：Entra 企業應用程式「Sam Homepage」→ 屬性 →「需要指派」= 是，只指派裕勝 | ✅ |
| 權限最小化：信件只用 `Mail.Read`（首頁不能改、不能刪信），已撤銷 `Mail.ReadWrite` | ✅ |
| 登入程式放在本站：`vendor/msal-browser-3.28.1.min.js`，已比對與 npm 官方套件 `@azure/msal-browser@3.28.1` 完全相同 | ✅ |
| 農民曆程式放在本站：`vendor/lunar-javascript-1.7.7.js`（MIT，授權見 `vendor/lunar-javascript-LICENSE.txt`），是 npm 官方 `lunar-javascript@1.7.7` 套件裡的 `lunar.js`，套件 sha512 與 npm 登記的一致；離線計算，不連外網 | ✅ |
| 內容安全政策（CSP）：程式只能從本站載入；只能連到微軟、天氣、地名（BigDataCloud、OpenStreetMap，只送座標到小數 2 位）、匯率這幾個網址 | ✅ |
| 和果只讀數字：只讀 `hechotc_handover_stats.json`，完整交班檔（有照護紀錄）一律不下載 | ✅ 2026-11-04 |
| GitHub 兩步驟驗證 | ⚠️ 請自己確認（見下方） |

**確認 GitHub 兩步驟驗證**：登入 GitHub → 右上角頭像 → Settings → **Password and authentication**，「Two-factor authentication」要顯示 Enabled。沒有的話按 **Enable two-factor authentication**，用 Microsoft Authenticator 或 Google Authenticator 掃 QR code，並把復原碼存好。

**手機或筆電遺失時**：
1. 用電腦登入 <https://entra.microsoft.com> → **使用者** → 點你自己 → 上方 **撤銷工作階段**。所有裝置上的首頁、Outlook、Teams 都會被登出。
2. 接著改你的 M365 密碼。
3. iPhone 用「尋找」App 鎖定或清除裝置。

平常請確認 iPhone 有設 Face ID 和密碼、MacBook 有設登入密碼。首頁會一直保持登入，裝置本身的鎖就是第一道防線。

**`hechotc_handover_stats.json` 的格式**（給匯出程式用）：

```json
{ "exported": "2026-11-04 13:30",
  "rows": [ { "date": "2026-11-03", "expected": 38, "present": 35, "clientLeave": 3,
              "staffOn": 8, "staffLeave": 0, "incidents": 0 } ] }
```

放在和果文件庫的 `常備資料區/土城和果儀表板資料/`，跟現在的交班檔同一個資料夾。只能放數字，不能有姓名。

## 平常怎麼用（首頁只負責看）

首頁不能新增、修改或完成任何東西，權限也只有「讀」。事情都在原本的地方處理：

| 想做的事 | 在哪裡做 | 首頁什麼時候更新 |
|---|---|---|
| 新增、完成、改期待辦 | 在 Claude App 說，或直接在 TickTick 裡改 | 透過 Claude 改的：Claude 改完會順手更新同步檔，下次打開首頁就是新的。直接在 TickTick 改的：雲端排程每天 07:30、12:00、15:00、18:00、21:00 前後同步，最慢約 3 小時（晚上 21:00 之後的等隔天 07:30） |
| 排行程 | Claude App 或 Outlook | 下次打開首頁 |
| 信件不要再出現 | 在 Outlook 取消旗標或標成完成 | 下次打開首頁 |
| 處理某件事 | 首頁上按「問 Claude」，會複製內容並打開 Claude | — |
| 改卡片說明、門檻 | 頁尾「在 Excel 改卡片與門檻」 | 下次打開首頁 |

提醒類（和果、天氣、匯率、社群）沒有「完成」按鈕：情況解除了就會自動消失。

**同步檔**（都在 OneDrive 的 Sam Homepage 資料夾，首頁只讀；每個檔由哪個排程寫，見上面各項）：
- ticktick.json：TickTick 逾期與 7 天內到期的待辦，只有標題、清單、日期時間、優先順序，不含備註
- company_stats.json、company_history.json：沁耘網站與社群的本月數字與歷史
- alerts_weather.json、alerts_ops.json：天氣與營運警報（只有標題、一句提醒、來源連結）
- invest.json：投資彙總（總資產、國泰、嘉信、變動 %），沒有持股明細
- life.json：旅行（名稱、日期、地點、確定或規劃中、一句提醒）
- SamHomepage.xlsx：卡片說明與門檻

**「待辦行程分流」技能**要上傳新版才會在改完 TickTick 後同步首頁：claude.ai → 設定 → Capabilities（功能）→ Skills → 找到 task-schedule-router → 上傳新版 zip。
## 檔案說明

| 檔案 | 用途 |
|---|---|
| `index.html`、`styles.css`、`js/` | 首頁本體 |
| `config.js` | 登入識別碼、天氣地點、預設門檻 |
| `template/SamHomepage.xlsx` | 第一次登入時上傳到 OneDrive 的空白資料表 |
| `tools/serve.ps1` | 本機測試用伺服器 |
| `tools/make-template.ps1`、`tools/make-icons.ps1` | 重新產生 Excel 範本與圖示 |
| `company.html`、`company.css`、`js/company.js`、`js/company-data.js` | 沁耘頁（網站與社群趨勢）；`company-data.js` 是純資料整理，`tests/parse-test.html` 測它 |
| `invest.html`、`invest.css`、`js/invest/` | 投資頁；`js/invest/page*.js` 是舊儀表板的頁面程式，`shim.js`、`load.js`、`data.js` 負責從 OneDrive 讀資料 |
| `tools/invest_plan.py` | 投資計畫書的四池、觸發警報與小計（`invest_sync.py --selftest` 一起測） |
| `tools/report_sync.py` | 把早報、晚報、週回顧整理的資料轉成投資頁「市場」分頁與首頁「新聞」區的檔（`--selftest` 跑測試） |
| `tools/invest_sync.py` | 每天更新投資彙總（`--selftest` 只跑計算測試，`--dry-run` 只印結果不寫檔） |
