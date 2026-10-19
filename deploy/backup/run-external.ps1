# Menjalankan backup/uji pemulihan database di LUAR server SANSU memakai Docker Desktop (Windows), tanpa GitHub Actions.
#   .\run-external.ps1 dump
#   .\run-external.ps1 restore-test
# Butuh: Docker Desktop berjalan, dan berkas backup.env (salin dari backup.env.example). Lihat docs/OPERASIONAL.md.
param([ValidateSet('dump', 'restore-test')][string]$Mode = 'dump', [string]$EnvFile = 'backup.env')
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Test-Path $EnvFile)) { Write-Error "Berkas $EnvFile tidak ada. Salin backup.env.example menjadi backup.env lalu isi."; exit 1 }

docker build -q -t sansu-backup:latest . | Out-Null
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if ($Mode -eq 'dump') {
  docker run --rm --env-file $EnvFile --entrypoint external-backup.sh sansu-backup:latest dump
  exit $LASTEXITCODE
}

$net = 'sansu-backup-net'; $db = 'sansu-backup-scratch'
function Clean { docker rm -f $db 2>&1 | Out-Null; docker network rm $net 2>&1 | Out-Null }
$ErrorActionPreference = 'Continue'
Clean
try {
  docker network create $net | Out-Null
  docker run -d --name $db --network $net -e POSTGRES_PASSWORD=scratch -e POSTGRES_DB=scratch postgres:18.6 | Out-Null
  $ready = $false
  for ($i = 0; $i -lt 30 -and -not $ready; $i++) {
    docker exec $db pg_isready -U postgres -d scratch 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true } else { Start-Sleep -Seconds 2 }
  }
  if (-not $ready) { Write-Error 'Database sementara tidak siap'; exit 1 }
  docker run --rm --network $net --env-file $EnvFile -e "RESTORE_TARGET_URL=postgresql://postgres:scratch@${db}:5432/scratch" --entrypoint external-backup.sh sansu-backup:latest restore-test
  exit $LASTEXITCODE
} finally { Clean }
