# 本機測試用的小型網頁伺服器：http://localhost:5173/
param([int]$Port = 5173)
$root = Split-Path -Parent $PSScriptRoot
$mime = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8';
  '.json'='application/json'; '.webmanifest'='application/manifest+json'; '.png'='image/png'; '.svg'='image/svg+xml';
  '.xlsx'='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; '.md'='text/markdown; charset=utf-8' }
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving $root at http://localhost:$Port/"
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
  if ($path -eq '' -or $path.EndsWith('/')) { $path += 'index.html' }
  $file = [IO.Path]::GetFullPath((Join-Path $root $path))
  $res = $ctx.Response
  if ($file.StartsWith($root) -and (Test-Path -LiteralPath $file -PathType Leaf)) {
    $bytes = [IO.File]::ReadAllBytes($file)
    $ext = [IO.Path]::GetExtension($file).ToLower()
    $res.ContentType = if ($mime[$ext]) { $mime[$ext] } else { 'application/octet-stream' }
    $res.Headers.Add('Cache-Control', 'no-store')
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
  } else { $res.StatusCode = 404 }
  $res.Close()
}
