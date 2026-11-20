[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-p]{32}$')][string]$ExtensionId,
    [string]$ProfileDirectory = 'Default',
    [Parameter(Mandatory=$true)][string]$ChromePath,
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
if ($ProfileDirectory -notmatch '^(Default|Profile [0-9]+)$') { throw 'Perfil invalido.' }
if (-not (Test-Path -LiteralPath $ChromePath -PathType Leaf)) { throw 'Chrome nao encontrado.' }
$url = "chrome-extension://$ExtensionId/daily.html?tick=1"
$chromeArguments = @("--profile-directory=`"$ProfileDirectory`"",$url)
if ($DryRun) {
    [pscustomobject]@{ Chrome=$ChromePath; Arguments=$chromeArguments; Collect=$false }
    return
}
$logDir = Join-Path $env:LOCALAPPDATA 'Inkwell\logs\daily-extension'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
try {
    # No user-data-dir, debugging port, cookies copy, kill or separate browser profile.
    Start-Process -FilePath $ChromePath -ArgumentList $chromeArguments -WindowStyle Hidden
    Add-Content -LiteralPath (Join-Path $logDir 'launch.log') -Value "$(Get-Date -Format o) Chrome acionado; confira lastAction na extensao."
} catch {
    Add-Content -LiteralPath (Join-Path $logDir 'launch.log') -Value "$(Get-Date -Format o) Falha: $($_.Exception.Message)"
    throw
}
