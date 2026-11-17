#!/usr/bin/env python3
"""Importador offline e sem publicação dos preços LigaLorcana por impressão.

Aceita cardsjson, listagem legada e documentos cards_editions/CSV previamente obtidos
com autorização. Não possui cliente HTTP, navegador nem dependências externas.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.parse import parse_qs, urlparse

JS_CARDS = re.compile(r"(?:var|let|const)\s+cardsjson\s*=\s*", re.I)
FINISHES = {"normal": "0", "foil": "2"}
FIELDS = (("p", "min_centavos"), ("m", "med_centavos"), ("g", "max_centavos"))


def iso(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("data real de captura ausente; informe --captured-at")
    try:
        dt = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"captured_at inválido: {value!r}") from exc
    if dt.tzinfo is None or dt.utcoffset() is None:
        raise ValueError("captured_at deve conter fuso horário")
    return dt.isoformat()


def text_name(value):
    name = re.sub(r"\s*\([^()]*\)\s*$", "", str(value or "")).strip()
    name = unicodedata.normalize("NFKD", name).casefold()
    name = "".join(ch for ch in name if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]", "", name)


def positive_int(value, field):
    try:
        number = int(value)
        if str(number) != str(value).strip() or number < 1:
            raise ValueError()
        return number
    except (ValueError, TypeError):
        raise ValueError(f"{field} inválido: {value!r}") from None


def cents(value):
    if isinstance(value, bool) or value is None or str(value).strip() == "":
        raise ValueError("preço ausente no objeto de valores")
    try:
        number = Decimal(str(value).strip())
    except InvalidOperation as exc:
        raise ValueError(f"preço inválido: {value!r}") from exc
    if not number.is_finite() or number <= 0 or number > 999999 or number * 100 != (number * 100).to_integral_value():
        raise ValueError(f"preço fora do limite ou com fração de centavo: {value!r}")
    return int(number * 100)


def finish(data):
    if data == []:
        return {"status": "sem_oferta"}
    if data is None:
        return {"status": "campo_ausente"}
    if not isinstance(data, dict) or set(data) < {"p", "m", "g"}:
        raise ValueError("faixa de preços incompleta")
    values = {label: cents(data[field]) for field, label in FIELDS}
    if not values["min_centavos"] <= values["med_centavos"] <= values["max_centavos"]:
        raise ValueError("mínimo, médio e máximo inconsistentes")
    return {"status": "ok", **values}


def parse_source(path):
    raw = path.read_text(encoding="utf-8-sig")
    if path.suffix.lower() == ".csv":
        return list(csv.DictReader(raw.splitlines(), delimiter=";"))
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        match = JS_CARDS.search(raw)
        if not match:
            raise ValueError(f"{path.name}: esperado JSON, CSV ou script cardsjson") from None
        obj, _ = json.JSONDecoder().raw_decode(raw[match.end():].lstrip())
        return {"cardsjson": obj}


def catalog_rows(data):
    if isinstance(data, dict):
        if isinstance(data.get("cardsjson"), list):
            return data["cardsjson"], "cardsjson"
        if isinstance(data.get("records"), list):
            return data["records"], "legado"
    if isinstance(data, list) and data and isinstance(data[0], dict) and "sSigla" in data[0]:
        return data, "cardsjson"
    raise ValueError("catálogo deve conter cardsjson[] ou records[]")


def build_catalog(data, master=None):
    rows, kind = catalog_rows(data)
    if not rows:
        raise ValueError("catálogo vazio")
    allowed_ids = None
    if master is not None:
        if not isinstance(master, dict) or not isinstance(master.get("cards"), list):
            raise ValueError("master precisa conter cards[]")
        allowed_ids = {c["card_id"] for c in master["cards"] if isinstance(c, dict) and c.get("card_id")}
    catalog = []
    fingerprints = set()
    for item in rows:
        edition = str(item.get("sSigla") if kind == "cardsjson" else item.get("edicao", "")).strip().upper()
        number = str(item.get("sN") if kind == "cardsjson" else item.get("numero", "")).strip()
        name = str(item.get("nEN") or item.get("nPT") or "") if kind == "cardsjson" else str(item.get("nome_base") or item.get("nome") or "")
        inkwell_id = None if kind == "cardsjson" else item.get("id")
        card_id = positive_int(item["id"], "liga_card_id") if kind == "cardsjson" else None
        edition_id = positive_int(item["idE"], "liga_edicao_id") if kind == "cardsjson" else None
        key = (edition, number, text_name(name))
        if not all(key) or key in fingerprints:
            raise ValueError(f"identidade ausente/duplicada no catálogo: {key!r}")
        fingerprints.add(key)
        if allowed_ids is not None and inkwell_id not in allowed_ids:
            inkwell_id = None
        catalog.append({"liga_card_id": card_id, "liga_edicao_id": edition_id,
                        "edicao": edition, "numero": number, "nome": name,
                        "inkwell_card_id": inkwell_id,
                        "url_fonte": item.get("url") if kind == "legado" else None})
    return catalog


def iter_files(path):
    if path.is_file():
        return [path]
    if not path.is_dir():
        raise ValueError(f"entrada não encontrada: {path}")
    paths = [p for p in sorted(path.iterdir()) if p.is_file() and p.suffix.lower() in {".json", ".csv", ".html", ".htm"}]
    if not paths:
        raise ValueError("pasta de entrada sem JSON/CSV/HTML")
    return paths


def prepare_entries(path, override):
    data = parse_source(path)
    if isinstance(data, dict) and isinstance(data.get("cards_editions"), list):
        captured = iso(data.get("_capturado_em") or override)
        source = data.get("_fonte")
        return [(row, source, captured) for row in data["cards_editions"]]
    if isinstance(data, list) and data and all(isinstance(row, dict) and "price" in row for row in data):
        return [(row, None, iso(override)) for row in data]
    if isinstance(data, list) and all(isinstance(row, dict) for row in data):
        entries = []
        for row in data:
            entries.append((csv_entry(row), row.get("source_url"), iso(row.get("captured_at") or override)))
        return entries
    raise ValueError(f"{path.name}: formato não reconhecido")


def csv_entry(row):
    # CSV canônico, sem supor o esquema de uma eventual exportação da Liga.
    price = {}
    for prefix, key in (("n", "0"), ("f", "2")):
        vals = [row.get(f"{prefix}_{x}") for x in ("min", "med", "max")]
        status = (row.get(f"{prefix}_status") or "").strip().lower()
        if status == "sem_oferta":
            if any(v not in ("", None) for v in vals):
                raise ValueError("CSV: sem_oferta com valores")
            price[key] = []
        elif status in ("", "ok") and all(v not in ("", None) for v in vals):
            price[key] = dict(zip(("p", "m", "g"), vals))
        elif status in ("", "campo_ausente") and all(v in ("", None) for v in vals):
            pass
        else:
            raise ValueError(f"CSV: campos parciais ou status inválido para {prefix}")
    return {"idcard": row.get("liga_card_id"), "id": row.get("liga_edicao_id"),
            "code": row.get("edicao"), "num": row.get("numero"),
            "_nome_carta": row.get("nome"), "price": price}


def url_card_name(url):
    if not url:
        return ""
    parsed = urlparse(str(url))
    if parsed.scheme != "https" or parsed.hostname not in {"www.ligalorcana.com.br", "ligalorcana.com.br"}:
        raise ValueError("URL da fonte não é HTTPS da LigaLorcana")
    return parse_qs(parsed.query).get("card", [""])[0]


def resolve_row(entry, catalog_index, url):
    card_id = positive_int(entry.get("idcard"), "idcard")
    edition_id = positive_int(entry.get("id"), "edition id")
    edition = str(entry.get("code") or "").strip().upper()
    number = str(entry.get("num") or "").strip()
    matches = catalog_index.get((edition, number), [])
    if not matches:
        raise ValueError(f"impressão fora do catálogo: {edition}/{number}")
    name = text_name(entry.get("_nome_carta") or url_card_name(url))
    if name:
        matches = [c for c in matches if text_name(c["nome"]) == name]
    if len(matches) != 1:
        raise ValueError(f"correspondência ambígua ou divergente: {edition}/{number}; nome={name!r}")
    target = matches[0]
    idkey = entry.get("idkey")
    if idkey is not None and str(idkey) != f"{edition_id}_{number}":
        raise ValueError("idkey divergente do ID da edição e número")
    if target["liga_card_id"] is not None and target["liga_card_id"] != card_id:
        raise ValueError("liga_card_id não corresponde ao catálogo")
    if target["liga_edicao_id"] is not None and target["liga_edicao_id"] != edition_id:
        raise ValueError("liga_edicao_id não corresponde ao catálogo")
    return target, (card_id, edition_id, number)


def import_data(catalog, files, override):
    indexes = defaultdict(list)
    for row in catalog:
        indexes[(row["edicao"], row["numero"])].append(row)
    snapshots = defaultdict(dict)
    issues = []
    seen = set()
    for file in files:
        try:
            entries = prepare_entries(file, override)
        except (ValueError, OSError) as exc:
            issues.append({"arquivo": file.name, "erro": str(exc)})
            continue
        for position, (entry, url, captured) in enumerate(entries, 1):
            target = None
            composite = None
            day = captured[:10]
            try:
                target, composite = resolve_row(entry, indexes, url)
                if (day, composite) in seen:
                    raise ValueError("impressão duplicada neste dia")
                seen.add((day, composite))
                if not isinstance(entry.get("price"), dict):
                    raise ValueError("objeto price ausente/inválido")
                prices = {label: finish(entry["price"].get(code)) for label, code in FINISHES.items()}
                snapshots[day][(target["edicao"], target["numero"], text_name(target["nome"]))] = {
                    "liga_card_id": composite[0], "liga_edicao_id": composite[1],
                    "edicao": target["edicao"], "numero": composite[2],
                    "nome": target["nome"], "inkwell_card_id": target["inkwell_card_id"],
                    "url_fonte": url or target["url_fonte"], "capturado_em": captured,
                    "normal": prices["normal"], "foil": prices["foil"]}
            except (ValueError, TypeError, KeyError) as exc:
                issues.append({"arquivo": file.name, "linha": position, "erro": str(exc)})
                if target is not None and composite is not None:
                    key = (target["edicao"], target["numero"], text_name(target["nome"]))
                    if key not in snapshots[day]:
                        snapshots[day][key] = {
                            "liga_card_id": composite[0], "liga_edicao_id": composite[1],
                            "edicao": target["edicao"], "numero": composite[2],
                            "nome": target["nome"], "inkwell_card_id": target["inkwell_card_id"],
                            "url_fonte": url or target["url_fonte"], "capturado_em": captured,
                            "normal": {"status": "invalido"}, "foil": {"status": "invalido"}}
    return snapshots, issues


def write_outputs(outdir, catalog, snapshots, issues):
    # Não altera preços.json, manifest, histórico existente nem o aplicativo.
    outdir = Path(outdir)
    if not snapshots:
        raise ValueError("nenhum registro válido: importação cancelada sem gravação")
    filenames = {day: outdir / "precos" / f"{day}.json" for day in snapshots}
    existing = [p for p in filenames.values() if p.exists()]
    if existing:
        raise FileExistsError(f"snapshot imutável já existe: {existing[0]}")
    index = outdir / "historico" / "index.json"
    prior = json.loads(index.read_text("utf-8")) if index.exists() else {"schema_version": 1, "dias": []}
    days = set(prior["dias"])
    for day in snapshots:
        if day in days:
            raise ValueError(f"dia já está no histórico: {day}")
    now = datetime.now(timezone.utc).isoformat()
    report = {"schema_version": 1, "importado_em": now, "total_catalogo": len(catalog),
              "dias": sorted(snapshots), "problemas": issues, "contagens": {}}
    payloads = {}
    for day, records in sorted(snapshots.items()):
        all_rows = []
        counts = Counter()
        for original in catalog:
            key = (original["edicao"], original["numero"], text_name(original["nome"]))
            row = records.get(key)
            if row is None:
                row = {**original, "capturado_em": None, "normal": {"status": "nao_coletado"},
                       "foil": {"status": "nao_coletado"}}
            else:
                row = dict(row)
            for finish_name in FINISHES:
                counts[row[finish_name]["status"]] += 1
            all_rows.append(row)
        report["contagens"][day] = dict(counts)
        payloads[day] = {"schema_version": 1, "fonte": "LigaLorcana", "moeda": "BRL",
                         "capturas_em": day, "importado_em": now,
                         "publicavel": False, "tipo": "precos_por_acabamento_offline",
                         "total_catalogo": len(catalog), "registros": all_rows}
    # Valida e serializa tudo antes de alterar o disco.
    blobs = {p: json.dumps(payloads[day], ensure_ascii=False, indent=2) + "\n" for day, p in filenames.items()}
    blobs[index] = json.dumps({"schema_version": 1, "dias": sorted(days | set(snapshots))}, indent=2) + "\n"
    blobs[outdir / "relatorio.json"] = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    for path, content in blobs.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_suffix(path.suffix + ".tmp")
        temp.write_text(content, encoding="utf-8")
        temp.replace(path)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, required=True, help="cardsjson ou listagem de 16/11")
    parser.add_argument("--input", type=Path, required=True, help="arquivo ou pasta de cards_editions / CSV")
    parser.add_argument("--master", type=Path, help="site/data/cards.json; valida IDs do Inkwell quando informados")
    parser.add_argument("--captured-at", help="timestamp original com fuso, se a fonte não contiver data")
    parser.add_argument("--outdir", type=Path, default=Path("build/ligalorcana-offline"))
    args = parser.parse_args(argv)
    try:
        master = parse_source(args.master) if args.master else None
        catalog = build_catalog(parse_source(args.catalog), master)
        snapshots, issues = import_data(catalog, iter_files(args.input), args.captured_at)
        report = write_outputs(args.outdir, catalog, snapshots, issues)
        print(json.dumps({"total_catalogo": report["total_catalogo"], "dias": report["dias"],
                          "problemas": len(issues), "contagens": report["contagens"]}, ensure_ascii=False))
        return 0 if not issues else 2
    except (ValueError, OSError, KeyError, json.JSONDecodeError) as exc:
        print(f"ERRO: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
