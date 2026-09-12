Write-Host "=== opencode chat ===" -ForegroundColor Cyan
if (-not (Test-Path "node_modules")) { npm install }
# Vérifie opencode
try { $v = & opencode --version 2>&1; Write-Host "opencode $v" -ForegroundColor Green } catch { Write-Host "opencode non trouvé - installe avec: npm i -g opencode-ai" -ForegroundColor Yellow }
npm start
