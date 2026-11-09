# Sam's Homepage 功能與資料說明

各功能怎麼運作、資料檔格式與欄位。排程時間與分工請看 OneDrive `Sam Homepage/首頁總覽.md`（交接手冊）；建立、上線與資安設定請看 `SETUP.md`；工作規則請看 `CLAUDE.md`。這份只放功能與資料細節，不放時間表。
目前的內容：
- **首頁**：待處理（只放要決定或動手的事，可按領域篩選；可完成、延後、編輯、問 Claude）、天氣、美元匯率、Outlook 今明行程，以及三張領域卡片一列排（生活、投資、工作；工作＝沁耘＋和果＋信件行程，並排顯示和果本月出席率與沁耘網站瀏覽。手機上只留大數字、重點件數與詳細）。
- **待處理裡的信件**：Outlook 收件匣裡加了旗標的信、最近 3 天未讀且重要性高的信，以及信箱分流排程寫的 `inbox.json`（見最下面「信箱分流」）。按「已回覆」只會從首頁拿掉；在 Outlook 取消旗標或標成完成，首頁也會自動拿掉。想讓某封信出現在待處理，在 Outlook 幫它加旗標就好。
- **和果日照營運異常**：讀和果的交班匯出檔，異常事件、出席率偏低、員工請假偏多、還沒點名、平日 18:00 後還沒交班（國定假日不提醒，見 `config.js` 的 `holidayCalendars`），都會列進重點。工作卡片會自動顯示和果本月出席率。只讀統計數字，不讀長輩或員工的姓名。
- **每日同步**（claude.ai 雲端排程「Sam 首頁：每日同步」，跑在雲端環境「Sam 首頁同步」，不用開任何電腦）：排程時間、模型、各時段做什麼，唯一一份在 OneDrive `Sam Homepage/首頁總覽.md` 的排程表（首頁顯示用的時間以 `config.js` 的 `syncTimes` 為準）；工作指示都在 OneDrive `投資資料/報告指示/同步.md`（排程只負責叫它去讀這個檔，要改做法就改這個檔）。全做的那次：TickTick（`ticktick.json`）、網站與社群（`company_stats.json`、`company_history.json`）、價格與總資產與四池與計畫書警報（`invest.json`）、天氣警報（`alerts_weather.json`）；其他時段只做其中一部分（TickTick 與天氣警報，或只更新價格與總資產），分工看排程表與 `同步.md`。這個環境的網路只放行證交所、櫃買中心、Yahoo Finance、jsDelivr、currency-api，加上天氣警報要用的 `opendata.cwa.gov.tw`、`www.dgpa.gov.tw`；連接器接 Microsoft 365、TickTick、WordPress.com、Metricool。
- **天氣與營運警報**（2026-11-08 加，取代舊的「天氣加報」與「生活晨間」排程；規則在 `投資資料/報告指示/警報.md`）：天氣（颱風五階段、新北停班停課、氣象署特報）由每日同步檢查（時間見交接手冊排程表），寫 `Sam Homepage/alerts_weather.json`；營運（停水停電、空品、疫情、道路，颱風期間晚報另查明天停班停課）由早報、晚報檢查，寫 `alerts_ops.json`。首頁把兩個檔放進今日重點：紅的（risk）排最上面、黃的（warn）排在前面、ok 不顯示、過了 `until` 的不顯示，檔案超過 30 小時沒更新會提醒。只有新出現的紅色警報才推播。格式：`{updated, by, alerts:[{tag, lvl, title, text?, until?, src?, url?}]}`。
- **早報、晚報、週回顧**（claude.ai 雲端排程，跑在可以連任何網站的「Sam 報告」環境）：早報（美股收盤、盤後、台股盤前）、晚報（台股盤後、三大法人、美股盤前、今晚時程、Cover Call、事件行事曆，週六不跑）、週回顧（本週回顧、下週行事曆、集中度）；時間見排程表。各自更新價格與總資產（`tools/invest_sync.py`），把市場資料寫進 OneDrive `投資資料/市場/<報別>/`（`tools/report_sync.py`），並推播一則。早報、晚報另外寫 `news_<星期幾 1～7>.json`（財經＋生活新聞），每週同一天自動蓋掉舊檔，不用另外刪；也寫 `news_digest.json`（摘要，句子裡的連結只留新聞列過的網址）。摘要的類別、順序、哪些先看都由 `報告指示/早報.md`、`晚報.md` 決定，首頁程式不寫死：`news_digest` 每筆是 `{cat, text, more?, tag?}`，照出現的順序顯示（最多 8 類、類別名稱最長 8 字），同一類寫多筆就合併；`text` 一定顯示，`more` 預設收起來、點「更多」才展開，`tag` 是額外的小標籤（最長 12 字，例如「持股」「日照」）；台股／美股／總經／持股／財經用藍色、其他類別用綠色。首頁「新聞」區顯示最新一份摘要（最新那份缺的類別用 24 小時內另一份補，位置照它在那份裡的前後順序），7 天內的新聞列表收在下面，點了開原文。完整的工作指示放在 OneDrive `投資資料/報告指示/*.md`（私人，不在 GitHub），要改報告內容就改那三個檔。
- **沁耘網站與社群**：每日同步的全做那次從 WordPress.com（qinyunhealth.com）和 Metricool（hecho.daycare 的 IG、FB、Google 商家）抓數字，寫進 OneDrive 的 `Sam Homepage/company_stats.json`（本月數字）與 `company_history.json`（網站每月、社群每日的歷史，最多留 24 個月與 150 天）。首頁只讀這兩個檔，網頁裡不存任何 WordPress 或 Metricool 的權杖。
  - 工作卡片顯示沁耘網站本月瀏覽（電腦上另有訪客、文章數，以及 IG、FB 追蹤人數）。
  - 網站兩週沒有新文章、IG 或 FB 兩週沒發文、數字超過 3 天沒更新，都會列進重點。
  - **沁耘頁**（`company.html`，工作卡片的「詳細 →」；取代舊工作儀表板的網站與社群部分）：本月瀏覽、訪客、IG／FB 追蹤、網站每月瀏覽與訪客、追蹤人數與每日觸及（近 35 天）、Google 商家曝光與點擊。和果的出席、營收、交班趨勢不在首頁，以 YunCare 為主。
