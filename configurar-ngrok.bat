@echo off
chcp 65001 >nul
cd /d "%~dp0"

where winget >nul 2>nul
if errorlevel 1 (
  echo O winget nao esta disponivel neste computador.
  echo Instale o ngrok pelo site oficial: https://ngrok.com/download
  echo Depois, configure seu token com: ngrok config add-authtoken SEU_TOKEN
  pause
  exit /b 1
)

where ngrok >nul 2>nul
if not errorlevel 1 goto configurado

echo Instalando o ngrok oficial pelo winget...
winget install -e --id Ngrok.Ngrok --accept-source-agreements --accept-package-agreements
if errorlevel 1 (
  echo A instalacao automatica falhou.
  echo Instale pelo site oficial: https://ngrok.com/download
  pause
  exit /b 1
)

:configurado
echo.
echo Configure o authtoken da sua conta ngrok:
echo   1. Acesse https://dashboard.ngrok.com/get-started/your-authtoken
echo   2. Copie seu token e execute no PowerShell:
echo      ngrok config add-authtoken SEU_TOKEN
echo.
echo Nao compartilhe seu authtoken.
echo Depois, abra ngrok.bat para iniciar o tunel.
pause
