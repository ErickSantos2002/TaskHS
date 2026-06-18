FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Usuário não-root + diretório de uploads (montar o volume taskhs-uploads aqui no
# Easypanel; volumes nomeados herdam a posse deste diretório). O app também cria o
# caminho no startup; o mkdir garante o ponto de montagem.
RUN useradd -m -u 1000 appuser \
    && mkdir -p /app/uploads \
    && chown -R appuser:appuser /app
USER appuser

ENV UPLOAD_DIR=/app/uploads

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
