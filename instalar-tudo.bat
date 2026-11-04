@echo off
chcp 65001 >nul
title Instalar Cerebro IA + Notas fiscais + WhatsApp
cd /d "%~dp0"
echo ===================================================
echo   INSTALAR: Cerebro IA, Notas fiscais e WhatsApp
echo   (mantem a sua versao atual da Central)
echo ===================================================
echo Pasta: %cd%
echo.
where node >nul 2>nul
if errorlevel 1 ( echo Node.js nao encontrado. Abra primeiro o iniciar.bat. & pause & exit /b )
if not exist servidor.js ( echo ERRO: servidor.js nao esta nesta pasta. Copie instalar-tudo.bat e instalar-tudo.js para a pasta da Central. & pause & exit /b )
if not exist instalar-tudo.js ( echo ERRO: falta o arquivo instalar-tudo.js nesta pasta. & pause & exit /b )
echo [1/4] Encaixando as novidades nos seus arquivos...
node instalar-tudo.js
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
timeout /t 7 >nul
echo.
echo [4/4] Conferindo:
curl -s http://localhost:3100/api/ping
echo.
curl -s http://localhost:3100/api/whatsapp | findstr /c:"intervaloMin" >nul
if errorlevel 1 ( echo ATENCAO: o servidor novo nao respondeu. Envie o arquivo instalar-tudo-log.txt e um print desta janela. ) else ( echo TUDO CERTO. Na pagina aberta, aperte CTRL + F5: aparecem as abas Cerebro IA, Notas fiscais e WhatsApp. )
echo.
pause
