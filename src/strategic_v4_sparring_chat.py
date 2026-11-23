"""Resume a deterministic Sparring match from an atomic decision checkpoint."""
import argparse
from contextlib import contextmanager
from copy import deepcopy
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
from tempfile import NamedTemporaryFile, TemporaryDirectory
from uuid import uuid4

if __package__:
    from .strategic_v4_sparring import prepare_sparring_review
else:
    from strategic_v4_sparring import prepare_sparring_review

SCHEMA = "inkwell-sparring-checkpoint-v1"
BRIDGE = Path(__file__).resolve().parents[1] / "tools" / "strategic_v4_sparring_engine.mjs"


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def file_hash(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def runtime_identity(engine, bridge):
    return {
        "engine_sha256": file_hash(engine), "bridge_sha256": file_hash(bridge),
        "node": subprocess.check_output(["node", "--version"], text=True).strip(),
    }


def new_checkpoint(seed, human, bot, engine, bridge, printings=None):
    return {"schema": SCHEMA, "game_id": str(uuid4()), "seed": seed,
            "human_deck": human, "bot_deck": bot, "printings": printings,
            "runtime": runtime_identity(engine, bridge), "history": [], "feedback": [], "cursor": None}


def write_atomic(path, state):
    with NamedTemporaryFile(dir=path.parent, prefix=f".{path.name}.", delete=False) as handle:
        tmp = Path(handle.name)
        try:
            handle.write(canonical(state) + b"\n")
            handle.flush()
            os.fsync(handle.fileno())
        except BaseException:
            tmp.unlink()
            raise
    try:
        tmp.replace(path)
    finally:
        tmp.unlink(missing_ok=True)


@contextmanager
def locked(path):
    fd = os.open(path.with_suffix(path.suffix + ".lock"), os.O_CREAT | os.O_RDWR, 0o600)
    with os.fdopen(fd, "r+") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        yield


def stream_checkpoint(state, engine, bridge, submitted=None):
    """Replay only recorded inputs, check the prefix, then optionally apply one new answer."""
    if state["schema"] != SCHEMA or state["runtime"] != runtime_identity(engine, bridge):
        raise ValueError("checkpoint runtime differs from the pinned engine, bridge or Node version")
    rolling = hashlib.sha256()
    index = 0
    boundary_checked = False
    reviews = []
    hand_events = []
    with TemporaryDirectory(prefix="inkwell-chat-") as tmp:
        root = Path(tmp)
        decks = [root / "human.deck", root / "bot.deck"]
        for path, key in zip(decks, ("human_deck", "bot_deck")):
            path.write_text(state[key], encoding="utf-8")
        command = ["node", str(bridge), "--engine", str(engine), "--human", str(decks[0]),
                   "--bot", str(decks[1]), "--seed", str(state["seed"]), "--game-id", state["game_id"]]
        with subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                              stderr=subprocess.DEVNULL, text=True, encoding="utf-8") as process:
            try:
                for line in process.stdout:
                    event = json.loads(line)
                    rolling.update(canonical(event) + b"\n")
                    kind = event["type"]
                    if kind == "trainer_hand":
                        hand_events.append(event)
                    elif kind == "review":
                        reviews.append(event["turn"])
                    if kind not in ("human_input", "finished"):
                        continue
                    if event.get("error"):
                        raise ValueError("engine rejected input: " + event["error"])
                    cursor = {"digest": rolling.hexdigest(), "type": kind}
                    replayed = index < len(state["history"])
                    if replayed:
                        saved_input = state["history"][index]
                        if kind != "human_input" or saved_input["before"] != cursor["digest"]:
                            raise ValueError(f"recorded decision {index + 1} did not replay identically")
                        reply = saved_input["answer"]
                    elif not boundary_checked:
                        if state["cursor"] is not None and state["cursor"] != cursor:
                            raise ValueError("saved decision boundary did not replay identically")
                        boundary_checked = True
                        if submitted is None:
                            return cursor, event, reviews, hand_events
                        if kind != "human_input":
                            raise ValueError("this game has finished")
                        reply = submitted
                    else:
                        return cursor, event, reviews, hand_events
                    process.stdin.write(json.dumps(reply) + "\n")
                    process.stdin.flush()
                    reviews.clear()
                    hand_events.clear()
                    index += 1
                raise ValueError("engine exited before the next decision")
            finally:
                if process.poll() is None:
                    process.terminate()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--engine", type=Path, required=True)
    parser.add_argument("--bridge", type=Path, default=BRIDGE)
    sub = parser.add_subparsers(dest="mode", required=True)
    start = sub.add_parser("start")
    start.add_argument("--human", type=Path, required=True)
    start.add_argument("--bot", type=Path, required=True)
    start.add_argument("--seed", type=int, required=True)
    start.add_argument("--printings", type=Path)
    sub.add_parser("show")
    action = sub.add_parser("act")
    action.add_argument("--expected", required=True)
    action.add_argument("--answer", required=True, type=json.loads)
    note = sub.add_parser("feedback")
    note.add_argument("--decision", required=True)
    note.add_argument("--annotation", required=True, type=json.loads)
    args = parser.parse_args(argv)

    try:
        with locked(args.checkpoint):
            if args.mode == "start":
                if args.checkpoint.exists():
                    raise ValueError("checkpoint already exists; use show or act")
                manifest = json.loads(args.printings.read_text(encoding="utf-8")) if args.printings else None
                state = new_checkpoint(args.seed, args.human.read_text(encoding="utf-8"),
                                       args.bot.read_text(encoding="utf-8"), args.engine, args.bridge, manifest)
            else:
                state = json.loads(args.checkpoint.read_text(encoding="utf-8"))
            submitted = args.answer if args.mode == "act" else None
            if args.mode == "act" and (not isinstance(submitted, dict)
                                      or state["cursor"]["digest"] != args.expected):
                raise ValueError("stale decision or invalid answer")
            cursor, event, reviews, hands = stream_checkpoint(state, args.engine, args.bridge, submitted)
            result = deepcopy(state)
            if args.mode == "act":
                result["history"].append({"before": state["cursor"]["digest"], "answer": submitted})
            result["cursor"] = cursor
            if args.mode == "feedback":
                turn = next((turn for turn in reviews if turn["decision_id"] == args.decision), None)
                if turn is None or any(item["decision_id"] == args.decision for item in result["feedback"]):
                    raise ValueError("unknown or already reviewed bot turn")
                review = prepare_sparring_review(turn, args.annotation)
                result["feedback"].append({"decision_id": args.decision, "feedback": review["feedback"]})
            if args.mode != "show":
                write_atomic(args.checkpoint, result)
            print(json.dumps({"game_id": result["game_id"], "cursor": cursor, "next": event,
                              "new_bot_hands": hands, "new_bot_reviews": reviews,
                              "annotations": result["feedback"]}, ensure_ascii=False))
    except (ValueError, OSError, KeyError) as error:
        parser.exit(1, f"{error}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
