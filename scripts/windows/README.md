# Read-only Windows Load Comparison

`load-sample.ps1` works in Windows PowerShell 5.1 or PowerShell 7. It does not
need administrator rights, install anything, change scheduling/registry/power
settings, capture media, or send a report anywhere. Do not disable an
organization's execution policy to run it; use an approved local shell.

Run from the repository root, in a **separate PowerShell window**:

```powershell
./scripts/windows/load-sample.ps1 -Scenario baseline -Camera external-a
./scripts/windows/load-sample.ps1 -Scenario platform -Camera external-a
./scripts/windows/load-sample.ps1 -Scenario eyetracker -Camera external-a
./scripts/windows/load-sample.ps1 -Scenario combined -Camera external-a
```

Each run lasts about five minutes, writing a new `wecog-load-*.json` in Documents.
Existing reports are never overwritten. The first observation is after two
seconds; missing/unsupported/protected counters are `null`, not zero.
`-OutputPath` optionally selects a new local file. No automatic report upload.

Use the same computer, browser, protocol, port, light and background programs.
In `baseline`, close the platform and eye tracker applications. In `platform`,
run only the platform protocol. In `eyetracker`, run only the tracker software.
In `combined`, run both. Close unrelated browser tabs and other browsers.
Repeat with `-Camera external-b` (the other camera), then optionally `internal`.
The camera label is a manual comparison label, not a device selector or verified
hardware identity. For a passive-viewing problem, include the actual long block,
not only precheck. The script never starts a protocol or tracker for you.

Process totals recognize Chrome, Edge and Firefox, and common Gazepoint process
names. If a tracker uses another executable, pass only its process name (without
`.exe`) with `-EyeTrackerProcessNames`. Unrecognized software still contributes
to system CPU/GPU totals. These names, PIDs, command lines, timestamps, account,
host, IP, camera identifiers and hardware serials are not written to the report.

## Interpretation

- `cpuPercent`: overall system CPU. A low overall value does not exclude a busy
  ordered worker; check `busiestCorePercent` too.
- `processes.*.cpuPercent`: CPU time delta normalized by logical processor count.
  Newly started, exited or inaccessible processes lack a matched delta; check
  `matchedProcesses`/`processCount`, do not interpret incomplete totals as zero.
- `workingSetSumBytes`: sum of process working sets, **not** unique physical RAM;
  shared pages can be counted multiple times. Check `availableRamBytes` separately.
- `gpuBusiestEnginePercent`: largest load of one physical GPU engine after
  combining its process instances. Different engines/GPUs are not summed. A
  driver without these optional counters produces `null`; this is not GPU idle.
- `samplerCpuPercent`/`querySeconds`: the observer has a cost too. If these are
  large, repeat without it and do not credit the platform with the observer's
  overhead. No universal low-overhead claim is made for old WMI providers.

Pair this report with the platform's bounded diagnostics: delivered camera FPS,
analysis FPS, `modelCallMs`, `workerWorkMs`, `workerRoundTripMs`, primary latency
percentiles, delegate selection, and quality/coverage. Camera/decode/USB, model
execution and shared CPU/GPU contention are different bottlenecks. Neither these
counters nor a hardware inventory alone establish which driver/USB device is at
fault. Do not change quality thresholds, timer resolution, process priority or
camera resolution to disguise a slow analysis path.

Local smoke/aggregation tests (no physical camera or tracker needed):

```powershell
./scripts/windows/load-sample.test.ps1
```

The optional GPU counter is feature-detected using local CIM. See Microsoft's
[Get-CimInstance documentation](https://learn.microsoft.com/en-us/powershell/module/cimcmdlets/get-ciminstance).
