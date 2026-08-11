#!/usr/bin/env node

/**
 * Weekly Search Agent (Brave Search Edition + New-Only Filtering + Master Index)
 * - Searches Brave API for each topic
 * - Filters out URLs already seen in previous runs (known_sources.json)
 * - Writes:
 *     reports/weekly-report-DATE.html  -> only genuinely new links this run
 *     reports/latest.html              -> same as above, always current
 *     reports/master.html              -> EVERY known source ever found,
 *                                          grouped by topic, with title + summary
 * - known_sources.json now stores rich records: {url, title, description, topic, firstSeen}
 *   (older runs only stored bare URL strings; those are auto-migrated on load,
 *   just without a title/summary, which will remain blank for those legacy entries).
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
 * Load known sources. Supports both the OLD format (array of URL strings)
 * and the NEW format (array of {url, title, description, topic, firstSeen}).
 * Old entries are migrated in-memory to the new shape with blank metadata.
 * Returns a Map keyed by url for O(1) lookup + easy merging.
 */
function loadKnownSources() {
  let raw;
  try {
    raw = fs.readFileSync(KNOWN_SOURCES_PATH, 'utf8');
  } catch (e) {
    console.log('No known_sources.json found yet - starting fresh (first run).');
    return new Map();
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error('known_sources.json does not contain a JSON array');
    }
  } catch (e) {
    console.error('known_sources.json exists but failed to parse:', e.message);
    console.error('Refusing to proceed with an empty known-sources list, since that would');
    console.error('overwrite your tracked history. Fix the JSON syntax and re-run.');
    process.exit(1);
  }

  const map = new Map();
  for (const entry of parsed) {
    if (typeof entry === 'string') {
      // Legacy format: bare URL string, no metadata available.
      map.set(entry, {
        url: entry,
        title: '',
        description: '',
        topic: 'Unknown (legacy entry)',
        firstSeen: 'legacy',
        publishedDate: null
      });
    } else if (entry && typeof entry === 'object' && entry.url) {
      map.set(entry.url, {
        url: entry.url,
        title: entry.title || '',
        description: entry.description || '',
        topic: entry.topic || 'Unknown',
        firstSeen: entry.firstSeen || 'unknown',
        publishedDate: entry.publishedDate || null
      });
    }
  }
  return map;
}

