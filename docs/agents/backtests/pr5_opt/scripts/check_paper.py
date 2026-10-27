# PR5-OPT: the replay's paper layer against PR5's own paper engine. The 2026-10-18 review's replay.py (stepMinute line for line,
# which reproduced 180 of 180 paper trips to 10-17) on this pull's minutes and prints, weekend dark as the paper engine runs, against
# PR5's own trips entered 2026-09-26 00:00 -> 2026-10-26 00:00 UTC and closed by 10-27 00:00, read with
#   select count(*) n, round(sum(pnl_usd)::numeric, 4) pnl_usd, count(*) filter (where how='taker') stops from agent_quote_trips
#   where t_entry >= '2026-09-26T00:00:00Z' and t_entry < '2026-10-26T00:00:00Z' and t_exit < '2026-10-27T00:00:00Z';
# which returned n 273, pnl_usd 18.8879, stops 4 (2026-10-27 03:4x UTC). Writes results/check_paper.json.
import os, sys, json, importlib.util, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sim
spec = importlib.util.spec_from_file_location('replay', os.path.join(sim.HERE, '..', 'scq_review', '2026-10-18', 'scripts', 'replay.py'))
RP = importlib.util.module_from_spec(spec); spec.loader.exec_module(RP)
ms = lambda *a: int(datetime.datetime(*a, tzinfo=datetime.timezone.utc).timestamp() * 1000)
mins, prints = sim.load_fwd()
trips, _ = RP.run(mins, prints, t_to=ms(2026, 10, 27))
sel = [t for t in trips if ms(2026, 9, 26) <= t['tEntry'] < ms(2026, 10, 26) and t['tExit'] < ms(2026, 10, 27) and t['how'] != 'open']
out = {'replay': {'n': len(sel), 'pnlUsd': round(sum(t['pnlUsd'] for t in sel), 4), 'stops': sum(t['how'] == 'taker' for t in sel)},
       'engine': {'n': 273, 'pnlUsd': 18.8879, 'stops': 4}}
papers = {}
sim.run(mins, prints, ms(2026, 9, 24), ms(2026, 10, 27), papers=papers, xhold=False)
mine = [z for b in papers for z in papers[b].closed if ms(2026, 9, 26) <= z[3] < ms(2026, 10, 26) and z[4] < ms(2026, 10, 27)]
ours = {(t['book'], t['side'], round(t['k'], 4), t['tEntry'], t['tExit']) for t in sel}
out['simPaperLayer'] = {'n': len(mine), 'stops': sum(z[5] == 'taker' for z in mine),
                        'sameTripsAsReplay': len(ours & {(z[0], z[1], round(z[2], 4), z[3], z[4]) for z in mine})}
print(out)
json.dump(out, open(os.path.join(sim.HERE, 'results', 'check_paper.json'), 'w'), indent=1)
