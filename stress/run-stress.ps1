param(
    [ValidateSet('up', 'down', 'status')]
    [string]$Action = 'status',
    [int]$Count = 100,
    [int]$Rate = 100,
    [int]$PayloadBytes = 256,
    [string]$Prefix = 'mdm-stress',
    [string]$Image = 'misaka-docker-monitor-loadgen:latest',
    [string]$LogFormat = 'json'
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$loadgenDir = Join-Path $scriptDir 'loadgen'
$label = 'misaka.stress=true'

function Get-StressContainers {
    docker ps -a --filter "label=$label" --format "{{.Names}}"
}

function Build-Image {
    Write-Host "Building stress image $Image..."
    docker build -t $Image $loadgenDir
}

function Remove-Containers {
    $containers = Get-StressContainers
    if (-not $containers) {
        Write-Host 'No stress containers found.'
        return
    }

    foreach ($name in $containers) {
        if ([string]::IsNullOrWhiteSpace($name)) {
            continue
        }

        Write-Host "Removing $name"
        docker rm -f $name | Out-Null
    }
}

switch ($Action) {
    'down' {
        Remove-Containers
        exit 0
    }
    'status' {
        docker ps -a --filter "label=$label" --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"
        exit 0
    }
}

Build-Image
Remove-Containers

for ($i = 1; $i -le $Count; $i++) {
    $name = "{0}-{1:d3}" -f $Prefix, $i
    Write-Host "Starting $name"
    docker run -d `
        --name $name `
        --label $label `
        -e RATE=$Rate `
        -e PAYLOAD_BYTES=$PayloadBytes `
        -e CONTAINER_NAME=$name `
        -e LOG_FORMAT=$LogFormat `
        $Image | Out-Null
}

Write-Host "Started $Count containers at $Rate logs/sec each."
Write-Host "Expected total throughput: $($Count * $Rate) logs/sec."
