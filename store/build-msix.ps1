<#
  Construye el paquete .msix para Microsoft Store a partir de la app ya empaquetada.

  Uso (desde la raiz del proyecto, en Windows):
    npm.cmd run package
    powershell -ExecutionPolicy Bypass -File store\build-msix.ps1 `
      -Publisher "CN=XXXXXXXX-XXXX-..." -PublisherDisplayName "Tu nombre"

  Los valores de -Publisher y -PublisherDisplayName salen de Partner Center:
  Tu app > Gestion de productos > Identidad del producto.
#>
param(
  [Parameter(Mandatory = $true)][string]$Publisher,
  [Parameter(Mandatory = $true)][string]$PublisherDisplayName,
  [string]$IdentityName = "edgar36.StarkNetChat",
  [string]$Version = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# Version: package.json (x.y.z) -> x.y.z.0 (la Store reserva el 4o numero)
if (-not $Version) {
  $pkg = Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json
  $Version = "$($pkg.version).0"
}
if ($Version -notmatch '^\d+\.\d+\.\d+\.0$') {
  throw "La version debe tener formato X.Y.Z.0 (la Store exige que el ultimo numero sea 0). Recibido: $Version"
}

# App empaquetada por electron-forge
$appDir = Get-ChildItem (Join-Path $root "out") -Directory -Filter "*-win32-x64" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $appDir) { throw "No encuentro out\*-win32-x64. Ejecuta antes: npm.cmd run package" }
if (-not (Test-Path (Join-Path $appDir.FullName "starknetchat-desktop.exe"))) {
  throw "No encuentro starknetchat-desktop.exe en $($appDir.FullName)"
}

# makeappx.exe del Windows SDK
$makeappx = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\makeappx.exe" -ErrorAction SilentlyContinue |
  Sort-Object FullName -Descending | Select-Object -First 1
if (-not $makeappx) {
  throw "Falta makeappx.exe (Windows SDK). Instalalo con: winget install Microsoft.WindowsSDK.10.0.26100"
}

# Carpeta de trabajo limpia
$staging = Join-Path $root "out\msix-staging"
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Path $staging | Out-Null
Copy-Item (Join-Path $appDir.FullName "*") $staging -Recurse -Force
Copy-Item (Join-Path $root "store\assets") (Join-Path $staging "Assets") -Recurse -Force

# Manifiesto a partir de la plantilla
function Esc([string]$s) { [System.Security.SecurityElement]::Escape($s) }
$manifest = Get-Content (Join-Path $root "store\AppxManifest.template.xml") -Raw -Encoding UTF8
$manifest = $manifest.Replace("{{IDENTITY_NAME}}", (Esc $IdentityName))
$manifest = $manifest.Replace("{{PUBLISHER}}", (Esc $Publisher))
$manifest = $manifest.Replace("{{PUBLISHER_DISPLAY_NAME}}", (Esc $PublisherDisplayName))
$manifest = $manifest.Replace("{{VERSION}}", $Version)
[System.IO.File]::WriteAllText((Join-Path $staging "AppxManifest.xml"), $manifest, (New-Object System.Text.UTF8Encoding($false)))

# Empaquetar
$out = Join-Path $root "out\StarkNetChat_${Version}_x64.msix"
if (Test-Path $out) { Remove-Item $out -Force }
& $makeappx.FullName pack /d $staging /p $out /o
if ($LASTEXITCODE -ne 0) { throw "makeappx fallo con codigo $LASTEXITCODE" }

Write-Host ""
Write-Host "Listo: $out" -ForegroundColor Green
Write-Host "Sube este .msix en Partner Center (Paquetes). La Store lo firma por ti."
