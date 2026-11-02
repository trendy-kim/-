@echo off
cd /d "%~dp0"
where git >nul 2>nul
if errorlevel 1 (
  echo Git is not installed. Install Git for Windows first: https://git-scm.com/download/win
  pause
  exit /b 1
)
if not exist .git git init -b main
git remote remove origin >nul 2>nul
git remote add origin https://github.com/trendy-kim/-.git
git add -A
git commit -m "Corporate card home-proximity analysis web app"
git pull origin main --allow-unrelated-histories --no-edit
git push -u origin main
echo.
echo Done. If a GitHub sign-in window appeared, sign in with your own account.
pause
