# Imagem de produção do serviço Python (M09.4, ADR-014): lê a fatura do cartão em PDF e, desde o
# M10.1 (ADR-015), classifica a categoria dos lançamentos.
#
# Quem constrói: o job "imagem" do CI (.github/workflows/ci.yml), que publica no GHCR
# (ghcr.io/danillo-valle/fintrack-ml) a cada merge na main, junto da web e da migrate.
# Contexto do build: esta pasta (services/ml), não a raiz do repositório.
#
# Construir à mão, no servidor:
#   docker build --build-arg APP_VERSION=$(git rev-parse HEAD) -t fintrack-ml:local services/ml
#
# Dois estágios: o primeiro tem o uv e instala as dependências exatas do uv.lock numa .venv; a
# imagem final copia só a .venv e o código, e roda como usuário sem privilégios. Em produção o
# container não tem porta publicada nem saída para a internet (rede interna "ml" do Compose).

ARG PYTHON_VERSION=3.13

# ── 1. build: o uv instala exatamente o que está no uv.lock (sem as ferramentas de teste) ────
FROM python:${PYTHON_VERSION}-slim-bookworm AS build
COPY --from=ghcr.io/astral-sh/uv:0.11.32 /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,id=fintrack-uv-cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project
COPY app ./app

# ── 2. ml: a imagem que vai para produção ────────────────────────────────────────────────────
FROM python:${PYTHON_VERSION}-slim-bookworm AS ml
ARG APP_VERSION=dev
# Etiquetas padrão OCI: o GHCR liga a imagem ao repositório (source)
LABEL org.opencontainers.image.source="https://github.com/danillo-valle/fintrack" \
      org.opencontainers.image.title="fintrack-ml" \
      org.opencontainers.image.description="FinTrack: serviço Python (fatura em PDF e classificador)" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.revision="${APP_VERSION}"
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
WORKDIR /app
# Usuário sem privilégios, com o mesmo uid do app web. /data/modelos é o ponto de montagem do
# volume dos modelos do classificador (M10.1): nasce vazio e do usuário ml, e o Docker copia
# esse dono para o volume novo. Nenhum modelo entra na imagem.
RUN useradd --uid 1000 --no-create-home --shell /usr/sbin/nologin ml \
    && mkdir -p /data/modelos && chown ml:ml /data/modelos
ENV ML_MODEL_DIR=/data/modelos
COPY --from=build /app/.venv /app/.venv
COPY --from=build /app/app /app/app
USER ml
EXPOSE 8001
# Sem curl na imagem: o próprio Python confere o /health
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/health', timeout=4)"]
# Um processo só (o servidor de casa é pequeno); sem o log de cada acesso (só o do app, com códigos)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001", "--no-access-log"]
