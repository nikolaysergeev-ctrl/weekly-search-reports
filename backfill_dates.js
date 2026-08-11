#!/usr/bin/env node

/**
 * One-time date-backfill script.
 * For entries that already have a title (meaning the page was reachable
 * during the metadata backfill), fetch the page again and look for a
 * real publish date in common metadata locations:
 *   - <meta property="article:published_time" content="...">
 *   - <meta name="date" content="...">
 *   - <meta name="publish-date" content="...">
 *   - <meta itemprop="datePublished" content="...">
 *   - <time datetime="...">
 *   - JSON-LD "datePublished": "..."
 *
 * Stores result as record.publishedDate (YYYY-MM-DD), separate from
 * firstSeen (which just means "when the agent found this link").
 * Entries where no date can be found are left without publishedDate
 * rather than guessing.
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const KNOWN_SOURCES_PATH = path.join(process.cwd(), 'known_sources.json');
const REQUEST_TIMEOUT_MS = 9000;
const DELAY_BETWEEN_REQUESTS_MS = 1200;
const MAX_REDIRECTS = 4;

function fetchHtml(url, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve) => {
    let lib;
    try { lib = url.startsWith('https') ? https : http; } catch (e) { resolve(null); return; }

    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml'
      },
      timeout: REQUEST_TIMEOUT_MS
    };

    const req = lib.get(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
        let nextUrl = res.headers.location;
        if (nextUrl.startsWith('/')) {
          const u = new URL(url);
          nextUrl = `${u.protocol}//${u.host}${nextUrl}`;
        }
        res.resume();
        fetchHtml(nextUrl, redirectsLeft - 1).then(resolve);
        return;
      }
      if (res.statusCode >= 400) { res.resume(); resolve(null); return; }

      let data = '';
      let size = 0;
      const MAX_BYTES = 500000;
      res.on('data', chunk => { size += chunk.length; if (size < MAX_BYTES) data += chunk; });
      res.on('end', () => resolve(data));
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function extractPublishedDate(html) {
  const patterns = [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i,
    /<meta[^>]+itemprop=["']datePublished["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+itemprop=["']datePublished["']/i,
    /<meta[^>]+name=["']date["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']publish-date["'][^>]+content=["']([^"']+)["']/i,
    /"datePublished"\s*:\s*"([^"]+)"/i,
    /<time[^>]+datetime=["']([^"']+)["']/i
  ];

  for (const re of patterns) {
    const match = html.match(re);
    if (match && match[1]) {
      const iso = match[1].trim();
      // Normalize to YYYY-MM-DD if we can parse it
      const parsed = new Date(iso);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString().slice(0, 10);
      }
    }
  }
  return null;
}

async function main() {
  console.log('Starting publish-date backfill...');

  const raw = fs.readFileSync(KNOWN_SOURCES_PATH, 'utf8');
  const records = JSON.parse(raw);

  const candidates = records.filter(r => r.title && !r.publishedDate);
  console.log(`${records.length} total entries, ${candidates.length} have a title but no date yet -> will attempt`);

  let done = 0, found = 0, notFound = 0;

  for (const record of records) {
    if (!record.title || record.publishedDate) continue;

    done++;
    process.stdout.write(`[${done}/${candidates.length}] ${record.url} ... `);

    const html = await fetchHtml(record.url);
    if (!html) {
      console.log('FAILED (no response)');
      notFound++;
    } else {
      const date = extractPublishedDate(html);
      if (date) {
        record.publishedDate = date;
        found++;
        console.log(`OK -> ${date}`);
      } else {
        notFound++;
        console.log('no date found');
      }
    }

    await new Promise(r => setTimeout(r, DELAY_BETWEEN_REQUESTS_MS));

    if (done % 20 === 0) {
      fs.writeFileSync(KNOWN_SOURCES_PATH, JSON.stringify(records, null, 2));
      console.log(`  (progress saved: ${done}/${candidates.length})`);
    }
  }

  fs.writeFileSync(KNOWN_SOURCES_PATH, JSON.stringify(records, null, 2));
  console.log(`\nDate backfill complete: ${found} dates found, ${notFound} not found, out of ${candidates.length} attempted.`);
}

main().catch(err => {
  console.error('Fatal error during date backfill:', err);
  process.exit(1);
});