// 設定檔：Azure「App 註冊」完成後，把 clientId 和 tenantId 填進來（見 SETUP.md）。
// clientId 留空 = 示範模式：資料只存在這台裝置的瀏覽器，不會同步。
export const CONFIG = {
  clientId: '93b71207-a7c7-4637-9a03-74dbb239842c', // Entra App 註冊「Sam Homepage」
  tenantId: 'a6e5917d-c955-490b-8365-4400fdf86245', // 沁耘健康企業有限公司

  // 首頁資料在你 OneDrive 裡的位置（第一次登入會自動建立）
  filePath: 'Sam Homepage/SamHomepage.xlsx',

  // 雲端「每日同步」排程的台北時間（05:30 只查天氣；07:30 全做；15:30 另更新價格與總資產；其餘只同步 TickTick 與天氣）。
  // 首頁的提示文字從這裡組；排程、SETUP.md 以這裡為準，改時間只改這一行與排程本身
  syncTimes: ['05:30', '07:30', '12:30', '15:30', '18:30', '21:30'],

  // 沁耘網站與社群數字：由這台電腦上的排程每天更新（WordPress.com、Metricool）
  companyStatsPath: 'Sam Homepage/company_stats.json',
  // TickTick 待辦：Claude 改完 TickTick 會更新；雲端排程每天 syncTimes 的時間也會同步
  tickTickPath: 'Sam Homepage/ticktick.json',
  // 信箱分流排程（每天 12:10）寫的檔：只有件數、分類、標題、單位、期限、連結
  inboxPath: 'Sam Homepage/inbox.json',
  // 成交提醒（Haiku 同步）寫的檔：國泰、嘉信有新成交但還沒記進持股的清單
  pendingTradesPath: 'Sam Homepage/pending_trades.json',
  // 沁耘網站與社群的歷史：每日同步（07:30）更新；沁耘頁（company.html）畫每月瀏覽、追蹤人數、每日觸及與 Google 商家
  companyHistoryPath: 'Sam Homepage/company_history.json',
  // 投資彙總（總資產、國泰、嘉信、變動 %）：每天 07:30 排程用 tools/invest_sync.py 更新，沒有持股明細
  investPath: 'Sam Homepage/invest.json',
  // 天氣與營運警報：每日同步（syncTimes 的每一次）寫第一個（颱風、停班停課、氣象署特報），
  // 早報與晚報寫第二個（停水停電、空品、疫情、道路）；各寫各的檔，首頁兩個都讀
  alertsPaths: ['Sam Homepage/alerts_weather.json', 'Sam Homepage/alerts_ops.json'],
  // 國定假日：Outlook 裡加一個「台灣假日」行事曆；今天在這些行事曆有整天事件就是假日（和果交班不提醒）。名稱對不到就當沒有假日
  holidayCalendars: ['台灣假日', 'Taiwan holidays', 'Taiwan Holidays'],
  // 旅行：行程確定或改變時由 Claude 更新
  lifePath: 'Sam Homepage/life.json',
  // 足跡：去過的地方（生活頁的世界地圖），由 Claude 依你說的更新
  travelsPath: 'Sam Homepage/travels.json',

  weather: { name: '土城', lat: 24.972, lon: 121.443 },

  // 和果 SharePoint 文件庫裡，給儀表板用的匯出檔（只有統計數字）
  hecho: {
    driveId: 'b!iy8NYPx4nkWI33c7_lYNd8jcKoBcm7hLoH4GwoDICICbAze9A_SyQq9R9QKXzhNY',
    folder: '常備資料區/土城和果儀表板資料',
    // 只有數字的交班統計：[{date, expected, present, clientLeave, staffOn, staffLeave, incidents}]
    stats: 'hechotc_handover_stats.json',
    monthly: 'hechotc_ops_monthly.csv',
  },

  // 需回覆信件：收件匣裡「已加旗標」的信，加上最近幾天「未讀且重要性高」的信
  mail: {
    importantDays: 3,
    // 另外把最近幾天「未讀」且符合下列任一規則的信也放進待處理（比對主旨與寄件地址；多半是系統通知，需要你去按一下的那種）
    actionDays: 3,
    actionRules: ['待簽核', '尚未進行每週通報', 'wants to access', '存取要求', '簽核逾期'],
  },

  // 細節頁：舊的 claude.ai 儀表板之後不用了。投資連到首頁自己的投資頁；生活連下一趟旅行的頁面
  detailLinks: {
    投資: 'invest.html',
    工作: 'hecho.html',
    生活: 'life.html',
  },

  // 工作卡與工作子頁的分頁：沁耘、土城和果各一頁
  workPages: [['沁耘', 'company.html'], ['土城和果', 'hecho.html']],

  // 預設門檻（可在 Excel「設定」表裡改）
  defaults: {
    雨機率門檻: 60,
    高溫門檻: 34,
    低溫門檻: 12,
    匯率變動門檻: 0.5, // %
    提前提醒天數: 3,
    出席率門檻: 85, // %
    員工請假門檻: 2, // 人
    投資變動門檻: 2, // %，總資產單日或本月
    用目前位置: 0, // 1＝天氣用這台裝置的定位（Excel 設定表寫「是」）；0＝固定用上面的土城
  },
};
