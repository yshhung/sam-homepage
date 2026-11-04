# 產生 PWA / iPhone 主畫面圖示
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $root 'icons'
New-Item -ItemType Directory -Force $dir | Out-Null

foreach ($size in 180, 192, 512) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = 'AntiAliasGridFit'
  $g.Clear([System.Drawing.Color]::Black)
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(56, 189, 248)), ($size * 0.045)
  $m = $size * 0.16
  $g.DrawEllipse($pen, $m, $m, $size - 2 * $m, $size - 2 * $m)
  $font = New-Object System.Drawing.Font 'Segoe UI', ($size * 0.34), ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = 'Center'; $sf.LineAlignment = 'Center'
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(230, 237, 243))
  $g.DrawString('S', $font, $brush, (New-Object System.Drawing.RectangleF 0, ($size * 0.02), $size, $size), $sf)
  $name = if ($size -eq 180) { 'apple-touch-icon.png' } else { "icon-$size.png" }
  $bmp.Save((Join-Path $dir $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}
"icons in $dir"
