const GROQ_KEY    = window.FINEPRINT_CONFIG.GROQ_KEY;
const COURT_TOKEN = window.FINEPRINT_CONFIG.COURT_TOKEN;
const NEWS_KEY    = window.FINEPRINT_CONFIG.NEWS_KEY;
const GROQ_MODEL  = window.FINEPRINT_CONFIG.GROQ_MODEL;

const GROQ_SYSTEM = `You are a legal analysis tool that helps everyday people understand what they actually agreed to in Terms & Conditions and Privacy Policies.

Your job is to surface TWO types of things:
1. Hidden surprises — things the company does that users would NEVER expect and that have no obvious connection to the service. Examples: TikTok collecting your voice biometrics, Spotify sharing your data with record labels, apps selling your GPS location to hedge funds, apps accessing your clipboard, camera, or contacts silently.
2. Legal traps — clauses that directly harm users: forced arbitration, class action waivers, auto-renewal, data selling, unilateral term changes, government data sharing, broad liability waivers, content ownership grabs.

Return ONLY valid JSON with no explanation, no markdown, no backticks.

Format:
{
  "company": "company name if found",
  "nodes": [
    { "id": "unique_id", "label": "Entity Name", "type": "company|data_broker|ad_network|jurisdiction|clause" }
  ],
  "edges": [
    { "source": "id1", "target": "id2", "label": "relationship description" }
  ],
  "need_to_knows": [
    {
      "title": "Short punchy headline (e.g. 'They can record your voice anytime')",
      "what": "One sentence explaining exactly what the clause says in plain English. Be specific about the data or action.",
      "impact": "One sentence explaining the real-world consequence for the user. Make it personal and concrete.",
      "severity": "high|medium|low"
    }
  ]
}

Node types:
- company: the main company
- data_broker: third party that buys/receives data
- ad_network: advertising partners
- jurisdiction: legal jurisdiction or governing law
- clause: important legal clause

CRITICAL RULES for need_to_knows:
- Sort by severity: high first, then medium, then low. The most alarming thing must be #1.
- Include BOTH hidden surprises AND legal traps.
- Be specific. BAD: "They collect your data." GOOD: "They collect your precise GPS location every 15 minutes, even when the app is closed."
- severity=high: directly harms user financially, legally, or serious privacy violation
- severity=medium: unfair or surprising but not immediately dangerous
- severity=low: worth knowing but limited direct impact
- Aim for 5-10 need_to_knows. More is better.
- Write as if texting a friend who is about to sign up for this service.`;

// ── Color for each node type in the graph ──────────────────
const NODE_COLORS = {
  company:      "#9B6B50",
  data_broker:  "#C96B6B",
  ad_network:   "#D4944A",
  jurisdiction: "#7AAECC",
  clause:       "#A898D8",
  user:         "#6BAA75",
};

// ── Global state ────────────────────────────────────────────
let currentParsed = null;
let simulation    = null;

// ============================================================
//  STARTUP — Check login status
// ============================================================
(async () => {
  if (!supabaseClient) {
    setStatus("Missing Supabase config. Set window.FINEPRINT_CONFIG in config.js", "error");
    setAnalyzeDisabled(true);
    return;
  }

  const { data: { session } } = await supabaseClient.auth.getSession();

  if (!session) {
    window.location.href = "login.html";
    return;
  }

  document.getElementById('user-email').textContent = session.user.email;
  loadSavedTrees();
})();

// 1. Handle quick-analyze text passed from dashboard
const quickText = sessionStorage.getItem('fineprint_quick_text');
if (quickText) {
  sessionStorage.removeItem('fineprint_quick_text');
  document.getElementById('paste-area').value = quickText;
  analyze();
}

// 2. Handle open-saved-analysis passed from dashboard
const openId = sessionStorage.getItem('fineprint_open_id');
if (openId) {
  sessionStorage.removeItem('fineprint_open_id');
  window._autoOpenId = openId;
}

