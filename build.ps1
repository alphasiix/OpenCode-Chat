Write-Host "=== Build .exe ===" -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -eq 0) {
  Write-Host "Build OK - voir dist/" -ForegroundColor Green
  Get-ChildItem dist -Filter *.exe | Format-Table Name, Length
} else {
  Write-Host "Build échoué - voir log ci-dessus" -ForegroundColor Red
}
