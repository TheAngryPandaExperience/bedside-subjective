@echo off
rem Double-click to start the receiver. Edit the folder below on first use.
cd /d "%~dp0"
py -3 receiver.py --out "%USERPROFILE%\Documents\Subjective"
pause
