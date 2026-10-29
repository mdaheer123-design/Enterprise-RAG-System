@echo off
title Enterprise AI RAG Assistant - Stopper

echo ======================================================================
echo           Stopping Enterprise AI Knowledge Assistant
echo ======================================================================
echo.

set "STOPPED=0"

:: Kill processes on port 8000 (Backend)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8000 ^| findstr LISTENING 2^>nul') do (
    echo [OK] Stopping Backend process [PID: %%a]
    taskkill /F /PID %%a >nul 2>&1
    set "STOPPED=1"
)

:: Kill processes on port 5173 (Frontend)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5173 ^| findstr LISTENING 2^>nul') do (
    echo [OK] Stopping Frontend process [PID: %%a]
    taskkill /F /PID %%a >nul 2>&1
    set "STOPPED=1"
)

echo.
echo ======================================================================
echo   All RAG Assistant services stopped successfully!
echo ======================================================================
echo.
pause