function saveKnownSources(knownMap) {
  const arr = Array.from(knownMap.values());
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
 * Brave Search API, biased toward recent/new content.
 * Now also captures the description snippet Brave returns, for use as a summary.
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
              .map(r => ({
                title: r.title || '',
                url: r.url || '',
                description: stripHtml(r.description || '')
              }))
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

// Brave descriptions sometimes contain <strong> highlight tags - strip them for clean summaries
function stripHtml(text) {
  return text.replace(/<[^>]+>/g, '').trim();
}

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

function generateHTMLReport(results, titleText, subtitleText) {
  const now = new Date().toLocaleString();

  const topicSections = results.map(topicResult => {
    const resultsHTML = topicResult.results.map((item, idx) => `
      <div class="result-item">
        <div class="result-number">${idx + 1}</div>
        <div class="result-content">
          <h4 class="result-title">${escapeHtml(item.title)}</h4>
          ${item.publishedDate ? `<p class="result-date">Published: ${escapeHtml(item.publishedDate)}</p>` : ''}
          ${item.description ? `<p class="result-desc">${escapeHtml(item.description)}</p>` : ''}
          <a href="${item.url}" target="_blank" class="result-link">${item.url}</a>
        </div>
      </div>
    `).join('');

    return `
      <section class="topic-section">
        <h2 class="topic-title">📌 ${escapeHtml(topicResult.topic)} <span class="count">(${topicResult.results.length})</span></h2>
        <div class="results-container">
          ${resultsHTML || '<p class="no-results">No results</p>'}
        </div>
      </section>
    `;
  }).join('');

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${escapeHtml(titleText)}</title>
<style>
body { font-family: -apple-system, Arial, sans-serif; background: #f0f2ff; padding: 40px; }
.container { max-width: 900px; margin: auto; background: white; padding: 30px; border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,0.1); }
h1 { color: #333; }
.subtitle { color: #777; margin-top: -5px; }
.topic-title { color: #667eea; margin: 25px 0 15px; }
.topic-title .count { color: #999; font-size: 0.7em; font-weight: normal; }
.result-item { display: flex; gap: 12px; background: #f9f9f9; padding: 15px; border-left: 4px solid #667eea; border-radius: 6px; margin-bottom: 10px; }
.result-number { flex-shrink: 0; width: 26px; height: 26px; background: #667eea; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.85em; font-weight: bold; }
.result-title { margin-bottom: 6px; font-size: 1.05em; }
.result-date { color: #999; font-size: 0.78em; margin-bottom: 4px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; }
.result-desc { color: #555; font-size: 0.92em; margin-bottom: 8px; line-height: 1.4; }
.result-link { color: #667eea; font-size: 0.85em; word-break: break-all; }
.no-results { color: #999; font-style: italic; }
nav.jump { margin: 15px 0 25px; font-size: 0.9em; }
nav.jump a { color: #667eea; margin-right: 12px; text-decoration: none; }
</style>
</head>
<body>
<div class="container">
<h1>${escapeHtml(titleText)}</h1>
<p class="subtitle">${escapeHtml(subtitleText)} &middot; Generated: ${escapeHtml(now)}</p>
${topicSections}
</div>
</body>
</html>`;
}

async function main() {
  console.log('Starting weekly search agent (new-only + master index mode)...');

  const knownMap = loadKnownSources();
  console.log(`Loaded ${knownMap.size} known sources from previous runs`);

  const weeklyResults = [];
  const today = new Date().toISOString().slice(0, 10);

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
    const newOnly = deduped.filter(item => !knownMap.has(item.url));

    // Merge everything seen this run into the known map (with metadata),
    // tagging brand-new ones with today's date as firstSeen.
    deduped.forEach(item => {
      if (!knownMap.has(item.url)) {
        knownMap.set(item.url, {
          url: item.url,
          title: item.title,
          description: item.description,
          topic: topic.name,
          firstSeen: today
        });
      }
    });

    weeklyResults.push({ topic: topic.name, results: newOnly });
  }

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // --- Weekly "new only" report (unchanged behavior) ---
  const weeklyHtml = generateHTMLReport(
    weeklyResults,
    '📰 Weekly Search Report — New Only',
    'Links found for the first time this run'
  );
  const weeklyFilename = path.join(OUTPUT_DIR, `weekly-report-${today}.html`);
  fs.writeFileSync(weeklyFilename, weeklyHtml);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'latest.html'), weeklyHtml);
  console.log(`Weekly report written: ${weeklyFilename}`);

  // --- Master index: every known source, ever, grouped by topic ---
  const byTopic = new Map();
  for (const record of knownMap.values()) {
    if (!byTopic.has(record.topic)) byTopic.set(record.topic, []);
    byTopic.get(record.topic).push(record);
  }
  // Sort each topic's entries newest-first (legacy entries with no date sort last)
  const masterResults = Array.from(byTopic.entries()).map(([topic, items]) => ({
    topic,
    results: items.sort((a, b) => {
      // Prefer real publish date; fall back to when the agent first found the link.
      // Entries with neither sort to the bottom.
      const aKey = a.publishedDate || a.firstSeen || '';
      const bKey = b.publishedDate || b.firstSeen || '';
      return bKey.localeCompare(aKey);
    })
  }));

  const masterHtml = generateHTMLReport(
    masterResults,
    '📚 Master Source Index',
    `All sources ever found by the agent (${knownMap.size} total)`
  );
  const masterFilename = path.join(OUTPUT_DIR, 'master.html');
  fs.writeFileSync(masterFilename, masterHtml);
  console.log(`Master index written: ${masterFilename}`);

  // --- Persist updated known sources (now with title/description/topic/date) ---
  saveKnownSources(knownMap);
  console.log(`known_sources.json updated: ${knownMap.size} total URLs tracked`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});