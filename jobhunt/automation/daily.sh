#!/usr/bin/env bash
# Daily run: discover new roles, scan the inbox, rebuild the dashboard, email the digest.
#
#   crontab -e
#   45 8 * * * /path/to/devtools/jobhunt/automation/daily.sh
#
# Put JOBHUNT_IMAP_PASSWORD (and optionally ANTHROPIC_API_KEY) in ~/.jobhunt.env
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f "$HOME/.jobhunt.env" ] && set -a && . "$HOME/.jobhunt.env" && set +a
mkdir -p var
python3 -m jobhunt daily --email >> var/daily.log 2>&1