- **投資**：每日同步把 OneDrive `投資資料/holdings.json`（持股，只在買賣時由 Claude 修改）和 `state.json`（最新價格、最近 70 天總資產）抄到雲端暫存，執行 `tools/invest_sync.py`，用公開收盤價（都不用登入）算出總資產、國泰、嘉信、今日與本月變動，寫回 `state.json` 和 `Sam Homepage/invest.json`。抄的時候會核對檔案大小，不對就不更新。首頁只讀這個彙總檔，不含股數、金額或帳號（投資計畫書警報的標題會有代號）；持股檔不在 GitHub。
  - 總資產單日或本月變動超過「投資變動門檻」（Excel「設定」表，預設 2%）、數字超過 3 天沒更新、有價格沒抓到，都會列進重點。
  - 買賣或入金出金後，在 Claude App 告訴 Claude，由「首頁投資與旅行」技能改持股檔；下一次全做的同步後首頁就會更新。
- **投資計畫（四池與觸發警報，2026-11-06 投資計畫書 v1）**：投資頁「計畫」分頁最上面的「四池配置」顯示四池（大盤／信念／波段・待處理／現金）目前比例、目標與偏離，超出容許區間標黃；首頁投資卡只留一句狀態（「四池都在區間內」，或哪一池超出、幾個警報，標黃），點了打開這個分頁（2026-11-07 從首頁搬過去）。分頁裡列觸發中的警報（信念股從 52 週收盤高點 −25%、S&P 500 從 52 週收盤高點 −10%／−20%／−30%、VIX > 30、單一信念股 > 25%、現金低於底線），沒觸發就不顯示；最下面是樂透額度、美金累積、下次半年檢查、PLTR 賣出進度。警報照樣列進首頁今日重點。
  - 計算在 `tools/invest_plan.py`（`invest_sync.py` 呼叫）：規則讀 `投資資料/rules.json`（kind：pool、cap＋each、drawdown、floor、budget、playbook、fx、schedule），歸池讀 `plans.json` 的 `pool`。
  - 07:30 每日同步帶 `--alerts` 重新判斷警報（另抓 S&P 500、VIX 與信念股一年的日收盤，52 週高點用收盤高點）；早報帶 `--alerts-if-stale`，只在同步當天沒判斷過時補判斷；晚報沿用。沒有新收盤（休市日）就不重算。
  - 第一次觸發或升級到下一級的警報標 `new`，早報把它們併入推播；之後首頁持續顯示、不再推播，條件解除自動消失。
  - **已知悉（ack）**：`plans.json` 每檔可加 `ack:{"cap"或"dd":"YYYY-MM-DD","note":"…"}`。被 ack 的警報在投資頁「計畫」分頁灰色列出，首頁待處理與投資卡的警報數不算它；條件消失再出現（觸發起算日晚於 ack 日）或級別升高，ack 自動失效。回撤警報有遲滯：−25% 觸發、回到 `release`（預設 −20%）以內才解除。
  - **四池過渡目標**：`pool_*` 規則可加 `interim:{until,max,min}`，期限內在過渡範圍內就不標超出區間（卡片副標寫「過渡目標」）；單一信念股上限依 `plans.json` 裡 `pool` 為 conviction 的全部（規則的 `pool` 欄），`example_codes` 只是備註。`invest.json` 的 `plan.highs` 記信念股 52 週收盤高點與日期（已忽略單日尖刺，台股另用證交所核對），`plan.evaluatedBy` 記是同步或早報判斷的。
