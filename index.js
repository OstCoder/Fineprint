
const GROQ_KEY = "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";
const COURT_TOKEN = "f1ab345757ffa6dba3dad50f1618009d15764697";
const NEWS_KEY = "e6c49421ccef48f9b3439c9e9ff0b6c8";
const GROQ_MODEL = "llama-3.3-70b-versatile";

const GROQ_SYSTEM = `You are a legal analysis tool helping everyday people understand Terms & Conditions and Privacy Policies.
Extract all relationships and identify red flags. Return ONLY valid JSON with no explanation, no markdown, no backticks.

Format:
{
  "company": "company name if found",
  "nodes": [
    { "id": "unique_id", "label": "Entity Name", "type": "company|data_broker|ad_network|jurisdiction|clause" }
  ],
  "edges": [
    { "source": "id1", "target": "id2", "label": "relationship description" }
  ],
  "red_flags": [
    {
      "title": "Short plain-English name for the issue (e.g. 'No jury trial allowed')",
      "what": "One sentence explaining what this clause actually does in plain English.",
      "impact": "One sentence explaining how this directly affects the user."
    }
  ]
}

Node types:
- company: the main company
- data_broker: third party that buys/receives data
- ad_network: advertising partners
- jurisdiction: legal jurisdiction or governing law
- clause: important legal clause (arbitration, auto-renew, class action waiver, etc.)

For red_flags, focus on things that genuinely harm the user: forced arbitration, class action waivers, data selling, auto-renewal traps, unilateral term changes, broad liability waivers, data sharing with governments, etc. Write as if explaining to a non-lawyer friend.`;

const NODE_COLORS = {
  company:     "#e8d5a3",
  data_broker: "#ff6b6b",
  ad_network:  "#ffa94d",
  jurisdiction:"#74c0fc",
  clause:      "#b197fc",
};

let currentParsed = null;
let simulation = null;

// ── Auth Guard ──
(async () => {
  if (!supabaseClient) {
    setStatus("Missing Supabase config. Set window.FINEPRINT_CONFIG in a local config file.", "error");
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

// ── Logout ──
document.getElementById('logout-btn').addEventListener('click', async () => {
  await supabaseClient.auth.signOut();
  window.location.href = "login.html";
});

// ── File Upload ──
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
    pasteArea.value = text.slice(0, 8000); // cap at 8k chars for Groq
    setStatus(`✓ Loaded ${file.name}`, "success");
    dropZone.querySelector('p').innerHTML = `<strong>${file.name}</strong> ready to analyze`;
  } catch (err) {
    setStatus('Failed to read file.', 'error');
  }
}

function readTxt(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
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
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(item => item.str).join(' ') + '\n';
  }
  return text;
}

// ── Analyze ──
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
    parsed.nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
    parsed.edges = Array.isArray(parsed.edges) ? parsed.edges : [];
    parsed.red_flags = Array.isArray(parsed.red_flags) ? parsed.red_flags : [];
    currentParsed = parsed;

    renderGraph(parsed);
    renderRedFlags(parsed.red_flags || []);

    document.getElementById('save-btn').style.display = 'block';
    setStatus(`✓ Found ${parsed.nodes.length} entities, ${parsed.edges.length} connections`, 'success');

    // Fetch lawsuits in background
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
  if (!GROQ_KEY) throw new Error("Missing GROQ_KEY in FINEPRINT_CONFIG");

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
    // ✅ Better error: surface the actual Groq error message
    let detail = '';
    try {
      const errBody = await res.json();
      detail = errBody?.error?.message || JSON.stringify(errBody);
    } catch (_) {
      detail = `HTTP ${res.status}`;
    }
    throw new Error(`Groq API error: ${detail}`);
  }

  const data = await res.json();
  const raw = data.choices[0].message.content;

  // ✅ Robust JSON extraction: strip any accidental markdown fences
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON found in Groq response");
  return JSON.parse(jsonMatch[0]);
}

