#!/usr/bin/env python3
"""Baixa e renomeia imagens Lorcana a partir do catálogo cards.json."""

from __future__ import annotations

import argparse
import csv
import hashlib
import html as html_lib
import json
import logging
import os
import re
import shutil
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen


USER_AGENT = "LorcanaImageAgent/1.0 (+personal card database sync)"
ID_COLUMN = "Database ID"
URL_COLUMN = "Image URL"
NAME_COLUMN = "Display Name"
SET_COLUMN = "Set Code"
NUMBER_COLUMN = "Card Number"
LOG = logging.getLogger("lorcana-image-agent")
OFFICIAL_SITE = "https://www.disneylorcana.com/en-US"
LIGA_SITE = "https://www.ligalorcana.com.br/"


def detect_project_root(explicit: Path | None = None) -> Path:
    """Find the Inkwell root whose deployable files live under site/."""
    if explicit is not None:
        return explicit.expanduser().resolve()

    starts = (Path.cwd().resolve(), Path(__file__).resolve().parent)
    visited: set[Path] = set()
    for start in starts:
        for candidate in (start, *start.parents):
            if candidate in visited:
                continue
            visited.add(candidate)
            if (candidate / "site").is_dir() and (candidate / "tools").is_dir():
                return candidate
    return Path.cwd().resolve()


def resolve_cli_path(value: Path | None, default: Path) -> Path:
    """Resolve an explicit CLI path from cwd, or use a repository default."""
    return (value.expanduser() if value is not None else default).resolve()


@dataclass
class Result:
    database_id: str
    display_name: str
    image_url: str
    image_file: str
    status: str
    bytes: int = 0
    sha256: str = ""
    error: str = ""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=(
        "Baixa as imagens de um cards.json e renomeia por nome + card_id."
    ))
    parser.add_argument(
        "source_file", type=Path, nargs="?",
        help=(
            "Catálogo JSON; padrão: <inkwell>/site/data/cards.json. "
            "Também aceita o antigo CSV master"
        ),
    )
    parser.add_argument(
        "--project-root", "--repo-root", dest="project_root", type=Path,
        help=(
            "Raiz do repositório Inkwell. Por padrão, detecta a pasta que contém "
            "site/ e tools/"
        ),
    )
    parser.add_argument(
        "--catalog-csv", type=Path,
        help="Compatibilidade: CSV master para um JSON antigo que só contenha collection",
    )
    parser.add_argument(
        "-o", "--output", type=Path,
        help="Pasta de saída (padrão: <inkwell>/site/lorcana-card-images)",
    )
    parser.add_argument(
        "--workers", type=int, default=8,
        help="Downloads simultâneos, entre 1 e 32 (padrão: 8)",
    )
    parser.add_argument(
        "--retries", type=int, default=3,
        help="Novas tentativas por imagem (padrão: 3)",
    )
    parser.add_argument(
        "--timeout", type=float, default=30,
        help="Timeout de cada requisição em segundos (padrão: 30)",
    )
    parser.add_argument(
        "--overwrite", action="store_true",
        help="Baixa novamente arquivos válidos já existentes",
    )
    parser.add_argument(
        "--no-update-json", action="store_true",
        help="Não preencher image_file no JSON após cada download",
    )
    parser.add_argument(
        "--no-official-fallback", action="store_true",
        help="Não procurar URLs ausentes na Disney nem na LigaLorcana",
    )
    parser.add_argument(
        "--naming", choices=("auto", "id", "readable", "name"), default="auto",
        help=("auto: nome__ID para JSON e ID para CSV; id: LOR1-1.jpg; "
              "readable: ID__nome.jpg; name: nome__ID.jpg"),
    )
    parser.add_argument(
        "--limit", type=int, default=None,
        help="Limita o total de linhas, útil para teste",
    )
    parser.add_argument(
        "--log-level", choices=("DEBUG", "INFO", "WARNING", "ERROR"),
        default="INFO",
    )
    parser.add_argument(
        "--show-paths", action="store_true",
        help="Mostra os caminhos resolvidos e encerra sem baixar imagens",
    )
    args = parser.parse_args()
    root = detect_project_root(args.project_root)
    args.project_root = root
    args.source_file = resolve_cli_path(
        args.source_file, root / "site" / "data" / "cards.json"
    )
    args.output = resolve_cli_path(
        args.output, root / "site" / "lorcana-card-images"
    )
    if args.catalog_csv is not None:
        args.catalog_csv = args.catalog_csv.expanduser().resolve()
    return args


