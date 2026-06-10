param(
    [string]$BaseUrl = 'http://127.0.0.1:3000',
    [string]$Username = 'admin',
    [string]$Password = 'change-me',
    [string]$ContainerPrefix = 'mdm-stress',
    [int]$DurationSeconds = 60,
    [int]$IntervalSeconds = 5
)

$ErrorActionPreference = 'Stop'

function Invoke-JsonRequest {
    param(
        [string]$Method,
        [string]$Url,
        [object]$Body = $null,
        [hashtable]$Headers = @{}
    )

    $invokeArgs = @{
        Method      = $Method
        Uri         = $Url
        Headers     = $Headers
        ContentType = 'application/json'
    }

    if ($null -ne $Body) {
        $invokeArgs.Body = ($Body | ConvertTo-Json -Depth 5)
    }

    Invoke-RestMethod @invokeArgs
}

$login = Invoke-JsonRequest -Method Post -Url "$BaseUrl/api/auth/login" -Body @{
    username = $Username
    password = $Password
}

$headers = @{
    Authorization = "Bearer $($login.token)"
}

$deadline = (Get-Date).AddSeconds($DurationSeconds)
$samples = @()

while ((Get-Date) -lt $deadline) {
    $startedAt = Get-Date
    $runtime = Invoke-JsonRequest -Method Get -Url "$BaseUrl/api/debug/runtime" -Headers $headers
    $containers = Invoke-JsonRequest -Method Get -Url "$BaseUrl/api/containers" -Headers $headers
    $latencyMs = [math]::Round(((Get-Date) - $startedAt).TotalMilliseconds, 2)
    $stressContainers = @($containers | Where-Object { $_.name -like "$ContainerPrefix*" })

    $sample = [pscustomobject]@{
        timestamp             = (Get-Date).ToString('o')
        latencyMs             = $latencyMs
        watchedContainers     = $runtime.collector.watchedContainers
        bufferedEntries       = $runtime.collector.bufferedEntries
        maxBufferedEntries    = $runtime.collector.maxBufferedEntries
        totalLinesReceived    = $runtime.collector.totalLinesReceived
        totalEntriesInserted  = $runtime.collector.totalEntriesInserted
        totalEntriesBroadcast = $runtime.collector.totalEntriesBroadcast
        totalFlushes          = $runtime.collector.totalFlushes
        totalFlushErrors      = $runtime.collector.totalFlushErrors
        lastFlushDurationMs   = $runtime.collector.lastFlushDurationMs
        rssBytes              = $runtime.process.rssBytes
        heapUsedBytes         = $runtime.process.heapUsedBytes
        stressContainers      = $stressContainers.Count
    }

    $samples += $sample
    $sample | Format-List
    Start-Sleep -Seconds $IntervalSeconds
}

$samples | ConvertTo-Json -Depth 5