if (window._autoOpenId && typeof tree !== 'undefined' && tree.id === window._autoOpenId) {
  window._autoOpenId = null;
  item.click();
}

// ============================================================
//  SIGN OUT
// ============================================================
document.getElementById('logout-btn').addEventListener('click', async () => {
  await supabaseClient.auth.signOut();
  window.location.href = "login.html";
});

// ============================================================
//  FILE UPLOAD
// ============================================================
const dropZone  = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const pasteArea = document.getElementById('paste-area');

dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));

dropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) await handleFile(file);
});

fileInput.addEventListener('change', async () => {
  if (fileInput.files[0]) await handleFile(fileInput.files[0]);
});

async function handleFile(file) {
  setStatus(`Reading ${file.name}...`);
  try {
    let text = '';
    if (file.type === 'application/pdf') {
      text = await readPdf(file);
    } else {
      text = await readTxt(file);
    }
    pasteArea.value = text.slice(0, 8000);
    setStatus(`✓ Loaded ${file.name}`, "success");
    dropZone.querySelector('p').innerHTML = `<strong>${file.name}</strong> ready to analyze`;
  } catch (err) {
    setStatus('Failed to read file.', 'error');
  }
}

function readTxt(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

async function readPdf(file) {
  const arrayBuffer = await file.arrayBuffer();
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(item => item.str).join(' ') + '\n';
  }
  return text;
}

// ============================================================
//  ANALYZE
// ============================================================
document.getElementById('analyze-btn').addEventListener('click', analyze);

async function analyze() {
  const text = pasteArea.value.trim();
  if (!text) {
    setStatus('Please upload a file or paste text first.', 'error');
    return;
  }

  setStatus('<span class="spinner"></span> Analyzing...', '');
  setAnalyzeDisabled(true);
  clearGraph();
  clearLawsuits();

  try {
    const parsed = await callGroq(text);

    parsed.nodes        = Array.isArray(parsed.nodes)        ? parsed.nodes        : [];
    parsed.edges        = Array.isArray(parsed.edges)        ? parsed.edges        : [];
    parsed.need_to_knows = Array.isArray(parsed.need_to_knows) ? parsed.need_to_knows : (Array.isArray(parsed.red_flags) ? parsed.red_flags : []);
    currentParsed       = parsed;

    renderGraph(parsed);
    renderNeedToKnows(parsed.need_to_knows);

    document.getElementById('save-btn').style.display = 'block';
    setStatus(`✓ Found ${parsed.nodes.length} entities · ${parsed.need_to_knows.length} need-to-knows`, 'success');

    if (parsed.company) {
      fetchLawsuits(parsed.company);
    }

  } catch (err) {
    setStatus('Analysis failed: ' + err.message, 'error');
    console.error(err);
  } finally {
    setAnalyzeDisabled(false);
  }
}

async function callGroq(text) {
  if (!GROQ_KEY) throw new Error("Missing GROQ_KEY in config.js");

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${GROQ_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: GROQ_SYSTEM },
        { role: "user",   content: `Extract all relationships from this T&C text:\n\n${text}` }
      ],
      temperature: 0.1,
      max_tokens: 2000
    })
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const errBody = await res.json();
      detail = errBody?.error?.message || JSON.stringify(errBody);
    } catch (_) { /* ignore */ }
    throw new Error(`Groq API error: ${detail}`);
  }

  const data    = await res.json();
  const rawText = data.choices[0].message.content;

  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("AI response didn't contain valid JSON");
  return JSON.parse(jsonMatch[0]);
}

