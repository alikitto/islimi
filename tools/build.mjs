// Сборка страниц каталога из одного шаблона.
//
//   node tools/build.mjs          — собрать index.html, uzukler.html, … , sitemap.xml
//                                   и обновить ?v=<хэш> CSS/JS в них и в 404.html
//   node tools/build.mjs --check  — только проверить, что собранные файлы актуальны
//
// Шаблон: tools/page.html, данные страниц: tools/pages.json. Без зависимостей (Node 18+).
// Готовые HTML лежат в репозитории — Cloudflare Pages выкладывает их как есть.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://catalog.islimi.az';
const CHECK = process.argv.includes('--check');

const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const hash = (f) => createHash('md5').update(readFileSync(join(ROOT, f))).digest('hex').slice(0, 8);
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const css = hash('assets/catalog.css');
const js = hash('assets/catalog.js');
const template = read('tools/page.html');
const pages = JSON.parse(read('tools/pages.json'));

const out = new Map(); // файл → содержимое

for (const page of pages) {
  const home = !page.slug;
  const vars = {
    title: escAttr(page.title),
    description: escAttr(page.description),
    url: `${SITE}/${page.slug}`,
    bodyClass: home ? 'is-home' : 'is-cat',
    homeHidden: home ? '' : ' hidden',
    sortHidden: home ? ' hidden' : '', // на главной сортировка появляется только в поиске
    eyebrow: home ? 'Yeni kolleksiya' : 'Kataloq',
    h: home ? 'h2' : 'h1', // на главной h1 — в первом экране
    heading: escAttr(page.heading),
    css,
    js,
  };
  const html = template.replace(/\{\{([\w:]+)\}\}/g, (m, key) => {
    if (key.startsWith('current:')) return key.slice(8) === page.slug ? ' aria-current="page"' : '';
    if (!(key in vars)) throw new Error(`Неизвестная метка ${m} в tools/page.html`);
    return vars[key];
  });
  out.set(page.file, html);
}

// 404.html собирается вручную, здесь только хэш стилей
out.set('404.html', read('404.html').replace(/catalog\.css\?v=[0-9a-f]+/g, `catalog.css?v=${css}`));

out.set('sitemap.xml', [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...pages.map((p) => `  <url><loc>${SITE}/${p.slug}</loc></url>`),
  '</urlset>',
  '',
].join('\n'));

let stale = [];
for (const [file, content] of out) {
  let current = null;
  try { current = read(file); } catch { /* файла ещё нет */ }
  if (current === content) continue;
  stale.push(file);
  if (!CHECK) writeFileSync(join(ROOT, file), content);
}

if (CHECK) {
  if (stale.length) {
    console.error(`Устарели: ${stale.join(', ')}\nЗапустите: node tools/build.mjs`);
    process.exit(1);
  }
  console.log(`Всё собрано (css ${css}, js ${js}).`);
} else {
  console.log(stale.length ? `Обновлены: ${stale.join(', ')}` : 'Без изменений.');
  console.log(`css ${css}, js ${js}`);
}
