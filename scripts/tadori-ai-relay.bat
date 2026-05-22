@echo off
REM ============================================================================
REM Tadori AI relay launcher (Windows / Pure PowerShell)
REM ============================================================================
REM
REM NOTE: Keep this .bat ASCII-only. cmd.exe parses .bat files using the system
REM ANSI code page (CP932 on JP Windows), not UTF-8. Japanese text in REM/echo
REM lines gets mis-decoded and stray bytes (&, |, <, >) can split the line, so
REM fragments run as bogus commands ("... is not recognized ..."). All Japanese
REM messages live in tadori-ai-relay.ps1 (PowerShell handles UTF-8 correctly).
REM
REM Config: edit tadori-ai-relay.env in this folder.
REM First-time setup:
REM   copy tadori-ai-relay.env.example tadori-ai-relay.env
REM   notepad tadori-ai-relay.env
REM
REM This .bat is a thin wrapper for double-click launch. It can also be run from
REM a Task Scheduler "At log on" trigger for auto-start.
REM ============================================================================

REM Run with -ExecutionPolicy Bypass so local script policy does not block it.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tadori-ai-relay.ps1" %*
pause
