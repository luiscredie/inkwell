"""Visible hand plus up to two distinct required prints, under uniform random draws."""
from math import comb
if __package__:
    from .strategic_v4_replay import draw_outs
else:
    from strategic_v4_replay import draw_outs


def draw_plan(snapshot, decklist, required, draws):
    if not 1 <= len(required) <= 2 or len(set(required)) != len(required):
        raise ValueError("expected one or two distinct prints")
    hand = snapshot["myPlayer"]["hand"]
    if any(c.get("hidden") or c.get("facedown") or not c.get("id") for c in hand):
        raise ValueError("own hand incompletely observed")
    estimates = [draw_outs(snapshot, decklist, [key], draws) for key in required]
    missing = [i for i, item in enumerate(estimates) if not item["candidate_copies_already_in_hand"]]
    if not missing:
        bounds = [1, 1]
    elif len(missing) == 1:
        bounds = estimates[missing[0]]["draw_probability_bounds"]
    else:
        combined = draw_outs(snapshot, decklist, required, draws)
        size = combined["deck_count"]
        lo, hi = combined["draw_out_copies"]
        a, b = [estimate["draw_out_copies"] for estimate in estimates]
        # Removing copies of either print can only decrease coverage. For each
        # feasible count of A it suffices to evaluate the two endpoints for B.
        total = comb(size, draws)
        counts = []
        for x in range(a[0], a[1] + 1):
            lower, upper = max(b[0], lo - x), min(b[1], hi - x)
            if lower <= upper:
                for y in (lower, upper):
                    counts.append(total - comb(size - x, draws) - comb(size - y, draws)
                                  + comb(size - x - y, draws))
        bounds = [min(counts) / total, max(counts) / total]
    return {"required_prints": list(required), "missing_from_hand": [required[i] for i in missing],
            "draws": draws, "hand_plus_draw_bounds": bounds,
            "assumption": "uniform draws without replacement, current hand retained",
            "execution": "unverified", "win_probability": None}
