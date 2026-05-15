@echo off
title Install (run once)
echo ============================================================
echo  Run this ONCE on first use or on a new PC.
echo  It installs packages and seeds base stock data.
echo.
echo  Before running, make sure:
echo   1. SQL Server is running
echo   2. database\schema.sql already executed in SSMS
echo   3. backend\.env exists and is filled in
echo ============================================================
echo.
pause

echo.
echo [1/3] Installing backend packages (first time is slow)...
cd /d "%~dp0backend"
call npm install
if errorlevel 1 goto fail

echo.
echo [2/3] Seeding base stock data into the database...
call node seed.js
if errorlevel 1 goto fail

echo.
echo [3/3] Installing frontend packages...
cd /d "%~dp0frontend"
call npm install
if errorlevel 1 goto fail

echo.
echo ============================================================
echo  DONE. From now on just double-click "start-all.bat".
echo ============================================================
pause
exit /b 0

:fail
echo.
echo ============================================================
echo  ERROR during install. See the red message above.
echo  Common causes: Node.js not installed / SQL Server not
echo  running / tables not created yet.
echo ============================================================
pause
exit /b 1
