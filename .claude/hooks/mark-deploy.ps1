# PostToolUse hook — marker file khi file trong project được edit.
# Stop hook đọc marker để fire 1 vercel deploy / turn (coalescing).
$ErrorActionPreference = 'SilentlyContinue'
try {
  $json = [Console]::In.ReadToEnd()
  if (-not $json) { exit 0 }
  $obj = $json | ConvertFrom-Json
  $f = $obj.tool_input.file_path
  if (-not $f) { exit 0 }

  # Project root (mda-cdp) — Next.js ở root, không có subfolder
  $projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

  # PATH FILTER: chỉ trigger nếu file nằm trong project root VÀ trong folder deployable
  # (app/, components/, lib/, public/, styles/, types/, middleware, next.config, etc.)
  # Skip nếu chỉ edit file test/debug/etl (không affect runtime web)
  $normF = ($f -replace '/','\\').ToLower()
  $normRoot = $projectRoot.ToLower()

  if ($normF -notlike "$normRoot*") { exit 0 }  # file ngoài project root

  # Skip các folder không cần redeploy
  $skipPatterns = @('\etl\','\supabase\','\.claude\','\.github\','\node_modules\','\.next\','\.vercel\')
  foreach ($p in $skipPatterns) {
    if ($normF -like "*$p*") { exit 0 }
  }

  # Skip specific files
  $skipFiles = @('.md','.sql','.txt','.log')
  foreach ($ext in $skipFiles) {
    if ($normF.EndsWith($ext)) { exit 0 }
  }

  # OK → tạo marker
  $markerFile = Join-Path $projectRoot '.vercel-pending'
  New-Item -Path $markerFile -ItemType File -Force | Out-Null
} catch {
  # Hooks must not break Claude; swallow errors.
}
exit 0
