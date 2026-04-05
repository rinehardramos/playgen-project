# PlayGen Task Daemon — Windows runner (launches inside WSL2)
# Scheduled via Task Scheduler to run at logon.
# The actual daemon runs in WSL — this script is the Windows-side trigger.

param(
    [switch]$Uninstall
)

$TaskName = "PlayGen-Task-Daemon"

if ($Uninstall) {
    Write-Host "Removing scheduled task $TaskName..."
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Done."
    exit 0
}

# ── Detect WSL distro ─────────────────────────────────────────────────────────
$WslDistros = wsl --list --quiet 2>$null | Where-Object { $_ -ne "" }
if (-not $WslDistros) {
    Write-Error "WSL is not installed or no distros available. Install WSL2 first."
    exit 1
}
# Use first distro (usually Ubuntu)
$Distro = ($WslDistros | Select-Object -First 1).Trim()
Write-Host "Using WSL distro: $Distro"

# ── Resolve project path inside WSL ──────────────────────────────────────────
$WinProjectDir = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$WslProjectDir = wsl -d $Distro wslpath -u "$WinProjectDir" 2>$null
if (-not $WslProjectDir) {
    Write-Error "Could not resolve WSL path for $WinProjectDir"
    exit 1
}

$RunnerScript = "$WslProjectDir/tools/task-daemon/deploy/linux/run-daemon.sh"

# ── Create/update Task Scheduler task ────────────────────────────────────────
$Action = New-ScheduledTaskAction `
    -Execute "wsl.exe" `
    -Argument "-d $Distro -- sh $RunnerScript"

$Trigger = New-ScheduledTaskTrigger -AtLogOn

$Settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
    -RestartCount 5 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew

$Principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType Interactive `
    -RunLevel Limited

# Remove existing task if present
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Principal $Principal `
    -Description "PlayGen autonomous agent pool daemon (runs inside WSL2)" | Out-Null

Write-Host ""
Write-Host "PlayGen Task Daemon registered as Windows Task Scheduler task."
Write-Host "  It will start at next login (or run now):"
Write-Host "    Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Status:"
Write-Host "    Get-ScheduledTask -TaskName '$TaskName' | Select-Object TaskName, State"
Write-Host "  Logs (inside WSL):"
Write-Host "    wsl -d $Distro -- tail -f ~/.playgen/logs/daemon.log"
Write-Host "  Remove:"
Write-Host "    pwsh $PSCommandPath -Uninstall"

# Ask to start now
$StartNow = Read-Host "Start daemon now? (y/N)"
if ($StartNow -eq 'y' -or $StartNow -eq 'Y') {
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "Daemon started."
}