- **天氣地點**（2026-11-09 改）：首頁天氣預設固定用 `config.js` 的土城，不呼叫瀏覽器定位，座標也不會送到任何地名服務。出國想看當地天氣時，在 Excel「設定」表新增一列「用目前位置」、值寫「是」，才會用這台裝置的定位；地名只用 `js/sources.js` 內建的台灣地名表（`nearestPlace`），台灣以外顯示座標。改回「否」或刪掉那列就恢復土城。
- **家屬提醒**（2026-11-09 加；規則在 `投資資料/報告指示/警報.md` 的「家屬提醒」）：每日同步用土城區預報加特報，判斷明天（或今天）會不會偏冷、溫差大、高溫（日照有開的週一到週五），寫進 `alerts_weather.json` 的 `tag:"家屬提醒"` 項目，只寫日期、溫度與「請護理師提醒家屬」，內容由護理師決定。首頁在今日狀態下面列出，新出現時推播一則「🧥 提醒家屬」。
- **日期卡與月曆頁**（2026-11-09 改）：首頁最上面只放今天的日期、星期、農曆、節氣與宜忌（農民曆離線計算）；整個月的月曆搬到 `calendar.html`（日期卡右邊的「月曆 ›」），可以切月份、點一天看那天的農曆宜忌與 Outlook 行程（只讀）。
- **投資頁**（`invest.html`，投資卡片的「詳細 →」）：原本 claude.ai「Sam的投資儀表板」整頁搬過來，分頁有總覽（總資產、目標進度、資產趨勢、配置、產業與集中度）、市場、持股、計畫、行事曆、交易紀錄。登入後直接讀 OneDrive「投資資料」（只讀），網頁裡沒有任何數字或代號；補進度標的、定期定額金額等私人設定放在 `投資資料/page_config.json`。圖表用本站的 `vendor/d3-7.9.0.min.js`（npm 官方 d3@7.9.0，已核對 sha512）。
- **生活**：大數字是距離下一趟旅行的天數（`Sam Homepage/life.json`，行程確定或改變時由 Claude 更新；還在規劃中的旅行 3 週內會提醒還沒確定）。說明列出 TickTick「🏠我的家庭」「🏃我的生活」「📦生活瑣事」近 7 天的扣款、帳單與下一件事，直接用 ticktick.json，沒有另外一份資料。

