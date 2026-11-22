#!/usr/bin/env node
/**
 * Abstract backfill + master.html rebuild.
 * Reads known_sources.json, adds record.abstract (full abstract) + record.abstractSource,
 * then rewrites reports/master.html with the full abstracts (collapsible).
 *
 * Resolution order per entry:
 *   1. Europe PMC by PMID (pubmed URL) / PMCID (PMC URL) / DOI (parsed from URL)
 *   2. Page fetch -> citation_doi (retry Europe PMC) or citation_abstract / og:description
 *   3. Europe PMC exact-title search (title similarity >= 0.85)
 * Entries with no abstract keep their snippet and are marked abstractSource:"none".
 *
 * Env: LIMIT=n (test run), FORCE=1 (retry "none" entries), OUTPUT_DIR (default ./reports)
 * Safe to re-run: entries with an abstract are skipped.
 */
const fs = require('fs');
const path = require('path');

const KS = path.join(process.cwd(), 'known_sources.json');
const OUT = process.env.OUTPUT_DIR || './reports';
const LIMIT = parseInt(process.env.LIMIT || '0', 10);
const FORCE = process.env.FORCE === '1';
const EPMC = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', times: '×', deg: '°', plusmn: '±', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ' };
const decode = t => (t || '')
  .replace(/&#(\d+);/g, (m, d) => { try { return String.fromCodePoint(+d); } catch { return m; } })
  .replace(/&#x([0-9a-f]+);/gi, (m, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return m; } })
  .replace(/&([a-z]+);/gi, (m, n) => ENT[n] ?? m);
const clean = t => decode((t || '').replace(/<\/(h\d|title)>/gi, ': ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').replace(/\s+([.,;:)])/g, '$1').replace(/:\s*:/g, ':').trim();
const norm = t => (t || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const stripSite = t => (t || '').replace(/\s+[|–—-]\s+[^|–—-]{2,40}$/, '').trim();
const sim = (a, b) => { const A = new Set(norm(a).split(' ')), B = new Set(norm(b).split(' ')); const i = [...A].filter(x => B.has(x)).length; return i / (A.size + B.size - i || 1); };

async function get(url, ms = 12000, accept) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept || '*/*' }, redirect: 'follow', signal: AbortSignal.timeout(ms) });
    if (!r.ok) return null;
    const t = await r.text();
    return t.slice(0, 600000);
  } catch { return null; }
}