// ── D3 Graph ──
function renderGraph(parsed) {
  const { nodes, edges, red_flags = [] } = parsed;

  document.getElementById('empty-state').style.display = 'none';

  const svg = d3.select("#graph-canvas");
  svg.selectAll("*").remove();

  const width  = svg.node().clientWidth;
  const height = svg.node().clientHeight;

  svg.append("defs").append("marker")
    .attr("id", "arrow")
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 22)
    .attr("refY", 0)
    .attr("markerWidth", 6)
    .attr("markerHeight", 6)
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M0,-5L10,0L0,5")
    .attr("fill", "#764C34");

  const g = svg.append("g");

  // Zoom
  svg.call(d3.zoom().scaleExtent([0.3, 3]).on("zoom", (e) => {
    g.attr("transform", e.transform);
  }));

  // Links
  const link = g.append("g").selectAll("line")
    .data(edges)
    .enter().append("line")
    .attr("stroke", "#392314")
    .attr("stroke-width", 1.5)
    .attr("marker-end", "url(#arrow)");

  // Link labels
  const linkLabel = g.append("g").selectAll("text")
    .data(edges)
    .enter().append("text")
    .attr("font-size", "9px")
    .attr("fill", "#B9B9B7")
    .attr("text-anchor", "middle")
    .attr("font-family", "Courier Prime, monospace")
    .text(d => d.label);

  // Nodes
  const node = g.append("g").selectAll("g")
    .data(nodes)
    .enter().append("g")
    .attr("class", d => {
      const isRedFlag = red_flags.some(f => {
        const text = typeof f === 'string' ? f : `${f.title || ''} ${f.what || ''}`;
        return text.toLowerCase().includes(d.label.toLowerCase());
      });
      return isRedFlag ? "node-redflag" : "";
    })
    .call(d3.drag()
      .on("start", dragStart)
      .on("drag", dragged)
      .on("end", dragEnd)
    )
    .on("mouseover", showTooltip)
    .on("mousemove", moveTooltip)
    .on("mouseout", hideTooltip);

  node.append("circle")
    .attr("r", d => d.type === 'company' ? 18 : 12)
    .attr("fill", d => NODE_COLORS[d.type] || "#B9B9B7")
    .attr("stroke", d => d.type === 'company' ? "#F4E3B0" : "transparent")
    .attr("stroke-width", 2)
    .attr("opacity", 0.9);

  node.append("text")
    .attr("dy", d => d.type === 'company' ? 32 : 24)
    .attr("text-anchor", "middle")
    .attr("font-size", d => d.type === 'company' ? "12px" : "10px")
    .attr("font-family", "Courier Prime, monospace")
    .attr("fill", "#F4E3B0")
    .attr("font-weight", d => d.type === 'company' ? "700" : "400")
    .text(d => d.label.length > 18 ? d.label.slice(0, 16) + '…' : d.label);

  // Force simulation — much more spread out
  simulation = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(edges).id(d => d.id).distance(180))
    .force("charge", d3.forceManyBody().strength(-800))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collision", d3.forceCollide().radius(70))
    .on("tick", () => {
      link
        .attr("x1", d => d.source.x)
        .attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x)
        .attr("y2", d => d.target.y);

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

// Tooltip
const tooltip = document.getElementById('tooltip');
function showTooltip(event, d) {
  tooltip.style.display = 'block';
  tooltip.querySelector('.tt-label').textContent = d.label;
  tooltip.querySelector('.tt-type').textContent = d.type.replace('_', ' ');
  tooltip.style.borderColor = NODE_COLORS[d.type] || '#764C34';
}
function moveTooltip(event) {
  tooltip.style.left = (event.clientX + 14) + 'px';
  tooltip.style.top  = (event.clientY - 10) + 'px';
}
function hideTooltip() { tooltip.style.display = 'none'; }

function clearGraph() {
  d3.select("#graph-canvas").selectAll("*").remove();
  document.getElementById('empty-state').style.display = 'flex';
  document.getElementById('red-flags-section').style.display = 'none';
  document.getElementById('save-btn').style.display = 'none';
}

// ── Red Flags ──
function renderRedFlags(flags) {
  const section = document.getElementById('red-flags-section');
  const list    = document.getElementById('red-flags-list');
  list.innerHTML = '';

  if (!flags.length) { section.style.display = 'none'; return; }

  flags.forEach(f => {
    const li = document.createElement('li');
    // Support both old string format and new {title, what, impact} format
    if (typeof f === 'string') {
      li.innerHTML = `<span class="rf-title">${f}</span>`;
    } else {
      li.innerHTML = `
        <span class="rf-title">${f.title || 'Issue Found'}</span>
        ${f.what   ? `<span class="rf-what"><strong>What it means:</strong> ${f.what}</span>`   : ''}
        ${f.impact ? `<span class="rf-impact"><strong>What it means for you:</strong> ${f.impact}</span>` : ''}
      `;
    }
    list.appendChild(li);
  });

  section.style.display = 'block';
}

// ── Lawsuits ──
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
      // Build URL from docket_id first (most reliable for type=d search results)
      // absolute_url in search results is a slug path like /docket/123/case-name/
      // but docket_id alone gives us a guaranteed working URL
      let caseUrl = null;
      if (c.docket_id) {
        // Slug name from caseName for a nicer URL, fallback to just the ID
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

      return {
        type: 'court',
        title: c.caseName || c.case_name || 'Unknown Case',
        source: c.court_citation_string || c.court || 'Federal Court',
        date: c.dateFiled || c.date_filed || '',
        url: caseUrl
      };
    });
  } catch (e) { console.error('CourtListener error:', e); return []; }
}

