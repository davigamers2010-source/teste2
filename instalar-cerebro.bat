@echo off
chcp 65001 >nul
title Instalar Cerebro IA na Central
cd /d "%~dp0"
echo ===================================================
echo   INSTALAR CEREBRO IA (mantem a sua versao atual)
echo ===================================================
echo Pasta da Central: %cd%
echo.
where node >nul 2>nul
if errorlevel 1 ( echo Node.js nao encontrado. & pause & exit /b )
if not exist servidor.js ( echo ERRO: servidor.js nao esta nesta pasta. Copie este arquivo e o instalar-cerebro.js para a pasta da Central. & pause & exit /b )
echo [1/4] Encaixando o Cerebro nos seus arquivos...
node instalar-cerebro.js
if errorlevel 1 ( echo. & pause & exit /b )
echo.
echo [2/4] Encerrando o servidor antigo...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":3100 .*LISTENING"') do taskkill /F /PID %%P >nul 2>nul
taskkill /F /IM node.exe /T >nul 2>nul
timeout /t 3 >nul
netstat -ano | findstr /R /C:":3100 .*LISTENING" >nul
if not errorlevel 1 (
  echo NAO CONSEGUI fechar o servidor antigo. Clique com o botao direito neste arquivo
  echo e escolha "Executar como administrador".
  pause
  exit /b
)
echo Porta 3100 livre.
echo.
echo [3/4] Iniciando a Central...
start "Central de Agentes" cmd /c iniciar.bat
timeout /t 6 >nul
echo.
echo [4/4] Conferindo:
curl -s http://localhost:3100/api/ping
echo.
curl -s http://localhost:3100/api/cerebro | findstr /c:"config" >nul
if errorlevel 1 (
  echo ATENCAO: o Cerebro nao respondeu. Tire um print desta janela e me envie.
) else (
  echo TUDO CERTO: Cerebro no ar. Na pagina aberta, aperte CTRL + F5 e abra a aba Cerebro IA.
)
echo.
pause
