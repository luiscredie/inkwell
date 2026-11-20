[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-p]{32}$')][string]$ExtensionId,
    [string]$ProfileDirectory = 'Default',
    [string]$ChromePath,
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
if ([TimeZoneInfo]::Local.Id -ne 'E. South America Standard Time') {
    throw 'Configure o fuso horario do Windows para Brasilia (E. South America Standard Time) antes de instalar a tarefa das 00h03.'
}
if (-not $ChromePath) {
    $ChromePath = @(
        "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
}
if (-not $ChromePath -or -not (Test-Path -LiteralPath $ChromePath -PathType Leaf)) { throw 'Chrome nao encontrado. Informe -ChromePath.' }
if ($ProfileDirectory -notmatch '^(Default|Profile [0-9]+)$') { throw 'Use Default ou Profile N, conforme chrome://version.' }
$profilePath = Join-Path "$env:LOCALAPPDATA\Google\Chrome\User Data" $ProfileDirectory
if (-not (Test-Path -LiteralPath $profilePath -PathType Container)) { throw "Perfil existente nao encontrado: $profilePath" }
$runner = Join-Path $PSScriptRoot 'Invoke-DailyTask.ps1'
if (-not (Test-Path -LiteralPath $runner -PathType Leaf)) { throw 'Mantenha os dois scripts na mesma pasta.' }
foreach ($value in @($runner,$ChromePath)) { if ($value.Contains('"')) { throw 'Caminho invalido.' } }
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -ExtensionId "{1}" -ProfileDirectory "{2}" -ChromePath "{3}"' -f $runner,$ExtensionId,$ProfileDirectory,$ChromePath
$escape = { param($value) [System.Security.SecurityElement]::Escape([string]$value) }
$nextRun = (Get-Date).Date.AddMinutes(3)
if ($nextRun -le (Get-Date)) { $nextRun = $nextRun.AddDays(1) }
$boundary = $nextRun.ToString('yyyy-MM-ddTHH:mm:ss')
$userSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$powerShell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
 <RegistrationInfo><Description>LigaLorcana 00h03; mesmo perfil Chrome, sem alterar live.</Description></RegistrationInfo>
 <Triggers><CalendarTrigger><StartBoundary>$boundary</StartBoundary><Enabled>true</Enabled><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger></Triggers>
 <Principals><Principal id="Author"><UserId>$userSid</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
 <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><WakeToRun>true</WakeToRun><ExecutionTimeLimit>PT5M</ExecutionTimeLimit></Settings>
 <Actions Context="Author"><Exec><Command>$(& $escape $powerShell)</Command><Arguments>$(& $escape $arguments)</Arguments><WorkingDirectory>$(& $escape $PSScriptRoot)</WorkingDirectory></Exec></Actions>
</Task>
"@
# Parse the exact same XML in simulation and installation.
[xml]$parsed = $xml
if ($DryRun) {
    Write-Output $xml
    Write-Host 'SIMULACAO: nenhuma tarefa instalada, Chrome aberto ou coleta iniciada.'
    return
}
Register-ScheduledTask -TaskName 'Inkwell-LigaLorcana-0003' -Xml $xml -Force | Out-Null
Get-ScheduledTaskInfo -TaskName 'Inkwell-LigaLorcana-0003' | Select-Object NextRunTime,LastTaskResult
Write-Host 'Tarefa instalada. Ative a coleta diaria na extensao. O usuario deve permanecer conectado ao Windows.'