資料存在你 OneDrive 的 `Sam Homepage/SamHomepage.xlsx`，第一次登入時會自動建立。

沒設定之前，首頁是**示範模式**：可以操作，但資料只存在那台裝置的瀏覽器。

## 檔案說明

| 檔案 | 用途 |
|---|---|
| `index.html`、`styles.css`、`js/` | 首頁本體 |
| `config.js` | 登入識別碼、天氣地點、預設門檻 |
| `template/SamHomepage.xlsx` | 第一次登入時上傳到 OneDrive 的空白資料表 |
| `tools/serve.ps1` | 本機測試用伺服器 |
| `tools/make-template.ps1`、`tools/make-icons.ps1` | 重新產生 Excel 範本與圖示 |
| `calendar.html`、`calendar.css`、`js/calendar.js` | 月曆頁（整個月、點一天看農曆宜忌與行程） |
| `company.html`、`company.css`、`js/company.js`、`js/company-data.js` | 沁耘頁（網站與社群趨勢）；`company-data.js` 是純資料整理，`tests/parse-test.html` 測它 |
| `invest.html`、`invest.css`、`js/invest/` | 投資頁；`js/invest/page*.js` 是舊儀表板的頁面程式，`shim.js`、`load.js`、`data.js` 負責從 OneDrive 讀資料 |
| `tools/invest_plan.py` | 投資計畫書的四池、觸發警報與小計（`invest_sync.py --selftest` 一起測） |
| `tools/report_sync.py` | 把早報、晚報、週回顧整理的資料轉成投資頁「市場」分頁與首頁「新聞」區的檔（`--selftest` 跑測試） |
| `tools/invest_sync.py` | 每天更新投資彙總（`--selftest` 只跑計算測試，`--dry-run` 只印結果不寫檔） |

- **和果頁**（`hecho.html`，2026-11-08 加）：首頁工作卡的「詳細」打開。讀和果群組 `常備資料區/土城和果儀表板資料` 裡 YunCare 匯出的 `hechotc_ops_monthly.csv`（每月出席率、服務個案數、新收與未再服務、年齡層、男女、平均年齡）和 `hechotc_handover_stats.json`（每天應到、實到、請假、異常）。只有人數，沒有姓名、案號、金額；沒登入時顯示示範數字。YunCare 是桌面程式，沒有網址可連，細節請在電腦看。沁耘頁與和果頁互相有連結。圖表程式共用 `js/charts.js`。

- **生活頁**（`life.html`，2026-11-08 加）：首頁生活卡的「詳細」打開。上面四格（去過幾個國家／地區、幾個地點、下一趟倒數、生活待辦），下面是世界地圖（去過的國家上色、地點標黃點）、依國家分組的地點、下一趟旅行、生活待辦（TickTick 的「我的家庭、我的生活、生活瑣事」）。足跡存在 OneDrive `Sam Homepage/travels.json`：`{updated, home:{lat,lon}, places:[{name, country, iso, lat, lon, year?}]}`，`iso` 是國家的數字代碼（地圖用它上色，香港、新加坡輪廓太小或沒有，留空，只標點）。新增去過的地方請告訴 Claude 更新這個檔。世界地圖輪廓是 `vendor/world-110m.json`（npm 套件 world-atlas@2.0.2 的 countries-110m，轉成 GeoJSON、去掉南極）。家庭帳本等 LINE 機器人的資料存放位置定了再加。

## 信箱分流（inbox.json）
排程「信箱分流」每天 00:10 與 12:10 掃描工作 Outlook 與私人 Gmail 最近 7 天，寫 `Sam Homepage/inbox.json`（只有件數、分類、標題、寄件單位、期限、信件連結，不含金額、帳號、內文）。首頁「待處理」讀它，列出需行動／需你決定／需回覆的信與 1HR 待簽核件數；分流檔正常時，首頁就不再用關鍵字規則（`config.js mail.actionRules`）重複列信，檔案不存在或出錯時才退回關鍵字規則。規則與階段寫在 OneDrive `投資資料/報告指示/信箱分流.md`。
