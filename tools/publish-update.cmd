@echo off
setlocal
rem LE JOKER POS - publish an update with one double-click.
rem Keep this file and publish-update.js in the SAME folder as private-key.pem (the keys folder).
chcp 65001 >nul
set "NODE=C:\Program Files\LE JOKER POS\node\node.exe"
if not exist "%NODE%" set "NODE=node"
"%NODE%" --disable-warning=ExperimentalWarning "%~dp0publish-update.js" %*
echo.
pause
