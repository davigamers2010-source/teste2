@echo off
chcp 65001 >nul
cd /d "%~dp0"

where ngrok >nul 2>nul
if not errorlevel 1 (
  ngrok update
  goto resultado
)

if exist "%LOCALAPPDATA%\Microsoft\WinGet\Links\ngrok.exe" (
  "%LOCALAPPDATA%\Microsoft\WinGet\Links\ngrok.exe" update
  goto resultado
)

for /d %%D in ("%LOCALAPPDATA%\Microsoft\WinGet\Packages\Ngrok.Ngrok_*") do (
  if exist "%%~fD\ngrok.exe" (
    "%%~fD\ngrok.exe" update
    goto resultado
  )
)

echo Nao encontrei ngrok.exe nos locais padrao do WinGet.
echo Reinstale pelo site oficial: https://ngrok.com/download
echo Depois execute configurar-ngrok.bat para conferir a instalacao.
pause
exit /b 1

:resultado
if errorlevel 1 (
  echo A atualizacao falhou. Confira sua conexao e tente novamente.
) else (
  echo Atualizacao concluida. Abra ngrok.bat novamente.
)
pause
