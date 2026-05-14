FROM python:3.12-slim AS base

WORKDIR /app

# Install Node for frontend build
RUN apt-get update && apt-get install -y --no-install-recommends \
    nodejs npm curl \
    && rm -rf /var/lib/apt/lists/*

# --- Python deps ---
COPY pyproject.toml .
COPY mcp_watchtower/ mcp_watchtower/
RUN pip install --no-cache-dir -e ".[server]"

# --- Frontend build ---
COPY web/package*.json web/
RUN cd web && npm ci

COPY web/ web/
RUN cd web && npm run build

# --- Runtime ---
ENV WATCHTOWER_DB_PATH=/data/watchtower.db
VOLUME ["/data"]
EXPOSE 8000

ENTRYPOINT ["python", "-m", "mcp_watchtower.cli"]
CMD ["demo", "--host", "0.0.0.0", "--port", "8000"]
