# Backend runtime: Node handles HTTP/AI; Python and curl read public source material.
FROM node:22-bookworm-slim AS node
FROM python:3.12-slim-bookworm
COPY --from=node /usr/local/bin/node /usr/local/bin/node
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates libstdc++6 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY prototype/requirements-web.txt prototype/requirements-daily.txt /tmp/requirements/
RUN pip install --no-cache-dir -r /tmp/requirements/requirements-web.txt -r /tmp/requirements/requirements-daily.txt
COPY prototype /app/prototype
RUN mkdir -p /app/prototype/.private
ENV PORT=10000 WEB_LLM_LISTEN_HOST=0.0.0.0 PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
EXPOSE 10000
CMD ["node", "prototype/web-ai-server.mjs"]