// ============================================================
//  GRAPH
// ============================================================
function renderGraph(parsed) {
  const { need_to_knows = [], red_flags = [] } = parsed;
  const flags = need_to_knows.length ? need_to_knows : red_flags;

  // Strip stale positions from saved nodes so the simulation starts fresh
  const nodes = parsed.nodes.map(n => ({ ...n, x: undefined, y: undefined, vx: 0, vy: 0, fx: null, fy: null }));

  // Inject a "You" node connected to the main company node
  const companyNode = nodes.find(n => n.type === 'company');
  const youNode = { id: '__you__', label: 'You', type: 'user', x: undefined, y: undefined, vx: 0, vy: 0, fx: null, fy: null };
  nodes.push(youNode);

  // Build edges: You → company (agreed to terms), You → any clause flagged high severity
  const edges = [...parsed.edges];
  if (companyNode) {
    edges.push({ source: '__you__', target: companyNode.id, label: 'agreed to terms' });
  }
  // Connect You to high-severity need_to_knows that have a matching clause node
  const highFlags = flags.filter(f => f.severity === 'high');
  highFlags.forEach(f => {
    const matchNode = nodes.find(n =>
      n.type === 'clause' && f.title && n.label.toLowerCase().includes(f.title.toLowerCase().slice(0, 8))
    );
    if (matchNode) {
      edges.push({ source: '__you__', target: matchNode.id, label: 'affected by' });
    }
  });

  document.getElementById('empty-state').style.display = 'none';

  const svg    = d3.select("#graph-canvas");
  const width  = svg.node().clientWidth;
  const height = svg.node().clientHeight;

  svg.selectAll("*").remove();

  svg.append("defs").append("marker")
    .attr("id", "arrow")
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 22).attr("refY", 0)
    .attr("markerWidth", 6).attr("markerHeight", 6)
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M0,-5L10,0L0,5")
    .attr("fill", "#9B6B50");

  const g = svg.append("g");

  svg.call(
    d3.zoom()
      .scaleExtent([0.3, 3])
      .on("zoom", (e) => g.attr("transform", e.transform))
  );

  const link = g.append("g").selectAll("line")
    .data(edges)
    .enter().append("line")
    .attr("stroke", "#C9B8AF")
    .attr("stroke-width", 1.5)
    .attr("marker-end", "url(#arrow)");

  const linkLabel = g.append("g").selectAll("text")
    .data(edges)
    .enter().append("text")
    .attr("font-size", "9px")
    .attr("fill", "#9E8880")
    .attr("text-anchor", "middle")
    .attr("font-family", "Courier Prime, monospace")
    .text(d => d.label);

  const node = g.append("g").selectAll("g")
    .data(nodes)
    .enter().append("g")
    .attr("class", d => {
      const isRedFlag = flags.some(f => {
        const flagText = typeof f === 'string' ? f : `${f.title || ''} ${f.what || ''}`;
        return flagText.toLowerCase().includes(d.label.toLowerCase());
      });
      return isRedFlag ? "node-redflag" : "";
    })
    .call(d3.drag()
      .on("start", dragStart)
      .on("drag",  dragged)
      .on("end",   dragEnd)
    )
    .on("mouseover", showTooltip)
    .on("mousemove", moveTooltip)
    .on("mouseout",  hideTooltip);

  node.append("circle")
    .attr("r",            d => d.type === 'company' ? 18 : d.type === 'user' ? 16 : 12)
    .attr("fill",         d => NODE_COLORS[d.type] || "#C8C3BF")
    .attr("stroke",       d => (d.type === 'company' || d.type === 'user') ? "#3B2016" : "transparent")
    .attr("stroke-width", d => d.type === 'user' ? 2.5 : 2)
    .attr("stroke-dasharray", d => d.type === 'user' ? "4,2" : "none")
    .attr("opacity", 0.9);

  node.append("text")
    .attr("dy",          d => d.type === 'company' ? 32 : d.type === 'user' ? 30 : 24)
    .attr("text-anchor", "middle")
    .attr("font-size",   d => d.type === 'company' ? "12px" : "10px")
    .attr("font-family", "Courier Prime, monospace")
    .attr("fill",        "#3B2016")
    .attr("font-weight", d => d.type === 'company' ? "700" : "400")
    .text(d => d.label.length > 18 ? d.label.slice(0, 16) + '…' : d.label);

  simulation = d3.forceSimulation(nodes)
    .force("link",      d3.forceLink(edges).id(d => d.id).distance(180))
    .force("charge",    d3.forceManyBody().strength(-800))
    .force("center",    d3.forceCenter(width / 2, height / 2))
    .force("collision", d3.forceCollide().radius(70))
    .on("tick", () => {
      link
        .attr("x1", d => d.source.x).attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x).attr("y2", d => d.target.y);

      linkLabel
        .attr("x", d => (d.source.x + d.target.x) / 2)
        .attr("y", d => (d.source.y + d.target.y) / 2);

      node.attr("transform", d => `translate(${d.x},${d.y})`);
    });
}