async function fetchNewsAPI(company) {
  if (!NEWS_KEY) return [];

  try {
    const query = `"${company}" AND (lawsuit OR settlement OR "class action" OR litigation OR "FTC" OR "DOJ")`;
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&sortBy=publishedAt&pageSize=10&language=en&apiKey=${NEWS_KEY}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.status !== 'ok') return [];

    const legalTerms = ["lawsuit","settlement","sued","court","trial","ftc","doj","litigation","class action","fine","penalty","ruling","verdict","charges"];
    return data.articles
      .filter(a => legalTerms.some(t => `${a.title} ${a.description||''}`.toLowerCase().includes(t)))
      .slice(0, 5)
      .map(a => ({
        type: 'news',
        title: a.title,
        source: a.source.name,
        date: a.publishedAt?.slice(0, 10) || '',
        url: a.url
      }));
  } catch { return []; }
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
    card.innerHTML = `
      <div class="lc-title">${r.title}</div>
      <div class="lc-meta">${r.source}${r.date ? ' · ' + r.date : ''} · ${r.type === 'court' ? '⚖️ Court' : '📰 News'}</div>
    `;
    list.appendChild(card);
  });
}

function setLawsuitStatus(msg) {
  const list = document.getElementById('lawsuit-list');
  list.innerHTML = `<div id="lawsuit-empty">${msg}</div>`;
}

function clearLawsuits() {
  setLawsuitStatus('Awaiting analysis...');
}

// ── Save Tree ──
document.getElementById('save-btn').addEventListener('click', async () => {
  if (!currentParsed) return;
  if (!supabaseClient) {
    setStatus("Missing Supabase config. Save disabled.", "error");
    return;
  }

  const { data: { user } } = await supabaseClient.auth.getUser();
  const { error } = await supabaseClient.from('saved_trees').insert({
    user_id:   user.id,
    company:   currentParsed.company || 'Unknown',
    nodes:     JSON.stringify(currentParsed.nodes),
    edges:     JSON.stringify(currentParsed.edges),
    red_flags: JSON.stringify(currentParsed.red_flags || [])
  });

  if (error) {
    setStatus('Save failed: ' + error.message, 'error');
  } else {
    setStatus('✓ Saved!', 'success');
    loadSavedTrees();
  }
});

// ── Load Saved Trees ──
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
        company:   tree.company,
        nodes:     JSON.parse(tree.nodes),
        edges:     JSON.parse(tree.edges),
        red_flags: JSON.parse(tree.red_flags || '[]')
      };
      currentParsed = parsed;
      renderGraph(parsed);
      renderRedFlags(parsed.red_flags);
      document.getElementById('save-btn').style.display = 'block';
      setStatus(`✓ Loaded: ${tree.company}`, 'success');
      if (parsed.company) fetchLawsuits(parsed.company);
    });
    list.appendChild(item);
  });
}

// ── Helpers ──
function setStatus(html, type = '') {
  const el = document.getElementById('status');
  el.innerHTML = html;
  el.className = type ? type : '';
}

function setAnalyzeDisabled(val) {
  document.getElementById('analyze-btn').disabled = val;
}