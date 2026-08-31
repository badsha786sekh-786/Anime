// generate-anime-pages.mjs
//
// Ye script AniList se top popular + trending anime ka data leti hai, aur har
// anime ke liye ek ALAG static HTML page banati hai (JavaScript ke bina bhi
// pura content dikhta hai) — taaki Google har anime ko individually crawl aur
// index kar sake. Ye GitHub Actions se daily automatically chalti hai.
//
// Output: /anime/<slug>-<id>.html  (ek file per anime)
//         /anime/index.html        (sabhi anime ki list, links ke saath)
//         /sitemap.xml             (Google ko sabhi URLs batane ke liye)
//
// Kuch bhi manually chalane ki zaroorat nahi — GitHub Actions workflow
// (.github/workflows/generate-pages.yml) ise apne aap chalata hai.

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const SITE_URL = 'https://anime.is-cool.dev';
const OUT_DIR = path.join(process.cwd(), 'anime');
const PAGE_COUNT = 5;      // AniList se kitne "pages" fetch karne hain
const PER_PAGE = 40;       // har page mein kitne anime (max ~50 AniList allow karta hai)

const API = 'https://graphql.anilist.co';

const QUERY = `
  query ($page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) {
      media(sort: POPULARITY_DESC, type: ANIME) {
        id
        title { romaji english native }
        coverImage { extraLarge large }
        bannerImage
        averageScore
        episodes
        format
        status
        genres
        description(asHtml: false)
        startDate { year }
        studios(isMain: true) { nodes { name } }
      }
    }
  }
`;

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function slugify(title) {
  return String(title || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'untitled';
}

async function fetchAllAnime() {
  const all = [];
  const seen = new Set();
  for (let page = 1; page <= PAGE_COUNT; page++) {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { page, perPage: PER_PAGE } }),
    });
    if (!res.ok) {
      console.error(`AniList request failed on page ${page}: HTTP ${res.status}`);
      break;
    }
    const json = await res.json();
    const media = json?.data?.Page?.media || [];
    if (media.length === 0) break;
    for (const m of media) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        all.push(m);
      }
    }
    // AniList free API: be polite between calls.
    await new Promise((r) => setTimeout(r, 700));
  }
  return all;
}

function pageHTML(m) {
  const title = m.title?.english || m.title?.romaji || m.title?.native || 'Untitled';
  const img = m.coverImage?.extraLarge || m.coverImage?.large || '';
  const synopsis = (m.description || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').slice(0, 300);
  const genres = (m.genres || []).join(', ');
  const studio = (m.studios?.nodes || []).map((s) => s.name).join(', ') || 'Unknown';
  const year = m.startDate?.year || '—';
  const score = m.averageScore != null ? (m.averageScore / 10).toFixed(1) : '—';
  const episodes = m.episodes || '—';
  const url = `${SITE_URL}/anime/${slugify(title)}-${m.id}.html`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'TVSeries',
    name: title,
    image: img,
    description: synopsis,
    genre: m.genres || [],
    datePublished: m.startDate?.year ? String(m.startDate.year) : undefined,
    numberOfEpisodes: m.episodes || undefined,
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} — Watch Guide, Info &amp; Episodes | BOSS Anime Club</title>
<meta name="description" content="${esc(title)} (${esc(year)}) — ${esc(synopsis.slice(0, 150))}">
<link rel="canonical" href="${url}">
<meta property="og:title" content="${esc(title)} — BOSS Anime Club">
<meta property="og:description" content="${esc(synopsis.slice(0, 200))}">
<meta property="og:image" content="${esc(img)}">
<meta property="og:type" content="video.tv_show">
<meta property="og:url" content="${url}">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>
  body{background:#0E1116;color:#F4F1EA;font-family:sans-serif;max-width:720px;margin:0 auto;padding:24px 16px 60px;line-height:1.6;}
  a{color:#FFB454;}
  img{max-width:220px;border-radius:4px;display:block;margin-bottom:16px;}
  .tag{display:inline-block;font-size:12px;border:1px solid #2A3140;border-radius:2px;padding:2px 8px;margin:2px 4px 2px 0;color:#8B93A7;}
  .meta{font-size:14px;color:#8B93A7;margin-bottom:16px;}
  .backlink{margin-top:32px;display:block;}
</style>
</head>
<body>
<h1>${esc(title)}</h1>
<img src="${esc(img)}" alt="${esc(title)} cover" loading="lazy">
<div class="meta">Score: ${esc(score)}/10 &nbsp;·&nbsp; Episodes: ${esc(episodes)} &nbsp;·&nbsp; Year: ${esc(year)} &nbsp;·&nbsp; Studio: ${esc(studio)}</div>
<div>${(m.genres || []).map((g) => `<span class="tag">${esc(g)}</span>`).join('')}</div>
<p>${esc(synopsis) || 'No synopsis available.'}</p>
<a class="backlink" href="${SITE_URL}/">▸ Open in the BOSS Anime Club app to search, save playlists, and listen to narration</a>
<a class="backlink" href="${SITE_URL}/anime/index.html">▸ Browse all anime</a>
</body>
</html>`;
}

function indexHTML(list) {
  const rows = list
    .map((m) => {
      const title = m.title?.english || m.title?.romaji || 'Untitled';
      const slug = slugify(title);
      return `<li><a href="./${slug}-${m.id}.html">${esc(title)}</a></li>`;
    })
    .join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Browse All Anime | BOSS Anime Club</title>
<meta name="description" content="Browse the full list of anime on BOSS Anime Club — info, episodes, genres and more.">
<link rel="canonical" href="${SITE_URL}/anime/index.html">
<style>
  body{background:#0E1116;color:#F4F1EA;font-family:sans-serif;max-width:720px;margin:0 auto;padding:24px 16px 60px;}
  a{color:#FFB454;text-decoration:none;}
  li{margin-bottom:8px;}
</style>
</head>
<body>
<h1>Browse All Anime</h1>
<p><a href="${SITE_URL}/">← Back to BOSS Anime Club</a></p>
<ul>
${rows}
</ul>
</body>
</html>`;
}

function sitemapXML(list) {
  const urls = list
    .map((m) => {
      const title = m.title?.english || m.title?.romaji || 'Untitled';
      const slug = slugify(title);
      return `  <url><loc>${SITE_URL}/anime/${slug}-${m.id}.html</loc></url>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE_URL}/</loc><priority>1.0</priority></url>
  <url><loc>${SITE_URL}/anime/index.html</loc><priority>0.8</priority></url>
${urls}
</urlset>`;
}

async function main() {
  console.log('Fetching anime list from AniList...');
  const list = await fetchAllAnime();
  console.log(`Fetched ${list.length} anime.`);

  await mkdir(OUT_DIR, { recursive: true });

  for (const m of list) {
    const title = m.title?.english || m.title?.romaji || 'Untitled';
    const slug = slugify(title);
    const filePath = path.join(OUT_DIR, `${slug}-${m.id}.html`);
    await writeFile(filePath, pageHTML(m), 'utf8');
  }

  await writeFile(path.join(OUT_DIR, 'index.html'), indexHTML(list), 'utf8');
  await writeFile(path.join(process.cwd(), 'sitemap.xml'), sitemapXML(list), 'utf8');

  console.log(`Done. Generated ${list.length} anime pages + index + sitemap.xml.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

