FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY analytics/pyproject.toml ./pyproject.toml
COPY analytics/uv.lock ./uv.lock
COPY analytics/src ./src

# pip is bootstrapped by URL + sha256: the base image's own pip may predate 26.2.2 and still
# trust the compromised eMudhra intermediates (vendored certifi), so its download is pinned by hash.
RUN pip install --no-cache-dir "pip @ https://files.pythonhosted.org/packages/3f/06/3e4420302363fbb71be3c7f35ce042f54bfca330e3e66b3a2e3c4cca579f/pip-26.2.2-py3-none-any.whl#sha256=fd7f4dfa8190e014013b9f08f3e973f4e4c26ffd179a204895533a7254813a70" \
    && pip install --no-cache-dir uv==0.13.5 \
    && uv sync --frozen --no-dev

EXPOSE 8000
CMD ["/app/.venv/bin/uvicorn", "analytics.main:app", "--host", "0.0.0.0", "--port", "8000"]
