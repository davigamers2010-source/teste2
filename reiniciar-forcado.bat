@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ==== PASTA DESTE ARQUIVO: %cd%
findstr /c:"abas-17" servidor.js >nul 2>nul
if errorlevel 1 (
  echo O servidor.js DESTA pasta e antigo. Copie o servidor.js novo para ESTA pasta.
  pause
  exit /b
)
echo servidor.js desta pasta: NOVO. Encerrando todos os servidores antigos...
taskkill /F /IM node.exe /T >nul 2>nul
timeout /t 3 >nul
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":3100 .*LISTENING"') do taskkill /F /PID %%P >nul 2>nul
timeout /t 2 >nul
start "Central" cmd /k "cd /d "%~dp0" && node servidor.js"
echo Aguardando o servidor novo subir...
timeout /t 5 >nul
echo.
echo ==== O que esta respondendo na porta 3100 agora:
curl -s http://localhost:3100/api/ping
echo.
echo.
echo Se acima aparecer "abas-17" e a pasta acima for esta mesma, esta tudo certo: abra http://localhost:3100 e aperte Ctrl+F5.
echo Se aparecer outra versao ou outra pasta, tire um print desta janela e me envie.
pause
