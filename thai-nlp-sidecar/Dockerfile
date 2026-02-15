FROM python:3.12-slim

WORKDIR /app

# Install system deps for pythainlp + curl for healthcheck
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc curl && \
    rm -rf /var/lib/apt/lists/*

# Install Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download PyThaiNLP data (newmm dict, stopwords, etc.)
RUN python -c "from pythainlp.tokenize import word_tokenize; word_tokenize('ทดสอบ', engine='newmm')"
RUN python -c "from pythainlp.corpus import thai_stopwords; thai_stopwords()"

# Copy app
COPY main.py .

# Non-root user
RUN useradd -m appuser && \
    mkdir -p /data/pythainlp && \
    chown -R appuser:appuser /app /data/pythainlp
USER appuser

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
