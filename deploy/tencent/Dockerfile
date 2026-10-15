# syntax=docker/dockerfile:1.7
# AEGIS Treasury service: the five processes (api, authorizer, exit_agent, executor, keeper) in one image.
# Build from the repository root: docker build -f deploy/tencent/Dockerfile .
FROM ghcr.io/astral-sh/uv:0.9.17 AS uv

FROM python:3.13.15-slim-bookworm

COPY --from=uv /uv /usr/local/bin/uv

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PATH=/app/.venv/bin:$PATH

WORKDIR /app/service
COPY service/pyproject.toml service/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY service/aegis ./aegis
COPY deployments/31337.json deployments/84532.json /app/deployments/
RUN python -m compileall -q aegis \
    && useradd --uid 10001 --no-create-home --home-dir /data --shell /usr/sbin/nologin aegis \
    && mkdir -p /data && chown aegis:aegis /data

ENV API_HOST=0.0.0.0 \
    API_PORT=8787 \
    AEGIS_DB=/data/aegis.db \
    AEGIS_LOG_DIR=/data/log \
    TRUST_PROXY=1

USER aegis
VOLUME ["/data"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8787/api/health', timeout=4).status == 200 else 1)"]

CMD ["python", "-m", "aegis", "all"]
