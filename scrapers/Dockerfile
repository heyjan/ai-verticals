FROM python:3.14-slim

WORKDIR /app

# Base deps: build tooling for curl-cffi, plus fonts needed by the
# CloakBrowser stealth Chromium binary (see CloakBrowser README → Font
# Setup on Linux — minimal images fail emoji-canvas fingerprint checks).
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl build-essential libcurl4-openssl-dev \
        fonts-noto-color-emoji fonts-freefont-ttf fonts-unifont \
        fonts-ipafont-gothic fonts-wqy-zenhei fonts-tlwg-loma-otf \
    && pip install --no-cache-dir uv

COPY scrapers/pyproject.toml scrapers/uv.lock scrapers/.python-version ./
COPY scrapers/src ./src

# Drop --frozen so adding cloakbrowser to pyproject.toml resolves and
# regenerates the lock at build time. (Lock is re-pinned per build until
# we have a host `uv` to refresh it out-of-band.)
RUN uv sync --no-dev

# Install the Chromium runtime libs that the stealth binary needs, then
# pre-download the binary so first-run downloads don't happen inside
# `docker run`. Cleanup apt lists after both steps complete.
RUN uv run playwright install-deps chromium \
    && uv run python -m cloakbrowser install \
    && rm -rf /var/lib/apt/lists/*

ENV PATH="/app/.venv/bin:${PATH}"
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app/src

# default: print help. Override via `docker run ... python -m scrapers.<module> ...`
CMD ["python", "-c", "print('Usage: docker run ai-job-classifier-scrapers python -m scrapers.<linkedin|glassdoor|merge|clean> --help')"]