function idsFromUrl(url) {
  let u = url; try { u = decodeURIComponent(url); } catch {}
  const o = {};
  let m;
  if ((m = u.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/))) o.pmid = m[1];
  if ((m = u.match(/\/(PMC\d+)/i))) o.pmcid = m[1].toUpperCase();
  if ((m = u.match(/nature\.com\/articles\/(s\d{5}-\d{3}-\d{5}-\w)/))) o.doi = '10.1038/' + m[1];
  else if ((m = u.match(/(10\.\d{4,9}\/[^\s?#"<>]+)/))) o.doi = m[1].replace(/[.,;)\]]+$/, '').replace(/\/(full|abstract|pdf|epdf)$/i, '');
  return o;
}

async function epmc(query) {
  const j = await get(`${EPMC}?query=${encodeURIComponent(query)}&resultType=core&format=json&pageSize=3`, 15000, 'application/json');
  if (!j) return null;
  try { return JSON.parse(j).resultList.result || []; } catch { return null; }
}
const abs = r => (r && r.abstractText ? clean(r.abstractText) : '');

async function viaEpmc(ids, title) {
  const tries = [];
  if (ids.pmid) tries.push(`EXT_ID:${ids.pmid} AND SRC:MED`);
  if (ids.pmcid) tries.push(`PMCID:${ids.pmcid}`);
  if (ids.doi) tries.push(`DOI:"${ids.doi}"`);
  for (const q of tries) {
    const res = await epmc(q); await sleep(250);
    const a = res && res.map(abs).find(x => x.length > 150);
    if (a) return a;
  }
  if (title) {
    const t = stripSite(title);
    const res = await epmc(`TITLE:"${t.replace(/"/g, '')}"`); await sleep(250);
    const hit = res && res.find(r => sim(r.title, t) >= 0.85 && abs(r).length > 150);
    if (hit) return abs(hit);
  }
  return '';
}

function metaAll(html, names) {
  const out = [];
  for (const n of names) {
    const re1 = new RegExp(`<meta[^>]+(?:name|property)=["']${n}["'][^>]+content=["']([^"']*)["']`, 'ig');
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${n}["']`, 'ig');
    for (const re of [re1, re2]) { let m; while ((m = re.exec(html))) out.push(clean(m[1])); }
  }
  return out;
}

async function resolve(rec) {
  const ids = idsFromUrl(rec.url);
  let a = await viaEpmc(ids, null);
  if (a) return { a, s: 'europepmc' };

  const html = await get(rec.url, 10000, 'text/html,application/xhtml+xml'); await sleep(900);
  if (html) {
    const doi = (metaAll(html, ['citation_doi', 'dc.identifier'])[0] || '').replace(/^doi:/i, '').match(/10\.\d{4,9}\/\S+/);
    if (doi && doi[0] !== ids.doi) { a = await viaEpmc({ doi: doi[0] }, null); if (a) return { a, s: 'europepmc' }; }
    const pm = metaAll(html, ['citation_pmid'])[0];
    if (pm && pm !== ids.pmid) { a = await viaEpmc({ pmid: pm }, null); if (a) return { a, s: 'europepmc' }; }
    const ld = [...html.matchAll(/"(?:abstract|description)"\s*:\s*"((?:[^"\\]|\\.){250,})"/g)].map(m => clean(m[1].replace(/\\n/g, ' ').replace(/\\"/g, '"')));
    const cand = [...metaAll(html, ['citation_abstract', 'dc.description', 'description', 'og:description']), ...ld]
      .filter(x => x.length >= 250 && !/^\(/.test(x)).sort((x, y) => y.length - x.length)[0];
    if (cand && cand.length > (rec.description || '').length + 40) return { a: cand, s: 'page' };
  }
  a = await viaEpmc({}, rec.title);
  if (a) return { a, s: 'europepmc-title' };
  return null;
}

const esc = t => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const TOPIC_ORDER = ['Longevity Science & Aging Biomarkers', 'Regenerative Medicine & Peptides', 'AI/ML in Precision Health', 'Microbiome Research', 'Obesity Medicine & GLP-1/GIPR Therapies'];

function renderMaster(recs, version) {
  const by = new Map();
  for (const r of recs) { const t = r.topic || 'Unclassified (needs review)'; if (!by.has(t)) by.set(t, []); by.get(t).push(r); }
  const topics = [...TOPIC_ORDER.filter(t => by.has(t)), ...[...by.keys()].filter(t => !TOPIC_ORDER.includes(t))];
  const withAbs = recs.filter(r => r.abstract).length;
  const sec = topics.map(t => {
    const items = by.get(t).map((r, i) => {
      const text = r.abstract || r.description || '';
      const short = text.length > 260 ? text.slice(0, 260).replace(/\s+\S*$/, '') + '…' : text;
      const body = r.abstract && r.abstract.length > 260
        ? `<details><summary>${esc(short)}</summary><p>${esc(r.abstract)}</p></details>`
        : `<p class="d">${esc(text)}</p>`;
      return `<div class="r"><b>${i + 1}</b><div><h4>${esc(r.title || r.url)}</h4><div class="m">${esc(r.publishedDate || '')}${r.abstract ? ' &middot; full abstract' : ''}</div>${body}<a href="${esc(r.url)}" target="_blank">${esc(r.url)}</a></div></div>`;
    }).join('');
    return `<h2>${esc(t)} <small>(${by.get(t).length})</small></h2>${items}`;
  }).join('');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Master Source Index v${version}</title><style>
body{font-family:-apple-system,Arial,sans-serif;background:#f0f2ff;padding:40px}.c{max-width:900px;margin:auto;background:#fff;padding:30px;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.1)}
h2{color:#667eea;margin:25px 0 15px}h2 small{color:#999;font-weight:400}.r{display:flex;gap:12px;background:#f9f9f9;padding:15px;border-left:4px solid #667eea;border-radius:6px;margin-bottom:10px}
.r>b{flex:none;width:26px;height:26px;background:#667eea;color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.85em}
h4{margin:0 0 4px}.m{color:#999;font-size:.78em;font-weight:600;text-transform:uppercase;margin-bottom:4px}p,summary{color:#555;font-size:.92em;line-height:1.4}p{margin:6px 0}summary{cursor:pointer}
a{color:#667eea;font-size:.85em;word-break:break-all}</style></head><body><div class="c"><h1>📚 Master Source Index <small style="font-size:.5em;color:#999">v${version}</small></h1>
<p>${recs.length} sources &middot; ${withAbs} with full abstracts &middot; Generated ${new Date().toISOString().slice(0, 10)}</p>${sec}</div></body></html>`;
}

async function main() {
  const recs = JSON.parse(fs.readFileSync(KS, 'utf8'));
  const todo = recs.filter(r => !r.abstract && (FORCE || !r.abstractSource));
  const run = LIMIT ? todo.slice(0, LIMIT) : todo;
  console.log(`${recs.length} entries, ${todo.length} need abstracts, running ${run.length}`);
  const stat = {}; let n = 0;
  for (const r of run) {
    n++;
    const res = await resolve(r);
    if (res) { r.abstract = res.a; r.abstractSource = res.s; } else { r.abstractSource = 'none'; }
    stat[r.abstractSource] = (stat[r.abstractSource] || 0) + 1;
    console.log(`[${n}/${run.length}] ${r.abstractSource.padEnd(15)} ${r.url}`);
    if (n % 20 === 0) fs.writeFileSync(KS, JSON.stringify(recs, null, 2));
  }
  fs.writeFileSync(KS, JSON.stringify(recs, null, 2));
  fs.mkdirSync(OUT, { recursive: true });
  const verFile = path.join(OUT, '.master_version');
  const version = (fs.existsSync(verFile) ? parseInt(fs.readFileSync(verFile, 'utf8'), 10) || 1 : 1) + 1;
  fs.writeFileSync(verFile, String(version));
  fs.writeFileSync(path.join(OUT, 'master.html'), renderMaster(recs, version));
  console.log('\nResults:', stat, `| total with abstract: ${recs.filter(r => r.abstract).length}/${recs.length} | master.html v${version}`);
}
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { idsFromUrl, clean, renderMaster, sim, stripSite };
