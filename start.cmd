@echo off
title Miku Quizer - AI Backend Server
color 0B

echo ======================================================
echo    🎵 Miku Quizer - AI Backend Launcher (Windows)
echo ======================================================
echo.

:: Navigate to backend directory
cd /d "%~dp0backend"
if errorlevel 1 (
    echo [ERROR] Backend folder not found!
    pause
    exit /b 1
)

:: Check if Node.js is installed
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or not in PATH!
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

echo [1/2] Checking dependencies (npm install)...
call npm install
if errorlevel 1 (
    echo [WARNING] npm install had an issue, trying to start server anyway...
)

echo.
echo [2/2] Starting Miku Quizer Backend Server...
echo ======================================================
echo API Endpoint: http://localhost:3001
echo Press Ctrl+C anytime to stop the server.
echo ======================================================
echo.

node server.js

if errorlevel 1 (
    echo.
    echo [ERROR] Server stopped with an error.
    pause
)
