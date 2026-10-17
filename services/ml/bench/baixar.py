"""Baixa um modelo GGUF do Hugging Face e confere o sha256 antes de usar.

    uv run python -m bench.baixar --repo Qwen/Qwen2.5-1.5B-Instruct-GGUF \
        --arquivo qwen2.5-1.5b-instruct-q4_k_m.gguf --pasta ~/fintrack-llm/modelos

O sha256 esperado vem da API do Hugging Face (o "oid" do arquivo grande). Se o arquivo baixado não
bater, ele é apagado e nada roda. Ao lado do modelo fica um .json com o tamanho, o sha256 e a
licença declarada na página do modelo (vai para o relatório e, depois, para o ADR).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from .cliente import conferir_url

BLOCO = 1024 * 1024


def _hf() -> str:
    # HF_ENDPOINT: a mesma variável das ferramentas do Hugging Face (o teste usa um servidor falso)
    return conferir_url(os.environ.get("HF_ENDPOINT", "https://huggingface.co"))


def _json(url: str) -> dict | list:
    with urllib.request.urlopen(conferir_url(url), timeout=60) as resposta:  # noqa: S310
        return json.loads(resposta.read())


def _repo_valido(repo: str) -> str:
    dono, _, nome = repo.partition("/")
    permitido = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.")
    if not dono or not nome or "/" in nome or not set(dono + nome) <= permitido:
        raise ValueError(f"repositório inválido: {repo!r}")
    return repo


def esperado(repo: str, arquivo: str) -> dict:
    """Tamanho, sha256 e licença do arquivo, pela API do Hugging Face."""
    repo = _repo_valido(repo)
    arvore = _json(f"{_hf()}/api/models/{repo}/tree/main")
    if not isinstance(arvore, list):
        raise SystemExit("a API do Hugging Face respondeu num formato inesperado")
    achado = next((a for a in arvore if a.get("path") == arquivo), None)
    if achado is None or not (achado.get("lfs") or {}).get("oid"):
        parecidos = [a.get("path") for a in arvore if str(a.get("path", "")).endswith(".gguf")]
        raise SystemExit(f"{arquivo} não está em {repo}. Arquivos .gguf: {', '.join(parecidos)}")
    info = _json(f"{_hf()}/api/models/{repo}")
    licenca = None
    if isinstance(info, dict):
        licenca = (info.get("cardData") or {}).get("license")
    return {
        "repo": repo,
        "arquivo": arquivo,
        "arquivo_bytes": int(achado["lfs"]["size"]),
        "arquivo_sha256": str(achado["lfs"]["oid"]),
        "licenca_declarada": licenca,
        "pagina": f"https://huggingface.co/{repo}",
    }


def sha256(caminho: Path) -> str:
    soma = hashlib.sha256()
    with caminho.open("rb") as arquivo:
        while bloco := arquivo.read(BLOCO):
            soma.update(bloco)
    return soma.hexdigest()


def baixar(repo: str, arquivo: str, pasta: Path, mostrar=print) -> Path:
    pasta.mkdir(parents=True, exist_ok=True)
    destino = pasta / arquivo
    info = esperado(repo, arquivo)
    if destino.exists() and destino.stat().st_size == info["arquivo_bytes"]:
        mostrar(f"{arquivo} já está aqui; conferindo o sha256...")
    else:
        url = f"{_hf()}/{repo}/resolve/main/{urllib.parse.quote(arquivo)}"
        parcial = destino.with_suffix(".part")
        mostrar(f"baixando {arquivo} ({info['arquivo_bytes'] / 1e9:.2f} GB)...")
        with (
            urllib.request.urlopen(conferir_url(url), timeout=120) as resposta,  # noqa: S310
            parcial.open("wb") as saida,
        ):
            feito, proximo = 0, 0.1
            while bloco := resposta.read(BLOCO):
                saida.write(bloco)
                feito += len(bloco)
                if feito / info["arquivo_bytes"] >= proximo:
                    mostrar(f"  {proximo * 100:.0f} %")
                    proximo += 0.1
        parcial.replace(destino)
    if sha256(destino) != info["arquivo_sha256"]:
        destino.unlink()
        raise SystemExit(f"o sha256 de {arquivo} não bate com o do Hugging Face: arquivo apagado")
    destino.chmod(0o644)  # o container lê com um usuário sem privilégios
    (pasta / f"{arquivo}.json").write_text(json.dumps(info, indent=2) + "\n", encoding="utf-8")
    mostrar(f"ok: {destino} (sha256 {info['arquivo_sha256'][:12]}…)")
    return destino


def main(argv: list[str] | None = None) -> int:
    opcoes = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    opcoes.add_argument("--repo", required=True)
    opcoes.add_argument("--arquivo", required=True)
    opcoes.add_argument("--pasta", required=True, type=Path)
    args = opcoes.parse_args(argv)
    if "/" in args.arquivo or args.arquivo.startswith(".") or not args.arquivo.endswith(".gguf"):
        raise SystemExit(f"nome de arquivo inválido: {args.arquivo!r}")
    baixar(args.repo, args.arquivo, args.pasta)
    return 0


if __name__ == "__main__":
    sys.exit(main())
