@echo off
chcp 65001 >nul
title Atualizacao Forcada do Servidor IA
cd /d "%~dp0"

echo ===================================================
echo   FORCANDO ATUALIZACAO DO SERVIDOR - CENTRAL IA
echo ===================================================
echo.

echo [1/4] ENCERRANDO PROCESSOS ANTERIORES DO NODE.JS...
taskkill /F /IM node.exe >nul 2>nul
echo Processos antigos encerrados com sucesso.
echo.

echo [2/4] VERIFICANDO ARQUIVO SERVIDOR.JS...
if not exist "servidor.js" (
  echo [ERRO CRITICO] O arquivo servidor.js nao foi encontrado na pasta atual!
  echo Certifique-se de que este script esta na mesma pasta do servidor.js.
  echo.
  pause
  exit /b
)
echo Arquivo servidor.js localizado.
echo.

echo [3/4] INICIANDO O SERVIDOR ATUALIZADO...
start "Servidor Central IA" cmd /k "node servidor.js"
echo Aguardando inicializacao do servidor na porta 3100...
timeout /t 3 >nul
echo.

echo [4/4] ABRINDO CENTRAL NO NAVEGADOR...
start http://localhost:3100
echo.
echo ===================================================
echo   INICIALIZACAO CONCLUIDA!
echo   DICA: Se a versao antiga continuar aparecendo no
echo   navegador, pressione CTRL + F5 na pagina aberta.
echo ===================================================
echo.
pause