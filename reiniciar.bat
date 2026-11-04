@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Pasta: %cd%
findstr /c:"contas-34" servidor.js >nul 2>nul
if errorlevel 1 (
  echo.
  echo O servidor.js desta pasta nao e a versao atual esperada.
  echo Execute atualizar.bat para atualizar os arquivos primeiro.
  pause
  exit /b 1
)
echo Servidor atual encontrado.
echo Verificando o que esta usando a porta 3100...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$root=(Resolve-Path '.').Path; $owners=Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; foreach($owner in $owners){$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$owner); if(-not $p -or $p.CommandLine -notmatch 'servidor\.js' -or $p.CommandLine.IndexOf($root,[StringComparison]::OrdinalIgnoreCase) -lt 0){Write-Error ('A porta 3100 pertence a outro programa (PID '+$owner+'). Nenhum processo foi encerrado.'); exit 1}; try{Stop-Process -Id $owner -Force -ErrorAction Stop}catch{Write-Error ('Nao consegui encerrar o servidor (PID '+$owner+'): '+$_.Exception.Message); exit 1}}"
if errorlevel 1 (
  echo.
  echo Feche manualmente a janela preta antiga da Central e tente de novo.
  echo Se o acesso for negado, execute este arquivo como administrador.
  pause
  exit /b 1
)
timeout /t 2 /nobreak >nul
netstat -ano | findstr /R /C:":3100 .*LISTENING" >nul
if not errorlevel 1 (
  echo.
  echo A porta 3100 continua ocupada. Feche o servidor antigo e tente novamente.
  pause
  exit /b 1
)
echo Porta 3100 livre. Abrindo a Central atual...
call iniciar.bat