function dragStart(event, d) {
  if (!event.active) simulation.alphaTarget(0.3).restart();
  d.fx = d.x; d.fy = d.y;
}
function dragged(event, d) { d.fx = event.x; d.fy = event.y; }
function dragEnd(event, d) {
  if (!event.active) simulation.alphaTarget(0);
  d.fx = null; d.fy = null;
}

const NODE_EXPLANATIONS = {
  company: (label) => ({
    badge: '🏢 Main Company',
    desc:  `This is the company whose Terms & Conditions you're reading. Everything in the document is a rule set by <strong>${label}</strong> — and by using their service, you've agreed to all of it.`,
  }),
  data_broker: (label) => ({
    badge: '⚠️ Data Broker / Third Party',
    desc:  `<strong>${label}</strong> is a third party that receives or can buy your personal data. They may track your behavior, build a profile on you, or sell your information to others — even if you've never heard of them.`,
  }),
  ad_network: (label) => ({
    badge: '📣 Advertising Partner',
    desc:  `<strong>${label}</strong> is an advertising network. The company shares your data with them so they can show you targeted ads across the internet, often on completely unrelated websites.`,
  }),
  jurisdiction: (label) => ({
    badge: '⚖️ Legal Jurisdiction',
    desc:  `If you ever need to sue the company (or they sue you), it must happen under the laws of <strong>${label}</strong>. This may be far from where you live, making legal action expensive or impractical.`,
  }),
  clause: (label) => ({
    badge: '📋 Legal Clause',
    desc:  clauseExplain(label),
  }),
  user: () => ({
    badge: '👤 You',
    desc:  'This is you — the person who agreed to these terms. Every edge connected to you shows a direct relationship or obligation between you and the company or its legal clauses.',
  }),
};

function clauseExplain(label) {
  const l = label.toLowerCase();
  if (l.includes('arbitration'))
    return `<strong>Arbitration</strong> means you give up your right to sue in court. Instead, disputes go to a private arbitrator — usually chosen by the company — whose decision is final and almost impossible to appeal.`;
  if (l.includes('class action'))
    return `A <strong>Class Action Waiver</strong> stops you from joining a group lawsuit with other users. You must fight the company alone, which is often too expensive to be worth it — which is exactly the point.`;
  if (l.includes('indemnity') || l.includes('indemnification'))
    return `An <strong>Indemnity clause</strong> means you agree to pay the company's legal fees if someone sues them because of something you did on their platform.`;
  if (l.includes('limitation of li'))
    return `A <strong>Limitation of Liability</strong> clause caps how much the company owes you if they harm you — sometimes as low as $0.`;
  if (l.includes('auto') || l.includes('renewal') || l.includes('renew'))
    return `An <strong>Auto-Renewal</strong> clause means your subscription renews and charges your card automatically. Missing the cancellation window means another full billing cycle.`;
  if (l.includes('termination'))
    return `A <strong>Termination clause</strong> lets the company delete your account at any time, for any reason, without warning or compensation.`;
  if (l.includes('content license') || l.includes('license'))
    return `A <strong>Content License</strong> means anything you post can be used by the company for free, forever, anywhere in the world — even after you delete your account.`;
  if (l.includes('governing law') || l.includes('choice of law'))
    return `A <strong>Governing Law clause</strong> locks all legal disputes into one specific state or country's legal system, regardless of where you live.`;
  return `<strong>${label}</strong> is a legal clause in the Terms & Conditions. Check the need-to-knows panel for more detail.`;
}