def safe_piece(text: str, limit: int = 120) -> str:
    text = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", text.strip())
    text = re.sub(r"\s+", "_", text)
    text = re.sub(r"_+", "_", text).strip(" ._")
    return (text or "sem_nome")[:limit].rstrip(" ._")


def extension_for(url: str, content_type: str = "") -> str:
    suffix = Path(urlparse(url).path).suffix.lower()
    if suffix in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"}:
        return ".jpg" if suffix == ".jpeg" else suffix
    mime = content_type.lower().split(";", 1)[0].strip()
    return {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "image/avif": ".avif",
    }.get(mime, ".jpg")


def image_filename(row: dict[str, str], naming: str) -> str:
    database_id = safe_piece(row[ID_COLUMN], 80)
    ext = extension_for(row[URL_COLUMN])
    if naming == "readable":
        return f"{database_id}__{safe_piece(row.get(NAME_COLUMN, ''))}{ext}"
    if naming == "name":
        return f"{safe_piece(row.get(NAME_COLUMN, ''))}__{database_id}{ext}"
    return f"{database_id}{ext}"


def read_catalog(csv_file: Path) -> list[dict[str, str]]:
    with csv_file.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        columns = set(reader.fieldnames or [])
        required = {ID_COLUMN, URL_COLUMN, NAME_COLUMN}
        missing = sorted(required - columns)
        if missing:
            raise ValueError("Colunas obrigatórias ausentes: " + ", ".join(missing))
        rows = [{key: (value or "").strip() for key, value in row.items()} for row in reader]

    ids = [row[ID_COLUMN] for row in rows]
    empty_ids = sum(not value for value in ids)
    seen: set[str] = set()
    duplicates: set[str] = set()
    for value in ids:
        if value in seen:
            duplicates.add(value)
        seen.add(value)
    if empty_ids:
        raise ValueError(f"{empty_ids} linha(s) sem {ID_COLUMN}")
    if duplicates:
        raise ValueError(f"{ID_COLUMN} duplicado(s): {', '.join(sorted(duplicates)[:10])}")
    return rows


def read_rows(
    source_file: Path, catalog_csv: Path | None, limit: int | None
) -> tuple[list[dict[str, str]], str]:
    if source_file.suffix.lower() == ".csv":
        rows = read_catalog(source_file)
        source_type = "csv"
    elif source_file.suffix.lower() == ".json":
        with source_file.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        json_cards = payload.get("cards") if isinstance(payload, dict) else None
        if isinstance(json_cards, list):
            rows = []
            for index, card in enumerate(json_cards, start=1):
                if not isinstance(card, dict):
                    raise ValueError(f"cards[{index - 1}] não é um objeto")
                database_id = str(card.get("card_id") or "").strip()
                display_name = str(card.get("name_en") or "").strip()
                image_url = str(card.get("image_url") or "").strip()
                if not database_id or not display_name:
                    raise ValueError(
                        f"cards[{index - 1}] sem card_id ou name_en"
                    )
                rows.append({
                    ID_COLUMN: database_id,
                    NAME_COLUMN: display_name,
                    URL_COLUMN: image_url,
                    SET_COLUMN: str(card.get("set_code") or "").strip(),
                    NUMBER_COLUMN: str(card.get("card_number") or "").strip(),
                })
            ids = [row[ID_COLUMN] for row in rows]
            if len(ids) != len(set(ids)):
                raise ValueError("O JSON contém card_id duplicado")
        else:
            collection = payload.get("collection") if isinstance(payload, dict) else None
            if not isinstance(collection, dict):
                raise ValueError("JSON inválido: lista 'cards' não encontrada")
            if catalog_csv is None:
                raise ValueError(
                    "Este JSON contém somente collection. Informe também "
                    "--catalog-csv CAMINHO_DO_CSV_MASTER."
                )
            catalog = {row[ID_COLUMN]: row for row in read_catalog(catalog_csv)}
            rows = []
            missing_ids = []
            for database_id in collection:
                row = catalog.get(str(database_id).strip())
                if row is None:
                    missing_ids.append(str(database_id))
                else:
                    rows.append(row)
            if missing_ids:
                LOG.warning(
                    "%d ID(s) da coleção não existem no catálogo: %s%s",
                    len(missing_ids), ", ".join(missing_ids[:10]),
                    "..." if len(missing_ids) > 10 else "",
                )
        source_type = "json"
    else:
        raise ValueError("A entrada deve ser um arquivo .csv ou .json")

    if limit is not None:
        rows = rows[: max(0, limit)]
    return rows, source_type


