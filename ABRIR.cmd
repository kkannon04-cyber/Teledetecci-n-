@echo off
setlocal
cd /d "%~dp0"
title Visor de teledeteccion aeronautica - SKVV a SKLT

echo.
echo   Visor de teledeteccion aeronautica
echo   SKVV - SKLT, 07 SEP 2026 1830Z
echo.
echo   Levantando el servidor local. NO cierres esta ventana
echo   mientras estes viendo el visor.
echo.

REM El visor necesita servirse por HTTP: usa modulos ES y fetch, que el navegador
REM bloquea si se abre index.html con doble clic. Se intenta con Node y, si no
REM esta instalado, con el servidor de PowerShell que trae Windows.

where node >nul 2>nul
if %errorlevel%==0 (
  echo   Servidor: Node.js
  start "" http://localhost:5173
  node herramientas\servidor.mjs
  goto fin
)

echo   Node.js no esta instalado: se usa el servidor de PowerShell.
start "" http://localhost:5173
powershell -NoProfile -ExecutionPolicy Bypass -File "herramientas\servidor.ps1"

:fin
echo.
echo   Servidor detenido.
pause
