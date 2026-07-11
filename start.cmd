@echo off
cd /d "%~dp0"
set "NODE=C:\Users\86156\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%NODE%" (
  "%NODE%" server.js
) else (
  node server.js
)
