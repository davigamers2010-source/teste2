@echo off
chcp 65001 >nul
title Atualizar Central - Aba Whats
cd /d "%~dp0"
echo ===================================================
echo   ATUALIZAR CENTRAL (aba Whats - WhatsApp por QR)
echo ===================================================
echo Pasta da Central: %cd%
echo.
echo [1/4] Copiando os arquivos novos de Downloads...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
 "$d=Join-Path $env:USERPROFILE 'Downloads';" ^
 "$root=Join-Path (Get-Location) 'backups'; New-Item -ItemType Directory -Force -Path $root | Out-Null; $b=Join-Path $root ('backup-'+(Get-Date -Format 'yyyyMMdd-HHmmss')); New-Item -ItemType Directory -Path $b | Out-Null;" ^
 "foreach($f in 'servidor.js','index.html','whats.js','package.json'){ if(Test-Path $f){ Copy-Item $f (Join-Path $b $f) } };" ^
 "$m=@{'servidor.js'='abas-20-whats';'index.html'='whaAbrir';'whats.js'='whats-sessao';'package.json'='baileys'};" ^
 "foreach($k in $m.Keys){ $base=[IO.Path]::GetFileNameWithoutExtension($k); $ext=[IO.Path]::GetExtension($k);" ^
 " $x=Get-ChildItem $d -Filter ($base+'*'+$ext) -ErrorAction SilentlyContinue | Where-Object { Select-String -Path $_.FullName -Pattern $m[$k] -Quiet } | Sort-Object LastWriteTime -Descending | Select-Object -First 1;" ^
 " if(-not $x){ Write-Host ('NAO ACHEI '+$k+' novo em Downloads.'); exit 1 }; Copy-Item $x.FullName $k -Force; Write-Host ('Copiado: '+$x.Name+' -> '+$k) };" ^
 "Write-Host ('Copia dos antigos em: '+$b)"
if errorlevel 1 (
  echo.
  echo Baixe de novo servidor.js, index.html, whats.js e package.json no chat e abra este arquivo outra vez.
  pause
  exit /b
)
echo.
echo [2/4] Instalando a biblioteca do WhatsApp ^(precisa de internet, so na primeira vez^)...
where npm >nul 2>nul
if errorlevel 1 (
  echo ERRO: o Node.js/npm nao foi encontrado. Instale o Node.js 18 ou mais novo em nodejs.org.
  pause
  exit /b
)
call npm install --omit=dev --no-audit --no-fund
if errorlevel 1 (
  echo ERRO: nao consegui instalar as bibliotecas. Verifique a internet e tente de novo.
  pause
  exit /b
)
echo.
echo [3/4] Encerrando o servidor antigo...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":3100 .*LISTENING"') do taskkill /F /PID %%P >nul 2>nul
taskkill /F /IM node.exe /T >nul 2>nul
timeout /t 3 >nul
netstat -ano | findstr /R /C:":3100 .*LISTENING" >nul
if not errorlevel 1 (
  echo NAO CONSEGUI fechar o servidor antigo. Clique com o botao direito neste arquivo e escolha "Executar como administrador".
  pause
  exit /b
)
echo.
echo [4/4] Abrindo a Central nova...
if exist iniciar.bat ( call iniciar.bat ) else ( start "Central" cmd /k node servidor.js )