def product_slug(name: str) -> str:
    text = name.lower().replace("’", "'")
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text


def official_gallery_urls(payload: dict) -> dict[str, str]:
    urls: dict[str, str] = {}
    for item in payload.get("sets", []):
        if not isinstance(item, dict):
            continue
        code = str(item.get("code") or "")
        name = str(item.get("name_en") or "")
        if code.startswith("LOR") and code[3:].isdigit() and name:
            urls[code] = (
                f"{OFFICIAL_SITE}/product/{product_slug(name)}/card-gallery"
            )
    # Nomes oficiais de produtos cuja coleção não segue o padrão LORn.
    urls["Q1"] = f"{OFFICIAL_SITE}/product/illumineers-quest-deep-trouble/card-gallery"
    urls["Q2"] = f"{OFFICIAL_SITE}/product/illumineers-quest-palace-heist/card-gallery"
    return urls


def fetch_text(url: str, timeout: float) -> str:
    request = Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "en-US,en;q=0.8",
        },
    )
    with urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", errors="replace")


def extract_official_images(html: str) -> list[str]:
    html = html.replace("\\/", "/").replace("\\u002F", "/")
    candidates = re.findall(
        r'https?://[^\s"\'<>]+?(?:/card|\.(?:jpg|jpeg|png|webp|avif))',
        html,
        flags=re.IGNORECASE,
    )
    result = []
    seen = set()
    for url in candidates:
        url = url.replace("&amp;", "&")
        if (
            ("ravensburger.cloud/" in url or "lorcana.ravensburger.com/" in url)
            and url not in seen
        ):
            seen.add(url)
            result.append(url)
    return result


def official_image_key(url: str) -> tuple[str, str] | None:
    patterns = (
        r"lorcana_en_set(\d+)_([^_/]+)_[0-9a-f]+/card",
        r"/images/en/set(\d+)/([^_/]+)_[0-9a-f]+\\.(?:jpg|jpeg|png|webp|avif)",
    )
    for pattern in patterns:
        match = re.search(pattern, url, flags=re.IGNORECASE)
        if match:
            return f"LOR{int(match.group(1))}", match.group(2).lower()
    return None


def resolve_missing_from_official(
    rows: list[dict[str, str]],
    payload: dict | None,
    timeout: float,
) -> tuple[int, int]:
    if payload is None:
        return 0, sum(not row[URL_COLUMN] for row in rows)
    missing = [row for row in rows if not row[URL_COLUMN]]
    if not missing:
        return 0, 0

    gallery_urls = official_gallery_urls(payload)
    needed_sets = sorted({
        row.get(SET_COLUMN, "") for row in missing
        if row.get(SET_COLUMN, "") in gallery_urls
    })
    image_map: dict[tuple[str, str], list[str]] = {}
    for set_code in needed_sets:
        gallery_url = gallery_urls[set_code]
        try:
            LOG.info("Consultando galeria oficial: %s", gallery_url)
            html = fetch_text(gallery_url, timeout)
            for image_url in extract_official_images(html):
                key = official_image_key(image_url)
                if key:
                    image_map.setdefault(key, []).append(image_url)
        except (HTTPError, URLError, TimeoutError, OSError) as exc:
            LOG.warning("Falha ao consultar %s: %s", gallery_url, exc)

    resolved = 0
    for row in missing:
        key = (
            row.get(SET_COLUMN, ""),
            row.get(NUMBER_COLUMN, "").lower(),
        )
        candidates = list(dict.fromkeys(image_map.get(key, [])))
        if len(candidates) == 1:
            row[URL_COLUMN] = candidates[0]
            resolved += 1
    unresolved = len(missing) - resolved
    LOG.info(
        "Fallback oficial: %d URL(s) encontrada(s), %d não encontrada(s)",
        resolved, unresolved,
    )
    return resolved, unresolved


