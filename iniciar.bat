@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instalando automaticamente, aguarde...
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  echo.
  echo Se a instalacao terminou, feche esta janela e abra o iniciar.bat novamente.
  echo Se deu erro, instale em https://nodejs.org e abra este arquivo de novo.
  pause
  exit /b
)
node -e "process.exit(+process.versions.node.split('.')[0]>=18?0:1)"
if errorlevel 1 (
  echo Seu Node.js e antigo. Atualizando automaticamente...
  winget upgrade -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  echo Feche esta janela e abra o iniciar.bat novamente.
  pause
  exit /b
)
start "" /min cmd /c "timeout /t 2 >nul && start http://localhost:3100"
:inicio
node "%~dp0servidor.js"
if errorlevel 2 (
  echo A porta 3100 ja estava em uso. Pode ser uma Central ANTIGA aberta: use o reiniciar.bat ^(como administrador^).
  timeout /t 3 >nul
  exit /b
)
echo O servidor parou. Reiniciando em 3 segundos... (feche esta janela para sair)
timeout /t 3 >nul
goto inicio
