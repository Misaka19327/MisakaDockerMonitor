# Stress Test

This directory contains a simple pressure-test harness for `MisakaDockerMonitor`.

## What it tests

- Many watched containers at the same time.
- High log throughput per container.
- Backpressure in the collector buffer and batch flush path.
- Monitor process memory growth and API latency while load is active.

## Files

- `loadgen/`: tiny Docker image that emits JSON or text logs at a fixed rate.
- `run-stress.ps1`: starts or removes many log generator containers.
- `sample-monitor.ps1`: authenticates to the monitor and samples runtime stats.

## Suggested stages

1. Warm-up: `20 containers x 50 logs/s`
2. Medium: `50 containers x 100 logs/s`
3. Target: `100 containers x 100 logs/s`

At the target stage the monitor will ingest about `10,000 logs/s`.

## Run

1. Start the monitor with the storage backend you actually plan to use.
2. Start generators:

```powershell
.\stress\run-stress.ps1 -Action up -Count 20 -Rate 50 -PayloadBytes 256
```

3. Sample the monitor for 60 seconds:

```powershell
.\stress\sample-monitor.ps1 -BaseUrl http://127.0.0.1:3000 -DurationSeconds 60 -IntervalSeconds 5
```

4. Scale up:

```powershell
.\stress\run-stress.ps1 -Action up -Count 50 -Rate 100 -PayloadBytes 256
.\stress\sample-monitor.ps1 -DurationSeconds 120 -IntervalSeconds 5

.\stress\run-stress.ps1 -Action up -Count 100 -Rate 100 -PayloadBytes 256
.\stress\sample-monitor.ps1 -DurationSeconds 120 -IntervalSeconds 5
```

5. Clean up:

```powershell
.\stress\run-stress.ps1 -Action down
```

## How to read the results

- `bufferedEntries` keeps climbing:
  the collector cannot flush as fast as Docker delivers logs.
- `lastFlushDurationMs` trends upward:
  storage writes are becoming the bottleneck.
- `rssBytes` or `heapUsedBytes` keeps rising without dropping:
  memory pressure is building.
- `latencyMs` on the sample script rises sharply:
  the API thread is being starved by collection or storage work.
- `totalFlushErrors` becomes non-zero:
  storage is failing under load.

## Current expectation for this repo

With the current design, `100 x 100 logs/s` is a meaningful risk scenario when using SQLite and a live log page:

- every log line is parsed synchronously in the collector,
- all watched containers share one in-process buffer,
- SQLite writes happen in one process with frequent transactions,
- live log pages broadcast each inserted row over SSE,
- the log viewer keeps an ever-growing in-memory map of pushed entries.

That does not guarantee a crash, but it is enough to expect lag, memory growth, or UI degradation before you should feel comfortable calling it safe.
