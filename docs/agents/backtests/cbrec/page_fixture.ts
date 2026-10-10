// The browser test's "Stablecoin quotes with Euros" fixture (src/e2e/quotes_coinbase_fixture.json), written from
// `coinbasePageFixture` (supabase/functions/agents/testing.ts): the paper test's own driver (`runCbQuotes`) run on a small
// recorded world, then the dashboard's own view of it (`cbQuotesView`), so the page is checked against what the function
// would send. `cb_quotes.test.ts` builds it again and asserts the committed file.
//
//   cd docs/agents/backtests/cbrec && npx --yes deno@1.46.3 run --allow-read --allow-write --allow-env page_fixture.ts

import { coinbasePageFixture } from "../../../../supabase/functions/agents/testing.ts";

const out = await coinbasePageFixture();
await Deno.writeTextFile(new URL("../../../../src/e2e/quotes_coinbase_fixture.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log(JSON.stringify({ realisedGbp: out.quotesCoinbase?.realisedGbp, held: out.quotesCoinbase?.heldRungs, trips: out.quotesCoinbase?.detail.tripCount }));
