"""VIEWS exploration: which spelling of Gamma's keyless comments query answers for an event (printed).

usage: probe_comments.py <event id>
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vcommon as V  # noqa: E402


def main():
    eid = sys.argv[1]
    ev = V.load(os.path.join(V.DATA, "univ", "ev", eid + ".json"))
    print("commentCount", ev.get("commentCount"), "series", [s.get("id") for s in ev.get("series") or []])
    for params in ({"parent_entity_type": "Event", "parent_entity_id": eid, "limit": 5},
                   {"parent_entity_type": "event", "parent_entity_id": eid, "limit": 5},
                   {"parent_entity_type": "Series", "parent_entity_id": (ev.get("series") or [{}])[0].get("id"), "limit": 5},
                   {"parent_entity_type": "Event", "parent_entity_id": eid, "limit": 5, "get_positions": "true",
                    "holders_only": "false", "order": "createdAt", "ascending": "false"}):
        try:
            d = V.pmnet.get(V.GAMMA + "/comments", dict(params, _=V.bust()))
            print(params, "->", len(d) if isinstance(d, list) else type(d), json.dumps(d)[:300])
        except RuntimeError as err:
            print(params, "error", str(err)[:200])


if __name__ == "__main__":
    main()
