FROM python:3.14-slim

WORKDIR /app

# pip is bootstrapped by URL + sha256: the base image's own pip may predate 26.2.2 and still
# trust the compromised eMudhra intermediates (vendored certifi), so its download is pinned by hash.
# Base deps: build tooling for curl-cffi, plus fonts needed by the
# CloakBrowser stealth Chromium binary (see CloakBrowser README → Font
# Setup on Linux — minimal images fail emoji-canvas fingerprint checks).
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl build-essential libcurl4-openssl-dev \
        fonts-noto-color-emoji fonts-freefont-ttf fonts-unifont \
        fonts-ipafont-gothic fonts-wqy-zenhei fonts-tlwg-loma-otf \
    && pip install --no-cache-dir "pip @ https://files.pythonhosted.org/packages/3f/06/3e4420302363fbb71be3c7f35ce042f54bfca330e3e66b3a2e3c4cca579f/pip-26.2.2-py3-none-any.whl#sha256=fd7f4dfa8190e014013b9f08f3e973f4e4c26ffd179a204895533a7254813a70" \
    && pip install --no-cache-dir uv==0.13.5

COPY scrapers/pyproject.toml scrapers/uv.lock scrapers/.python-version ./
COPY scrapers/src ./src

# Lock is refreshed out-of-band with `uv lock`; builds install exactly what it pins.
RUN uv sync --frozen --no-dev

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
