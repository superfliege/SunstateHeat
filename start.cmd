@echo off
rem Doppelklick-Starter: umgeht die PowerShell-Ausfuehrungsrichtlinie nur fuer dieses Skript.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
pause
