# Stop hook — fires `vercel --prod --yes` detached background nếu marker exists.
# KHÔNG block Claude. User chỉ cần hard-refresh sau 1-2 phút.
$ErrorActionPreference = 'SilentlyContinue'
try {
  # Project root — Next.js ở root, không có subfolder
  $projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
  $marker = Join-Path $projectRoot '.vercel-pending'
  if (-not (Test-Path $marker)) { exit 0 }
  Remove-Item $marker -Force

  $logFile = Join-Path $projectRoot '.vercel-deploy.log'
  $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  "[$timestamp] Auto-deploy triggered — uploading to Vercel..." | Out-File -FilePath $logFile -Encoding utf8

  # Detached background process. Claude proceeds immediately.
  $inner = "Set-Location -LiteralPath '$projectRoot'; vercel --prod --yes 2>&1 | Out-File -FilePath '$logFile' -Append -Encoding utf8; '[done ' + (Get-Date).ToString('HH:mm:ss') + ']' | Out-File -FilePath '$logFile' -Append -Encoding utf8"
  Start-Process -WindowStyle Hidden -FilePath 'powershell' -ArgumentList @('-NoProfile','-WindowStyle','Hidden','-Command',$inner) | Out-Null

  $msg = "🚀 Vercel deploy started in background. Tail: Get-Content `"$logFile`" -Wait"
  $payload = @{ systemMessage = $msg } | ConvertTo-Json -Compress
  Write-Output $payload
} catch {
  # Hooks must not break Claude.
}
exit 0
