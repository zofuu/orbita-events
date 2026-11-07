// Проверка SEO публичных страниц и сетевого адреса: node scripts/seo-check.js [базовый адрес] [json]
const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const pages = ['/', '/events', '/events/3', '/categories/it', '/about', '/contacts'];
const out = [];
for (const p of pages) {
  const r = await fetch(base + p);
  const t = await r.text();
  const title = /<title>([^<]*)<\/title>/.exec(t)?.[1] ?? '';
  const desc = /name="description" content="([^"]*)"/.exec(t)?.[1] ?? '';
  const imgs = [...t.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  out.push({
    page: p, status: r.status, title, titleLen: title.length, descLen: desc.length,
    h1: (t.match(/<h1\b/g) ?? []).length, canonical: /rel="canonical"/.test(t), og: /property="og:title"/.test(t), jsonld: /ld\+json/.test(t),
    images: imgs.length, imagesWithAlt: imgs.filter((i) => /\balt="/.test(i)).length,
    noindex: /name="robots" content="noindex/.test(t),
  });
}
const robots = await (await fetch(base + '/robots.txt')).text();
const sm = await (await fetch(base + '/sitemap.xml')).text();
const priv = [];
for (const p of ['/account', '/organizer', '/login']) { const t = await (await fetch(base + p)).text(); priv.push({ page: p, noindex: /noindex/.test(t), inRobots: new RegExp(`Disallow: ${p}`).test(robots) }); }
const res = { base, pages: out, privatePages: priv, sitemapUrls: (sm.match(/<loc>/g) ?? []).length, robotsHasSitemap: /Sitemap:/.test(robots) };
console.log(JSON.stringify(res, null, 2));
if (process.argv[3]) (await import('node:fs')).writeFileSync(process.argv[3], JSON.stringify(res, null, 2));
