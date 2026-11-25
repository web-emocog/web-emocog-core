$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'load-sample.ps1')
function Assert-Equal($Actual, $Expected) {
    if ($Actual -ne $Expected) { throw "Unexpected aggregate: $Actual; expected $Expected" }
}
Assert-Equal (Get-WecogNumber $null) $null
Assert-Equal (Get-WecogNumber 'bad') $null
Assert-Equal (Get-WecogGpuBusy @()) $null
$gpu = @(
    @{ Name = 'pid_1_luid_0x1_0x2_phys_0_eng_0_engtype_3D'; UtilizationPercentage = 20 },
    @{ Name = 'pid_2_luid_0x1_0x2_phys_0_eng_0_engtype_3D'; UtilizationPercentage = 30 },
    @{ Name = 'pid_1_luid_0x1_0x2_phys_0_eng_1_engtype_Copy'; UtilizationPercentage = 40 }
)
Assert-Equal (Get-WecogGpuBusy $gpu) 50
$before = @{ x = @{ group = 'browser'; cpu = 10; bytes = 100 } }
$after = @{ x = @{ group = 'browser'; cpu = 12; bytes = 200 }; new = @{ group = 'browser'; cpu = 999; bytes = 300 } }
$delta = Get-WecogProcessDelta $before $after 2 4
Assert-Equal $delta.browser.cpuPercent 25
Assert-Equal $delta.browser.processCount 2
Assert-Equal $delta.browser.workingSetSumBytes 500
Assert-Equal $delta.eyetracker.cpuPercent $null
$after.x.cpu = 1
Assert-Equal (Get-WecogProcessDelta $before $after 2 4).browser.cpuPercent $null
$fake = @([pscustomobject]@{ ProcessName = 'chrome'; Id = 123; StartTime = [datetime]'2020-01-01'; CPU = 1; WorkingSet64 = 2 },
    [pscustomobject]@{ ProcessName = 'PRIVATE-OTHER'; Id = 456; StartTime = [datetime]'2020-01-01'; CPU = 99; WorkingSet64 = 99 })
$snapshot = Get-WecogProcessSnapshot $fake @('GP3')
Assert-Equal $snapshot.Count 1
Assert-Equal ($snapshot.Values | Select-Object -First 1).group 'browser'

$OutputPath = Join-Path ([IO.Path]::GetTempPath()) ('wecog-load-test-' + [guid]::NewGuid().ToString('N') + '.json')
$DurationSeconds = 4; $IntervalSeconds = 2
try {
    Invoke-WecogLoadSample
    $report = Get-Content -Raw -LiteralPath $OutputPath | ConvertFrom-Json
    Assert-Equal $report.schemaVersion 'windows-load.v1'
    if ($report.samples.Count -lt 1) { throw 'No read-only counter samples' }
    $allowed = @('elapsedSeconds', 'cpuPercent', 'busiestCorePercent', 'availableRamBytes', 'gpuBusiestEnginePercent', 'processes', 'samplerCpuPercent', 'querySeconds')
    foreach ($sample in $report.samples) {
        foreach ($property in $sample.PSObject.Properties.Name) { if ($property -notin $allowed) { throw 'Unexpected telemetry field' } }
    }
    $existing = [IO.File]::ReadAllText($OutputPath)
    $DurationSeconds = 4
    $refused = $false
    try { Invoke-WecogLoadSample } catch { $refused = $true }
    Assert-Equal $refused $true
    Assert-Equal ([IO.File]::ReadAllText($OutputPath)) $existing
} finally { if (Test-Path -LiteralPath $OutputPath) { Remove-Item -LiteralPath $OutputPath } }
Write-Output 'Load sampler aggregation, privacy and read-only smoke passed.'
