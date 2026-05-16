@echo off
title Clear Stock Data (type yes to confirm)
cd /d "%~dp0backend"
echo ============================================================
echo  This will DELETE all stock price data (stock_daily_bars
echo  and stock_sync). Accounts / trades / stock catalog are NOT
echo  touched. You must type  yes  to confirm.
echo ============================================================
echo.
node clear-stock-data.js
echo.
echo (You can close this window now.)
pause
