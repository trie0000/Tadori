@echo off
REM ============================================================================
REM Tadori one-click launcher (Windows)
REM ============================================================================
REM
REM NOTE: Keep this .bat ASCII-only. cmd.exe parses .bat files using the system
REM ANSI code page (CP932 on JP Windows), not UTF-8. Japanese text in REM/echo
REM lines gets mis-decoded and stray bytes (&, |, <, >) can split the line.
REM All Japanese messages live in tadori-start.ps1.
REM
REM What it does:
REM   1) Start tadori-ai-relay.ps1 if not running (in a new window)
REM   2) Wait for /tadori/health to respond
REM   3) Open SharePoint URL in default browser
REM   4) Show a popup reminding to click the bookmarklet
REM
REM Config: edit tadori-ai-relay.env in this folder.
REM Required for full automation:
REM   TADORI_SITE_URL=https://<tenant>.sharepoint.com/sites/<site>
REM (If omitted you will be prompted at launch.)
REM
REM Auto-start at logon:
REM   Task Scheduler -> Create Basic Task -> Trigger "At log on"
REM   Action: Start a program -> this .bat
REM ============================================================================

REM Keep the window visible so the user sees the launcher progress
REM (relay startup wait, errors, etc.).
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tadori-start.ps1" %*
set EC=%errorlevel%
if not "%EC%"=="0" (
    echo.
    echo [tadori-start] ----------------------------------------------------------
    echo [tadori-start] PowerShell exited with code %EC%
    echo [tadori-start] See messages above for the cause.
    echo [tadori-start] ----------------------------------------------------------
    pause
)
endlocal
