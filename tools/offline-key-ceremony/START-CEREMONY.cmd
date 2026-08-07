@echo off
setlocal
cd /d "%~dp0"
node.exe verify-bundle.js || exit /b 1
echo.
node.exe ceremony.js
exit /b %errorlevel%
