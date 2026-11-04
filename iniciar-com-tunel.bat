@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Abra primeiro o iniciar.bat para instalar.
  pause
  exit /b
)
where cloudflared >nul 2>nul
if errorlevel 1 if not exist "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" if not exist "%ProgramFiles%\cloudflared\cloudflared.exe" (
  echo Instalando o cloudflared automaticamente, aguarde...
  winget install -e --id Cloudflare.cloudflared --accept-source-agreements --accept-package-agreements
)
where py >nul 2>nul
if not errorlevel 1 goto iniciar_python
where python >nul 2>nul
if errorlevel 1 (
  echo Python 3 nao encontrado. Instale pelo site https://www.python.org/downloads/
  pause
  exit /b 1
)
start "Central de Agentes" cmd /c iniciar.bat
python tunel.py
goto fim

:iniciar_python
start "Central de Agentes" cmd /c iniciar.bat
py -3 tunel.py

:fim
pause
