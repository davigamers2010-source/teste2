@echo off
chcp 65001 >nul
title Atualizar Central - conexao Wix
cd /d "%~dp0"
echo ===================================================
echo   ATUALIZAR CENTRAL (conexao Wix)
echo ===================================================
echo Pasta da Central: %cd%
echo.

echo [1/5] Conferindo os arquivos...
set OKS=0
set OKI=0
findstr /c:"Wix (loja e site)" servidor.js >nul 2>nul && set OKS=1
findstr /c:"no Wix e nas plataformas" index.html >nul 2>nul && set OKI=1
if "%OKS%%OKI%"=="11" (
  echo Os arquivos desta pasta ja sao a versao nova. Nao precisa copiar nada.
  goto encerrar
)
echo Procurando os arquivos novos em Downloads...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
 "$d=Join-Path $env:USERPROFILE 'Downloads';" ^
 "$s=Get-ChildItem $d -Filter 'servidor*.js' -ErrorAction SilentlyContinue | Where-Object { Select-String -Path $_.FullName -SimpleMatch 'Wix (loja e site)' -Quiet } | Sort-Object LastWriteTime -Descending | Select-Object -First 1;" ^
 "$i=Get-ChildItem $d -Filter 'index*.html' -ErrorAction SilentlyContinue | Where-Object { Select-String -Path $_.FullName -SimpleMatch 'no Wix e nas plataformas' -Quiet } | Sort-Object LastWriteTime -Descending | Select-Object -First 1;" ^
 "if(-not $s -or -not $i){ Write-Host 'NAO ACHEI os arquivos novos em Downloads.'; exit 1 };" ^
 "$root=Join-Path (Get-Location) 'backups'; New-Item -ItemType Directory -Force -Path $root | Out-Null; $b=Join-Path $root ('backup-'+(Get-Date -Format 'yyyyMMdd-HHmmss')); New-Item -ItemType Directory -Path $b | Out-Null;" ^
 "foreach($f in 'servidor.js','index.html'){ if(Test-Path $f){ Copy-Item $f (Join-Path $b $f) } };" ^
 "Copy-Item $s.FullName 'servidor.js' -Force; Copy-Item $i.FullName 'index.html' -Force;" ^
 "Write-Host ('Copiado: '+$s.Name+' e '+$i.Name); Write-Host ('Copia dos arquivos antigos em: '+$b)"
if errorlevel 1 (
  echo.
  echo Baixe de novo o servidor.js e o index.html no chat ^(ficam em Downloads^) e abra este arquivo outra vez.
  pause
  exit /b
)
echo.

echo [2/5] Conferindo a versao instalada...
findstr /c:"Wix (loja e site)" servidor.js >nul 2>nul
if errorlevel 1 (
  echo ERRO: o servidor.js desta pasta nao e a versao nova.
  pause
  exit /b
)
findstr /c:"no Wix e nas plataformas" index.html >nul 2>nul
if errorlevel 1 (
  echo ERRO: o index.html desta pasta nao e a versao nova.
  pause
  exit /b
)
echo servidor.js e index.html: versao nova ^(ok^).
echo.

:encerrar
echo [3/5] Encerrando o servidor antigo...
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

echo [4/5] Iniciando a Central nova...
start "Central de Agentes" cmd /c iniciar.bat
timeout /t 6 >nul
echo.

echo [5/5] Conferindo o que esta respondendo na porta 3100:
curl -s http://localhost:3100/api/ping
echo.
echo.
curl -s http://localhost:3100/api/conexoes | findstr /c:"Wix (loja e site)" >nul
if errorlevel 1 (
  echo ATENCAO: o servidor no ar ainda nao tem a conexao Wix.
  echo Tire um print desta janela e me envie.
) else (
  echo TUDO CERTO: o Wix ja aparece em Conexoes. Na pagina aberta, aperte CTRL + F5.
)
echo.
pause
