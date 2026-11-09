# Sam's Homepage 設定與上線

建立、上線、安裝與資安設定，以及平常怎麼用。功能與資料說明在 `docs/FEATURES.md`；排程、分工與目前進度在 OneDrive `Sam Homepage/首頁總覽.md`（交接手冊）；工作規則在 `CLAUDE.md`。

沒設定之前，首頁是**示範模式**：可以操作，但資料只存在那台裝置的瀏覽器。資料存在你 OneDrive 的 `Sam Homepage/SamHomepage.xlsx`，第一次登入時會自動建立。

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

`config.js` 裡其他設定（登入以外）：`syncTimes`（首頁顯示的同步時間，排程時間以它為準）、`holidayCalendars`（Outlook 國定假日行事曆名稱）、`inboxPath`（信箱分流檔路徑）、`mail`（信件待處理的天數與關鍵字規則）、`detailLinks`（卡片的「詳細」連結）。各項用途見 `docs/FEATURES.md`。

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
| 內容安全政策（CSP）：程式只能從本站載入；只能連到微軟、天氣（Open-Meteo，預設只送土城座標）、匯率這幾個網址 | ✅ |
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
| 新增、完成、改期待辦 | 在 Claude App 說，或直接在 TickTick 裡改 | 透過 Claude 改的：Claude 改完會順手更新同步檔，下次打開首頁就是新的。直接在 TickTick 改的：等下一次 TickTick 同步（時間見交接手冊的排程表，通常幾小時內） |
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
