# Read-only Windows 10/11 sampler. No elevation, video capture or network access.
[CmdletBinding()]
param(
    [ValidateRange(4, 600)][int]$DurationSeconds = 300,
    [ValidateRange(2, 10)][int]$IntervalSeconds = 2,
    [ValidateSet('baseline', 'platform', 'eyetracker', 'combined')][string]$Scenario = 'platform',
    [ValidateSet('internal', 'external-a', 'external-b', 'none')][string]$Camera = 'none',
    [string[]]$EyeTrackerProcessNames = @('Gazepoint', 'GazepointControl', 'GazepointAnalysis', 'GP3'),
    [string]$OutputPath = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) ('wecog-load-' + [guid]::NewGuid().ToString('N') + '.json'))
)

function Get-WecogNumber($Value) {
    if ($null -eq $Value) { return $null }
    try { $n = [double]$Value } catch { return $null }
    if ([double]::IsNaN($n) -or [double]::IsInfinity($n) -or $n -lt 0) { return $null }
    return $n
}

function Get-WecogGpuBusy($Rows) {
    $engines = @{}
    foreach ($row in $Rows) {
        # Group per physical engine, not per process; do not add different engines.
        if ($row.Name -notmatch '^pid_\d+_(luid_.+_phys_\d+_eng_\d+_engtype_.+?)(?:#\d+)?$') { continue }
        $key = $Matches[1]
        $value = Get-WecogNumber $row.UtilizationPercentage
        if ($null -eq $value) { continue }
        if (-not $engines.ContainsKey($key)) { $engines[$key] = 0.0 }
        $engines[$key] += $value
    }
    if ($engines.Count -eq 0) { return $null }
    return [math]::Min(100, ($engines.Values | Measure-Object -Maximum).Maximum)
}

function Get-WecogProcessSnapshot($Processes, [string[]]$TrackerNames) {
    $rows = @{}
    foreach ($p in $Processes) {
        $group = if ($p.ProcessName -in @('chrome', 'msedge', 'firefox')) { 'browser' }
            elseif ($p.ProcessName -in $TrackerNames) { 'eyetracker' } else { $null }
        if ($null -eq $group) { continue }
        try {
            # PID and creation time stay in memory only and protect against PID reuse.
            $key = [string]$p.Id + '/' + $p.StartTime.Ticks
            $cpu = Get-WecogNumber $p.CPU
            if ($null -ne $cpu) { $rows[$key] = @{ group = $group; cpu = $cpu; bytes = [double]$p.WorkingSet64 } }
        } catch { continue } # Protected/exited processes are unavailable, not zero load.
    }
    return $rows
}

function Get-WecogProcessDelta($Before, $After, [double]$Elapsed, [int]$Cores) {
    $result = @{}
    foreach ($group in @('browser', 'eyetracker')) {
        $matched = 0; $cpu = 0.0; $bytes = 0.0; $count = 0
        foreach ($key in $After.Keys) {
            $row = $After[$key]
            if ($row.group -ne $group) { continue }
            $count++; $bytes += $row.bytes
            if ($Before.ContainsKey($key) -and $row.cpu -ge $Before[$key].cpu) {
                $matched++; $cpu += $row.cpu - $Before[$key].cpu
            }
        }
        $percent = if ($matched -gt 0 -and $Elapsed -gt 0 -and $Cores -gt 0) { [math]::Min(100, 100 * $cpu / $Elapsed / $Cores) } else { $null }
        $result[$group] = @{ cpuPercent = $percent; processCount = $count; matchedProcesses = $matched;
            workingSetSumBytes = $(if ($count -gt 0) { $bytes } else { $null }) }
    }
    return $result
}

