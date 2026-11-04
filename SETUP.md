# Sam's Homepage 設定與上線

目前的內容：
- **第 1 階段**：今日重點（可完成、延後、編輯、問 Claude）、天氣、美元匯率、Outlook 今明行程、四張領域卡片
- **第 2 階段**：
  - 需回覆信件：Outlook 收件匣裡加了旗標的信，加上最近 3 天未讀且重要性高的信。按「已回覆」只會從首頁拿掉；在 Outlook 取消旗標或標成完成，首頁也會自動拿掉。
  - 沁耘營運異常：讀和果的交班匯出檔，異常事件、出席率偏低、員工請假偏多、平日 18:00 後還沒交班，都會列進重點。沁耘卡片會自動顯示本月出席率。
  - 只讀統計數字，不讀長輩或員工的姓名。

想讓某封信出現在今日重點，在 Outlook 幫它加旗標就好。
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
| 內容安全政策（CSP）：程式只能從本站載入；只能連到微軟、天氣、匯率這幾個網址 | ✅ |
| 和果只讀數字：有 `hechotc_handover_stats.json` 就只讀它；沒有時才退回讀完整交班檔 | ⚠️ 等匯出程式產生 stats 檔 |
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

## 平常怎麼用

| 想做的事 | 怎麼做 |
|---|---|
| 新增重點 | 右下角 ＋ |
| 完成 / 已處理 | 按綠色按鈕，三台裝置同步消失 |
| 延後 | 「延後」→ 明天、後天、下週一、一週後或選日期 |
| 修改 | 點重點的標題 |
| 交給 Claude | 「問 Claude」會把內容複製起來並打開 Claude，貼上即可 |
| 改領域卡片 | 卡片右上角 ✎ |
| 改門檻（雨、溫度、匯率、提前幾天提醒） | 在 Excel 的「設定」表改 |
| 大量整理 | 頁尾「在 Excel 打開資料」直接改表格 |

在別台裝置改過，切回首頁時會自動重新讀取；也可以按右上角 ↻。

## 檔案說明

| 檔案 | 用途 |
|---|---|
| `index.html`、`styles.css`、`js/` | 首頁本體 |
| `config.js` | 登入識別碼、天氣地點、預設門檻 |
| `template/SamHomepage.xlsx` | 第一次登入時上傳到 OneDrive 的空白資料表 |
| `tools/serve.ps1` | 本機測試用伺服器 |
| `tools/make-template.ps1`、`tools/make-icons.ps1` | 重新產生 Excel 範本與圖示 |
