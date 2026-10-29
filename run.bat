@echo off
setlocal enabledelayedexpansion
title Enterprise AI RAG Assistant - Launcher

:: Set project root directory
cd /d "%~dp0"

echo ======================================================================
echo           Starting Enterprise AI Knowledge Assistant
echo ======================================================================
echo.

:: 1. Cleanup any stale processes on ports 8000 and 5173
echo [*] Checking for previous instances on ports 8000 and 5173...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8000 ^| findstr LISTENING 2^>nul') do (
    echo [!] Releasing occupied port 8000 (PID: %%a)...
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5173 ^| findstr LISTENING 2^>nul') do (
    echo [!] Releasing occupied port 5173 (PID: %%a)...
    taskkill /F /PID %%a >nul 2>&1
)

:: 2. Check and start PostgreSQL service if stopped
echo [*] Checking PostgreSQL status...
netstat -aon 2>nul | findstr :5432 | findstr LISTENING >nul 2>&1
if !errorlevel! equ 0 (
    echo [OK] PostgreSQL is active on port 5432.
) else (
    echo [*] Starting PostgreSQL service...
    sc query postgresql-x64-16 2>nul | findstr /i "RUNNING" >nul
    if !errorlevel! equ 0 (
        echo [OK] PostgreSQL service is running.
    ) else (
        net start postgresql-x64-16 >nul 2>&1
        if !errorlevel! equ 0 (
            echo [OK] PostgreSQL service started successfully.
        ) else (
            echo [i] PostgreSQL service check skipped or already running.
        )
    )
)

:: 3. Detect Python Environment
set "PYTHON_CMD="

:: Check virtualenv first
if exist "%~dp0backend\venv\Scripts\python.exe" (
    "%~dp0backend\venv\Scripts\python.exe" -c "import uvicorn" >nul 2>&1
    if !errorlevel! equ 0 (
        set "PYTHON_CMD=%~dp0backend\venv\Scripts\python.exe"
        echo [OK] Using virtual environment Python: backend\venv
    )
)

if not defined PYTHON_CMD if exist "%~dp0backend\.venv\Scripts\python.exe" (
    "%~dp0backend\.venv\Scripts\python.exe" -c "import uvicorn" >nul 2>&1
    if !errorlevel! equ 0 (
        set "PYTHON_CMD=%~dp0backend\.venv\Scripts\python.exe"
        echo [OK] Using virtual environment Python: backend\.venv
    )
)

:: Check system Python
if not defined PYTHON_CMD (
    python -c "import uvicorn" >nul 2>&1
    if !errorlevel! equ 0 (
        set "PYTHON_CMD=python"
        echo [OK] Using system Python with required packages.
    )
)

:: Fallback: use whatever Python is available and install requirements
if not defined PYTHON_CMD (
    if exist "%~dp0backend\venv\Scripts\python.exe" (
        set "PYTHON_CMD=%~dp0backend\venv\Scripts\python.exe"
    ) else (
        where python >nul 2>&1
        if !errorlevel! equ 0 (
            set "PYTHON_CMD=python"
        ) else (
            echo [ERROR] Python not found! Please install Python 3.11+.
            pause
            exit /b 1
        )
    )
    echo [*] Installing missing backend packages...
    "%PYTHON_CMD%" -m pip install -r "%~dp0backend\requirements.txt"
)

:: 4. Detect Node / NPM
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] npm / Node.js not found in PATH! Please install Node.js.
    pause
    exit /b 1
)

:: Check if frontend node_modules exists
if not exist "%~dp0frontend\node_modules" (
    echo [*] Installing frontend packages (first run)...
    cd /d "%~dp0frontend"
    call npm install
    cd /d "%~dp0"
)

:: 5. Launch Backend Server in background window
echo [1/2] Launching Backend Server on http://127.0.0.1:8000 ...
start "RAG Assistant - Backend (:8000)" cmd /k "cd /d "%~dp0backend" && "%PYTHON_CMD%" -m uvicorn app.main:app --port 8000 --host 127.0.0.1"