function Invoke-WecogLoadSample {
    if ($env:OS -ne 'Windows_NT') { throw 'This sampler requires Windows.' }
    $cores = [Environment]::ProcessorCount
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $self = Get-Process -Id $PID
    $selfBefore = $self.TotalProcessorTime.TotalSeconds
    $before = Get-WecogProcessSnapshot @(Get-Process) $EyeTrackerProcessNames
    $previousAt = $watch.Elapsed.TotalSeconds
    $samples = [Collections.Generic.List[object]]::new()
    $gpuAvailable = $true
    while ($watch.Elapsed.TotalSeconds -lt $DurationSeconds) {
        $sleep = [math]::Min($IntervalSeconds, $DurationSeconds - $watch.Elapsed.TotalSeconds)
        if ($sleep -le 0) { break }
        Start-Sleep -Milliseconds ([int]($sleep * 1000))
        $queryStart = $watch.Elapsed.TotalSeconds
        $cpu = $null; $coreMax = $null; $freeRam = $null; $gpu = $null
        try {
            $rows = @(Get-CimInstance -ClassName Win32_PerfFormattedData_PerfOS_Processor -OperationTimeoutSec 2 -ErrorAction Stop)
            $total = @($rows | Where-Object { $_.Name -eq '_Total' })
            if ($total.Count -eq 1) { $cpu = Get-WecogNumber $total[0].PercentProcessorTime }
            $coreValues = @($rows | Where-Object { $_.Name -match '^\d+$' } | ForEach-Object { Get-WecogNumber $_.PercentProcessorTime })
            if ($coreValues.Count -gt 0) { $coreMax = ($coreValues | Measure-Object -Maximum).Maximum }
        } catch { } # Missing counters are represented by null, never a fabricated zero.
        try {
            $memory = Get-CimInstance -ClassName Win32_PerfFormattedData_PerfOS_Memory -OperationTimeoutSec 2 -ErrorAction Stop
            $freeRam = Get-WecogNumber $memory.AvailableBytes
        } catch { }
        if ($gpuAvailable) {
            try {
                $gpu = Get-WecogGpuBusy @(Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -OperationTimeoutSec 2 -ErrorAction Stop)
            } catch { $gpuAvailable = $false }
        }
        $after = Get-WecogProcessSnapshot @(Get-Process) $EyeTrackerProcessNames
        $at = $watch.Elapsed.TotalSeconds
        $groups = Get-WecogProcessDelta $before $after ($at - $previousAt) $cores
        $self.Refresh(); $selfNow = $self.TotalProcessorTime.TotalSeconds
        $selfLoad = 100 * ($selfNow - $selfBefore) / ($at - $previousAt) / $cores
        $samples.Add(@{ elapsedSeconds = $at; cpuPercent = $cpu; busiestCorePercent = $coreMax;
            availableRamBytes = $freeRam; gpuBusiestEnginePercent = $gpu; processes = $groups;
            samplerCpuPercent = $selfLoad; querySeconds = $at - $queryStart })
        $before = $after; $previousAt = $at; $selfBefore = $selfNow
    }
    $report = @{ schemaVersion = 'windows-load.v1'; scenario = $Scenario; camera = $Camera;
        logicalProcessors = $cores; intervalSeconds = $IntervalSeconds; samples = $samples.ToArray();
        limitations = @('Read-only aggregate counters; not a camera/USB/driver or scientific validation.',
            'Browser totals include all open browsers. Shared working sets can be counted more than once.',
            'Process CPU excludes new/exited/inaccessible processes without a matched sample.',
            'GPU is the busiest physical engine, not summed engine percentages. Unsupported counters are null.',
            'Counter queries add load; inspect samplerCpuPercent and querySeconds. No system settings changed.') }
    $json = $report | ConvertTo-Json -Depth 8
    # Explicit CLI path only; do not overwrite an existing report or start a transcript.
    $file = [IO.File]::Open([IO.Path]::GetFullPath($OutputPath), [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
        $bytes = [Text.UTF8Encoding]::new($false).GetBytes($json)
        $file.Write($bytes, 0, $bytes.Length)
    } finally { $file.Dispose() }
    Write-Output 'Local load report created. No recording or upload performed.'
}

if ($MyInvocation.InvocationName -ne '.') { Invoke-WecogLoadSample }
