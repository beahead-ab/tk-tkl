# Riktig installation i Windows-runnerns temporära mapp. Ingen start eller fysisk anslutning.
$ErrorActionPreference = 'Stop'
$App = Join-Path $env:RUNNER_TEMP 'Träkvista TKL COM-prov'
$env:CDA_TKL_HOME = $App
$env:CDA_TKL_SOURCE = $PWD.Path
$env:CDA_TKL_NO_START = '1'
New-Item -ItemType Directory -Force (Join-Path $App 'state') | Out-Null
$Marker = Join-Path $App 'state\provmarkor.txt'
Set-Content $Marker 'syntetiska befintliga driftdata' -Encoding UTF8
$Before = (Get-FileHash $Marker).Hash
Set-Content (Join-Path $App 'app.env') 'CHARLOTTENDAL_TEST_SENTINEL=bevarad' -Encoding UTF8
try {
  & (Join-Path $PWD 'install.ps1')
  $Pointer = Join-Path $App 'current.txt'
  if (-not (Test-Path $Pointer)) { throw 'Installationen skapade ingen aktuell version.' }
  $Release = (Get-Content $Pointer -Raw).Trim()
  $Expected = (Get-Content (Join-Path $PWD 'package.json') -Raw | ConvertFrom-Json).version
  $Actual = (Get-Content (Join-Path $Release 'package.json') -Raw | ConvertFrom-Json).version
  if ($Expected -ne $Actual) { throw 'Fel version installerades.' }
  if (-not (Test-Path (Join-Path $Release 'src\windows-serial.mjs'))) { throw 'Windows-transporten saknas i installationen.' }
  if ((Get-FileHash $Marker).Hash -ne $Before) { throw 'Befintliga driftdata ändrades.' }
  if (-not (Select-String (Join-Path $App 'app.env') -Pattern '^CHARLOTTENDAL_TEST_SENTINEL=bevarad$' -Quiet)) { throw 'Befintlig inställning försvann.' }
  Push-Location $Release
  try {
    & (Join-Path $App 'node\node.exe') --input-type=module -e "import('serialport').then(m => m.SerialPort.list()).then(p => console.log('Native COM-listning OK:', p.length));"
    if ($LASTEXITCODE) { throw 'Den installerade Node-versionen kan inte läsa COM-listan.' }
  } finally { Pop-Location }
  Write-Host "Windows-installationsprov godkänt: $Actual, blanksteg/svenska tecken, native-modul och bevarad driftdata."
} finally {
  Remove-Item Env:CDA_TKL_HOME, Env:CDA_TKL_SOURCE, Env:CDA_TKL_NO_START -ErrorAction SilentlyContinue
}
