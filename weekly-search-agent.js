#!/usr/bin/env node

/**
 * Weekly Search Agent (Brave Search Edition)
 * Free API, no Azure required
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const TOPICS = [
  {
    name: 'Longevity Science & Aging Biomarkers',
    queries: [
      'longevity aging biomarkers research 2024 2025',
      'epigenetic aging clocks biological age',
      'hallmarks of aging cellular senescence'
    ]
  },
  {
    name: 'Obesity Medicine & GLP-1/GIPR Therapies',
    queries: [
      'GLP-1 GIPR tirzepatide retatrutide clinical trials 2024',
      'obesity medicine pharmacotherapy breakthrough',
      'weight loss therapy outcomes real world evidence'
    ]
  },
  {
    name: 'AI/ML in Precision Health',
    queries: [
      'artificial intelligence precision medicine digital health 2024',
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
 * Brave Search API (Free)
 */
async function searchTopic(query) {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) {
    console.error('❌ Missing BRAVE_API_KEY');
    return [];
  }

  const endpoint = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`;

  return new Promise((resolve) => {
    const req = https.request(
      endpoint,
      {
        method: 'GET',
        headers: {
          'X-Subscription-Token': apiKey
        },
        timeout: 8000
      },
      res => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);

            const items = (json.web?.results || [])
              .slice(0, 5)
              .map(r => ({
                title: r.title || '',
                url: r.url || ''
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

    req.end();
  });
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

/**
 * Generate HTML report
 */
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
          ${resultsHTML || '<p class="no-results">No results found</p>'}
        </div>
      </section>
    `;
  }).join('');

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Weekly Search Report</title>
<style>
body { font-family: Arial; background: #f0f2ff; padding: 40px; }
.container { max-width: 900px; margin: auto; background: white; padding: 30px; border-radius: 12px; }
.topic-title { color: #667eea; margin-bottom: 15px; }
.result-item { background: #f9f9f9; padding: 15px; border-left: 4px solid #667eea; margin-bottom: 10px; }
.result-link { color: #667eea; }
</style>
</head>
<body>
<div class="container">
<h1>Weekly Search Report</h1>
<p>Generated: ${escapeHtml(now)}</p>
${topicSections}
</div>
</body>
</html>`;
}

/**
 * Main
 */
async function main() {
  console.log('🚀 Weekly Search Agent (Brave Edition)');

  const results = [];

  for (const topic of TOPICS) {
    console.log(`🔎 Topic: ${topic.name}`);
    const topicResults = [];

    for (const query of topic.queries) {
      const items = await searchTopic(query);
      topicResults.push(...items);
      await new Promise(r => setTimeout(r, 400));
    }

    const unique = Array.from(new Map(topicResults.map(i => [i.url, i])).values());
    results.push({ topic: topic.name, results: unique });
  }

  const html = generateHTMLReport(results);

  const outputDir = process.env.OUTPUT_DIR || './reports';
  fs.mkdirSync(outputDir, { recursive: true });

  const filename = `weekly-report-${new Date().toISOString().split('T')[0]}.html`;
  fs.writeFileSync(path.join(outputDir, filename), html);
  fs.writeFileSync(path.join(outputDir, 'latest.html'), html);

  console.log('✅ Report generated');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
