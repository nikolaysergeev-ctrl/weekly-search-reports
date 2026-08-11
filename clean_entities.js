#!/usr/bin/env node

/**
 * One-time cleanup script.
 * The earlier metadata backfill only decoded a handful of HTML entities
 * (&amp; &lt; &gt; &quot; &#39; &nbsp;), so titles/descriptions pulled from
 * scientific abstracts and other entity-heavy pages ended up with raw codes
 * like &#8220; (left curly quote), &#961; (Greek rho), &#8201; (thin space),
 * &#8722; (minus sign) still showing.
 *
 * This re-processes the title/description already stored in
 * known_sources.json with a full decoder - no re-fetching needed.
 */

const fs = require('fs');
const path = require('path');

const KNOWN_SOURCES_PATH = path.join(process.cwd(), 'known_sources.json');

// Common named entities beyond the basics
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
    // Numeric decimal entities: &#8220; -> actual character
    .replace(/&#(\d+);/g, (match, dec) => {
      try { return String.fromCodePoint(parseInt(dec, 10)); }
      catch (e) { return match; }
    })
    // Numeric hex entities: &#x2014; -> actual character
    .replace(/&#x([0-9a-fA-F]+);/g, (match, hex) => {
      try { return String.fromCodePoint(parseInt(hex, 16)); }
      catch (e) { return match; }
    })
    // Named entities: &rsquo; &mdash; etc.
    .replace(/&([a-zA-Z]+);/g, (match, name) => {
      return NAMED_ENTITIES.hasOwnProperty(name) ? NAMED_ENTITIES[name] : match;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function main() {
  console.log('Cleaning HTML entities from existing titles/descriptions...');

  const raw = fs.readFileSync(KNOWN_SOURCES_PATH, 'utf8');
  const records = JSON.parse(raw);

  let changed = 0;

  for (const record of records) {
    const originalTitle = record.title || '';
    const originalDesc = record.description || '';

    const cleanTitle = decodeHtmlEntities(originalTitle);
    const cleanDesc = decodeHtmlEntities(originalDesc);

    if (cleanTitle !== originalTitle || cleanDesc !== originalDesc) {
      record.title = cleanTitle;
      record.description = cleanDesc;
      changed++;
    }
  }

  fs.writeFileSync(KNOWN_SOURCES_PATH, JSON.stringify(records, null, 2));
  console.log(`Done. ${changed} entries had entities cleaned up, out of ${records.length} total.`);
}

main();