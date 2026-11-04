# Sam's Homepage 設定與上線

目前的內容：
- **第 1 階段**：今日重點（可完成、延後、編輯、問 Claude）、天氣、美元匯率、Outlook 今明行程、四張領域卡片
- **第 2 階段**：
  - 需回覆信件：Outlook 收件匣裡加了旗標的信，加上最近 3 天未讀且重要性高的信。按「已回覆」會在 Outlook 把旗標標成完成。
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
   - `Mail.ReadWrite`：讀需回覆的信；按「已回覆」時把 Outlook 旗標標成完成（不會寄信、不會刪信）
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
