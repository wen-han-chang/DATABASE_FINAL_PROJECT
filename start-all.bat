@echo off
title Start All
echo ============================================================
echo  Launching BACKEND and FRONTEND windows, then opening browser.
echo.
echo  First time / new PC: run "install-first.bat" once before this.
echo  Also make sure SQL Server is running.
echo ============================================================
echo.

start "Backend - DO NOT CLOSE" "%~dp0start-backend.bat"
start "Frontend - DO NOT CLOSE" "%~dp0start-frontend.bat"

echo Two windows opened. Waiting ~15s for frontend to be ready...
timeout /t 15 /nobreak >nul

start "" http://localhost:5173

echo.
echo ============================================================
echo  Browser opened. Login with:
echo    email:    demo@invest.ai
echo    password: demo123
echo.
echo  Keep the BACKEND and FRONTEND windows open.
echo  You can close THIS window now.
echo ============================================================
timeout /t 8 /nobreak >nul
