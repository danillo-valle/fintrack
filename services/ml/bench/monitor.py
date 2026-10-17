"""O que acontece no servidor enquanto o LLM trabalha: medido em paralelo, a cada poucos segundos.

  Amostrador  temperatura da CPU, frequência média dos núcleos, swap em uso e a memória do
              container do LLM (pelo cgroup do Linux; sem ele, pelo docker stats)
  Saude       o tempo de resposta do /api/health da produção, uma vez por segundo

Tudo vem de /sys e /proc (nada para instalar, nem o lm-sensors). Num computador sem esses
arquivos (o laboratório, um Mac) a medida fica vazia em vez de quebrar.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import threading
import time
from pathlib import Path

from .cliente import obter

SYS = Path("/sys")
PROC = Path("/proc")


def _ler_int(caminho: Path) -> int | None:
    try:
        return int(caminho.read_text().split()[0])
    except (OSError, ValueError, IndexError):
        return None


def temperatura_cpu(raiz: Path = SYS) -> float | None:
    """A maior temperatura (°C) entre as zonas da CPU (x86_pkg_temp, acpitz...)."""
    maiores: list[float] = []
    for zona in sorted((raiz / "class" / "thermal").glob("thermal_zone*")):
        valor = _ler_int(zona / "temp")
        if valor is not None and 0 < valor < 150_000:
            maiores.append(valor / 1000)
    return max(maiores) if maiores else None


def frequencia_media(raiz: Path = SYS) -> float | None:
    """A frequência média (MHz) dos núcleos agora (cai quando a CPU esquenta)."""
    valores = [
        v
        for arquivo in (raiz / "devices" / "system" / "cpu").glob(
            "cpu[0-9]*/cpufreq/scaling_cur_freq"
        )
        if (v := _ler_int(arquivo)) is not None
    ]
    return round(sum(valores) / len(valores) / 1000, 1) if valores else None


def swap_em_uso(raiz: Path = PROC) -> int | None:
    """Bytes de swap em uso no servidor inteiro."""
    try:
        linhas = (raiz / "meminfo").read_text().splitlines()
    except OSError:
        return None
    valores = {}
    for linha in linhas:
        nome, _, resto = linha.partition(":")
        if nome in ("SwapTotal", "SwapFree"):
            valores[nome] = int(resto.split()[0]) * 1024
    if len(valores) < 2:
        return None
    return valores["SwapTotal"] - valores["SwapFree"]


def pasta_cgroup(container: str, raiz: Path = SYS) -> Path | None:
    """A pasta do cgroup v2 do container (driver systemd ou cgroupfs do Docker)."""
    if not container:
        return None
    for pasta in (
        raiz / "fs" / "cgroup" / "system.slice" / f"docker-{container}.scope",
        raiz / "fs" / "cgroup" / "docker" / container,
    ):
        if (pasta / "memory.current").exists():
            return pasta
    return None


def _docker_stats(container: str) -> int | None:
    """Plano B sem cgroup legível: a memória pelo docker stats (mais lento, menos preciso)."""
    if not container or not shutil.which("docker"):
        return None
    try:
        saida = subprocess.run(  # noqa: S603 (argumentos fixos, sem shell)
            ["docker", "stats", "--no-stream", "--format", "{{json .}}", container],  # noqa: S607
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        ).stdout
        uso = json.loads(saida.splitlines()[0])["MemUsage"].split("/")[0].strip()
    except (OSError, ValueError, IndexError, KeyError, subprocess.SubprocessError):
        return None
    unidades = {"KiB": 1024, "MiB": 1024**2, "GiB": 1024**3, "kB": 1000, "MB": 1000**2, "B": 1}
    for sufixo, fator in sorted(unidades.items(), key=lambda par: -len(par[0])):
        if uso.endswith(sufixo):
            try:
                return int(float(uso[: -len(sufixo)]) * fator)
            except ValueError:
                return None
    return None


class _Laco(threading.Thread):
    def __init__(self, intervalo: float):
        super().__init__(daemon=True)
        self.intervalo = intervalo
        self._parar = threading.Event()
        self.amostras: list[dict] = []
        self._trava = threading.Lock()

    def amostrar(self) -> dict | None:  # pragma: no cover (cada subclasse tem a sua)
        raise NotImplementedError

    def run(self) -> None:
        while not self._parar.is_set():
            amostra = self.amostrar()
            if amostra is not None:
                with self._trava:
                    self.amostras.append(amostra)
            self._parar.wait(self.intervalo)

    def parar(self) -> list[dict]:
        self._parar.set()
        self.join(timeout=30)
        with self._trava:
            return list(self.amostras)

    def marcar(self) -> int:
        """Quantas amostras já existem: separa as fases (repouso x carga)."""
        with self._trava:
            return len(self.amostras)


class Amostrador(_Laco):
    def __init__(self, container: str = "", intervalo: float = 2.0, raiz_sys: Path = SYS):
        super().__init__(intervalo)
        self.raiz_sys = raiz_sys
        self.cgroup = pasta_cgroup(container, raiz_sys)
        self.container = container

    def amostrar(self) -> dict:
        amostra: dict = {
            "t": time.time(),
            "temperatura_c": temperatura_cpu(self.raiz_sys),
            "frequencia_mhz": frequencia_media(self.raiz_sys),
            "swap_bytes": swap_em_uso(),
        }
        if self.cgroup:
            amostra["memoria_bytes"] = _ler_int(self.cgroup / "memory.current")
            amostra["memoria_pico_bytes"] = _ler_int(self.cgroup / "memory.peak")
            amostra["swap_container_bytes"] = _ler_int(self.cgroup / "memory.swap.current")
        else:
            amostra["memoria_bytes"] = _docker_stats(self.container)
        return amostra


class Saude(_Laco):
    """GET no /api/health da produção a cada segundo; guarda o tempo e se respondeu ok."""

    def __init__(self, url: str, intervalo: float = 1.0):
        super().__init__(intervalo)
        self.url = url

    def amostrar(self) -> dict:
        inicio = time.perf_counter()
        codigo, corpo = obter(self.url, limite=10)
        return {
            "t": time.time(),
            "ms": round((time.perf_counter() - inicio) * 1000, 2),
            "ok": codigo == 200 and b'"status":"ok"' in corpo,
        }
