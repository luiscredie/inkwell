"""Local terminal client for the Sparring simulator bridge."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

if __package__:
    from .strategic_v4_sparring import RATINGS, prepare_sparring_review
else:
    from strategic_v4_sparring import RATINGS, prepare_sparring_review


LABELS = ("game_changing", "ok", "bad", "inconclusive")
HUMAN_LABELS = ("Game changing", "OK", "Bad", "Inconclusivo")


def append_feedback(path, review):
    # One append per review, outside the engine or any trainer input.
    fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
    with os.fdopen(fd, "a", encoding="utf-8") as file:
        file.write(json.dumps(review, ensure_ascii=False) + "\n")


def decision_input(value, request):
    if request["type"] == "Action" and value.isdecimal():
        return {"type": "Action", "option": int(value)}
    if request["type"] == "Choose Cards":
        parts = [part.strip() for part in value.split(",")] if value else []
        if all(part.isdecimal() for part in parts):
            indices = [int(part) for part in parts]
            if (not request["min"] <= len(indices) <= request["max"]
                    or len(set(indices)) != len(indices)
                    or any(not 1 <= i <= len(request["cards"]) for i in indices)):
                raise ValueError("Escolha índices distintos dentro da quantidade pedida.")
            return {"type": "Decision", "answer": {
                "type": "Choose Cards", "cards": [request["cards"][i - 1] for i in indices],
            }}
    if request["type"] == "Pay Cost" and value.isdecimal():
        index = int(value)
        if index == 0 and request["optional"]:
            return {"type": "Decision", "answer": {"type": "Pay Cost", "pay": False}}
        if not 1 <= index <= len(request["payments"]):
            raise ValueError("Escolha um pagamento listado.")
        return {"type": "Decision", "answer": {
            "type": "Pay Cost", "pay": True, "payment": request["payments"][index - 1],
        }}
    return json.loads(value)


def short_test_answer(request):
    if request["type"] == "Action":
        choices = request["actions"]
        selected = next((o for o in choices if o["action"]["type"] == "End Turn"), choices[0])
        return {"type": "Action", "option": selected["option"]}
    if request["type"] == "Choose Cards" and request["min"] == 0:
        return decision_input("", request)
    if request["type"] in ("Optional", "Optional Cost Rule"):
        return {"type": "Decision", "answer": {"type": request["type"], "accept": False}}
    raise ValueError(f"smoke input handler cannot answer {request['type']}")


def interactive_answer(message):
    state, request = message["state"], message["request"]
    print(f"\nSeu turno · {state['turn']['number']}")
    for seat, player in state["players"].items():
        print(f"  Jogador {seat}: {player['lore']} lore · mesa {json.dumps(player['play'], ensure_ascii=False)}")
    print("Sua mão:", json.dumps(state["players"]["1"]["hand"], ensure_ascii=False))
    if message.get("error"):
        print(message["error"])
    print(json.dumps(request, ensure_ascii=False, indent=2))
    if request["type"] == "Choose Cards":
        print("Cartas na ordem exibida: índices a partir de 1, separados por vírgula.")
    elif request["type"] == "Pay Cost":
        print("Pagamentos na ordem exibida: índices a partir de 1. Use 0 se for opcional.")
    while True:
        try:
            return decision_input(input("Número da ação ou resposta JSON: ").strip(), request)
        except ValueError as error:
            print("Entrada inválida. Use o número da opção ou o objeto JSON pedido pelo motor.", error)


def interactive_feedback(turn):
    print("\nSequência do bot e opções legais em cada passo")
    print(json.dumps(turn, ensure_ascii=False, indent=2))
    print("  ".join(f"{i + 1} {label}" for i, label in enumerate(HUMAN_LABELS)))
    while True:
        choice = input("Classificação (Enter para pular): ").strip()
        if not choice:
            return None
        if choice in ("1", "2", "3", "4"):
            grade = LABELS[int(choice) - 1]
        else:
            grade = choice.lower()
        if grade in RATINGS:
            reason = input("Por quê? ").strip()
            if reason:
                return {"rating": grade, "reason": reason,
                        "preferred_line": input("Qual alternativa você jogaria? ").strip() or None}
        print("Informe uma classificação válida e uma justificativa.")


def run_session(command, feedback_file, answer, feedback, notify, *, env=None):
    pending = None
    with subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding="utf-8", env=env) as engine:
        try:
            for line in engine.stdout:
                message = json.loads(line)
                kind = message["type"]
                if kind == "human_input":
                    reply = answer(message)
                    engine.stdin.write(json.dumps(reply) + "\n")
                    engine.stdin.flush()
                elif kind == "trainer_hand":
                    if pending is not None:
                        raise ValueError("new hand arrived before the previous turn review")
                    pending = message["decision_id"]
                    notify(message)
                elif kind == "review":
                    turn = message["turn"]
                    if pending != turn["decision_id"] or turn.get("human_turn_locked") is not True:
                        raise ValueError("review does not follow the engine's locked turn")
                    annotation = feedback(turn)
                    if annotation is not None:
                        review = prepare_sparring_review(turn, annotation)
                        review["ink_decision"] = turn.get("ink_decision")
                        append_feedback(feedback_file, review)
                    pending = None
                elif kind == "finished":
                    if engine.wait() != 0:
                        raise ValueError("engine terminated with an error")
                    if pending is not None:
                        raise ValueError("engine finished without the pending turn review")
                    notify(message)
                    return message
                else:
                    raise ValueError(f"unexpected engine message: {kind}")
            raise ValueError("engine exited without a finish record")
        finally:
            if engine.poll() is None:
                engine.terminate()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine", required=True, type=Path, help="path to simulator dist/index.mjs")
    parser.add_argument("--human", required=True, type=Path, help="human deck file")
    parser.add_argument("--bot", required=True, type=Path, help="bot deck file")
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--policy", choices=("defense", "baseline"), default="defense")
    parser.add_argument("--turns", type=int, help="optional short run limit")
    parser.add_argument("--feedback", type=Path, default=Path("sparring-feedback.local.jsonl"))
    parser.add_argument("--smoke", action="store_true", help="automatic test controller, no human ratings")
    args = parser.parse_args(argv)
    bridge = Path(__file__).resolve().parents[1] / "tools" / "strategic_v4_sparring_engine.mjs"
    engine = args.engine
    env = os.environ.copy()
    if args.policy == "defense":
        env["INKWELL_RULES_ENGINE"] = str(engine.resolve())
        env.pop("INKWELL_DECISION_JOURNAL", None)
        engine = bridge.with_name("strategic_v4_sparring_candidate.mjs")
    command = ["node", str(bridge), "--engine", str(engine), "--human", str(args.human),
               "--bot", str(args.bot), "--seed", str(args.seed)]
    if args.turns is not None:
        command.extend(["--turns", str(args.turns)])

    def notify(message):
        if message["type"] == "trainer_hand":
            print("Mão real do bot após o fechamento do seu turno:", ", ".join(message["bot_hand"]["cards"]))
        else:
            print("Fim da sessão:", json.dumps(message, ensure_ascii=False))

    try:
        run_session(command, args.feedback, (lambda event: short_test_answer(event["request"])) if args.smoke
                    else interactive_answer, (lambda turn: print(json.dumps(turn, ensure_ascii=False))) if args.smoke
                    else interactive_feedback, notify, env=env)
    except (ValueError, OSError, EOFError) as error:
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
