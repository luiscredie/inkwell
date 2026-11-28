"""Audit synthetic loss checkpoints in fresh, time-limited engine processes."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time


def store(path, value):
    with tempfile.NamedTemporaryFile(dir=path.parent, mode="w", delete=False) as tmp:
        name = Path(tmp.name)
        try:
            json.dump(value, tmp, ensure_ascii=False)
            tmp.flush()
            os.fsync(tmp.fileno())
            name.replace(path)
        finally:
            name.unlink(missing_ok=True)


def review_batch(folder, cache, node, reviewer, env):
    cache.mkdir(parents=True, exist_ok=True)
    records = []
    deadline = time.monotonic() + 90
    for checkpoint in sorted(folder.glob("*.json")):
        key = checkpoint.name
        item = {"checkpoint": key, "origem": "pendente"}
        records.append(item)
        if hashlib.sha256(checkpoint.read_bytes()).hexdigest() + ".json" != key:
            item["status"] = "checkpoint_invalido"
            continue
        target = cache / key
        if target.exists():
            try:
                saved = json.loads(target.read_bytes())
            except (ValueError, OSError):
                saved = None
            if (isinstance(saved, dict) and saved.get("checkpoint") == key and saved.get("reproduced") is True
                    and saved.get("status") in ("inconclusive", "survived_reply", "own_win")):
                item.update(origem="memoria", status=saved["status"])
                continue
        available = deadline - time.monotonic()
        if available <= 0:
            item["status"] = "orcamento_do_lote"
            continue
        try:
            child = subprocess.run([node, str(reviewer), str(checkpoint)], env=env,
                                   capture_output=True, text=True, check=True, timeout=min(available, 18))
            review = json.loads(child.stdout)
            if review["checkpoint"] != key:
                raise ValueError("Resposta associada a outro checkpoint")
            item.update(origem="executada", status=review["status"])
            if review["reproduced"]:
                store(target, review)
        except subprocess.TimeoutExpired:
            item["status"] = "tempo_esgotado"
        except (ValueError, KeyError, OSError, subprocess.CalledProcessError) as error:
            item["status"] = "erro_revisao"
            item["erro"] = (getattr(error, "stderr", "") or str(error))[-1000:]
    return records
