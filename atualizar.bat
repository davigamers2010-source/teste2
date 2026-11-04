@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo  Atualizando a Central de Agentes
echo ============================================
echo.
echo [1/4] Procurando arquivos novos na pasta Downloads...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=Join-Path $env:USERPROFILE 'Downloads'; $c='%~dp0'; foreach($p in @(@('servidor*.js','servidor.js'),@('index*.html','index.html'))){ $f=Get-ChildItem -Path $d -Filter $p[0] -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1; $dest=Join-Path $c $p[1]; if($f -and ((-not (Test-Path $dest)) -or $f.LastWriteTime -gt (Get-Item $dest).LastWriteTime)){ Copy-Item $f.FullName $dest -Force; Write-Host ('  Copiado: '+$f.Name+' -> '+$p[1]) } else { Write-Host ('  Sem arquivo mais novo para '+$p[1]+' (usando o que ja esta na pasta)') } }"
echo.
echo [2/4] Fechando o servidor antigo (porta 3100)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$root=(Resolve-Path '.').Path; $owners=Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; foreach($owner in $owners){$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$owner); if(-not $p -or $p.CommandLine -notmatch 'servidor\.js' -or $p.CommandLine.IndexOf($root,[StringComparison]::OrdinalIgnoreCase) -lt 0){Write-Error ('A porta 3100 pertence a outro programa (PID '+$owner+'). Nenhum processo foi encerrado. Feche a janela da Central antiga manualmente.'); exit 1}; try{Stop-Process -Id $owner -Force -ErrorAction Stop}catch{Write-Error ('Nao consegui encerrar o servidor (PID '+$owner+'): '+$_.Exception.Message); exit 1}}"
if errorlevel 1 (
  echo Nenhum processo foi encerrado. Feche a janela da Central antiga e tente novamente.
  pause
  exit /b 1
)
timeout /t 2 /nobreak >nul
echo.
echo [3/4] Iniciando o servidor novo...
start "Central de Agentes (deixe aberta)" cmd /k node "%~dp0servidor.js"
timeout /t 4 /nobreak >nul
echo.
echo [4/4] Abrindo a pagina sem cache...
start "" "http://localhost:3100/?v=%RANDOM%%RANDOM%"
echo.
echo Pronto. Na pagina, confira o topo: deve mostrar "online - contas-34".
echo Se ainda aparecer versao antiga, aperte Ctrl+F5 na pagina.
timeout /t 8
