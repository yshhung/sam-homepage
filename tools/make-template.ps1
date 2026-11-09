# 用本機 Excel 產生 template/SamHomepage.xlsx（首頁第一次登入時會上傳到 OneDrive）
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'template\SamHomepage.xlsx'
New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
if (Test-Path $out) { Remove-Item $out -Force }

$xl = New-Object -ComObject Excel.Application
$xl.DisplayAlerts = $false
$wb = $xl.Workbooks.Add()
while ($wb.Worksheets.Count -lt 4) { $wb.Worksheets.Add([Type]::Missing, $wb.Worksheets.Item($wb.Worksheets.Count)) | Out-Null }

function Add-Table($ws, $name, $headers, $rows) {
  $ws.Cells.NumberFormat = '@'   # 全部存文字，日期才不會被 Excel 自動轉格式
  for ($c = 0; $c -lt $headers.Count; $c++) { $ws.Cells.Item(1, $c + 1).Value2 = $headers[$c] }
  $r = 2
  foreach ($row in $rows) { for ($c = 0; $c -lt $row.Count; $c++) { $ws.Cells.Item($r, $c + 1).Value2 = [string]$row[$c] }; $r++ }
  $last = [Math]::Max($r - 1, 2)
  $range = $ws.Range($ws.Cells.Item(1, 1), $ws.Cells.Item($last, $headers.Count))
  $lo = $ws.ListObjects.Add(1, $range, $null, 1)
  $lo.Name = $name
  $lo.TableStyle = 'TableStyleMedium2'
  if ($rows.Count -eq 0) { $lo.ListRows.Item(1).Delete() }
  $ws.Columns.AutoFit() | Out-Null
}

$ws = $wb.Worksheets.Item(1); $ws.Name = '重點'
Add-Table $ws 'Items' @('ID','類別','標題','備註','到期日','狀態','延後至','連結','建立','完成') @()

$ws = $wb.Worksheets.Item(2); $ws.Name = '卡片'
Add-Table $ws 'Cards' @('領域','數字','說明','更新') @(
  @('工作','—','在這裡寫一句工作現況',''),
  @('沁耘','—','在這裡寫一句公司現況（網站、曝光、課程）',''),
  @('和果','—','在這裡寫一句和果日照現況',''),
  @('投資','—','在這裡寫一句投資現況',''),
  @('生活','—','在這裡寫一句生活現況','')
)

$ws = $wb.Worksheets.Item(3); $ws.Name = '設定'
Add-Table $ws 'Settings' @('項目','值','說明') @(
  @('雨機率門檻','60','今天降雨機率超過這個 % 就列入重點'),
  @('高溫門檻','34','最高溫超過這個度數就列入重點'),
  @('低溫門檻','12','最低溫低於這個度數就列入重點'),
  @('匯率變動門檻','0.5','美元兌台幣單日變動超過這個 % 就列入重點'),
  @('提前提醒天數','3','到期日前幾天開始出現在今日重點'),
  @('出席率門檻','85','和果個案出席率（實到／應到）低於這個 % 就列入重點'),
  @('員工請假門檻','2','和果員工請假人數達到這個數就列入重點'),
  @('投資變動門檻','2','總資產單日或本月變動超過這個 % 就列入重點'),
  @('用目前位置','否','寫「是」才用這台裝置的定位看天氣；否則固定用土城')
)

$ws = $wb.Worksheets.Item(4); $ws.Name = '說明'
$lines = @(
  'Sam Homepage 資料庫',
  '',
  '「重點」表：首頁的待辦與重點。可以在首頁改，也可以直接在這裡改。',
  '  類別：沁耘（公司）、網站、社群、課程、和果（日照）、行程、待辦、信件、投資、帳單、旅行、天氣、其他',
  '  狀態：待辦、完成、已處理（完成或已處理就不再顯示）',
  '  日期請寫成 2026-11-04 這種格式',
  '  ID 請不要改；新增一列時 ID 可以留空，首頁會自動補上',
  '「卡片」表：首頁四張領域卡片的數字和一句話',
  '「設定」表：各種門檻',
  '',
  '請不要改表格名稱和欄位名稱，首頁是靠它們讀資料的。'
)
for ($i = 0; $i -lt $lines.Count; $i++) { $ws.Cells.Item($i + 1, 1).Value2 = $lines[$i] }
$ws.Cells.Item(1, 1).Font.Bold = $true

$wb.Worksheets.Item(1).Activate()
$wb.SaveAs($out, 51)
$wb.Close($false)
$xl.Quit()
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl) | Out-Null
"saved $out"
