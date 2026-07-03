@echo off
chcp 65001 >nul
echo.
echo   🎯 BossSay PDF 解析服务
echo   ========================
echo.
echo   正在启动...
echo.

:: 检查 Python
python --version >nul 2>&1
if errorlevel 1 (
    echo   ❌ 未找到 Python，请先安装 Python 3.8+
    echo   下载地址: https://www.python.org/downloads/
    pause
    exit /b 1
)

:: 安装依赖
echo   📦 检查依赖...
pip install pdfplumber -q 2>nul

:: 启动服务
echo.
python "%~dp0app.py"

pause
