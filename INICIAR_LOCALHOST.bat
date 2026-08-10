@echo off
setlocal
cd /d "%~dp0"
echo.
echo ==========================================
echo   CivilOff N-DIT - Servidor localhost
ECHO ==========================================
echo.
where python >nul 2>nul
if errorlevel 1 (
  echo Python nao foi encontrado no PATH.
  echo Instale o Python e marque "Add python.exe to PATH".
  pause
  exit /b 1
)
start "" "http://localhost:8080"
python -m http.server 8080
endlocal