:: 6. Launch Frontend Dev Server in background window
echo [2/2] Launching Frontend Server on http://localhost:5173 ...
start "RAG Assistant - Frontend (:5173)" cmd /k "cd /d "%~dp0frontend" && call npm run dev"

:: 7. Wait for Backend to be healthy
echo.
echo [*] Waiting for services to initialize (loading ML models)...
set /a ATTEMPTS=0
:WAIT_BACKEND
timeout /t 1 /nobreak >nul
set /a ATTEMPTS+=1
curl -s -m 2 http://127.0.0.1:8000/health >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Backend server is healthy!
    goto OPEN_APP
)
if %ATTEMPTS% geq 30 (
    echo [!] Backend is still initializing. Proceeding to launch browser...
    goto OPEN_APP
)
goto WAIT_BACKEND

:OPEN_APP
timeout /t 2 /nobreak >nul
echo [OK] Opening Application in your default browser...
start http://localhost:5173/

:MENU_LOOP
cls
echo ======================================================================
echo           Enterprise AI RAG Assistant is RUNNING!
echo ======================================================================
echo.
echo   Application (Frontend) : http://localhost:5173/
echo   Backend API Server     : http://127.0.0.1:8000/
echo   Swagger Documentation  : http://127.0.0.1:8000/docs
echo.
echo ----------------------------------------------------------------------
echo   ACTIONS:
echo     [1] Open Frontend in Default Browser
echo     [2] Open API Documentation (Swagger) in Browser
echo     [3] Restart Backend Server
echo     [4] Restart Frontend Server
echo     [5] Stop All Services and Exit
echo ======================================================================
echo.
set "CHOICE="
set /p CHOICE="Choose an option (1-5) or press Enter to keep running: "

if "%CHOICE%"=="1" (
    start http://localhost:5173/
    goto MENU_LOOP
)
if "%CHOICE%"=="2" (
    start http://127.0.0.1:8000/docs
    goto MENU_LOOP
)
if "%CHOICE%"=="3" (
    echo [*] Restarting Backend Server...
    for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8000 ^| findstr LISTENING 2^>nul') do taskkill /F /PID %%a >nul 2>&1
    timeout /t 1 /nobreak >nul
    start "RAG Assistant - Backend (:8000)" cmd /k "cd /d "%~dp0backend" && "%PYTHON_CMD%" -m uvicorn app.main:app --port 8000 --host 127.0.0.1"
    echo [OK] Backend restarted.
    timeout /t 2 /nobreak >nul
    goto MENU_LOOP
)
if "%CHOICE%"=="4" (
    echo [*] Restarting Frontend Server...
    for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5173 ^| findstr LISTENING 2^>nul') do taskkill /F /PID %%a >nul 2>&1
    timeout /t 1 /nobreak >nul
    start "RAG Assistant - Frontend (:5173)" cmd /k "cd /d "%~dp0frontend" && call npm run dev"
    echo [OK] Frontend restarted.
    timeout /t 2 /nobreak >nul
    goto MENU_LOOP
)
if "%CHOICE%"=="5" (
    goto SHUTDOWN
)

goto MENU_LOOP

:SHUTDOWN
echo.
echo ======================================================================
echo           Stopping Enterprise AI Knowledge Assistant
echo ======================================================================
echo.
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8000 ^| findstr LISTENING 2^>nul') do (
    echo [*] Stopping Backend process (PID: %%a)...
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5173 ^| findstr LISTENING 2^>nul') do (
    echo [*] Stopping Frontend process (PID: %%a)...
    taskkill /F /PID %%a >nul 2>&1
)
echo.
echo [OK] All services stopped. Goodbye!
echo.
timeout /t 2 /nobreak >nul
exit /b 0
