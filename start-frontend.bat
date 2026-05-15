@echo off
title Frontend - DO NOT CLOSE THIS WINDOW
cd /d "%~dp0frontend"
echo ============================================================
echo  Starting FRONTEND...
echo  Success = you see "Local:  http://localhost:5173/"
echo  Open that URL in your browser.
echo.
echo  KEEP THIS WINDOW OPEN (this window IS the frontend).
echo  To stop: press Ctrl + C in this window.
echo ============================================================
echo.
call npm run dev
echo.
echo Frontend stopped. Press any key to close.
pause >nul
