@echo off
rem One-click update (Windows). Fetches the latest Refrain code and installs
rem any new dependencies. Double-click to run, then relaunch Refrain.
rem Your config.json and .env are never touched.
setlocal
cd /d "%~dp0\.."

if not exist ".git" (
  echo This copy of Refrain wasn't set up with Git, so it can't update itself.
  echo To update: download the latest ZIP from GitHub, unzip it to a new
  echo folder, and copy your config.json and .env into it before starting it.
  pause
  exit /b 1
)

echo Fetching the latest version...
call git pull --ff-only
if errorlevel 1 (
  echo.
  echo Update could not complete automatically. See the message above.
  pause
  exit /b 1
)

echo Installing any new dependencies...
call npm install

echo.
echo Update complete. Close Refrain and start it again to finish.
pause