def normalize_match_text(text: str) -> str:
    text = html_lib.unescape(text).lower().replace("–", "-").replace("’", "'")
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def html_meta_content(html: str, key: str) -> str:
    patterns = (
        rf'<meta[^>]+(?:property|name)=["\']{re.escape(key)}["\'][^>]+content=["\']([^"\']+)["\']',
        rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']{re.escape(key)}["\']',
    )
    for pattern in patterns:
        match = re.search(pattern, html, flags=re.IGNORECASE)
        if match:
            return html_lib.unescape(match.group(1).strip())
    return ""


def liga_card_url(row: dict[str, str]) -> str:
    name = row[NAME_COLUMN]
    number = row.get(NUMBER_COLUMN, "")
    params = {
        "card": f"{name} ({number})" if number else name,
        "ed": row.get(SET_COLUMN, ""),
        "num": number,
        "view": "cards/card",
    }
    return f"{LIGA_SITE}?{urlencode(params)}"


def liga_image_from_page(html: str, row: dict[str, str]) -> str:
    title = html_meta_content(html, "og:title")
    image = html_meta_content(html, "og:image")
    if not title or not image:
        return ""
    expected_name = normalize_match_text(row[NAME_COLUMN])
    actual_title = normalize_match_text(title)
    # O título precisa conter o nome completo; set e número já fazem parte da URL.
    if expected_name not in actual_title:
        return ""
    lowered_image = image.lower()
    if any(token in lowered_image for token in (
        "logo", "favicon", "banner", "avatar", "social-share", "default"
    )):
        return ""
    return image if image.startswith(("https://", "http://")) else ""


def resolve_missing_from_liga(
    rows: list[dict[str, str]], timeout: float
) -> tuple[int, int, bool]:
    missing = [row for row in rows if not row[URL_COLUMN]]
    resolved = 0
    consecutive_blocks = 0
    blocked = False
    for position, row in enumerate(missing, start=1):
        page_url = liga_card_url(row)
        try:
            html = fetch_text(page_url, timeout)
            consecutive_blocks = 0
            image_url = liga_image_from_page(html, row)
            if image_url:
                row[URL_COLUMN] = image_url
                resolved += 1
        except HTTPError as exc:
            if exc.code in {403, 429}:
                consecutive_blocks += 1
                if consecutive_blocks >= 3:
                    blocked = True
                    LOG.warning(
                        "LigaLorcana bloqueou acessos automatizados; "
                        "fallback encerrado após 3 recusas."
                    )
                    break
            else:
                LOG.debug("LigaLorcana %s: HTTP %s", row[ID_COLUMN], exc.code)
        except (URLError, TimeoutError, OSError) as exc:
            LOG.debug("LigaLorcana %s: %s", row[ID_COLUMN], exc)
        if position % 25 == 0:
            LOG.info("LigaLorcana: %d/%d consultas", position, len(missing))
        time.sleep(0.35)
    unresolved = sum(not row[URL_COLUMN] for row in rows)
    LOG.info(
        "Fallback LigaLorcana: %d URL(s) encontrada(s), %d não encontrada(s)",
        resolved, unresolved,
    )
    return resolved, unresolved, blocked


def looks_like_image(path: Path) -> bool:
    if not path.is_file() or path.stat().st_size < 100:
        return False
    with path.open("rb") as handle:
        head = handle.read(32)
    signatures = (
        b"\xff\xd8\xff",                 # JPEG
        b"\x89PNG\r\n\x1a\n",           # PNG
        b"GIF87a", b"GIF89a",            # GIF
        b"BM",                            # BMP
    )
    is_webp = head.startswith(b"RIFF") and head[8:12] == b"WEBP"
    is_avif = len(head) >= 12 and head[4:12] in {
        b"ftypavif", b"ftypavis", b"ftypmif1", b"ftypmsf1"
    }
    return head.startswith(signatures) or is_webp or is_avif


def hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download_one(
    row: dict[str, str],
    images_dir: Path,
    naming: str,
    retries: int,
    timeout: float,
    overwrite: bool,
) -> Result:
    database_id = row[ID_COLUMN]
    display_name = row[NAME_COLUMN]
    url = row[URL_COLUMN]
    if not url:
        return Result(database_id, display_name, "", "", "official_not_found",
                      error="Imagem não encontrada com segurança na galeria oficial")

    filename = image_filename(row, naming)
    destination = images_dir / filename
    relative = f"images/{filename}"
    if not overwrite and looks_like_image(destination):
        return Result(database_id, display_name, url, relative, "skipped",
                      destination.stat().st_size, hash_file(destination))

    last_error = ""
    for attempt in range(retries + 1):
        temp_path: Path | None = None
        try:
            request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "image/*"})
            with urlopen(request, timeout=timeout) as response:
                content_type = response.headers.get("Content-Type", "")
                if content_type and not content_type.lower().startswith("image/"):
                    raise ValueError(f"Content-Type inesperado: {content_type}")
                with tempfile.NamedTemporaryFile(
                    mode="wb", delete=False, dir=images_dir, prefix=".download-"
                ) as temp:
                    temp_path = Path(temp.name)
                    shutil.copyfileobj(response, temp, length=1024 * 1024)
            if not looks_like_image(temp_path):
                raise ValueError("resposta não é uma imagem válida")
            os.replace(temp_path, destination)
            return Result(database_id, display_name, url, relative, "downloaded",
                          destination.stat().st_size, hash_file(destination))
        except (HTTPError, URLError, TimeoutError, OSError, ValueError) as exc:
            last_error = f"{type(exc).__name__}: {exc}"
            if temp_path:
                temp_path.unlink(missing_ok=True)
            if attempt < retries:
                time.sleep(min(8.0, 0.75 * (2 ** attempt)))

    return Result(database_id, display_name, url, relative, "failed", error=last_error)


def atomic_write_json(path: Path, payload: object) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    os.replace(temporary, path)


def prepare_json_update(
    source_file: Path, enabled: bool
) -> tuple[dict | None, dict[str, dict]]:
    if not enabled or source_file.suffix.lower() != ".json":
        return None, {}
    with source_file.open("r", encoding="utf-8-sig") as handle:
        payload = json.load(handle)
    cards = payload.get("cards") if isinstance(payload, dict) else None
    if not isinstance(cards, list):
        return None, {}
    index = {
        str(card.get("card_id")): card
        for card in cards
        if isinstance(card, dict) and card.get("card_id")
    }
    backup = source_file.with_name(f"{source_file.stem}.backup{source_file.suffix}")
    if not backup.exists():
        shutil.copy2(source_file, backup)
        LOG.info("Backup criado: %s", backup)
    return payload, index


def update_json_card(
    payload: dict,
    card_index: dict[str, dict],
    source_file: Path,
    result: Result,
) -> bool:
    if result.status not in {"downloaded", "skipped"} or not result.image_file:
        return False
    card = card_index.get(result.database_id)
    if card is None:
        return False
    # image_base_path já é "images/"; por isso armazenamos apenas o arquivo.
    card["image_file"] = Path(result.image_file).name
    if result.image_url:
        card["image_url"] = result.image_url
        hostname = (urlparse(result.image_url).hostname or "").lower()
        card["image_source"] = (
            "ligalorcana"
            if "ligalorcana" in hostname or "ligapokemon" in hostname
            else "disney_ravensburger"
        )
    # name_en permanece no registro e também integra o novo image_file.
    payload["images_updated_at"] = datetime.now(timezone.utc).isoformat()
    return True


def write_csv(path: Path, results: Iterable[Result]) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    fields = list(Result.__dataclass_fields__)
    with temporary.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(asdict(result) for result in results)
    os.replace(temporary, path)