const tooltip = document.getElementById('tooltip');

function showTooltip(event, d) {
  const color   = NODE_COLORS[d.type] || '#9B6B50';
  const explain = NODE_EXPLANATIONS[d.type]
    ? NODE_EXPLANATIONS[d.type](d.label)
    : { badge: d.type.replace('_', ' '), desc: d.label };

  const flags = currentParsed?.need_to_knows || currentParsed?.red_flags || [];
  const isRedFlag = flags.some(f => {
    const txt = typeof f === 'string' ? f : `${f.title || ''} ${f.what || ''}`;
    return txt.toLowerCase().includes(d.label.toLowerCase());
  });

  tooltip.style.display     = 'block';
  tooltip.style.borderColor = color;
  tooltip.innerHTML = `
    <div class="tt-badge" style="background:${color}22; color:${color}; border:1px solid ${color}44;">
      ${explain.badge}
    </div>
    <div class="tt-label">${d.label}</div>
    <div class="tt-desc">${explain.desc}</div>
    ${isRedFlag ? `<div class="tt-redflag">🚩 Need to Know</div>` : ''}
  `;
}

function moveTooltip(event) {
  const tw = tooltip.offsetWidth;
  const th = tooltip.offsetHeight;
  let x = event.clientX + 16;
  let y = event.clientY - 10;
  if (x + tw > window.innerWidth  - 12) x = event.clientX - tw - 16;
  if (y + th > window.innerHeight - 12) y = window.innerHeight - th - 12;
  tooltip.style.left = x + 'px';
  tooltip.style.top  = y + 'px';
}
function hideTooltip() { tooltip.style.display = 'none'; }

function clearGraph() {
  d3.select("#graph-canvas").selectAll("*").remove();
  const emptyState = document.getElementById('empty-state');
  if (emptyState) emptyState.style.display = 'flex';
  // Support both old (red-flags-section) and new (need-to-knows-section) HTML
  const ntk = document.getElementById('need-to-knows-section') || document.getElementById('red-flags-section');
  if (ntk) ntk.style.display = 'none';
  const saveBtn = document.getElementById('save-btn');
  if (saveBtn) saveBtn.style.display = 'none';
}

// ============================================================
//  NEED TO KNOWS
// ============================================================
function renderNeedToKnows(flags) {
  const section = document.getElementById('need-to-knows-section') || document.getElementById('red-flags-section');
  const list    = document.getElementById('need-to-knows-list') || document.getElementById('red-flags-list');
  list.innerHTML = '';

  if (!flags || !flags.length) {
    section.style.display = 'none';
    return;
  }

  // Sort: high first, then medium, then low
  const order = { high: 0, medium: 1, low: 2 };
  const sorted = [...flags].sort((a, b) => {
    const sa = order[a.severity] ?? 1;
    const sb = order[b.severity] ?? 1;
    return sa - sb;
  });

  sorted.forEach((f, i) => {
    const li = document.createElement('li');
    const severity = f.severity || 'medium';
    const severityColor = severity === 'high' ? '#C96B6B' : severity === 'medium' ? '#D4944A' : '#7AAECC';
    const severityLabel = severity === 'high' ? '🔴 HIGH' : severity === 'medium' ? '🟠 MEDIUM' : '🔵 LOW';

    if (typeof f === 'string') {
      li.innerHTML = `<span class="rf-title">${f}</span>`;
    } else {
      li.innerHTML = `
        <div class="ntk-header">
          <span class="ntk-number">#${i + 1}</span>
          <span class="ntk-severity" style="color:${severityColor}">${severityLabel}</span>
        </div>
        <span class="rf-title">${f.title || 'Need to Know'}</span>
        ${f.what   ? `<span class="rf-what"><strong>What it says:</strong> ${f.what}</span>`               : ''}
        ${f.impact ? `<span class="rf-impact"><strong>What it means for you:</strong> ${f.impact}</span>`  : ''}
      `;
    }

    li.style.borderLeftColor = severityColor;
    list.appendChild(li);
  });

  section.style.display = 'block';
}

