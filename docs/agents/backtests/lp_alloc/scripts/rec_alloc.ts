// LP-ALLOC: the full-universe record (scripts/build.ts) as LPSELF's loader reads it (`loadPR`, unchanged), plus each
// kept market's reward programme through time (`progs`, written beside it by scripts/split_progs.py, gzip'd as data/progs.json.gz).
import { gunzipSync } from "node:zlib";
import { loadPR, type Meta, type Rec } from "../../lpself/scripts/rec.ts";

export type Prog = [number, number | null, number, number];   // [minute index, rate | null (ended), v, minSize]
export type AllocRec = Rec & { slots: Map<number, Meta[]>; progs: Map<string, Prog[]> };

export function loadAlloc(recFile: string, progsFile: string): AllocRec {
  const r = loadPR(recFile) as AllocRec;
  const txt = progsFile.endsWith(".gz") ? new TextDecoder().decode(gunzipSync(Deno.readFileSync(progsFile))) : Deno.readTextFileSync(progsFile);
  const o = JSON.parse(txt) as { conds: string[]; progs: Prog[][] };
  r.progs = new Map(o.conds.map((c, i) => [c, o.progs[i]]));
  return r;
}
