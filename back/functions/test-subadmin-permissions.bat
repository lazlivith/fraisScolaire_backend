@echo off
echo Test des permissions sous-admin
echo ==============================
echo.

cd /d "%~dp0"
node test-subadmin-permissions.js

echo.
echo Test termine
pause
