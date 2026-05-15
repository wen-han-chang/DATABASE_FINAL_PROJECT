@echo off
title Backend - DO NOT CLOSE THIS WINDOW
cd /d "%~dp0backend"
echo ============================================================
echo  Starting BACKEND...
echo  Success = you see "Backend is running at http://localhost:3001"
echo  and "[db] Connected to SQL Server".
echo.
echo  KEEP THIS WINDOW OPEN (this window IS the backend).
echo  To stop: press Ctrl + C in this window.
echo ============================================================
echo.
call npm run dev
echo.
echo Backend stopped. Press any key to close.
pause >nul
