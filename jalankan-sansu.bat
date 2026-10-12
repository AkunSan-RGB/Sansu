@echo off
setlocal
cd /d "%~dp0"
title SANSU
echo ================================================
echo   SANSU - persiapan dan menjalankan aplikasi
echo ================================================
echo.

where node >nul 2>nul
if errorlevel 1 goto :no_node
where docker >nul 2>nul
if errorlevel 1 goto :no_docker
docker info >nul 2>nul
if errorlevel 1 goto :docker_off

echo [1/5] Memasang / memperbarui dependensi, beberapa menit pada percobaan pertama...
call npm install --no-audit --no-fund
if errorlevel 1 goto :err
rem Selalu bangun ulang paket bersama agar tipe terbaru dipakai API dan web
call npm run build -w shared
if errorlevel 1 goto :err

:env
if not exist backend\.env copy backend\.env.example backend\.env >nul
rem Database SANSU memakai port 5434 agar tidak bentrok dengan PostgreSQL lain
powershell -NoProfile -Command "(Get-Content backend\.env) -replace 'localhost:5432/akurata','localhost:5434/akurata' | Set-Content backend\.env"

echo [2/5] Menyalakan database PostgreSQL 18.6...
call npm run db:up
if errorlevel 1 goto :err

echo [3/5] Menunggu database siap, maksimal 2 menit...
set /a tries=0
:wait
docker exec akurata-db pg_isready -U akurata >nul 2>nul
if not errorlevel 1 goto :db_ready
set /a tries+=1
if %tries% geq 60 goto :db_timeout
<nul set /p "=."
timeout /t 2 /nobreak >nul
goto :wait

:db_ready
echo  siap.
timeout /t 3 /nobreak >nul

rem Matikan server SANSU lama yang mungkin masih berjalan di latar belakang (port 3000 dan 5173)
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":3000 .*LISTENING" /c:":5173 .*LISTENING"') do taskkill /F /PID %%p >nul 2>nul
echo [4/5] Menyiapkan tabel dan data demo...
call npm run db:migrate
if errorlevel 1 goto :err
call npm run db:seed
if errorlevel 1 goto :err

echo.
echo [5/5] Menjalankan SANSU. Browser terbuka otomatis setelah server siap.
echo       Alamat : http://localhost:5173
echo       Login  : admin@demo.id / demo12345
echo       Tutup jendela ini untuk menghentikan aplikasi.
echo.
start "" /b node scripts\open-when-ready.cjs
call npm run dev
goto :eof

:no_node
echo [X] Node.js belum terpasang.
echo     Unduh versi LTS di https://nodejs.org lalu jalankan file ini lagi.
goto :fail

:no_docker
echo [X] Docker Desktop belum terpasang.
echo     Unduh di https://www.docker.com/products/docker-desktop lalu jalankan file ini lagi.
goto :fail

:docker_off
echo [X] Docker Desktop belum berjalan.
echo     Buka Docker Desktop, tunggu sampai tertulis Engine running, lalu jalankan file ini lagi.
goto :fail

:db_timeout
echo.
echo [X] Database tidak kunjung siap. Status dan log terakhir container:
docker ps -a --filter name=akurata-db --format "{{.Names}}  {{.Status}}"
docker logs --tail 30 akurata-db
goto :err

:err
echo.
echo [X] Terjadi kesalahan. Salin pesan di atas dan kirimkan ke Claude.

:fail
echo.
pause
exit /b 1
