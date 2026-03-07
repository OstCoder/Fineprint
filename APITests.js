const COMPANY = "Meta Platforms";
const COURT_TOKEN = "f1ab345757ffa6dba3dad50f1618009d15764697";
const NEWS_KEY = "e6c49421ccef48f9b3439c9e9ff0b6c8";

async function testCourtListener() {
  console.log("\n⚖️  TEST 1: CourtListener\n");

  try {
    const url = `https://www.courtlistener.com/api/rest/v4/search/?q=${encodeURIComponent(COMPANY)}&type=d&order_by=score+desc&page_size=5`;

    const res = await fetch(url, {
      headers: {
        "Authorization": `Token ${COURT_TOKEN}`,
        "Accept": "application/json",
      },
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`❌ CourtListener returned status: ${res.status}`);
      console.error(`   Response: ${body.slice(0, 300)}`);
      return;
    }

    const data = await res.json();

    if (!data.results || data.results.length === 0) {
      console.log("⚠️  No results found.");
      return;
    }

    console.log(`✅ CourtListener WORKING — ${data.count} total results`);
    console.log(`\n--- Top ${data.results.length} Cases ---\n`);

    data.results.forEach((c, i) => {
      console.log(`${i + 1}. ${c.caseName || c.case_name || "Unknown"}`);
      console.log(`   Filed: ${c.dateFiled || c.date_filed || "N/A"} | Court: ${c.court || "N/A"}`);
      console.log(`   Docket #: ${c.docketNumber || c.docket_number || "N/A"}`);
      if (c.absolute_url) console.log(`   https://www.courtlistener.com${c.absolute_url}`);
      console.log();
    });

  } catch (err) {
    console.error("❌ CourtListener FAILED:", err.message);
  }
}
no
async function testNewsAPI() {
  console.log("\n📰 TEST 2: NewsAPI (current lawsuit news)\n");

  try {
    const query = `"${COMPANY}" AND (lawsuit OR settlement OR "class action" OR litigation OR "FTC" OR "DOJ")`;
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&sortBy=publishedAt&pageSize=10&language=en&apiKey=${NEWS_KEY}`;

    const res = await fetch(url);
    const data = await res.json();

    if (data.status !== "ok") {
      console.error("❌ NewsAPI error:", data.message);
      return;
    }

    const legalTerms = ["lawsuit", "settlement", "sued", "court", "trial", "ftc", "doj",
                        "litigation", "class action", "fine", "penalty", "ruling", "verdict", "charges"];

    const filtered = data.articles.filter(a => {
      const text = `${a.title} ${a.description || ""}`.toLowerCase();
      return legalTerms.some(term => text.includes(term));
    });

    console.log(`✅ NewsAPI WORKING — ${data.totalResults} raw results | ${filtered.length} legal articles`);
    console.log(`\n--- Top Legal Articles ---\n`);

    filtered.slice(0, 5).forEach((a, i) => {
      console.log(`${i + 1}. ${a.title}`);
      console.log(`   Source: ${a.source.name} | Published: ${a.publishedAt?.slice(0, 10)}`);
      console.log(`   ${(a.description || "").slice(0, 120)}...`);
      console.log(`   ${a.url}\n`);
    });

  } catch (err) {
    console.error("❌ NewsAPI FAILED:", err.message);
  }
}

// ─────────────────────────────────────────
// RUN BOTH
// ─────────────────────────────────────────
console.log(`\n🔍 Searching lawsuits for: "${COMPANY}"`);
(async () => {
  await testCourtListener();
  await testNewsAPI();
})();