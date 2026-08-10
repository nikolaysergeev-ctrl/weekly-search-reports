#!/usr/bin/env node

/**
 * Weekly Search Agent (Brave Search Edition + New-Only Filtering)
 * - Searches Brave API for each topic
 * - Filters out URLs already seen in previous runs (known_sources.json)
 * - Writes the HTML report AND updates known_sources.json so next week's
 *   run only shows genuinely new items.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = process.env.OUTPUT_DIR || './reports';
const BRAVE_API_KEY = process.env.BRAVE_API_KEY;
const KNOWN_SOURCES_PATH = path.join(process.cwd(), 'known_sources.json');

const TOPICS = [
  {
    name: 'Longevity Science & Aging Biomarkers',
    queries: [
      'longevity aging biomarkers research 2026',
      'epigenetic aging clocks biological age',
      'hallmarks of aging cellular senescence'
    ]
  },
  {
    name: 'Obesity Medicine & GLP-1/GIPR Therapies',
    queries: [
      'GLP-1 GIPR tirzepatide retatrutide clinical trials',
      'obesity medicine pharmacotherapy breakthrough',
      'weight loss therapy outcomes real world evidence'
    ]
  },
  {
    name: 'AI/ML in Precision Health',
    queries: [
      'artificial intelligence precision medicine digital health',
      'machine learning disease prediction biomarkers',
      'AI clinical decision support healthcare'
    ]
  },
  {
    name: 'Regenerative Medicine & Peptides',
    queries: [
      'regenerative medicine peptides exosomes stem cells',
      'bioregenerative therapy clinical development',
      'peptide therapeutics BPC-157 longevity'
    ]
  },
  {
    name: 'Microbiome Research',
    queries: [
      'microbiome dysbiosis health aging research',
      'gut microbiota metabolic disease interventions',
      'probiotics postbiotics microbiome engineering'
    ]
  }
];

/**
 * Load the set of URLs already reported in previous runs.
 * Creates an empty file on first run so later writes don't fail.
 */
function loadKnownSources() {
  try {
    const raw = fs.readFileSync(KNOWN_SOURCES_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch (e) {
    return new Set(); // file doesn't exist yet or is invalid -> start fresh
  }
}

function saveKnownSources(knownSet) {
  const arr = Array.from(knownSet);
  fs.writeFileSync(KNOWN_SOURCES_PATH, JSON.stringify(arr, null, 2));
}

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (item.url && !seen.has(item.url)) {
      seen.add(item.url);
      out.push(item);
    }
  }
  return out;
}

/**
 * Brave Search API, biased toward recent/new content
 */
async function searchTopic(query) {
  if (!BRAVE_API_KEY) {
    console.error('Missing BRAVE_API_KEY');
    return [];
  }

  const biasedQuery = `${query} (2026 OR "recent" OR "new study" OR "published")`;
  const endpoint = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(biasedQuery)}&count=15`;

  return new Promise((resolve) => {
    const req = https.request(
      endpoint,
      {
        method: 'GET',
        headers: { 'X-Subscription-Token': BRAVE_API_KEY },
        timeout: 8000
      },
      res => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const items = (json.web?.results || [])
              .map(r => ({ title: r.title || '', url: r.url || '' }))
              .filter(item => item.title && item.url);
            resolve(items);
          } catch (e) {
            console.error('Parse error:', e.message);
            resolve([]);
          }
        });
      }
    );

    req.on('error', err => {
      console.error('API error:', err.message);
      resolve([]);
    });
    req.on('timeout', () => { req.destroy(); resolve([]); });
    req.end();
  });
}

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

function generateHTMLReport(results) {
  const now = new Date().toLocaleString();

  const topicSections = results.map(topicResult => {
    const resultsHTML = topicResult.results.map((item, idx) => `
      <div class="result-item">
        <div class="result-number">${idx + 1}</div>
        <div class="result-content">
          <h4 class="result-title">${escapeHtml(item.title)}</h4>
          <a href="${item.url}" target="_blank" class="result-link">${item.url}</a>
        </div>
      </div>
    `).join('');

    return `
      <section class="topic-section">
        <h2 class="topic-title">📌 ${escapeHtml(topicResult.topic)}</h2>
        <div class="results-container">
          ${resultsHTML || '<p class="no-results">No new results this week</p>'}
        </div>
      </section>
    `;
  }).join('');

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Weekly Search Report — New Only</title>
<style>
body { font-family: -apple-system, Arial, sans-serif; background: #f0f2ff; padding: 40px; }
.container { max-width: 900px; margin: auto; background: white; padding: 30px; border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,0.1); }
h1 { color: #333; }
.topic-title { color: #667eea; margin: 25px 0 15px; }
.result-item { display: flex; gap: 12px; background: #f9f9f9; padding: 15px; border-left: 4px solid #667eea; border-radius: 6px; margin-bottom: 10px; }
.result-number { flex-shrink: 0; width: 26px; height: 26px; background: #667eea; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.85em; font-weight: bold; }
.result-title { margin-bottom: 6px; font-size: 1.05em; }
.result-link { color: #667eea; font-size: 0.85em; word-break: break-all; }
.no-results { color: #999; font-style: italic; }
</style>
</head>
<body>
<div class="container">
<h1>📰 Weekly Search Report — New Only</h1>
<p>Generated: ${escapeHtml(now)}</p>
${topicSections}
</div>
</body>
</html>`;
}

async function main() {
  console.log('Starting weekly search agent (new-only mode)...');

  const knownSources = loadKnownSources();
  console.log(`Loaded ${knownSources.size} known sources from previous runs`);

  const results = [];
  const allUrlsThisRun = [];

  for (const topic of TOPICS) {
    console.log(`Topic: ${topic.name}`);
    let topicResults = [];

    for (const query of topic.queries) {
      const items = await searchTopic(query);
      console.log(`  "${query}" -> ${items.length} raw results`);
      topicResults.push(...items);
      await new Promise(r => setTimeout(r, 500));
    }

    const deduped = dedupe(topicResults);

    // Track every URL seen this run so it's marked "known" for next week,
    // regardless of whether it makes it into this week's "new" report.
    deduped.forEach(item => allUrlsThisRun.push(item.url));

    const newOnly = deduped.filter(item => !knownSources.has(item.url));

    results.push({ topic: topic.name, results: newOnly });
  }

  const html = generateHTMLReport(results);

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const filename = path.join(
    OUTPUT_DIR,
    `weekly-report-${new Date().toISOString().slice(0, 10)}.html`
  );
  fs.writeFileSync(filename, html);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'latest.html'), html);
  console.log(`Report written: ${filename}`);

  // Update known_sources.json with everything seen this run,
  // so next week's run correctly treats these as "already seen".
  allUrlsThisRun.forEach(url => knownSources.add(url));
  saveKnownSources(knownSources);
  console.log(`known_sources.json updated: ${knownSources.size} total URLs tracked`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});