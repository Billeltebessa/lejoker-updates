@echo off
setlocal
rem Drag LE-JOKER-POS-Setup-X.Y.Z.exe and drop it onto this file.
rem Keep this file and sign-update.js in the same folder as private-key.pem.
set "EXE=%~1"
if "%EXE%"=="" (
  echo.
  echo  Drag the Setup .exe file and drop it onto sign-update.cmd
  pause
  exit /b 1
)
set "NODE=C:\Program Files\LE JOKER POS\node\node.exe"
if not exist "%NODE%" set "NODE=node"
echo.
echo  Release notes in English (optional), then Enter:
set /p "NOTES="
"%NODE%" "%~dp0sign-update.js" "%EXE%" "%~dp0private-key.pem" %NOTES%
echo.
pause
