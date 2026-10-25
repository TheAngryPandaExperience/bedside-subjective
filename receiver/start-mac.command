#!/bin/sh
# Double-click to start the receiver. Edit the folder below on first use.
cd "$(dirname "$0")"
python3 receiver.py --out "$HOME/Documents/Subjective"
