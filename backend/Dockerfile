# Croplytix API image.
#
# The same image runs everywhere: `docker run` on a laptop or the VM, or Cloud
# Run. Nothing about *where* it runs is baked in — that all arrives as
# environment variables at start-up (see app/settings.py).
#
# Cloud Run's container contract, and how this file meets it:
#   * listen on 0.0.0.0 at the port in $PORT (Cloud Run sets 8080)  -> CMD below
#   * be ready within the startup timeout                            -> slim image, no build step at runtime
#   * handle SIGTERM for graceful shutdown                           -> `exec` so uvicorn is PID 1
#   * filesystem is in-memory and ephemeral                          -> we never write to it (uploads stream to GCS)

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Dependencies first, on their own layer: Docker caches this layer keyed on
# requirements.txt, so editing app code does not reinstall packages.
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app
# COPY keeps each file's permission bits from the machine that ran the build.
# A checkout with 0600 files would leave the code readable by root only, and the
# unprivileged user below would fail with "Permission denied: /app/app/main.py".
# Make it world-readable (and directories traversable), never writable.
RUN chmod -R a+rX /app

# Don't run as root. Nothing in this app needs it, and if the process is ever
# compromised the blast radius stays inside an unprivileged user.
RUN useradd --system --uid 10001 --no-create-home api
USER api

ENV PORT=8080
EXPOSE 8080

# --proxy-headers: Cloud Run terminates TLS and forwards plain HTTP to us with
# X-Forwarded-Proto/For headers; this makes uvicorn trust them so generated
# URLs (e.g. in /docs) say https. --forwarded-allow-ips="*" is safe here because
# the only thing that can reach the container is Cloud Run's own front end.
CMD exec uvicorn app.main:app --host 0.0.0.0 --port "$PORT" --proxy-headers --forwarded-allow-ips="*"
