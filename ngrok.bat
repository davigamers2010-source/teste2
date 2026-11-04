@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist "%~dp0ngrok-dominio.txt" (
  echo Arquivo ngrok-dominio.txt nao encontrado.
  echo Informe nele o dominio reservado na sua conta ngrok.
  pause
  exit /b 1
)

set /p NGROK_DOMAIN=<"%~dp0ngrok-dominio.txt"
if "%NGROK_DOMAIN%"=="" (
  echo ngrok-dominio.txt esta vazio.
  echo Informe nele o dominio reservado na sua conta ngrok.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale-o ou abra iniciar.bat primeiro.
  pause
  exit /b 1
)

where ngrok >nul 2>nul
if errorlevel 1 if not exist "%LOCALAPPDATA%\Microsoft\WinGet\Links\ngrok.exe" (
  echo Ngrok nao encontrado. Execute configurar-ngrok.bat primeiro.
  pause
  exit /b 1
)

start "Central de Agentes" cmd /c iniciar.bat
timeout /t 4 >nul
node tunel.js
pause
