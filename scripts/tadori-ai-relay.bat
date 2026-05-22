@echo off
REM ============================================================================
REM Tadori AI relay launcher (Windows / Pure PowerShell)
REM ============================================================================
REM
REM 設定は同じフォルダの `tadori-ai-relay.env` に書きます。
REM 初回セットアップ:
REM   copy tadori-ai-relay.env.example tadori-ai-relay.env
REM   notepad tadori-ai-relay.env
REM
REM この .bat はダブルクリックで起動するための薄い wrapper です。
REM タスクスケジューラの「ログオン時」トリガで自動起動も可。
REM ============================================================================

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tadori-ai-relay.ps1" %*
pause
