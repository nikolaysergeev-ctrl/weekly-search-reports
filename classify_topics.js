#!/usr/bin/env node

/**
 * One-time classification script.
 * Reads known_sources.json and, for any entry currently tagged
 * "Unknown (legacy entry)", assigns it to the best-matching topic
 * based on keyword overlap in its title + description.
 *
 * Entries that already have a real topic (found by normal weekly runs
 * after the metadata upgrade) are left untouched.
 *
 * Entries with zero keyword matches are tagged "Unclassified (needs review)"
 * rather than forced into a wrong bucket.
 */

const fs = require('fs');
const path = require('path');

const KNOWN_SOURCES_PATH = path.join(process.cwd(), 'known_sources.json');

const TOPIC_KEYWORDS = {
  'Longevity Science & Aging Biomarkers': [
    'longevity', 'aging', 'ageing', 'biomarker', 'senescence', 'senescent',
    'epigenetic', 'methylation', 'dunedinpace', 'grimage', 'phenoage',
    'biological age', 'healthspan', 'geroscience', 'aging clock', 'frailty',
    'vo2max', 'vo2 max', 'grip strength', 'telomere', 'hallmarks of aging',
    'lifespan', 'apob', 'hscrp', 'supar', 'sarcopenia'
  ],
  'Obesity Medicine & GLP-1/GIPR Therapies': [
    'obesity', 'glp-1', 'glp1', 'gip', 'gipr', 'tirzepatide', 'semaglutide',
    'retatrutide', 'weight loss', 'bariatric', 'metabolic surgery', 'appetite',
    'incretin', 'ozempic', 'wegovy', 'mounjaro', 'zepbound', 'anti-obesity'
  ],
  'AI/ML in Precision Health': [
    'artificial intelligence', 'machine learning', ' ai ', 'deep learning',
    'algorithm', 'digital health', 'precision medicine', 'predictive model',
    'neural network', 'large language model', 'llm', 'generative ai',
    'clinical decision support', 'ai-powered', 'ai model'
  ],
  'Regenerative Medicine & Peptides': [
    'regenerative medicine', 'peptide', 'exosome', 'stem cell', 'bpc-157',
    'tissue engineering', 'cell therapy', 'growth factor', 'regenerative therapy',
    'stem cell therapy', 'cellular therapy'
  ],
  'Microbiome Research': [
    'microbiome', 'gut microbiota', 'probiotic', 'postbiotic', 'prebiotic',
    'dysbiosis', 'gut bacteria', 'fecal transplant', 'gut-brain axis',
    'short-chain fatty acid', 'gut health', 'intestinal flora'
  ]
};

function classify(text) {
  const lower = ` ${text.toLowerCase()} `;
  let bestTopic = null;
  let bestScore = 0;

  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase())) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestTopic = topic;
    }
  }

  return bestScore > 0 ? bestTopic : null;
}

function main() {
  console.log('Starting topic classification for legacy entries...');

  const raw = fs.readFileSync(KNOWN_SOURCES_PATH, 'utf8');
  const records = JSON.parse(raw);

  let classified = 0;
  let unclassified = 0;
  let skipped = 0;

  for (const record of records) {
    if (record.topic !== 'Unknown (legacy entry)') {
      skipped++;
      continue;
    }

    const text = `${record.title || ''} ${record.description || ''}`;
    const topic = classify(text);

    if (topic) {
      record.topic = topic;
      classified++;
    } else {
      record.topic = 'Unclassified (needs review)';
      unclassified++;
    }
  }

  fs.writeFileSync(KNOWN_SOURCES_PATH, JSON.stringify(records, null, 2));

  console.log(`Done. ${classified} classified, ${unclassified} left as "Unclassified (needs review)", ${skipped} already had a real topic.`);

  // Print a per-topic breakdown for a quick sanity check
  const counts = {};
  for (const r of records) counts[r.topic] = (counts[r.topic] || 0) + 1;
  console.log('\nFinal topic distribution:');
  for (const [topic, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count.toString().padStart(4)}  ${topic}`);
  }
}

main();