[CmdletBinding()]
param(
    [string]$RepoRoot = "C:\Users\luisc\OneDrive\Desktop\inkwell",
    [double]$DelayMin = 6.0,
    [double]$DelayMax = 10.0
)

$ErrorActionPreference = "Stop"

$repo = (Resolve-Path -LiteralPath $RepoRoot).Path
$tools = Join-Path $repo "tools"
$site = Join-Path $repo "site"
$agent = Join-Path $tools "ligalorcana_price_agent_daily_v5.py"
$validator = Join-Path $tools "validate_release.py"
$manifestRefresher = Join-Path $tools "refresh_data_manifest.py"
$logBase = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { $env:TEMP }
$logDir = Join-Path $logBase "Inkwell\logs\price-refresh"

New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$stamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$logFile = Join-Path $logDir "price-refresh_$stamp.log"

$mutex = [System.Threading.Mutex]::new($false, "Local\InkwellDailyPriceRefresh")
$ownsMutex = $false
$transcriptStarted = $false

# Only these generated artifacts may be staged by this automation.
$generatedArtifacts = @(
    "site/data/ligalorcana-prices.json",
    "site/data/card-price-map.json",
    "site/data/ligalorcana-price-map.v4.json",
    "site/data/prices.json",
    "site/data/price-history.json",
    "site/data/price-analytics.json",
    "site/data/validation-report.json",
    "site/data-manifest.json"
)

# These published files must be clean before collection begins. The raw cache
# may already be dirty after an interrupted run and is intentionally allowed.
$publishedArtifacts = @(
    "site/data/prices.json",
    "site/data/price-history.json",
    "site/data/validation-report.json",
    "site/data-manifest.json"
)

function Assert-ExitCode {
    param([string]$Step, [int[]]$Allowed = @(0))
    if ($LASTEXITCODE -notin $Allowed) {
        throw "$Step failed with exit code $LASTEXITCODE. See $logFile"
    }
}

try {
    $ownsMutex = $mutex.WaitOne(0)
    if (-not $ownsMutex) {
        throw "Another Inkwell price refresh is already running."
    }

    Start-Transcript -Path $logFile -Append | Out-Null
    $transcriptStarted = $true
    Set-Location -LiteralPath $repo

    $python = (Get-Command python.exe -ErrorAction Stop).Source

    foreach ($required in @($agent, $validator, $manifestRefresher)) {
        if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
            throw "Required file not found: $required"
        }
    }

    $branch = (& git branch --show-current).Trim()
    Assert-ExitCode "Read current Git branch"
    if ($branch -ne "main") {
        throw "Automation only runs on branch main; current branch is '$branch'."
    }

    & git diff --cached --quiet
    if ($LASTEXITCODE -ne 0) {
        throw "The Git index already contains staged changes. Commit or unstage them first."
    }

    & git fetch origin main
    Assert-ExitCode "git fetch"
    $head = (& git rev-parse HEAD).Trim()
    Assert-ExitCode "Read HEAD"
    $remote = (& git rev-parse origin/main).Trim()
    Assert-ExitCode "Read origin/main"
    if ($head -ne $remote) {
        throw "HEAD is not synchronized with origin/main. Resolve pull/push state manually first."
    }

    $dirtyPublished = & git status --porcelain -- @publishedArtifacts
    Assert-ExitCode "Check published price artifacts"
    if ($dirtyPublished) {
        throw "Published price artifacts already have local changes. Resolve them before automation runs.`n$dirtyPublished"
    }

    Write-Host "Starting daily collection at $(Get-Date -Format o)"
    Write-Host "Adaptive delay: $DelayMin-$DelayMax seconds; target is approximately seven hours for a full 3,438-card day."

    & $python $agent `
        --resume-today `
        --delay-min $DelayMin `
        --delay-max $DelayMax `
        --retries 1 `
        --checkpoint-every 25 `
        --access-denied-limit 3
    $agentExit = $LASTEXITCODE

    if ($agentExit -ne 0) {
        # The v5 agent preserves its durable raw cache. Do not publish or commit
        # when the circuit breaker or any collection error occurs.
        throw "Price collection did not complete cleanly (exit $agentExit). Raw progress was preserved; nothing will be committed."
    }

    $statusJson = (& $python $agent --resume-status | Out-String)
    Assert-ExitCode "Read resume status"
    $status = $statusJson | ConvertFrom-Json
    if ($null -eq $status.remaining_today -or [int]$status.remaining_today -ne 0) {
        throw "Collection is incomplete: remaining_today=$($status.remaining_today). Nothing will be committed."
    }

    # Rebuild all derived artifacts from the durable cache. This is idempotent
    # and ensures prices/history/manifest describe the same completed snapshot.
    & $python $agent --finalize-cache
    Assert-ExitCode "Finalize price cache"

    & $python $manifestRefresher --root $site
    Assert-ExitCode "Refresh data manifest"

    & $python $validator --root $site --quick
    Assert-ExitCode "Release validation"

    $existingArtifacts = @(
        $generatedArtifacts | Where-Object {
            Test-Path -LiteralPath (Join-Path $repo $_) -PathType Leaf
        }
    )
    if ($existingArtifacts.Count -eq 0) {
        throw "No generated price artifacts were found to stage."
    }

    & git add -- @existingArtifacts
    Assert-ExitCode "Stage generated price artifacts"

    & git diff --cached --quiet
    if ($LASTEXITCODE -eq 0) {
        Write-Host "No price changes to commit. Validation passed."
        exit 0
    }

    $commitDate = Get-Date -Format "yyyy-MM-dd"
    & git commit -m "refresh daily prices $commitDate"
    Assert-ExitCode "Commit daily price artifacts"

    & git push origin main
    Assert-ExitCode "Push daily price artifacts"

    Write-Host "Daily price refresh completed, validated, committed, and pushed."
}
catch {
    Write-Error $_
    exit 1
}
finally {
    if ($transcriptStarted) {
        try { Stop-Transcript | Out-Null } catch { }
    }
    if ($ownsMutex) {
        try { $mutex.ReleaseMutex() } catch { }
    }
    $mutex.Dispose()
}
