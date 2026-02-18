@echo off
setlocal EnableExtensions

set "ROOT_DIR=%~dp0"
pushd "%ROOT_DIR%" >nul

call :ensure_node
if errorlevel 1 goto :fail

where npm >nul 2>nul
if errorlevel 1 (
  echo [setup] npm is not available. Reinstall Node.js LTS and retry.
  goto :fail
)

echo [setup] Installing npm dependencies...
call npm install
if errorlevel 1 goto :fail

echo [setup] Starting development environment...
call npm run dev
if errorlevel 1 goto :fail

popd >nul
exit /b 0

:ensure_node
where node >nul 2>nul
if not errorlevel 1 (
  for /f "delims=" %%v in ('node -v') do echo [setup] Node found: %%v
  exit /b 0
)

echo [setup] Node.js not found. Trying winget install...
where winget >nul 2>nul
if errorlevel 1 (
  echo [setup] winget is not available.
  echo [setup] Install Node.js LTS manually and retry:
  echo [setup] https://nodejs.org/en/download
  exit /b 1
)

winget install --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
if errorlevel 1 (
  echo [setup] winget installation failed.
  echo [setup] Install Node.js LTS manually and retry:
  echo [setup] https://nodejs.org/en/download
  exit /b 1
)

if exist "%ProgramFiles%\nodejs\node.exe" (
  set "PATH=%ProgramFiles%\nodejs;%PATH%"
)

where node >nul 2>nul
if errorlevel 1 (
  echo [setup] Node.js was installed but not found in PATH in this session.
  echo [setup] Close and reopen terminal, then run this file again.
  exit /b 1
)

for /f "delims=" %%v in ('node -v') do echo [setup] Node found: %%v
exit /b 0

:fail
popd >nul
exit /b 1
