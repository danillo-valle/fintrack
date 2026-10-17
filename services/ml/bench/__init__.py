"""A medição do LLM local no servidor (M10.2a, ADR-007): fica fora da imagem de produção.

O Dockerfile copia só app/; esta pasta roda no seu servidor com `uv run`, contra um llama-server
num container, e só com dados SINTÉTICOS (samples/categorizacao). Veja bench/README.md.
"""
