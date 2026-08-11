#!/usr/bin/env node

/**
 * One-time backfill script.
 * Reads known_sources.json, and for any entry missing a title/description
 * (i.e. legacy bare-URL entries from before metadata capture was added),
 * fetches the page and extracts <title> + meta description.
 *
 * Run via the "Backfill Metadata" workflow (manual trigger only).
 * Safe to re-run: entries that already have a title are skipped.
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
    try {
      lib = url.startsWith('https') ? https : http;
    } catch (e) {
      resolve(null);
      return;
    }

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
        res.resume(); // discard this response
        fetchHtml(nextUrl, redirectsLeft - 1).then(resolve);
        return;
      }

      if (res.statusCode >= 400) {
        res.resume();
        resolve(null);
        return;
      }

      let data = '';
      let size = 0;
      const MAX_BYTES = 500000; // cap at ~500KB to avoid huge pages
      res.on('data', chunk => {
        size += chunk.length;
        if (size < MAX_BYTES) data += chunk;
      });
      res.on('end', () => resolve(data));
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtmlEntities(match[1].trim()) : '';
}

function extractDescription(html) {
  // Try standard meta description first
  let match = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  if (!match) {
    // Fall back to og:description
    match = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:description["']/i);
  }
  return match ? decodeHtmlEntities(match[1].trim()) : '';
}

const NAMED_ENTITIES = {
  'amp': '&', 'lt': '<', 'gt': '>', 'quot': '"', 'apos': "'",
  'nbsp': ' ', 'mdash': '\u2014', 'ndash': '\u2013', 'hellip': '\u2026',
  'rsquo': '\u2019', 'lsquo': '\u2018', 'rdquo': '\u201d', 'ldquo': '\u201c',
  'times': '\u00d7', 'deg': '\u00b0', 'micro': '\u00b5', 'plusmn': '\u00b1',
  'alpha': '\u03b1', 'beta': '\u03b2', 'gamma': '\u03b3', 'delta': '\u03b4',
  'rho': '\u03c1', 'sigma': '\u03c3', 'copy': '\u00a9', 'reg': '\u00ae',
  'trade': '\u2122'
};

function decodeHtmlEntities(text) {
  if (!text) return text;
  return text
    .replace(/&#(\d+);/g, (match, dec) => {
      try { return String.fromCodePoint(parseInt(dec, 10)); }
      catch (e) { return match; }
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (match, hex) => {
      try { return String.fromCodePoint(parseInt(hex, 16)); }
      catch (e) { return match; }
    })
    .replace(/&([a-zA-Z]+);/g, (match, name) => {
      return NAMED_ENTITIES.hasOwnProperty(name) ? NAMED_ENTITIES[name] : match;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  console.log('Starting metadata backfill...');

  const raw = fs.readFileSync(KNOWN_SOURCES_PATH, 'utf8');
  const parsed = JSON.parse(raw);

  // Normalize to object records (handles any lingering bare-string entries too)
  const records = parsed.map(entry =>
    typeof entry === 'string'
      ? { url: entry, title: '', description: '', topic: 'Unknown (legacy entry)', firstSeen: 'legacy' }
      : entry
  );

  const needsBackfill = records.filter(r => !r.title);
  console.log(`${records.length} total entries, ${needsBackfill.length} missing a title -> will backfill`);

  let done = 0;
  let succeeded = 0;
  let failed = 0;

  for (const record of records) {
    if (record.title) continue; // already has metadata, skip

    done++;
    process.stdout.write(`[${done}/${needsBackfill.length}] ${record.url} ... `);

    const html = await fetchHtml(record.url);
    if (!html) {
      console.log('FAILED (no response)');
      failed++;
      record.description = record.description || '(Could not fetch summary - page unreachable)';
    } else {
      const title = extractTitle(html);
      const description = extractDescription(html);
      if (title) {
        record.title = title;
        succeeded++;
        console.log('OK');
      } else {
        console.log('OK (no title found)');
      }
      if (description) {
        record.description = description;
      } else if (!record.description) {
        record.description = '(No summary available for this page)';
      }
    }

    await new Promise(r => setTimeout(r, DELAY_BETWEEN_REQUESTS_MS));

    // Save progress every 20 entries in case the job gets interrupted
    if (done % 20 === 0) {
      fs.writeFileSync(KNOWN_SOURCES_PATH, JSON.stringify(records, null, 2));
      console.log(`  (progress saved: ${done}/${needsBackfill.length})`);
    }
  }

  fs.writeFileSync(KNOWN_SOURCES_PATH, JSON.stringify(records, null, 2));
  console.log(`\nBackfill complete: ${succeeded} succeeded, ${failed} failed out of ${needsBackfill.length}`);
  console.log('known_sources.json updated.');
}

main().catch(err => {
  console.error('Fatal error during backfill:', err);
  process.exit(1);
});