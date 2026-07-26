#!/usr/bin/env node

/**
 * Weekly Search Agent
 * Searches topics of interest and generates an HTML report
 * Runs on schedule via GitHub Actions or locally
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
 * Fetch search results from DuckDuckGo API (no auth required)
 */
async function searchTopic(query) {
  return new Promise((resolve, reject) => {
    const encodedQuery = encodeURIComponent(query);
    const url = `https://api.duckduckgo.com/?q=${encodedQuery}&format=json&no_html=1&t=news-agent`;

    https.get(url, { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const results = JSON.parse(data);
          // Extract top results from RelatedTopics
          const items = (results.RelatedTopics || []).slice(0, 3).map(item => ({
            title: item.Text || '',
            url: item.FirstURL || ''
          })).filter(item => item.title && item.url);
          resolve(items);
        } catch (e) {
          resolve([]);
        }
      });
    }).on('error', reject);
  });
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
      <h2 class="topic-title">📌 ${topicResult.topic}</h2>
      <div class="results-container">
        ${resultsHTML || '<p class="no-results">No results found</p>'}
      </div>
    </section>
    `;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Weekly Search Report</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 40px 20px;
      color: #333;
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
      background: white;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      overflow: hidden;
    }

    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 40px 30px;
      text-align: center;
    }

    .header h1 {
      font-size: 2.5em;
      margin-bottom: 10px;
      font-weight: 700;
    }

    .header .timestamp {
      font-size: 0.9em;
      opacity: 0.9;
      font-weight: 500;
    }

    .content {
      padding: 40px 30px;
    }

    .topic-section {
      margin-bottom: 40px;
      padding-bottom: 30px;
      border-bottom: 2px solid #f0f0f0;
    }

    .topic-section:last-child {
      border-bottom: none;
    }

    .topic-title {
      font-size: 1.5em;
      color: #667eea;
      margin-bottom: 20px;
      font-weight: 700;
    }

    .results-container {
      display: flex;
      flex-direction: column;
      gap: 15px;
    }

    .result-item {
      display: flex;
      gap: 15px;
      padding: 15px;
      background: #f9f9f9;
      border-left: 4px solid #667eea;
      border-radius: 6px;
      transition: all 0.3s ease;
    }

    .result-item:hover {
      background: #f0f5ff;
      transform: translateX(5px);
    }

    .result-number {
      flex-shrink: 0;
      width: 30px;
      height: 30px;
      background: #667eea;
      color: white;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 0.9em;
    }

    .result-content {
      flex: 1;
      min-width: 0;
    }

    .result-title {
      font-size: 1.1em;
      margin-bottom: 8px;
      color: #333;
      font-weight: 600;
      line-height: 1.4;
    }

    .result-link {
      color: #667eea;
      text-decoration: none;
      font-size: 0.85em;
      word-break: break-all;
      transition: color 0.2s;
    }

    .result-link:hover {
      color: #764ba2;
      text-decoration: underline;
    }

    .no-results {
      color: #999;
      font-style: italic;
      padding: 20px;
      text-align: center;
    }

    .footer {
      background: #f5f5f5;
      padding: 20px 30px;
      text-align: center;
      font-size: 0.85em;
      color: #666;
      border-top: 1px solid #e0e0e0;
    }

    .footer a {
      color: #667eea;
      text-decoration: none;
    }

    .footer a:hover {
      text-decoration: underline;
    }

    @media (max-width: 600px) {
      .header h1 {
        font-size: 1.8em;
      }

      .content {
        padding: 20px;
      }

      .topic-title {
        font-size: 1.3em;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📰 Weekly Search Report</h1>
      <div class="timestamp">Generated: ${now}</div>
    </div>
    
    <div class="content">
      ${topicSections}
    </div>
    
    <div class="footer">
      <p>Auto-generated by Weekly Search Agent • <a href="#">View Raw Data</a></p>
    </div>
  </div>
</body>
</html>`;

  return html;
}

function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

/**
 * Main execution
 */
async function main() {
  console.log('🚀 Starting weekly search agent...');
  const results = [];

  for (const topic of TOPICS) {
    console.log(`📍 Searching: ${topic.name}`);
    const topicResults = [];

    for (const query of topic.queries) {
      try {
        const items = await searchTopic(query);
        topicResults.push(...items);
        // Add delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`  ⚠️  Error searching "${query}":`, error.message);
      }
    }

    // Deduplicate and limit results
    const uniqueResults = Array.from(
      new Map(topicResults.map(item => [item.title, item])).values()
    ).slice(0, 5);

    results.push({
      topic: topic.name,
      results: uniqueResults
    });
  }

  // Generate and save HTML
  const html = generateHTMLReport(results);
  const outputDir = process.env.OUTPUT_DIR || './reports';
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const filename = `weekly-report-${new Date().toISOString().split('T')[0]}.html`;
  const filepath = path.join(outputDir, filename);
  
  fs.writeFileSync(filepath, html);
  console.log(`✅ Report saved to: ${filepath}`);

  // Also save to latest.html for easy access
  fs.writeFileSync(path.join(outputDir, 'latest.html'), html);
  console.log('✅ Latest report updated');
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
