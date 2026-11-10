param(
    [Parameter(Mandatory = $true)][string]$SourcePath,
    [Parameter(Mandatory = $true)][string]$Site,
    [Parameter(Mandatory = $true)][string]$Server,
    [Parameter(Mandatory = $true)][string]$User,
    [Parameter(Mandatory = $true)][string]$Password
)

$ErrorActionPreference = 'Stop'

# msdeploy.exe je součástí Windows Server imagů na GitHub runnerech, ale cesta se může lišit.
$candidates = @(
    (Join-Path $env:ProgramFiles 'IIS\Microsoft Web Deploy V3\msdeploy.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'IIS\Microsoft Web Deploy V3\msdeploy.exe')
)
$msdeploy = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $msdeploy) {
    $exe = Get-ChildItem -Path (Join-Path $env:ProgramFiles 'IIS') -Filter 'msdeploy.exe' -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName
    $msdeploy = $exe
}
if (-not $msdeploy) { throw 'msdeploy.exe nenalezen - na runneru chybi Web Deploy.' }

if (-not (Test-Path $SourcePath)) { throw "Zdrojova slozka neexistuje: $SourcePath" }

# -useChecksum = porovnávat obsah souborů, ne timestampy. Bez toho MSDeploy přeskakuje
# soubory, které mají na serveru novější čas (např. po ručním ZIP/Web Deploy nahrání),
# a na webu tak zůstane starý JS/CSS i při novém buildu.
# -enableRule:AppOffline = na dobu synchronizace položí app_offline.htm, aby nebyly
# zamčené DLL a web se korektně restartoval.
$dest = "contentPath='$Site',computerName='$Server/msdeploy.axd?site=$Site',userName='$User',password='$Password',authType='Basic'"

Write-Host "Deploy do $Site z $SourcePath"
& $msdeploy -verb:sync "-source:contentPath=$SourcePath" "-dest:$dest" -enableRule:AppOffline -useChecksum -verbose
if ($LASTEXITCODE -ne 0) { throw "msdeploy selhal (exit $LASTEXITCODE) pro $Site" }
Write-Host "Deploy na $Site dokoncen."
