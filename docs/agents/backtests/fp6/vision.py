"""fp6: keyless readers for Binance's public data, shared by the fp6 fetch scripts.

Public reads only: data.binance.vision (the bulk archive and its S3 listing), the public
www.binance.com history endpoints (fapi/dapi fundingRate and klines, exchangeInfo, bookTicker)
and the public CMS announcement endpoints. No key is read and nothing is signed.
fapi.binance.com answers 451 to this machine, so futures history is read from www.binance.com,
as docs/agents/backtests/fund/fetch.py does.

Every zip read from the archive is checked against the sha256 the archive publishes beside it
(`<file>.CHECKSUM`); a mismatch stops the pull. Every URL read and every stored file is recorded
in the manifest with its sha256.
"""

from __future__ import annotations

import csv
import gzip
import hashlib
import io
import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
UA = {"User-Agent": "Mozilla/5.0 daviesportfolios-fp6-research (public market data)"}
VISION = "https://data.binance.vision"
S3_LIST = "https://s3-ap-northeast-1.amazonaws.com/data.binance.vision"
WWW = "https://www.binance.com"

_last: dict[str, float] = {}


def _pace(host: str, gap: float) -> None:
    wait = _last.get(host, 0.0) + gap - time.time()
    if wait > 0:
        time.sleep(wait)
    _last[host] = time.time()


_lock = threading.Lock()


def get(url: str, gap: float | None = None, tries: int = 7, allow404: bool = False) -> bytes | None:
    """GET with retries. Refuses the hosts that are not the frozen public ones. The archive's
    CloudFront and S3 hosts take parallel reads; the API hosts are paced (serialised per host)."""
    if url.startswith("https://fapi.binance.com") or url.startswith("https://dapi.binance.com") \
            or url.startswith("https://api.binance.com"):
        raise SystemExit(f"{url}: not a host these scripts read")
    host = url.split("/")[2]
    if gap is None:
        gap = 0.0 if host in ("data.binance.vision", "s3-ap-northeast-1.amazonaws.com") else 0.15
    last: Exception | None = None
    for k in range(tries):
        if gap > 0:
            with _lock:
                _pace(host, gap)
        try:
            # some symbols are not ASCII (e.g. a perpetual named in Chinese): encode them, keep the URL's syntax
            wire = urllib.parse.quote(url, safe=":/?&=%_-.~")
            with urllib.request.urlopen(urllib.request.Request(wire, headers=UA), timeout=120) as res:
                return res.read()
        except urllib.error.HTTPError as exc:
            last = exc
            if exc.code == 404 and allow404:
                return None
            if exc.code not in (418, 429, 500, 502, 503, 504):
                raise
        except Exception as exc:  # noqa: BLE001 - retried, then raised
            last = exc
        time.sleep(1.5 * (k + 1))
    raise RuntimeError(f"get failed for {url}: {last}")


def get_json(url: str, gap: float = 0.25):
    raw = get(url, gap=gap)
    return json.loads(raw)


def s3_prefixes(prefix: str) -> list[str]:
    """Every sub-prefix under `prefix` in the archive's bucket listing (paged)."""
    out: list[str] = []
    marker = ""
    while True:
        url = f"{S3_LIST}?delimiter=/&prefix={prefix}" + (f"&marker={marker}" if marker else "")
        raw = get(url).decode()
        found = re.findall(r"<Prefix>([^<]+)</Prefix>", raw)
        found = [p for p in found if p != prefix]
        out += found
        if "<IsTruncated>true</IsTruncated>" not in raw or not found:
            break
        m = re.search(r"<NextMarker>([^<]+)</NextMarker>", raw)
        marker = m.group(1) if m else found[-1]
    return out


def s3_keys(prefix: str) -> list[tuple[str, int]]:
    """Every object key (and size) under `prefix` (paged)."""
    out: list[tuple[str, int]] = []
    marker = ""
    while True:
        url = f"{S3_LIST}?prefix={prefix}" + (f"&marker={marker}" if marker else "")
        raw = get(url).decode()
        keys = []
        for block in re.findall(r"<Contents>(.*?)</Contents>", raw, flags=re.S):
            k = re.search(r"<Key>([^<]+)</Key>", block)
            s = re.search(r"<Size>(\d+)</Size>", block)
            if k and s:
                keys.append((k.group(1), int(s.group(1))))
        out += keys
        if "<IsTruncated>true</IsTruncated>" not in raw or not keys:
            break
        marker = keys[-1][0]
    return out


def vision_zip(path: str, allow404: bool = False) -> tuple[list[list[str]] | None, str | None]:
    """One archive zip, checked against its published sha256. Returns (csv rows, sha256)."""
    raw = get(f"{VISION}/{path}", allow404=allow404)
    if raw is None:
        return None, None
    chk = get(f"{VISION}/{path}.CHECKSUM", allow404=True)
    digest = hashlib.sha256(raw).hexdigest()
    if chk is not None:
        published = chk.decode().split()[0].strip().lower()
        if digest != published:
            raise SystemExit(f"{path} does not match its published sha256")
    zf = zipfile.ZipFile(io.BytesIO(raw))
    names = zf.namelist()
    if len(names) != 1:
        raise SystemExit(f"{path}: a vision zip holds {len(names)} files")
    rows = list(csv.reader(io.StringIO(zf.read(names[0]).decode())))
    return rows, digest


def ms_stamp(v: str) -> int:
    """Archive stamps switched from milliseconds to microseconds on 2025-01-01 (spot)."""
    t = int(v)
    return t // 1000 if t > 10**14 else t


def write_gz(path: Path, obj) -> str:
    """Deterministic gzip JSON (no file name, no time in the header). Returns the sha256."""
    raw = json.dumps(obj, separators=(",", ":"), sort_keys=True).encode()
    buf = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=buf, mtime=0, compresslevel=9) as gz:
        gz.write(raw)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(buf.getvalue())
    return hashlib.sha256(buf.getvalue()).hexdigest()


def read_gz(path: Path):
    return json.loads(gzip.decompress(path.read_bytes()))


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()
