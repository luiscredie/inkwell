"""Evaluate a conditional Strength of a Raging Fire response at a replay frame."""
from importlib import import_module

STRENGTH_CARD_ID = "2-201"
STRENGTH_COST = 3


def resource_routes(available_ink, eligible_singers):
    """Match the V1.1 strategic_adaptation.strength_playability resource contract."""
    pay = None if available_ink is None else available_ink >= STRENGTH_COST
    sing = None if eligible_singers is None else eligible_singers > 0
    can_use = True if True in (pay, sing) else False if pay is False and sing is False else None
    return {"can_pay": pay, "can_sing": sing, "can_use": can_use}


def routes_from_engine(ink, singers):
    module_name = f"{__package__}.strategic_adaptation" if __package__ else "strategic_adaptation"
    try:
        engine = import_module(module_name)
    except ModuleNotFoundError as error:
        if error.name != module_name:
            raise
        return resource_routes(ink, singers), "reference_contract"

    implementation = getattr(engine, "strength_playability", None)
    if not callable(implementation):
        raise ValueError("strategic_adaptation lacks strength_playability (expected V1.1)")
    result = implementation(available_ink=ink, eligible_singers=singers)
    expected = resource_routes(ink, singers)
    if not isinstance(result, dict) or any(
        key not in result or result[key] is not value for key, value in expected.items()
    ):
        raise ValueError("strategic_adaptation strength_playability contract mismatch")
    return expected, "strategic_adaptation"


def nonnegative_int(value):
    return type(value) is int and value >= 0


def visible_character(card):
    return card.get("type", "").lower() == "character" and not card.get("hidden") and not card.get("facedown")


def ready_ink(slots):
    states = [slot.get("exerted", (slot.get("card") or {}).get("exerted")) for slot in slots]
    if all(type(state) is bool for state in states):
        return states.count(False)
    return None


def strength_response(snapshot, context, draw_estimate):
    """Test legal payment and lethal damage, conditional on drawing Strength now."""
    own = snapshot["myPlayer"]
    characters = [card for card in own["field"] if visible_character(card)]
    target_id = context.get("target_instance_id")
    if not isinstance(target_id, str) or not target_id:
        raise ValueError("Strength context requires target_instance_id")
    target = next((card for card in snapshot["opponent"]["field"]
                   if card.get("instanceId") == target_id and visible_character(card)), None)
    if target is None:
        raise ValueError("Strength target is not a visible opposing character at this frame")

    for key in ("play_legal", "target_legal", "paying_ink_legal"):
        if context.get(key) is not None and type(context[key]) is not bool:
            raise ValueError(f"{key} must be true, false, or null")
    reduction = context.get("damage_reduction")
    if reduction is not None and not nonnegative_int(reduction):
        raise ValueError("damage_reduction must be a nonnegative integer or null")
    ink = ready_ink(own["inkwell"])
    # Base-cost route only. A true flag confirms the 3-ink route and that
    # the evaluator has checked cost-changing effects and payment constraints.
    payment = context.get("paying_ink_legal")
    usable_ink = ink if payment is True else 0 if payment is False else None
    singer_ids = context.get("eligible_singer_ids")
    if singer_ids is not None:
        if (not isinstance(singer_ids, list) or any(not isinstance(i, str) or not i for i in singer_ids)
                or len(set(singer_ids)) != len(singer_ids)):
            raise ValueError("eligible_singer_ids must be a list of distinct visible instance IDs or null")
        ready = {card.get("instanceId"): card for card in characters
                 if card.get("exerted") is False and card.get("justPlayed") is False}
        if not set(singer_ids) <= ready.keys():
            raise ValueError("every listed singer must be ready, dry and in play at this frame")
        overrides = context.get("effective_singer_costs", {})
        if not isinstance(overrides, dict) or set(overrides) - set(singer_ids):
            raise ValueError("effective_singer_costs must map listed singer IDs to effective costs")
        for singer_id in singer_ids:
            cost = overrides.get(singer_id, ready[singer_id].get("cost"))
            if not nonnegative_int(cost) or cost < STRENGTH_COST:
                raise ValueError("every listed singer must meet the song's effective cost")
    routes, engine = routes_from_engine(usable_ink, None if singer_ids is None else len(singer_ids))

    hidden_characters_possible = any(card.get("hidden") or card.get("facedown") for card in own["field"])
    raw_damage = None if hidden_characters_possible else len(characters)
    damage = None if reduction is None or raw_damage is None else max(0, raw_damage - reduction)
    # The reviewer supplies the effective willpower when modifiers make the
    # printed statistic unreliable. A missing value leaves the check conditional.
    willpower = context.get("target_effective_willpower")
    if willpower is not None and not nonnegative_int(willpower):
        raise ValueError("target_effective_willpower must be a nonnegative integer or null")
    already_damaged = target.get("damage")
    remaining = None if willpower is None or not nonnegative_int(already_damaged) else willpower - already_damaged
    if remaining is not None and remaining <= 0:
        raise ValueError("target has no remaining willpower at this frame")
    lethal = None if damage is None or remaining is None else damage >= remaining
    checks = (context.get("play_legal"), context.get("target_legal"), routes["can_use"], lethal)
    status = "blocked" if False in checks else "confirmed_at_frame" if all(checks) else "conditional"
    bounds = draw_estimate["draw_probability_bounds"]
    return {
        "engine": engine,
        "status_if_drawn_at_frame": status,
        "resources": {"ready_ink": ink, **routes},
        "damage": {"raw": raw_damage, "after_reduction": damage, "target_remaining_willpower": remaining,
                   "lethal": lethal},
        "candidate_draw_probability_bounds": bounds,
        "legal_lethal_candidate_draw_bounds_at_fixed_frame": (
            bounds if status == "confirmed_at_frame" else [0, 0] if status == "blocked" else [0, bounds[1]]
        ),
        "assumption": "current frame held fixed; legality evidence supplied by caller; measures draws",
    }
