@echo off
setlocal
title File Database (Portable)

rem =====================================================================
rem  File Database - portable launcher (no install, no admin required).
rem
rem  Launches the copy of Microsoft Edge / Google Chrome that is already
rem  on this PC in a clean app window, with its data profile kept on THIS
rem  drive (the "data" folder next to this script). Your files therefore
rem  live on the USB stick and nothing is left behind on the computer.
rem =====================================================================

rem Folder this script lives in (ends with a backslash) - works on any drive letter.
set "HERE=%~dp0"
set "URL=file:///%HERE:\=/%app/index.html"
set "DATA=%HERE%data"
if not exist "%DATA%" mkdir "%DATA%"

rem --allow-file-access-from-files lets the local apps load their data files.
set "ARGS=--user-data-dir=%DATA% --allow-file-access-from-files --no-first-run --no-default-browser-check"

rem 1) Microsoft Edge (present on virtually every Windows work PC)
set "BROWSER="
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if defined BROWSER (
  start "" "%BROWSER%" --app="%URL%" %ARGS%
  goto :eof
)

rem 2) Google Chrome (Program Files or per-user install)
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "BROWSER=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if defined BROWSER (
  start "" "%BROWSER%" --app="%URL%" %ARGS%
  goto :eof
)

echo Could not find Microsoft Edge or Google Chrome in the usual locations.
echo.
echo You can still open the app manually - double-click:
echo    %HERE%app\index.html
echo.
echo (In that fallback the vault is stored in the PC's browser, not on the USB -
echo  use the app's Export / Import backup buttons to move your data instead.)
echo.
pause
