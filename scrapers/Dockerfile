FROM python:3.14-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl build-essential libcurl4-openssl-dev \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir uv

COPY scrapers/pyproject.toml scrapers/uv.lock scrapers/.python-version ./
COPY scrapers/src ./src

RUN uv sync --frozen --no-dev

ENV PATH="/app/.venv/bin:${PATH}"
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app/src

# default: print help. Override via `docker run ... python -m scrapers.<module> ...`
CMD ["python", "-c", "print('Usage: docker run ai-job-classifier-scrapers python -m scrapers.<linkedin|glassdoor|merge|clean> --help')"]
