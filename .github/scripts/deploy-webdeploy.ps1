param(
    [Parameter(Mandatory = $true)][string]$SourcePath,
    [Parameter(Mandatory = $true)][string]$Site,
    [Parameter(Mandatory = $true)][string]$Server,
    [Parameter(Mandatory = $true)][string]$User,
    [Parameter(Mandatory = $true)][string]$Password,
    # Veřejná adresa webu - když je zadaná, skript počká, až app_offline.htm opravdu
    # vrátí 503 (tj. IIS shodil aplikaci a uvolnil zamčené DLL), než začne synchronizovat.
    [string]$WaitUrl = '',
    [int]$OfflineTimeoutSeconds = 45
)

$ErrorActionPreference = 'Stop'

# msdeploy.exe je součástí Windows Server imagů na GitHub runnerech, ale cesta se může lišit.
$candidates = @()
if ($env:ProgramFiles) {
    $candidates += (Join-Path $env:ProgramFiles 'IIS\Microsoft Web Deploy V3\msdeploy.exe')
}
$pf86 = ${env:ProgramFiles(x86)}
if ($pf86) {
    $candidates += (Join-Path $pf86 'IIS\Microsoft Web Deploy V3\msdeploy.exe')
}
$msdeploy = $candidates | Where-Object { (Test-Path $_) } | Select-Object -First 1
if (-not $msdeploy -and $env:ProgramFiles) {
    $exe = Get-ChildItem -Path (Join-Path $env:ProgramFiles 'IIS') -Filter 'msdeploy.exe' -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName
    $msdeploy = $exe
}
if (-not $msdeploy) { throw 'msdeploy.exe nenalezen - na runneru chybi Web Deploy.' }

if (-not (Test-Path $SourcePath)) { throw "Zdrojova slozka neexistuje: $SourcePath" }

$remote = "computerName='$Server/msdeploy.axd?site=$Site',userName='$User',password='$Password',authType='Basic'"
$destSite = "contentPath='$Site',$remote"

# Proč to není jen jeden msdeploy s -enableRule:AppOffline:
# Web Deploy si app_offline.htm položí sám, ale při stejné synchronizaci ho zase uklidí
# a/nebo appku shodí pozdě - na MonsterASP tak publikace končí ERROR_FILE_IN_USE
# ("Web Deploy cannot modify the file 'PrehrajtoProxy.dll' ... locked by an external process").
# Proto tři fáze: nahrát app_offline.htm -> počkat, než appka spadne -> synchronizovat
# (app_offline.htm se přeskakuje, aby ho sync nesmazal) -> app_offline.htm smazat.
$skipOffline = '-skip:objectName=filePath,absolutePath=.*app_offline\.htm'

$offlineDir = Join-Path ([System.IO.Path]::GetTempPath()) ('wflix-offline-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $offlineDir -Force | Out-Null
$offlineFile = Join-Path $offlineDir 'app_offline.htm'
$offlineHtml = @'
<!DOCTYPE html>
<html lang="cs">
<head>
<meta charset="utf-8">
<title>Wflix se aktualizuje</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0b0b0f; color: #f2f2f5;
         display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  div { text-align: center; padding: 0 24px; }
  h1 { font-size: 26px; margin: 0 0 10px; }
  p { color: #a0a0ab; margin: 0; }
</style>
</head>
<body>
  <div>
    <h1>Wflix se právě aktualizuje</h1>
    <p>Vydrž chvilku, za pár sekund to bude zase fungovat.</p>
  </div>
</body>
</html>
'@
Set-Content -Path $offlineFile -Value $offlineHtml -Encoding utf8

function Wait-AppOffline {
    param([string]$Url, [int]$TimeoutSeconds)
    if ([string]::IsNullOrWhiteSpace($Url)) {
        Start-Sleep -Seconds 10
        return
    }
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $probe = $Url.TrimEnd('/') + '/api/ping'
    while ((Get-Date) -lt $deadline) {
        $code = 0
        try {
            $r = Invoke-WebRequest -Uri $probe -TimeoutSec 15 -SkipHttpErrorCheck
            $code = [int]$r.StatusCode
        } catch {
            $code = 0
        }
        if ($code -eq 503) {
            Write-Host "app_offline.htm vraci 503 - aplikace je dole, pokracuji."
            Start-Sleep -Seconds 5
            return
        }
        Write-Host "cekam na app_offline (HTTP $code) ..."
        Start-Sleep -Seconds 3
    }
    Write-Host "::warning::$probe nevratil 503 do $TimeoutSeconds s - zkousim synchronizaci i tak."
}

$deployed = $false
try {
    Write-Host "1/3 app_offline.htm -> $Site"
    & $msdeploy -verb:sync "-source:contentPath=$offlineDir" "-dest:$destSite" -useChecksum -verbose
    if ($LASTEXITCODE -ne 0) { throw "app_offline.htm se nenahral (exit $LASTEXITCODE) pro $Site" }

    Wait-AppOffline -Url $WaitUrl -TimeoutSeconds $OfflineTimeoutSeconds

    for ($attempt = 1; $attempt -le 3; $attempt++) {
        Write-Host "2/3 deploy do $Site z $SourcePath (pokus $attempt)"
        & $msdeploy -verb:sync "-source:contentPath=$SourcePath" "-dest:$destSite" $skipOffline -useChecksum -verbose
        if ($LASTEXITCODE -eq 0) { $deployed = $true; break }
        Write-Host "msdeploy selhal (exit $LASTEXITCODE), zkusim znovu za 15 s"
        Start-Sleep -Seconds 15
    }
    if (-not $deployed) { throw "msdeploy selhal 3x pro $Site" }
} finally {
    Remove-Item -Recurse -Force $offlineDir -ErrorAction SilentlyContinue
    Write-Host "3/3 odstraneni app_offline.htm na $Site"
    & $msdeploy -verb:delete "-dest:contentPath='$Site/app_offline.htm',$remote" -verbose
    if ($LASTEXITCODE -ne 0) {
        Write-Host "::warning::app_offline.htm se nepodarilo smazat (exit $LASTEXITCODE) - web muze zustat na 503, smaz ho rucne."
    }
}

Write-Host "Deploy na $Site dokoncen."
