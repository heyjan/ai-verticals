FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY analytics/pyproject.toml ./pyproject.toml
COPY analytics/uv.lock ./uv.lock
COPY analytics/src ./src

RUN pip install --no-cache-dir uv==0.11.7 \
    && uv sync --frozen --no-dev

EXPOSE 8000
CMD ["/app/.venv/bin/uvicorn", "analytics.main:app", "--host", "0.0.0.0", "--port", "8000"]
