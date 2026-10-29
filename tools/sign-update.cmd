@echo off
chcp 65001 >nul
setlocal
rem اسحب ملف LE-JOKER-POS-Setup-X.Y.Z.exe وأفلته فوق هذا الملف
set "EXE=%~1"
if "%EXE%"=="" (
  echo.
  echo  اسحب ملف التثبيت .exe وأفلته فوق sign-update.cmd
  echo  Drag the Setup .exe file and drop it onto sign-update.cmd
  pause
  exit /b 1
)
set "NODE=C:\Program Files\LE JOKER POS\node\node.exe"
if not exist "%NODE%" set "NODE=node"
set "KEY=%~dp0private-key.pem"
if not exist "%KEY%" (
  echo.
  echo  اسحب ملف private-key.pem إلى هذه النافذة ثم اضغط Enter:
  echo  Drag private-key.pem into this window then press Enter:
  set /p "KEY="
)
echo.
echo  ملاحظات الإصدار (اختياري) ثم Enter / Release notes (optional):
set /p "NOTES="
"%NODE%" "%~dp0sign-update.js" "%EXE%" "%KEY%" %NOTES%
echo.
pause