def main() -> int:
    args = parse_args()
    if args.show_paths:
        print(json.dumps({
            "project_root": str(args.project_root),
            "source_file": str(args.source_file),
            "output": str(args.output),
            "catalog_csv": str(args.catalog_csv) if args.catalog_csv else None,
        }, ensure_ascii=False, indent=2))
        return 0
    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s %(levelname)s %(message)s",
    )
    args.workers = max(1, min(32, args.workers))
    if args.retries < 0 or args.timeout <= 0:
        raise ValueError("--retries deve ser >= 0 e --timeout deve ser > 0")

    rows, source_type = read_rows(args.source_file, args.catalog_csv, args.limit)
    json_payload, json_card_index = prepare_json_update(
        args.source_file, enabled=not args.no_update_json
    )
    lookup_payload = json_payload
    if lookup_payload is None and args.source_file.suffix.lower() == ".json":
        with args.source_file.open("r", encoding="utf-8-sig") as handle:
            candidate_payload = json.load(handle)
        if isinstance(candidate_payload, dict):
            lookup_payload = candidate_payload
    official_resolved = 0
    official_unresolved = 0
    liga_resolved = 0
    liga_unresolved = 0
    liga_blocked = False
    if not args.no_official_fallback:
        official_resolved, official_unresolved = resolve_missing_from_official(
            rows, lookup_payload, args.timeout
        )
        if official_unresolved:
            liga_resolved, liga_unresolved, liga_blocked = resolve_missing_from_liga(
                rows, args.timeout
            )
    naming = args.naming
    if naming == "auto":
        naming = "name" if source_type == "json" else "id"
    output = args.output.resolve()
    images_dir = output / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    LOG.info("Base: %d cartas | Saída: %s", len(rows), output)

    results: list[Result] = []
    lock = threading.Lock()
    completed = 0
    pending_json_changes = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {
            pool.submit(
                download_one, row, images_dir, naming, args.retries,
                args.timeout, args.overwrite
            ): row[ID_COLUMN]
            for row in rows
        }
        for future in as_completed(futures):
            result = future.result()
            with lock:
                results.append(result)
                completed += 1
                if json_payload is not None and update_json_card(
                    json_payload, json_card_index, args.source_file, result
                ):
                    pending_json_changes += 1
                    if pending_json_changes >= 25:
                        atomic_write_json(args.source_file, json_payload)
                        pending_json_changes = 0
                if result.status in {"failed", "official_not_found"}:
                    LOG.warning("%s: %s", result.database_id, result.error)
                elif completed == 1 or completed % 50 == 0 or completed == len(rows):
                    LOG.info("Progresso: %d/%d", completed, len(rows))

    order = {row[ID_COLUMN]: index for index, row in enumerate(rows)}
    results.sort(key=lambda item: order[item.database_id])
    if json_payload is not None and pending_json_changes:
        atomic_write_json(args.source_file, json_payload)
        LOG.info("JSON atualizado: %s", args.source_file)
    counts: dict[str, int] = {}
    for result in results:
        counts[result.status] = counts.get(result.status, 0) + 1

    write_csv(output / "image_manifest.csv", results)
    atomic_write_json(output / "image_manifest.json", {
        result.database_id: {
            "display_name": result.display_name,
            "image_file": result.image_file,
            "image_url": result.image_url,
            "status": result.status,
            "sha256": result.sha256,
        }
        for result in results
    })
    atomic_write_json(output / "download_summary.json", {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_file": str(args.source_file.resolve()),
        "catalog_csv": str(args.catalog_csv.resolve()) if args.catalog_csv else None,
        "source_type": source_type,
        "naming": naming,
        "total": len(results),
        "counts": counts,
        "official_fallback": {
            "resolved": official_resolved,
            "unresolved": official_unresolved,
        },
        "ligalorcana_fallback": {
            "resolved": liga_resolved,
            "unresolved": liga_unresolved,
            "blocked": liga_blocked,
        },
    })

    LOG.info("Concluído: %s", ", ".join(f"{key}={value}" for key, value in counts.items()))
    return 1 if counts.get("failed", 0) else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\nInterrompido. Execute novamente para retomar.", file=sys.stderr)
        raise SystemExit(130)
    except Exception as exc:
        LOG.error("%s", exc)
        raise SystemExit(2)
