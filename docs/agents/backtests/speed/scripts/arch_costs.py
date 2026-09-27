"""SPEED step 3: what each architecture costs to run, from the project's own measurements (`results/infra.json`,
`results/poll_cpu.json`) and the documented prices and limits.

Four ways to act within a second or so of a source publishing, each run all month:
* today's loop — one pg_cron job a minute invoking an Edge Function;
* pg_cron's one-second schedule invoking an Edge Function each second;
* one Edge call a minute that polls every second inside it (a lease so two calls never overlap);
* a Cloudflare Durable Object kept in memory, polling every half second on an alarm, holding Polymarket's market
  socket, and calling the Irish Edge function to place an order.

usage: arch_costs.py <results dir> <out json>
"""
import json
import math
import os
import sys

MONTH_S = 30 * 86400


def main():
    res, outp = sys.argv[1], sys.argv[2]
    infra = json.load(open(os.path.join(res, "infra.json")))
    cpu = json.load(open(os.path.join(res, "poll_cpu.json")))
    edge = infra["edge"]
    inv = edge["invocations_24h_to_2026-09-27T01:00Z"]
    # a full day of today's cron: five jobs a minute, two every five minutes, the overnight recorder's ~10 hours
    cron_day = 5 * 1440 + 2 * 288 + 120
    base_month = (inv["total"] - inv["agents_by_cron"] - inv["snapshot-record"] - inv["overnight-record"] + cron_day) * 30
    included = edge["plan_quota"]["included_per_month"]
    per_row = infra["pg_cron"]["job_run_details"]["bytes_per_row_on_disk"]
    per_resp = infra["pg_net"]["stored_responses"]["bytes_per_response"]
    poll_cpu = cpu["cpu_ms_per_poll"]
    boot_cpu = edge["cpu_ms_per_call"]["dashboard"]["p50"]     # the lightest measured call: boot + one small read

    def edge_cost(calls_month):
        total = base_month + calls_month
        over = max(0, total - included)
        return {"added_invocations_a_month": calls_month, "total_a_month": total, "included": included,
                "over_quota": over, "usd_a_month": 2 * math.ceil(over / 1e6)}

    arch = {}
    arch["a job a minute (today's cadence)"] = {
        "reaction_after_publication_s": "uniform 0-60 + ~0.4 (median ~30)",
        "edge": edge_cost(43200),
        "job_run_details_rows_a_day": 1440, "job_run_details_bytes_a_day": 1440 * per_row,
        "http_response_rows_held_6h": 360,
        "cpu_ms_per_call": f"~{boot_cpu + poll_cpu:.0f} (the lightest measured calls: 16-29 ms p50)",
        "cpu_share_of_2s_limit": round((boot_cpu + poll_cpu) / 2000, 4), "wall_s_per_call": "~0.3",
    }
    arch["pg_cron every 1 s -> Edge"] = {
        "reaction_after_publication_s": "uniform 0-1 + dispatch (0.19 s p50, ~2 s one time in ten) + read 0.2 + order 0.03",
        "edge": edge_cost(MONTH_S),
        "job_run_details_rows_a_day": 86400, "job_run_details_bytes_a_day": 86400 * per_row,
        "job_run_details_note": "cron.log_run is on and nothing prunes the table: ~4 GB a month, against a whole database of "
                                f"{infra['pg_cron']['job_run_details']['whole_database_bytes'] / 1e6:.0f} MB today, unless a daily delete "
                                "(or log_run off, a superuser setting) keeps it at one day (~133 MB)",
        "http_response_rows_held_6h": 21600,
        "http_response_bytes_held": {"at_todays_mean_response": 21600 * per_resp, "at_a_1kB_response": 21600 * 1024},
        "postgres_log_lines_a_day": 86400, "connections_a_day": 86400,
        "note": "cron.use_background_workers is off: each run opens a connection to localhost, and cron.log_statement logs it",
        "cpu_ms_per_call": f"~{boot_cpu + poll_cpu:.0f}", "cpu_share_of_2s_limit": round((boot_cpu + poll_cpu) / 2000, 4),
        "wall_s_per_call": "~0.3 (each call must end inside its second or calls pile up; pg_cron runs at most 32 jobs at once, Supabase advises 8)",
    }
    polls = 55
    arch["one Edge call a minute, polling every 1 s inside it"] = {
        "reaction_after_publication_s": "uniform 0-1 + read 0.1 + order 0.03",
        "edge": edge_cost(43200),
        "job_run_details_rows_a_day": 1440, "job_run_details_bytes_a_day": 1440 * per_row,
        "cpu_ms_per_call": round(boot_cpu + polls * poll_cpu, 1), "cpu_share_of_2s_limit": round((boot_cpu + polls * poll_cpu) / 2000, 4),
        "wall_s_per_call": "~55-58, under the 150 s idle timeout and the 400 s worker limit (today's `books` call runs 43.6 s, `quotes` 28.2 s)",
        "note": "a half-second cadence doubles the reads (~200 ms CPU, 10 % of the limit) and gains a quarter second",
    }
    alarms = MONTH_S / 0.5 / 1.0     # one alarm a half second
    gbs = MONTH_S * 0.125
    req_over = max(0, alarms - 1e6)
    arch["Cloudflare Durable Object, polling every 0.5 s, socket to Polymarket"] = {
        "reaction_after_publication_s": "uniform 0-0.5 + read 0.1 + hop to the Irish Edge ~0.2 + order 0.03",
        "workers_paid_minimum_usd": 5.0,
        "duration_gb_s_a_month": gbs, "duration_included": 400000, "duration_usd": 0.0 if gbs <= 400000 else 12.5 * math.ceil((gbs - 400000) / 1e6),
        "alarm_requests_a_month": alarms, "requests_usd": 0.15 * math.ceil(req_over / 1e6),
        "usd_a_month": round(5.0 + 0.15 * math.ceil(req_over / 1e6), 2),
        "cpu_ms_per_poll": poll_cpu, "cpu_limit": "30 s a request by default (5 min max); an alarm a half second is its own request",
        "limits": "outbound WebSocket keeps the object alive at most 15 minutes a connection (reconnect inside that); six connections waiting for headers; 10,000 subrequests an invocation",
        "needs": ["a Workers Paid plan on the account (the read-only tools do not show its plan)", "a deployment, which is Davies' call",
                  "the order still placed by the Irish Edge function: a Durable Object's location is a best-effort region, its strongest guarantee the EU, never Ireland"],
    }
    out = {"baseline_invocations_a_month": base_month, "plan": "Supabase Pro: 2,000,000 Edge invocations a month, $2 a million over",
           "architectures": arch}
    with open(outp, "w") as f:
        json.dump(out, f, indent=1, sort_keys=True)
        f.write("\n")
    print(json.dumps(out, indent=1)[:5000])


if __name__ == "__main__":
    main()
