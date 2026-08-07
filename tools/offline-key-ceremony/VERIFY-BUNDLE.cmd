@echo off
setlocal
cd /d "%~dp0"
node.exe verify-bundle.js
pause
exit /b %errorlevel%
