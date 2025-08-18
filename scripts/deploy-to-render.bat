@echo off
setlocal enabledelayedexpansion

REM EPickup Backend Deployment Script for Render (Windows)
REM This script automates the deployment process to Render platform

echo 🚀 EPickup Backend Deployment Script
echo =====================================

REM Check if we're in the backend directory
if not exist "package.json" (
    echo [ERROR] Please run this script from the backend directory
    pause
    exit /b 1
)

REM Check if .env.production exists
if not exist ".env.production" (
    echo [WARNING] .env.production file not found!
    echo [INFO] Creating .env.production from template...
    if exist ".env.production.template" (
        copy ".env.production.template" ".env.production"
        echo [WARNING] Please edit .env.production with your actual values before deploying!
        echo [INFO] You can now edit .env.production and run this script again
        pause
        exit /b 1
    ) else (
        echo [ERROR] .env.production.template not found. Please create .env.production manually
        pause
        exit /b 1
    )
)

REM Validate environment variables
echo [INFO] Validating environment configuration...
call npm run validate:config

if %errorlevel% equ 0 (
    echo [SUCCESS] Environment configuration validated successfully
) else (
    echo [ERROR] Environment configuration validation failed
    pause
    exit /b 1
)

REM Run tests
echo [INFO] Running tests to ensure code quality...
call npm run test:all

if %errorlevel% equ 0 (
    echo [SUCCESS] All tests passed successfully
) else (
    echo [WARNING] Some tests failed. Continue with deployment? (Y/N)
    set /p response=
    if /i not "!response!"=="Y" (
        echo [INFO] Deployment cancelled by user
        pause
        exit /b 1
    )
)

REM Check if git repository exists
if not exist ".git" (
    echo [INFO] Initializing git repository...
    git init
    git add .
    git commit -m "Initial commit for deployment"
    echo [SUCCESS] Git repository initialized
) else (
    echo [INFO] Git repository already exists
)

REM Check git status
echo [INFO] Checking git status...
git status --porcelain > temp_git_status.txt
set /p git_status=<temp_git_status.txt
del temp_git_status.txt

if not "!git_status!"=="" (
    echo [WARNING] Uncommitted changes detected. Commit them? (Y/N)
    set /p response=
    if /i "!response!"=="Y" (
        git add .
        git commit -m "Deployment commit - %date% %time%"
        echo [SUCCESS] Changes committed
    ) else (
        echo [WARNING] Deploying with uncommitted changes
    )
)

REM Check if remote origin exists
git remote get-url origin >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARNING] No remote origin configured
    echo [INFO] Please add your GitHub repository as remote origin:
    echo git remote add origin https://github.com/yourusername/your-repo.git
    echo.
    echo [INFO] Then push your code:
    echo git push -u origin main
    echo.
    echo [INFO] After that, you can deploy from the Render dashboard
    pause
    exit /b 1
)

REM Push to remote repository
echo [INFO] Pushing code to remote repository...
git push origin main

if %errorlevel% equ 0 (
    echo [SUCCESS] Code pushed successfully
) else (
    echo [ERROR] Failed to push code
    pause
    exit /b 1
)

echo [SUCCESS] 🎉 Deployment preparation completed!
echo.
echo Next steps:
echo 1. Go to https://dashboard.render.com
echo 2. Create a new Web Service
echo 3. Connect your GitHub repository
echo 4. Select the backend folder
echo 5. Configure build settings:
echo    - Build Command: npm install
echo    - Start Command: npm start
echo 6. Add all environment variables from .env.production
echo 7. Click 'Create Web Service'
echo.
echo Your app will be available at: https://your-app-name.onrender.com
echo.
echo Health check endpoint: https://your-app-name.onrender.com/health
echo Metrics endpoint: https://your-app-name.onrender.com/metrics
echo.
echo [INFO] Happy deploying! 🚀
pause
