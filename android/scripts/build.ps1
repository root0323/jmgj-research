param([string]$Tools = (Join-Path $PSScriptRoot '../../.verification/android-tools'), [string]$Output = 'C:/Users/hyeon/AppData/Local/jmgj-research/android-build/0.8.2', [switch]$Debug)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$Tools = (Resolve-Path $Tools).Path
$env:JAVA_HOME = (Get-ChildItem (Join-Path $Tools 'jdk') -Directory | Select-Object -First 1).FullName
$env:ANDROID_HOME = 'C:/Users/hyeon/AppData/Local/jmgj-research/android-sdk'
$env:GRADLE_USER_HOME = 'C:/Users/hyeon/AppData/Local/jmgj-research/android-gradle-cache'
$env:PATH = "$env:JAVA_HOME/bin;$env:PATH"
Push-Location $repo
try {
  & node frontend/scripts/prepare-background-assets.cjs
  if ($LASTEXITCODE -ne 0) { throw 'Background preparation failed' }
  & node frontend/scripts/prepare-star-assets.cjs
  if ($LASTEXITCODE -ne 0) { throw 'Star preparation failed' }
  & node frontend/node_modules/vite/bin/vite.js build --config android/web/vite.config.mts --configLoader runner
  if ($LASTEXITCODE -ne 0) { throw 'Android web build failed' }
  & node android/scripts/prepare-model.cjs
  if ($LASTEXITCODE -ne 0) { throw 'Model packaging failed' }
  $assets = Join-Path $repo 'android/app/src/main/assets/web'
  if ((Test-Path -LiteralPath $assets) -and [IO.Path]::GetFullPath($assets).StartsWith((Join-Path $repo 'android/app/src/main/assets/'), [StringComparison]::OrdinalIgnoreCase)) { Remove-Item -LiteralPath $assets -Recurse -Force }
  function CopyTree($source, $dest) {
    if (-not $dest.StartsWith((Join-Path $repo 'android'), [StringComparison]::OrdinalIgnoreCase)) { throw 'Destination outside Android workspace' }
    & robocopy $source $dest /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP
    if ($LASTEXITCODE -gt 7) { throw 'Asset copy failed' }
  }
  CopyTree (Join-Path $repo 'android/web/dist') $assets
  CopyTree (Join-Path $repo 'frontend/public') $assets
  CopyTree (Join-Path $repo 'android/build/mobile-model') (Join-Path $assets 'mobile-model')
  CopyTree (Join-Path $repo 'desktop/licenses') (Join-Path $assets 'licenses')
  CopyTree (Join-Path $repo 'android/licenses') (Join-Path $assets 'licenses')
  Copy-Item -LiteralPath (Join-Path $repo 'desktop/NOTICE.txt') -Destination (Join-Path $assets 'NOTICE.txt')
  if (-not $Output.StartsWith('C:/Users/hyeon/AppData/Local/jmgj-research/android-build/', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected build output root' }
  New-Item -ItemType Directory -Force -Path $Output | Out-Null
  & robocopy (Join-Path $Tools 'sdk') $env:ANDROID_HOME /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP
  if ($LASTEXITCODE -gt 7) { throw 'SDK staging failed' }
  $sourceStage = [IO.Path]::GetFullPath((Join-Path $Output 'app/src'))
  if (-not $sourceStage.StartsWith([IO.Path]::GetFullPath($Output) + [IO.Path]::DirectorySeparatorChar)) { throw 'Unexpected source stage' }
  & robocopy (Join-Path $repo 'android/app/src') $sourceStage /MIR /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP
  if ($LASTEXITCODE -gt 7) { throw 'Android project staging failed' }
  Copy-Item -LiteralPath (Join-Path $repo 'android/app/build.gradle') -Destination (Join-Path $Output 'app/build.gradle')
  foreach ($name in 'settings.gradle','build.gradle','gradle.properties','signing.properties','astrosky-release.jks') {
    $source = Join-Path $repo "android/$name"
    if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination (Join-Path $Output $name) }
  }
  Push-Location $Output
  try {
    $gradle = Join-Path $Tools 'gradle-8.11.1/bin/gradle.bat'
    if (-not $Debug -and -not (Test-Path -LiteralPath (Join-Path $repo 'android/signing.properties'))) { throw 'Release signing credentials required' }
    $tasks = if ($Debug) { @('assembleDebug', 'testDebugUnitTest') } else { @('assembleRelease', 'assembleDebug', 'testDebugUnitTest') }
    & $gradle --no-daemon @tasks
    if ($LASTEXITCODE -ne 0) { throw 'APK build failed' }
  } finally { Pop-Location }
} finally { Pop-Location }
