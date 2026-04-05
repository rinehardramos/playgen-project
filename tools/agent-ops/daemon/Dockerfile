FROM python:3.12-slim

WORKDIR /app

# Copy daemon and config
COPY daemon.py .

# State directory will be mounted as a volume
RUN mkdir -p /state

CMD ["python", "-u", "daemon.py"]
