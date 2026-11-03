FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt gunicorn

COPY scripts/install_stockfish.sh scripts/
RUN bash scripts/install_stockfish.sh

COPY chess_teacher chess_teacher

RUN useradd --system app
USER app

ENV CHESS_TEACHER_BEHIND_PROXY=1
EXPOSE 5000
# One worker: analysis jobs live in that process's memory. Threads serve requests in parallel.
CMD ["gunicorn", "--workers", "1", "--threads", "8", "--timeout", "120", "--bind", "0.0.0.0:5000", "chess_teacher.web:app"]
