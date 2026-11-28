"""Human-in-the-loop Sparring review contract; never a game rules engine.

Inputs must originate from a verified simulator/replay, or be explicitly marked
unknown. Reviews are advisory annotations, never reinforcement rewards.
"""
from copy import deepcopy

RATINGS = {"game_changing", "ok", "bad", "inconclusive"}
EVIDENCE = {"engine", "replay", "human_hypothesis"}


def _boolean_or_none(value, label):
    if value is not None and type(value) is not bool:
        raise ValueError(f"{label} must be true, false or null")
    return value


def _required_text(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be nonempty text")
    return value.strip()


def _evidence_actions(actions, label):
    if not isinstance(actions, list):
        raise ValueError(f"{label} must be a list")
    result = []
    for action in actions:
        if not isinstance(action, dict) or action.get("source") not in EVIDENCE:
            raise ValueError(f"each {label} must declare engine, replay or human_hypothesis evidence")
        if not isinstance(action.get("type"), str) or not action["type"]:
            raise ValueError(f"each {label} must identify its action type")
        item = deepcopy(action)
        item["simulated"] = False  # no rollouts are performed by this module
        item["legal_confirmed"] = action["source"] == "engine"
        result.append(item)
    return result


def evaluate_emergency(context):
    """Recognize the specific 19-lore defensive exception only with hard evidence."""
    if not isinstance(context, dict):
        raise ValueError("context must be an object")
    lore = context.get("human_lore")
    if lore is not None and (type(lore) is not int or not 0 <= lore <= 20):
        raise ValueError("human_lore must be 0..20 or null")
    facts = ("immediate_lethal_threat", "selected_line_prevents_lethal", "only_legal_defense")
    for key in facts:
        _boolean_or_none(context.get(key), key)
    certified = context.get("defense_evidence") == "engine"
    if lore == 19 and all(context.get(key) is True for key in facts) and certified:
        status = "confirmed_emergency_exception"
    elif lore == 19 and all(context.get(key) is True for key in facts):
        status = "declared_emergency_needs_engine_validation"
    elif lore == 19 and any(context.get(key) is False for key in facts):
        status = "specific_exception_not_supported"
    else:
        status = "unverified"
    missing = [key for key in facts if context.get(key) is None]
    if lore is None:
        missing.insert(0, "human_lore")
    if lore == 19 and not certified:
        missing.append("engine_verified_defensive_legality")
    return {"status": status, "missing_evidence": missing,
            "note": "19 lore alone never proves lethal; other lethal thresholds remain possible"}


def evaluate_setup(context):
    """Treat Malicious + Circle + Phillip as a candidate, not an assumed best line."""
    facts = ("phillip_in_discard", "malicious_in_hand", "sequence_legal_now")
    for key in facts:
        _boolean_or_none(context.get(key), key)
    if any(context.get(key) is False for key in facts):
        status = "not_available_now"
    elif all(context.get(key) is True for key in facts) and context.get("sequence_evidence") == "engine":
        status = "legal_candidate_not_simulated"
    else:
        status = "setup_hypothesis_unverified"
    return {"status": status,
            "missing_evidence": [key for key in facts if context.get(key) is None],
            "note": "Future draws, resource timing and better strategic value are not inferred"}


def prepare_sparring_review(turn, feedback):
    """Reveal the bot decision only after the human turn is locked.

    The caller supplies verified bot-hand information. No guessed cards,
    legal move enumeration, win probability, or model training occurs here.
    """
    if not isinstance(turn, dict) or not isinstance(feedback, dict):
        raise ValueError("turn and feedback must be objects")
    if turn.get("human_turn_locked") is not True:
        raise ValueError("cannot reveal bot hand before human turn is locked")
    game_id = _required_text(turn.get("game_id"), "game_id")
    decision_id = _required_text(turn.get("decision_id"), "decision_id")
    grade = feedback.get("rating")
    if grade not in RATINGS:
        raise ValueError("invalid feedback rating")
    rationale = _required_text(feedback.get("reason"), "feedback reason")
    hand = turn.get("bot_hand")
    if hand is not None:
        if not isinstance(hand, dict) or hand.get("source") not in ("engine", "replay"):
            raise ValueError("bot hand must have engine/replay source or be unknown")
        if not isinstance(hand.get("cards"), list) or not all(isinstance(c, str) and c for c in hand["cards"]):
            raise ValueError("verified bot hand must be a list of card IDs")
    context = turn.get("context") or {}
    if not isinstance(context, dict):
        raise ValueError("context must be an object")
    decision = _evidence_actions(turn.get("bot_actions", []), "bot_actions")
    alternatives = _evidence_actions(turn.get("alternative_actions", []), "alternative_actions")
    gaps = []
    if hand is None:
        gaps.append("bot_hand_not_verified")
    if not alternatives:
        gaps.append("legal_alternatives_not_enumerated")
    elif any(not a["legal_confirmed"] for a in alternatives):
        gaps.append("some_alternatives_not_legally_verified")
    if context.get("human_lore") is None:
        gaps.append("human_lore_unknown")
    if context.get("bot_lore") is None:
        gaps.append("bot_lore_unknown")
    emergency = evaluate_emergency(context)
    setup = evaluate_setup(context)
    return {
        "schema": "inkwell-sparring-feedback-v1",
        "game_id": game_id, "decision_id": decision_id,
        "phase": "post_human_turn", "bot_hand": deepcopy(hand),
        "bot_actions": decision, "alternative_actions": alternatives,
        "context": deepcopy(context),
        "feedback": {"human_rating": grade, "reason": rationale,
                     "preferred_line": feedback.get("preferred_line"),
                     "status": "provisional_human_label", "training_applied": False},
        "checks": {"emergency": emergency, "setup_combo": setup},
        "missing_evidence": gaps,
        "strategic_ranking": "inconclusive", "win_probability": None,
        "simulated_alternatives": 0,
    }
