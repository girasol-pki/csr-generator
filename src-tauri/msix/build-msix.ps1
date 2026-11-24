# Arma el MSIX para la Microsoft Store a partir del binario de `pnpm tauri build --no-bundle`.
# Sin firmar: la Store firma el paquete al publicarlo.
#
# Uso: ./src-tauri/msix/build-msix.ps1 -OutDir out/msix
param(
    [Parameter(Mandatory = $true)][string]$OutDir
)

$ErrorActionPreference = "Stop"

$msixDir = $PSScriptRoot
$tauriDir = Split-Path $msixDir -Parent
$exe = Join-Path $tauriDir "target\release\girasol-csr-generator.exe"
if (-not (Test-Path $exe)) { throw "No existe $exe; corre antes 'pnpm tauri build --no-bundle'." }

$appVersion = (Get-Content (Join-Path $tauriDir "tauri.conf.json") -Raw | ConvertFrom-Json).version
if ($appVersion -notmatch '^\d+\.\d+\.\d+$') { throw "Versión inválida en tauri.conf.json: $appVersion" }

$sdkBin = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Directory |
    Where-Object { Test-Path (Join-Path $_.FullName "x64\makeappx.exe") } |
    Sort-Object { [version]$_.Name } |
    Select-Object -Last 1
if (-not $sdkBin) { throw "No se encontró makeappx.exe (Windows SDK)." }
$makeappx = Join-Path $sdkBin.FullName "x64\makeappx.exe"
$makepri = Join-Path $sdkBin.FullName "x64\makepri.exe"

New-Item -ItemType Directory -Force $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path
$layout = Join-Path $OutDir "layout"
if (Test-Path $layout) { Remove-Item -Recurse -Force $layout }

$appDir = Join-Path $layout "VFS\ProgramFilesX64\Girasol CSR Generator"
New-Item -ItemType Directory -Force $appDir | Out-Null
Copy-Item $exe $appDir
Copy-Item -Recurse (Join-Path $msixDir "Assets") $layout

$manifest = (Get-Content (Join-Path $msixDir "AppxManifest.xml") -Raw).Replace("{{VERSION}}", "$appVersion.0")
[IO.File]::WriteAllText((Join-Path $layout "AppxManifest.xml"), $manifest, [Text.UTF8Encoding]::new($false))

# resources.pri resuelve las variantes de escala de los íconos (scale-100, targetsize-48, ...).
$priConfig = Join-Path $OutDir "priconfig.xml"
& $makepri createconfig /cf $priConfig /dq en-us /o | Out-Null
if ($LASTEXITCODE -ne 0) { throw "makepri createconfig falló ($LASTEXITCODE)" }
# Sin <packaging> todo queda en un solo resources.pri: los .pri separados por escala solo
# los carga Windows cuando vienen como paquetes de recursos de un bundle, y esto es un MSIX único.
$priXml = [xml](Get-Content $priConfig -Raw)
$priXml.SelectNodes("//packaging") | ForEach-Object { [void]$_.ParentNode.RemoveChild($_) }
$priXml.Save($priConfig)
& $makepri new /pr $layout /cf $priConfig /of (Join-Path $layout "resources.pri") /o | Out-Null
if ($LASTEXITCODE -ne 0) { throw "makepri new falló ($LASTEXITCODE)" }

# Notas de la versión para "Novedades" de la Store, tomadas de la sección ## [X.Y.Z] del CHANGELOG.
$changelog = Get-Content (Join-Path (Split-Path $tauriDir -Parent) "CHANGELOG.md") -Raw
$section = [regex]::Match($changelog, "(?ms)^## \[$([regex]::Escape($appVersion))\][^\r\n]*\r?\n(.*?)(?=^## \[|\z)")
if (-not $section.Success) { throw "CHANGELOG.md no tiene sección para la versión $appVersion." }
$releaseNotes = $section.Groups[1].Value.Trim()
if ($releaseNotes.Length -eq 0) { throw "La sección $appVersion de CHANGELOG.md está vacía." }
if ($releaseNotes.Length -gt 1500) { throw "Las notas de $appVersion tienen $($releaseNotes.Length) caracteres; la Store acepta 1500." }
[IO.File]::WriteAllText((Join-Path $OutDir "release-notes.txt"), $releaseNotes, [Text.UTF8Encoding]::new($false))

$package = Join-Path $OutDir "GirasolCSRGenerator_${appVersion}_x64.msix"
& $makeappx pack /d $layout /p $package /o
if ($LASTEXITCODE -ne 0) { throw "makeappx pack falló ($LASTEXITCODE)" }

Write-Output "MSIX: $package"