// ============================================================
//  LEGAL ACTIVITY
// ============================================================
async function fetchLawsuits(company) {
  setLawsuitStatus(`Searching legal records for ${company}...`);

  const [court, news] = await Promise.allSettled([
    fetchCourtListener(company),
    fetchNewsAPI(company)
  ]);

  const results = [
    ...(court.status === 'fulfilled' ? court.value : []),
    ...(news.status  === 'fulfilled' ? news.value  : []),
  ];

  renderLawsuits(results);
}

async function fetchCourtListener(company) {
  if (!COURT_TOKEN) return [];

  try {
    const url = `https://www.courtlistener.com/api/rest/v4/search/?q=${encodeURIComponent(company)}&type=d&order_by=score+desc&page_size=5`;
    const res = await fetch(url, {
      headers: { "Authorization": `Token ${COURT_TOKEN}`, "Accept": "application/json" }
    });
    if (!res.ok) return [];
    const data = await res.json();

    return (data.results || []).map(c => {
      let caseUrl = null;
      if (c.docket_id) {
        const slug = (c.caseName || c.case_name || '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 60);
        caseUrl = slug
          ? `https://www.courtlistener.com/docket/${c.docket_id}/${slug}/`
          : `https://www.courtlistener.com/docket/${c.docket_id}/`;
      } else if (c.absolute_url) {
        caseUrl = `https://www.courtlistener.com${c.absolute_url}`;
      }

      const nature = c.nature_of_suit || '';
      const desc   = nature ? nature.slice(0, 180) : null;

      return {
        type:        'court',
        title:       c.caseName || c.case_name || 'Unknown Case',
        description: desc,
        source:      c.court_citation_string || c.court || 'Federal Court',
        date:        c.dateFiled || c.date_filed || '',
        url:         caseUrl
      };
    });
  } catch (e) {
    console.error('CourtListener error:', e);
    return [];
  }
}

async function fetchNewsAPI(company) {
  if (!NEWS_KEY) return [];

  try {
    const query = `"${company}" AND (lawsuit OR settlement OR "class action" OR litigation OR "FTC" OR "DOJ")`;
    const url   = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&sortBy=publishedAt&pageSize=10&language=en&apiKey=${NEWS_KEY}`;
    const res   = await fetch(url);
    const data  = await res.json();
    if (data.status !== 'ok') return [];

    const legalTerms = ["lawsuit","settlement","sued","court","trial","ftc","doj",
                        "litigation","class action","fine","penalty","ruling","verdict","charges"];

    return data.articles
      .filter(a => legalTerms.some(t =>
        `${a.title} ${a.description || ''}`.toLowerCase().includes(t)
      ))
      .slice(0, 5)
      .map(a => ({
        type:        'news',
        title:       a.title,
        description: a.description ? a.description.slice(0, 180) + (a.description.length > 180 ? '…' : '') : null,
        source:      a.source.name,
        date:        a.publishedAt?.slice(0, 10) || '',
        url:         a.url
      }));
  } catch {
    return [];
  }
}

function renderLawsuits(results) {
  const list = document.getElementById('lawsuit-list');
  list.innerHTML = '';

  if (!results.length) {
    setLawsuitStatus('No legal records found.');
    return;
  }

  results.forEach(r => {
    const card = document.createElement('div');
    card.className = `lawsuit-card ${r.type}`;
    const hasLink = r.url && r.url !== '#';

    card.innerHTML = `
      <div class="lc-title">${r.title}</div>
      ${r.description ? `<div class="lc-description">${r.description}</div>` : ''}
      <div class="lc-meta">
        ${r.source}${r.date ? ' · ' + r.date : ''}
        · ${r.type === 'court' ? '⚖️ Court Filing' : '📰 News'}
      </div>
      ${hasLink
        ? `<a class="lc-link" href="${r.url}" target="_blank" rel="noopener noreferrer">View full ${r.type === 'court' ? 'docket' : 'article'} →</a>`
        : `<span class="lc-link" style="opacity:0.3">No link available</span>`
      }
    `;

    list.appendChild(card);
  });
}

function setLawsuitStatus(msg) {
  document.getElementById('lawsuit-list').innerHTML = `<div id="lawsuit-empty">${msg}</div>`;
}
function clearLawsuits() { setLawsuitStatus('Awaiting analysis...'); }

// ============================================================
//  SAVE & LOAD
// ============================================================
document.getElementById('save-btn').addEventListener('click', async () => {
  if (!currentParsed) return;

  const { data: { user } } = await supabaseClient.auth.getUser();
  // Strip the injected You node before saving
  const saveNodes = currentParsed.nodes.filter(n => n.id !== '__you__');
  const saveEdges = currentParsed.edges.filter(e => e.source !== '__you__' && e.target !== '__you__');
  const { error } = await supabaseClient.from('saved_trees').insert({
    user_id:   user.id,
    company:   currentParsed.company || 'Unknown',
    nodes:     JSON.stringify(saveNodes),
    edges:     JSON.stringify(saveEdges),
    red_flags: JSON.stringify(currentParsed.need_to_knows || currentParsed.red_flags || [])
  }, { count: 'minimal' });

  if (error) {
    setStatus('Save failed: ' + error.message, 'error');
  } else {
    setStatus('✓ Saved!', 'success');
    loadSavedTrees();
  }
});

async function loadSavedTrees() {
  const { data, error } = await supabaseClient
    .from('saved_trees')
    .select('*')
    .order('created_at', { ascending: false });

  if (error || !data?.length) return;

  const section = document.getElementById('saved-section');
  const list    = document.getElementById('saved-list');
  section.style.display = 'block';
  list.innerHTML = '';

  data.forEach(tree => {
    const item = document.createElement('div');
    item.className = 'saved-item';
    item.innerHTML = `
      <div class="saved-company">${tree.company}</div>
      <div class="saved-date">${new Date(tree.created_at).toLocaleDateString()}</div>
    `;

    item.addEventListener('click', () => {
      const parsed = {
        company:      tree.company,
        nodes:        JSON.parse(tree.nodes),
        edges:        JSON.parse(tree.edges),
        need_to_knows: JSON.parse(tree.red_flags || '[]')
      };
      currentParsed = parsed;
      renderGraph(parsed);
      renderNeedToKnows(parsed.need_to_knows);
      document.getElementById('save-btn').style.display = 'block';
      setStatus(`✓ Loaded: ${tree.company}`, 'success');
      if (parsed.company) fetchLawsuits(parsed.company);
    });

    // Auto-open if triggered from dashboard
    if (window._autoOpenId && tree.id === window._autoOpenId) {
      window._autoOpenId = null;
      item.click();
    }

    list.appendChild(item);
  });
}

// ============================================================
//  UTILITY HELPERS
// ============================================================
function setStatus(html, type = '') {
  const el     = document.getElementById('status');
  el.innerHTML = html;
  el.className = type || '';
}

function setAnalyzeDisabled(val) {
  document.getElementById('analyze-btn').disabled = val;
}