param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('dockerhub', 'ghcr')]
    [string]$Registry,

    [Parameter(Mandatory = $true)]
    [string]$Owner,

    [string]$SourceImage = 'cencurity-community:2026-03-12-secfix',
    [switch]$Login,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

if ($Registry -eq 'ghcr') {
    $targetImage = "ghcr.io/$Owner/cencurity-community:2026-03-12-secfix"
    if ($Login) {
        docker login ghcr.io
    }
} else {
    $targetImage = "$Owner/cencurity-community:2026-03-12-secfix"
    if ($Login) {
        docker login
    }
}

Write-Host "Source image: $SourceImage"
Write-Host "Target image: $targetImage"

docker image inspect $SourceImage | Out-Null

if ($DryRun) {
    Write-Host '[DryRun] docker tag' $SourceImage $targetImage
    Write-Host '[DryRun] docker push' $targetImage
} else {
    docker tag $SourceImage $targetImage
    docker push $targetImage
}

Write-Host ''
Write-Host 'Set this in cencurity/.env:'
Write-Host "CENCURITY_IMAGE=$targetImage"
Write-Host 'CENCURITY_PULL_POLICY=always'
Write-Host ''
Write-Host 'Then redeploy with:'
Write-Host 'docker compose -f cencurity/docker-compose.yml pull'
Write-Host 'docker compose -f cencurity/docker-compose.yml up -d --force-recreate'
