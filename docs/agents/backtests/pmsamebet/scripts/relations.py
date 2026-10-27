"""PMSAMEBET step 4: the relations between markets of DIFFERENT events, each as the covers that lock a payoff.

A cover is a set of legs (a market's YES or NO, bought at its ask) whose payoff is at least `floor` dollars a share in
every state the relation allows. Its edge is floor − Σ ask − taker fees; a positive edge is a locked profit IF the
relation holds, and the relation is only as good as the two resolution texts (each family's `hole` says where it can
fail). Families:

  DUP      the same question listed in two events (hand-checked pairs, the texts compared in the review §2)
  SEATMOV  a House/Senate seat's party-winner market against the same party's margin-of-victory brackets
           (first-round margin events excluded: a first round is not the winner)
  COMBO    a chamber/state market against the outcomes of a combination event that contain it (balance of power,
           oil × Senate, the Texas–Michigan–Maine combo, Fed paths)
  NOMWIN   2028: a candidate winning the presidency implies winning the party's nomination
  OSCAR    winning an Oscar implies being nominated in the same category
  FED      Fed path combos against the meeting markets; "another hike in 2026" against the count of hikes
  BYON     a "by <date>" market against the "not by <date>" outcome of the same thing's dated-bracket event
           (complements: both YES or both NO pays $1 a share when the texts agree)

Writes $PM_DATA/rel_events.json (the events used, trimmed) and $PM_DATA/relations.json.

usage: PM_DATA=<scratch> python3 -I docs/agents/backtests/pmsamebet/scripts/relations.py
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pmnet  # noqa: E402

HAND_SLUGS = {
    "which-party-will-win-the-senate-in-2026", "which-party-will-win-the-house-in-2026", "balance-of-power-2026-midterms",
    "who-wins-the-senate-pending-oil-above-or-below-80-before-the-midterms",
    "republicans-win-the-senate-pending-oil-above-or-below-80",
    "who-wins-the-senate-pending-oil-below-85-before-the-midterms",
    "who-wins-the-senate-pending-hormuz-agreement-and-oil-below-80",
    "senate-three-way-combo-texas-michigan-maine",
    "fed-decision-in-october-20260617190323537", "fed-decision-in-december-20260729232808632", "fed-decisions-sepdec",
    "how-many-fed-rate-hikes-in-2026-20260623190717369", "another-fed-rate-hike-in-2026",
    "will-microstrategy-announce-bankruptcy-before-2027", "which-companies-announce-bankruptcy-before-2027",
    "anthropic-acquired-before-2027", "openai-acquired-before-2027", "which-companies-will-be-acquired-before-2027",
    "trump-meets-with-mark-carney-byptptpt", "who-will-trump-meet-with-by-october-31",
    "will-elon-musk-announce-presidential-run-before-2027", "who-will-announce-presidential-run-before-2027",
    "anthropic-ipo-closing-market-cap-119", "anthropic-ipo-closing-market-cap-979",
    "anthropic-ipo-closing-market-cap-higher-strikes",
    "premier-league-teams-relegated-2026-27", "will-manchester-city-be-relegated-from-the-premier-league-in-2026-27",
    "anthropic-ipo-by", "anthropic-ipo-date", "next-fable-model-5pt2-released-byptptpt",
    "next-fable-model-5pt2-released-onptptpt-20261002",
}
FAM_RE = re.compile(r"(house-election-winner|senate-election-winner|margin-of-victory|oscars-2027-|"
                    r"presidential-nominee-2028|presidential-election-winner-2028)")


def tokens_of(m):
    t = m.get("clobTokenIds")
    t = json.loads(t) if isinstance(t, str) else (t or [])
    o = m.get("outcomes")
    o = json.loads(o) if isinstance(o, str) else (o or [])
    if len(t) != 2 or [x.lower() for x in o] != ["yes", "no"]:
        return None
    return {"yes": t[0], "no": t[1]}


def live(m):
    return m.get("active") and not m.get("closed") and m.get("acceptingOrders") and tokens_of(m)


def leg(m, side):
    fs = m.get("feeSchedule") or {}
    return {"cid": m["conditionId"], "token": tokens_of(m)[side], "side": side.upper(), "q": m["question"],
            "eslug": m["eslug"], "fee_rate": float(fs.get("rate") or 0) if m.get("feesEnabled") else 0.0,
            "fee_exp": float(fs.get("exponent") or 1)}


def find(E, slug, pat):
    e = E.get(slug)
    if not e:
        return []
    rx = re.compile(pat, re.I)
    return [m for m in e["markets"] if live(m) and rx.search(m["question"])]


def one(E, slug, pat):
    ms = find(E, slug, pat)
    if len(ms) != 1:
        raise SystemExit(f"expected one market in {slug} for {pat!r}, got {[m['question'] for m in ms]}")
    return ms[0]


def ident(rid, fam, T, S, Sc, note, hole):
    """T (one market) has the same outcome as the union of S (exclusive outcomes of one event); Sc the rest of it."""
    covers = [{"name": "T.NO+S.YES", "floor": 1, "legs": [leg(T, "no")] + [leg(m, "yes") for m in S]}]
    if Sc:
        covers.append({"name": "T.YES+Sc.YES", "floor": 1, "legs": [leg(T, "yes")] + [leg(m, "yes") for m in Sc]})
    return {"id": rid, "family": fam, "kind": "identity", "note": note, "hole": hole, "end": T["endDate"],
            "covers": covers}


def impl(rid, fam, A, B, note, hole):
    """A implies the union of B (exclusive outcomes): buying A's NO and every B's YES pays at least $1."""
    return {"id": rid, "family": fam, "kind": "implication", "note": note, "hole": hole, "end": A["endDate"],
            "covers": [{"name": "A.NO+B.YES", "floor": 1, "legs": [leg(A, "no")] + [leg(m, "yes") for m in B]}]}


def name_key(s):
    s = s.lower().replace("’", "'")
    s = re.sub(r"[^a-z ]", "", s.replace(".", ""))
    return re.sub(r"\s+", " ", s).strip()


def main():
    E = {}
    for e in pmnet.iter_array(os.path.join(pmnet.DATA, "open_events.json")):
        if e["slug"] in HAND_SLUGS or FAM_RE.search(e["slug"] or ""):
            for m in e["markets"]:
                m["eslug"] = e["slug"]
            E[e["slug"]] = e
    pmnet.dump(os.path.join(pmnet.DATA, "rel_events.json"), E)
    R = []

    # ---- DUP: the same question in two events (texts compared by hand, review §2)
    dups = [
        ("DUP-MSTR", ("will-microstrategy-announce-bankruptcy-before-2027", "MicroStrategy"),
         ("which-companies-announce-bankruptcy-before-2027", "MicroStrategy"), "texts equal but for wording"),
        ("DUP-ANTH-ACQ", ("anthropic-acquired-before-2027", "Anthropic"),
         ("which-companies-will-be-acquired-before-2027", "Anthropic"), "texts to compare"),
        ("DUP-OPENAI-ACQ", ("openai-acquired-before-2027", "OpenAI"),
         ("which-companies-will-be-acquired-before-2027", "OpenAI"), "standalone counts the controlling nonprofit too"),
        ("DUP-CARNEY", ("trump-meets-with-mark-carney-byptptpt", "October 31"),
         ("who-will-trump-meet-with-by-october-31", "Carney"), "standalone defines a meeting more narrowly"),
        ("DUP-MUSK", ("will-elon-musk-announce-presidential-run-before-2027", "Musk"),
         ("who-will-announce-presidential-run-before-2027", "Musk"), "standalone window starts 2025-11-05"),
        ("DUP-ANTH-NOIPO-a", ("anthropic-ipo-closing-market-cap-119", "not IPO"),
         ("anthropic-ipo-closing-market-cap-higher-strikes", "not IPO"), "identical texts"),
        ("DUP-ANTH-NOIPO-b", ("anthropic-ipo-closing-market-cap-979", "not IPO"),
         ("anthropic-ipo-closing-market-cap-higher-strikes", "not IPO"), "identical texts"),
        ("DUP-ANTH-NOIPO-c", ("anthropic-ipo-closing-market-cap-119", "not IPO"),
         ("anthropic-ipo-closing-market-cap-979", "not IPO"), "identical texts"),
        ("DUP-OIL80R-hi", ("republicans-win-the-senate-pending-oil-above-or-below-80", "at least \\$80"),
         ("who-wins-the-senate-pending-oil-above-or-below-80-before-the-midterms", "at least \\$80 .*Republicans"),
         "standalone resolves 50-50 if Nov 2 is not a trading day; the event uses the prior day"),
        ("DUP-OIL80R-lo", ("republicans-win-the-senate-pending-oil-above-or-below-80", "below \\$80"),
         ("who-wins-the-senate-pending-oil-above-or-below-80-before-the-midterms", "below \\$80 .*Republicans"),
         "as above"),
        ("DUP-MANCITY", ("premier-league-teams-relegated-2026-27", "Manchester City"),
         ("will-manchester-city-be-relegated-from-the-premier-league-in-2026-27", "Manchester City"),
         "NOT equivalent: the standalone also pays on expulsion over the 115 charges, appeal or not"),
    ]
    for rid, (sa, pa), (sb, pb), hole in dups:
        try:
            a, b = one(E, sa, pa), one(E, sb, pb)
        except SystemExit as ex:
            print("skip", rid, ex)
            continue
        r = ident(rid, "DUP", a, [b], [], f"{a['question']} [{sa}] = [{sb}]", hole)
        r["covers"].append({"name": "S.NO+T.YES", "floor": 1, "legs": [leg(b, "no"), leg(a, "yes")]})
        R.append(r)

    # ---- COMBO: chamber control against balance of power and the conditional combos
    sen, hou, bop = "which-party-will-win-the-senate-in-2026", "which-party-will-win-the-house-in-2026", "balance-of-power-2026-midterms"
    bop_all = [m for m in E[bop]["markets"] if live(m)]
    for party, P in (("R", "Republican"), ("D", "Democratic")):
        T = one(E, sen, P + " Party control the Senate")
        S = [m for m in bop_all if re.search(f": {party} Senate", m["question"])]
        R.append(ident(f"COMBO-SEN{party}-BOP", "COMBO", T, S, [m for m in bop_all if m not in S],
                       f"Senate {party} = BoP {party} Senate × either House", "BoP 'Other' outcome; same control rule text"))
        T = one(E, hou, P + " Party control the House")
        S = [m for m in bop_all if re.search(f", {party} House", m["question"])]
        R.append(ident(f"COMBO-HOU{party}-BOP", "COMBO", T, S, [m for m in bop_all if m not in S],
                       f"House {party} = BoP either Senate × {party} House", "BoP 'Other' outcome"))
    for slug, tag in (("who-wins-the-senate-pending-oil-above-or-below-80-before-the-midterms", "OIL80"),
                      ("who-wins-the-senate-pending-oil-below-85-before-the-midterms", "OIL85"),
                      ("who-wins-the-senate-pending-hormuz-agreement-and-oil-below-80", "HORMUZ80")):
        allm = [m for m in E[slug]["markets"] if live(m)]
        for party, P, word in (("R", "Republican", "Republicans"), ("D", "Democratic", "Democrats")):
            T = one(E, sen, P + " Party control the Senate")
            S = [m for m in allm if word in m["question"]]
            R.append(ident(f"COMBO-SEN{party}-{tag}", "COMBO", T, S, [m for m in allm if m not in S],
                           f"Senate {party} = Σ {tag} combos with {party} Senate",
                           "oil leg from Pyth CLL close; HORMUZ80's rules are a PDF link, not read" if tag == "HORMUZ80"
                           else "oil leg from Pyth CLL close (both sides of the oil split are listed)"))
    combo = "senate-three-way-combo-texas-michigan-maine"
    cm = [m for m in E[combo]["markets"] if live(m)]

    def combo_party(q, state):
        q = q.replace("Will ", "")
        # "Republicans win the Texas and Michigan Senate seats, and Democrats win Maine?"
        # a part that names no party ("Maine Senate seats" in "Texas, Michigan, and Maine") inherits the one before it
        parts = re.split(r",\s*and\s+", q.rstrip("?"))
        who = None
        for p in parts:
            p = p.strip()
            if p.startswith("Republicans"):
                who = "R"
            elif p.startswith("Democrats"):
                who = "D"
            if state in p:
                return who
        return None
    for state in ("Texas", "Michigan", "Maine"):
        for party, word in (("R", "Republicans"), ("D", "Democrats")):
            T = one(E, f"{state.lower()}-senate-election-winner", f"{word} win the {state}")
            S = [m for m in cm if combo_party(m["question"], state) == party]
            R.append(ident(f"COMBO-{state[:2].upper()}{party}-3WAY", "COMBO", T, S, [m for m in cm if m not in S],
                           f"{state} {party} = Σ 3-way combos with {state} {party}",
                           "combo resolves 'Other' (not listed, inactive) if a race is uncalled by 2027-03-31 or an independent wins"))

    # ---- FED: path combos and counts against the meeting markets
    octo, dec, path = "fed-decision-in-october-20260617190323537", "fed-decision-in-december-20260729232808632", "fed-decisions-sepdec"
    o_nc, o_up = one(E, octo, "no change"), find(E, octo, "increase interest")
    d_nc, d_up = one(E, dec, "no change"), find(E, dec, "increase interest")
    hph, hpp = one(E, path, "Hike–Pause–Hike"), one(E, path, "Hike–Pause–Pause")
    hhh, hhp = one(E, path, "Hike–Hike–Hike"), one(E, path, "Hike–Hike–Pause")
    fh = "intermeeting moves are ignored by the path combos and counted by neither meeting market"
    R.append(impl("FED-HPH-OCTNC", "FED", hph, [o_nc], "HPH implies October no change", fh))
    R.append(impl("FED-HPP-OCTNC", "FED", hpp, [o_nc], "HPP implies October no change", fh))
    R.append(impl("FED-HPH-DECUP", "FED", hph, d_up, "HPH implies a December hike (25 or 50+)", fh))
    R.append(impl("FED-HPP-DECNC", "FED", hpp, [d_nc], "HPP implies December no change", fh))
    R.append(impl("FED-HHH-OCTUP", "FED", hhh, o_up, "HHH implies an October hike", fh))
    R.append(impl("FED-HHP-OCTUP", "FED", hhp, o_up, "HHP implies an October hike", fh))
    R.append(impl("FED-HHH-DECUP", "FED", hhh, d_up, "HHH implies a December hike", fh))
    R.append(impl("FED-HHP-DECNC", "FED", hhp, [d_nc], "HHP implies December no change", fh))
    R.append({"id": "FED-HPx-OCTNC-sum", "family": "FED", "kind": "sum-implication", "end": o_nc["endDate"],
              "note": "HPH + HPP <= October no change", "hole": fh,
              "covers": [{"name": "B.YES+A.NO", "floor": 2, "legs": [leg(o_nc, "yes"), leg(hph, "no"), leg(hpp, "no")]}]})
    hikes = "how-many-fed-rate-hikes-in-2026-20260623190717369"
    another = one(E, "another-fed-rate-hike-in-2026", "Another")
    S = [m for m in find(E, hikes, "") if re.search(r"Will (2|3|4|5 or more) Fed rate hikes", m["question"])]
    Sc = [m for m in find(E, hikes, "") if m not in S]
    R.append(ident("FED-ANOTHER-COUNT", "FED", another, S, Sc, "another hike in 2026 = 2+ hikes in 2026 (one so far)",
                   "count event and standalone may treat intermeeting hikes alike; 'one so far' read from prices, not checked at source"))
    for m in d_up:
        R.append(impl(f"FED-DEC{('50' if '50' in m['question'] else '25')}-ANOTHER", "FED", m, [another],
                      "a December hike implies another hike in 2026", "none beyond the texts"))
    for m in o_up:
        R.append(impl(f"FED-OCT{('50' if '50' in m['question'] else '25')}-ANOTHER", "FED", m, [another],
                      "an October hike implies another hike in 2026", "none beyond the texts"))

    # ---- BYON: "by <date>" against the dated event's "not by <date>" (complements when the texts agree)
    byon = [
        ("BYON-ANTH-NOV30", ("anthropic-ipo-by", "by November 30"), ("anthropic-ipo-date", "not IPO by November 30"),
         "'by' counts listing and trading; 'date' counts the IPO launch (the first public sale): an IPO priced on "
         "Nov 30 that trades Dec 1 makes both NO, which breaks T.YES+U.YES and pays T.NO+U.NO twice"),
        ("BYON-FABLE-OCT31", ("next-fable-model-5pt2-released-byptptpt", "by October 31"),
         ("next-fable-model-5pt2-released-onptptpt-20261002", "no next Fable"), "same release definition in both texts"),
    ]
    for rid, (sa, pa), (sb, pb), hole in byon:
        try:
            T, U = one(E, sa, pa), one(E, sb, pb)
        except SystemExit as ex:
            print("skip", rid, ex)
            continue
        R.append({"id": rid, "family": "BYON", "kind": "complement", "note": f"{T['question']} = not {U['question']}",
                  "hole": hole, "end": T["endDate"],
                  "covers": [{"name": "T.YES+U.YES", "floor": 1, "legs": [leg(T, "yes"), leg(U, "yes")]},
                             {"name": "T.NO+U.NO", "floor": 1, "legs": [leg(T, "no"), leg(U, "no")]}]})

    # ---- SEATMOV: seat winner (party) against the same party's margin brackets
    n_seat, skipped_hidden = 0, []
    for slug, e in E.items():
        mm = re.match(r"^(.*)-(house|senate)-election-winner$", slug)
        if not mm:
            continue
        key, ch = mm.group(1), mm.group(2)
        movs = [s for s in E if s.startswith(f"{key}-{ch}-") and "margin" in s and "first-round" not in s]
        if len(movs) != 1:
            continue
        mov = movs[0]
        mov_live = [m for m in E[mov]["markets"] if live(m)]
        # an open bracket that takes no orders could still resolve YES: such a seat is left out, not priced
        hidden = [m for s_ in (slug, mov) for m in E[s_]["markets"]
                  if m.get("active") and not m.get("closed") and not live(m)
                  and not re.search(r"Person [A-Z]|not listed", m["question"])]
        if hidden:
            skipped_hidden.append(slug)
            continue
        for party, word in (("R", "Republican"), ("D", "Democrat")):
            T = [m for m in e["markets"] if live(m) and re.search(word, m["question"])]
            S = [m for m in mov_live if re.search(word + r"(ic)? Party candidate", m["question"])]
            if len(T) != 1 or not S:
                continue
            Sc = [m for m in mov_live if m not in S]
            R.append(ident(f"SEATMOV-{key.upper()}-{ch[:3].upper()}-{party}", "SEATMOV", T[0], S, Sc,
                           f"{slug} {party} = Σ {mov} {party} brackets",
                           "winner market follows caucus/certification; margin market the top two's vote share; "
                           "a third-party winner breaks T.YES+Sc.YES"))
            n_seat += 1

    # ---- NOMWIN: president 2028 implies nominee 2028
    win = {name_key(re.sub(r"^Will (.*) win the 2028 US Presidential Election\?$", r"\1", m["question"])): m
           for m in find(E, "presidential-election-winner-2028", r"^Will .* win the 2028 US Presidential Election\?$")}
    for party, slug in (("R", "republican-presidential-nominee-2028"), ("D", "democratic-presidential-nominee-2028")):
        for m in find(E, slug, r"^Will .* win the 2028 .* presidential nomination\?$"):
            k = name_key(re.sub(r"^Will (.*) win the 2028 .*$", r"\1", m["question"]))
            k2 = k.replace("jd vance", "jd vance")
            if k2 in win:
                R.append(impl(f"NOMWIN-{party}-{k2.replace(' ', '_')}", "NOMWIN", win[k2], [m],
                              f"{win[k2]['question']} implies {m['question']}",
                              "a candidate could win without that nomination (independent, other party, replacement)"))

    # ---- OSCAR: win implies nominated, per category
    for slug in list(E):
        mm = re.match(r"^oscars-2027-(.*)-winner-\d+$", slug)
        if not mm:
            continue
        cat = mm.group(1)
        noms = [s for s in E if s.startswith(f"oscars-2027-{cat}-nominations")]
        if len(noms) != 1:
            continue
        nom = {}
        for m in find(E, noms[0], r"nominated"):
            k = re.sub(r"^Will (.*) be nominated for .*$", r"\1", m["question"]).strip('"“” ')
            nom[name_key(k)] = m
        for m in find(E, slug, r" win "):
            k = name_key(re.sub(r"^Will (.*) win .*$", r"\1", m["question"]).strip('"“” '))
            if k in nom:
                R.append(impl(f"OSCAR-{cat}-{k.replace(' ', '_')[:40]}", "OSCAR", m, [nom[k]],
                              f"{m['question']} implies {nom[k]['question']}",
                              "a win without the listed nomination wording (name variants, category moves)"))

    pmnet.dump(os.path.join(pmnet.DATA, "relations.json"), R)
    print("seats left out for a bracket that takes no orders:", len(skipped_hidden))
    from collections import Counter
    print("events", len(E), "relations", len(R), Counter(r["family"] for r in R))


if __name__ == "__main__":
    main()
