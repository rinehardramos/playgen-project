FROM python:3.12-slim

RUN pip install --no-cache-dir pytz

# Dynamic claude CLI wrapper:
# Scans /claude-vm (mounted host claude-code-vm dir) for the latest version
# and execs it — survives Claude Code auto-updates automatically.
RUN printf '#!/bin/sh\n\
LATEST=$(ls /claude-vm 2>/dev/null | sort -V | tail -1)\n\
if [ -z "$LATEST" ]; then\n\
  echo "[claude-wrapper] /claude-vm not mounted or empty" >&2; exit 1\n\
fi\n\
exec "/claude-vm/$LATEST/claude" "$@"\n' \
  > /usr/local/bin/claude && chmod +x /usr/local/bin/claude

WORKDIR /app
COPY daemon.py .

VOLUME ["/state"]

CMD ["python3", "-u", "daemon.py"]
