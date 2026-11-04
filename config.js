// 設定檔：Azure「App 註冊」完成後，把 clientId 和 tenantId 填進來（見 SETUP.md）。
// clientId 留空 = 示範模式：資料只存在這台裝置的瀏覽器，不會同步。
export const CONFIG = {
  clientId: '93b71207-a7c7-4637-9a03-74dbb239842c', // Entra App 註冊「Sam Homepage」
  tenantId: 'a6e5917d-c955-490b-8365-4400fdf86245', // 沁耘健康企業有限公司

  // 首頁資料在你 OneDrive 裡的位置（第一次登入會自動建立）
  filePath: 'Sam Homepage/SamHomepage.xlsx',

  // 沁耘網站與社群數字：由這台電腦上的排程每天更新（WordPress.com、Metricool）
  companyStatsPath: 'Sam Homepage/company_stats.json',
  // TickTick 待辦：Claude 改完 TickTick 會更新，每天 07:30 排程備援
  tickTickPath: 'Sam Homepage/ticktick.json',
  // 投資彙總（總資產、國泰、嘉信、變動 %）：每天 07:30 排程用 tools/invest_sync.py 更新，沒有持股明細
  investPath: 'Sam Homepage/invest.json',
  // 旅行：行程確定或改變時由 Claude 更新
  lifePath: 'Sam Homepage/life.json',

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
  mail: { importantDays: 3 },

  // 細節頁：舊的 claude.ai 儀表板之後不用了，投資、生活已經不連過去（生活改連下一趟旅行的頁面）
  detailLinks: {
    工作: 'https://claude.ai/artifact/VdqsDF6LADCfMum6mdSSDe#work',
    沁耘: 'https://claude.ai/artifact/VdqsDF6LADCfMum6mdSSDe#work',
    和果: 'https://claude.ai/artifact/VdqsDF6LADCfMum6mdSSDe#work',
  },

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
  },
};
