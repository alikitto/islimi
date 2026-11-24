// Islimi — каталог. Общий скрипт для всех страниц каталога.
// Данные: Worker upload-to-r2 → /api/items (D1). Категория страницы берётся из адреса.
(() => {
  'use strict';

  const API_BASE = new URLSearchParams(location.search).has('localapi')
    ? 'http://localhost:8787'                      // локальный wrangler dev: открыть страницу с ?localapi
    : 'https://upload-to-r2.ramizagayev122.workers.dev';
  const API_URL = API_BASE + '/api/items';
  const WA_NUMBER = '994702920323';
  const SITE_URL = 'https://catalog.islimi.az';

  const CATS = [
    { slug: '', name: 'Yeni', title: 'Yeni gələnlər', doc: 'Yeni | Kataloq — Islimi Jewelry' },
    { slug: 'uzukler', name: 'Üzüklər' },
    { slug: 'sirqalar', name: 'Sırgalar' },
    { slug: 'qolbaqlar', name: 'Qolbaqlar' },
    { slug: 'boyunbagilar', name: 'Boyunbağılar' },
  ];
  const HOME_LIMIT = 24;   // сколько товаров на главной («Yeni»)
  const PAGE_SIZE = 12;    // сколько карточек добавлять за раз
  const NEW_DAYS = 30;     // бейдж «Yeni» в категориях — для товаров моложе N дней

  const $ = (sel, root = document) => root.querySelector(sel);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const el = {
    grid: $('#grid'),
    status: $('#status'),
    more: $('#more'),
    sentinel: $('#sentinel'),
    title: $('#pageTitle'),
    meta: $('#pageMeta'),
    search: $('#search'),
    searchClear: $('#searchClear'),
    cats: $('#cats'),
    header: $('#header'),
    eyebrow: $('#pageEyebrow'),
    catalog: $('#catalog'),
    tiles: $('#tiles'),
    hero: $('#hero'),
    statTotal: $('#statTotal'),
    statUpdated: $('#statUpdated'),
    toTop: $('#toTop'),
    toast: $('#toast'),
    lb: $('#lb'),
    lbVideo: $('#lbVideo'),
    lbCat: $('#lbCat'),
    lbCode: $('#lbCode'),
    lbDate: $('#lbDate'),
    lbWa: $('#lbWa'),
    lbFull: $('#lbFull'),
    lbShare: $('#lbShare'),
    lbPrev: $('#lbPrev'),
    lbNext: $('#lbNext'),
    lbCounter: $('#lbCounter'),
  };

  const state = {
    items: [],      // все товары, новые первыми
    updated: null,
    stamp: '',      // метка версии каталога (data.updated), чтобы не перерисовывать тот же
    cat: null,
    list: [],       // товары текущего вида (категория + поиск)
    shown: 0,
    query: '',
    lbList: [],
    lbIndex: -1,
    loaded: false,
  };

  // ---------- Утилиты ----------

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[\s\-_.]/g, '');

  // Месяцы вручную: не во всех браузерах есть локаль «az» (Chrome показывает «2026 M11 23»)
  const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avqust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr'];
  const MONTHS_SHORT = ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avq', 'sen', 'okt', 'noy', 'dek'];
  const fmtDate = (d) => (d && !isNaN(d) ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : '');

  const waLink = (code) => `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(`Salam! Kod ${code}`)}`;
  const itemUrl = (item) => `${SITE_URL}/${slugOf(item.category)}#${encodeURIComponent(item.code)}`;
  const slugOf = (category) => (CATS.find((c) => c.name === category) || CATS[0]).slug;

  const plural = (n) => `${n} məhsul`;

  const ICON = {
    wa: '<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.08-.3-.15-1.26-.47-2.39-1.48-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.21 3.07.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.7.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2-1.41.25-.7.25-1.29.18-1.42-.08-.12-.28-.2-.57-.35M12.05 21.79h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.89-9.88 2.64 0 5.12 1.03 6.99 2.9a9.83 9.83 0 0 1 2.89 6.99c0 5.45-4.44 9.88-9.88 9.88m8.41-18.3A11.82 11.82 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.69 1.45c6.55 0 11.89-5.34 11.89-11.89 0-3.18-1.24-6.17-3.48-8.42"/></svg>',
    play: '<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
    eye: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/></svg>',
  };
  const DIAMOND = '<span class="diamond" aria-hidden="true"></span>';

  // ---------- Тосты ----------

  let toastTimer;
  function toast(text) {
    el.toast.textContent = text;
    el.toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('is-visible'), 1800);
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch { /* ignore */ }
      ta.remove(); return ok;
    }
  }

  // ---------- Маршрутизация (без перезагрузки между категориями) ----------

  function catFromPath(pathname) {
    const s = decodeURIComponent(pathname).replace(/^\/+|\/+$/g, '').replace(/\.html$/i, '').toLowerCase();
    return CATS.find((c) => c.slug === s) || CATS[0];
  }

  function setCategory(cat) {
    state.cat = cat;
    const home = !cat.slug;
    document.body.classList.toggle('is-home', home);
    document.body.classList.toggle('is-cat', !home);
    document.querySelectorAll('.home-only').forEach((n) => { n.hidden = !home; });
    el.eyebrow.innerHTML = DIAMOND + (home ? 'Yeni kolleksiya' : 'Kataloq');
    el.title.textContent = cat.title || cat.name;
    document.title = cat.doc || `${cat.name} | Kataloq — Islimi Jewelry`;
    el.cats.querySelectorAll('.chip').forEach((chip) => {
      if (chip.dataset.slug === cat.slug) chip.setAttribute('aria-current', 'page');
      else chip.removeAttribute('aria-current');
    });
    const active = el.cats.querySelector('[aria-current="page"]');
    if (active && el.cats.scrollWidth > el.cats.clientWidth) {
      const left = active.offsetLeft - (el.cats.clientWidth - active.offsetWidth) / 2;
      el.cats.scrollTo({ left, behavior: state.loaded ? 'smooth' : 'auto' });
    }
    movePill(state.loaded && !reduceMotion);
  }

  // Золотая «таблетка» под выбранной категорией: плавно переезжает между пунктами
  const pill = el.cats.querySelector('.cats__pill');
  function movePill(animate) {
    const active = el.cats.querySelector('.chip[aria-current="page"]');
    if (!pill || !active) return;
    if (!animate) pill.style.transition = 'none';
    pill.style.width = active.offsetWidth + 'px';
    pill.style.height = active.offsetHeight + 'px';
    pill.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
    el.cats.classList.add('has-pill');
    if (!animate) { void pill.offsetWidth; pill.style.transition = ''; }
  }
  if (pill && 'ResizeObserver' in window) {
    // ширина пунктов меняется при загрузке шрифта и смене размера окна
    const ro = new ResizeObserver(() => movePill(false));
    el.cats.querySelectorAll('.chip').forEach((chip) => ro.observe(chip));
  }

  function applyRoute() {
    const cat = catFromPath(location.pathname);
    if (cat !== state.cat) {
      setCategory(cat);
      if (state.loaded) {
        el.search.value = ''; state.query = ''; el.searchClear.hidden = true;
        render();
      }
    }
    syncLightboxWithHash();
  }

  // Переход по категориям (кнопки в шапке и плитки на главной) — без перезагрузки
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[data-slug]');
    if (!link || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    const cat = CATS.find((c) => c.slug === link.dataset.slug) || CATS[0];
    if (cat === state.cat && !state.query) { scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }); return; }
    history.pushState(null, '', '/' + cat.slug + location.search);
    if (cat === state.cat) { el.search.value = ''; state.query = ''; el.searchClear.hidden = true; render(); }
    else applyRoute();
    scrollTo({ top: 0, behavior: 'auto' });
  });

  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[data-scroll]');
    if (!link) return;
    e.preventDefault();
    el.catalog.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  });

  addEventListener('popstate', applyRoute);

  // ---------- Данные ----------

  function normalize(raw) {
    const list = Array.isArray(raw) ? raw : (raw.items || []);
    return list
      .filter((i) => i && i.code && i.video)
      .map((i) => ({
        id: Number(i.id) || 0,
        code: String(i.code).trim(),
        video: String(i.video).trim(),
        videoSm: String(i.video_sm || '').trim() || String(i.video).trim(), // лёгкая копия 540 px для карточек
        category: String(i.category || '').trim(),
        pin: i.pin === true || Number(i.pin) === 1,
        views: Math.max(0, Number(i.views) || 0),
        created: i.created_at ? new Date(i.created_at) : null,
      }))
      .sort((a, b) => b.id - a.id); // новые первыми
  }

  function computeList() {
    const { cat, items } = state;
    const q = norm(state.query);
    const inCat = cat.slug ? items.filter((i) => i.category === cat.name) : items;
    if (q) return inCat.filter((i) => norm(i.code).includes(q));
    if (cat.slug) return inCat;
    // «Yeni»: закреплённые сверху, затем самые свежие
    return [...items.filter((i) => i.pin), ...items.filter((i) => !i.pin)].slice(0, HOME_LIMIT);
  }

  function updateCounts() {
    el.cats.querySelectorAll('.chip').forEach((chip) => {
      const cat = CATS.find((c) => c.slug === chip.dataset.slug);
      const out = chip.querySelector('.chip__count');
      if (!cat || !cat.slug || !out) return;
      out.textContent = state.items.filter((i) => i.category === cat.name).length || '';
    });
  }

  function updateMeta() {
    if (state.query) {
      el.meta.textContent = state.list.length ? `“${state.query}” üzrə ${state.list.length} nəticə` : '';
      return;
    }
    const parts = [plural(state.list.length)];
    if (state.updated) parts.push(`Yeniləndi ${fmtDate(state.updated)}`);
    el.meta.textContent = parts.join(' · ');
  }

  // ---------- Карточки ----------

  function cardHTML(item, index) {
    const isNew = state.cat.slug && item.created && (Date.now() - item.created) < NEW_DAYS * 864e5;
    const showPin = item.pin && !state.cat.slug && !state.query;
    const badges = [
      showPin ? `<span class="badge badge--pin">${DIAMOND}Seçilmiş</span>` : '',
      isNew ? `<span class="badge">${DIAMOND}Yeni</span>` : '',
    ].join('');
    const code = esc(item.code);
    // Категорию показываем только в смешанных списках («Yeni», поиск) — в разделе она и так понятна
    const showCat = !state.cat.slug || state.query;
    return `
      <article class="card" data-index="${index}" data-id="${item.id}" style="animation-delay:${Math.min(index % PAGE_SIZE, 8) * 40}ms">
        ${badges ? `<div class="badges">${badges}</div>` : ''}
        <button class="card__media media" type="button" aria-label="${code} — videoya bax">
          <video muted playsinline loop preload="none" data-src="${esc(item.videoSm)}"></video>
          <span class="card__view" aria-hidden="true">${ICON.play}Bax</span>
        </button>
        <div class="card__body">
          ${showCat ? `<span class="card__cat">${DIAMOND}${esc(item.category)}</span>` : ''}
          <div class="card__row">
            <span class="card__code">${code}</span>
            ${viewsHTML(item)}
          </div>
        </div>
      </article>`;
  }

  // Просмотры: «128», «1,2 min». Ноль не показываем — у нового товара это выглядит пусто.
  const compact = (() => {
    try { return new Intl.NumberFormat('az', { notation: 'compact', maximumFractionDigits: 1 }); } catch { return null; }
  })();
  const fmtViews = (n) => (n < 1000 || !compact ? String(n) : compact.format(n));
  const viewsWord = (n) => `${n} baxış`;
  function viewsHTML(item) {
    return `<span class="card__views"${item.views ? '' : ' hidden'} title="${viewsWord(item.views)}" aria-label="${viewsWord(item.views)}">${ICON.eye}<span>${fmtViews(item.views)}</span></span>`;
  }

  function skeletonHTML(n) {
    return Array.from({ length: n }, () => `
      <div class="card is-skeleton" aria-hidden="true">
        <div class="card__media"></div>
        <div class="card__body"><div class="card__text"><div class="line" style="width:60%"></div><div class="line" style="width:36%;margin-top:8px"></div></div></div>
      </div>`).join('');
  }

  // Видео: загружаем, когда карточка рядом с экраном; играем, только когда она видна;
  // выгружаем, когда она ушла далеко — иначе при долгой прокрутке в памяти копятся
  // сотни буферов и телефон перезагружает вкладку.
  const mediaOf = (v) => v.closest('.media') || v.parentElement;

  // Пока страницу быстро листают, карточки пролетают мимо — их видео не качаем.
  // Загрузка начнётся, когда прокрутка замедлится, и только у карточек, оставшихся рядом.
  const FAST_SCROLL = 1500; // px/с
  const RECHECK = 150;      // мс
  let lastScroll = 0, lastY = 0, scrollSpeed = 0;
  const flinging = () => performance.now() - lastScroll < 120 && scrollSpeed > FAST_SCROLL;
  const pending = new Map(); // video → таймер загрузки
  function startLoad(v) {
    pending.delete(v);
    if (v.src) return;
    if (flinging()) { pending.set(v, setTimeout(() => startLoad(v), RECHECK)); return; }
    v.preload = 'auto';
    v.src = v.dataset.src;
    loader.unobserve(v);
  }
  const loader = new IntersectionObserver((entries) => {
    for (const { isIntersecting, target: v } of entries) {
      if (v.src) continue;
      if (!isIntersecting) { clearTimeout(pending.get(v)); pending.delete(v); continue; }
      if (!pending.has(v)) startLoad(v);
    }
  }, { rootMargin: '400px 0px' });

  const player = new IntersectionObserver((entries) => {
    for (const { isIntersecting, target: v } of entries) {
      if (isIntersecting && !reduceMotion && !document.hidden && el.lb.hidden) v.play().catch(() => {});
      else v.pause();
    }
  }, { threshold: 0.35 });

  // Запас больше, чем у loader, чтобы видео у края зоны не грузилось и не выгружалось по кругу
  const unloader = new IntersectionObserver((entries) => {
    for (const { isIntersecting, target: v } of entries) {
      if (isIntersecting || !v.src) continue;
      v.pause();
      v.removeAttribute('src');
      v.preload = 'none';
      v.load(); // освобождает буфер и декодер
      mediaOf(v).classList.remove('is-ready');
      loader.observe(v); // загрузится снова, когда карточка вернётся
    }
  }, { rootMargin: '250% 0px' });

  function wireVideo(v) {
    const media = mediaOf(v);
    const ready = () => { if (v.src) media.classList.add('is-ready'); };
    v.addEventListener('loadeddata', ready);
    v.addEventListener('playing', ready);
    v.addEventListener('error', ready);
    loader.observe(v);
    player.observe(v);
    unloader.observe(v);
  }

  function unwireVideo(v) {
    clearTimeout(pending.get(v)); pending.delete(v);
    loader.unobserve(v); player.unobserve(v); unloader.unobserve(v);
    v.removeAttribute('src'); v.load();
  }

  // Заново проверить видимость: player сразу запустит то, что на экране
  function resumeVisible() {
    document.querySelectorAll('main video[data-src]').forEach((v) => { player.unobserve(v); player.observe(v); });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) document.querySelectorAll('main video').forEach((v) => v.pause());
    else if (el.lb.hidden) resumeVisible(); // вернулись из WhatsApp или другой вкладки
  });

  // ---------- Главная: первый экран, плитки категорий, цифры ----------

  function renderHome() {
    const { items } = state;
    el.tiles.querySelectorAll('.tile').forEach((tile) => {
      const cat = CATS.find((c) => c.slug === tile.dataset.slug);
      const inCat = items.filter((i) => i.category === cat.name);
      tile.querySelector('[data-count]').textContent = `${inCat.length} model`;
    });

    el.statTotal.textContent = items.length;
    const d = state.updated;
    el.statUpdated.textContent = d && !isNaN(d) ? `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}` : '—';
    el.hero.classList.remove('is-loading');
  }

  // Плавное появление блоков при прокрутке
  const revealer = new IntersectionObserver((entries) => {
    for (const { isIntersecting, target } of entries) {
      if (!isIntersecting) continue;
      target.classList.add('is-in');
      revealer.unobserve(target);
    }
  }, { rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('.reveal').forEach((n) => revealer.observe(n));

  function appendPage() {
    const next = state.list.slice(state.shown, state.shown + PAGE_SIZE);
    if (!next.length) return;
    const html = next.map((item, i) => cardHTML(item, state.shown + i)).join('');
    el.grid.insertAdjacentHTML('beforeend', html);
    const cards = el.grid.querySelectorAll('.card');
    for (let i = state.shown; i < cards.length; i++) wireVideo(cards[i].querySelector('video'));
    state.shown += next.length;
    el.more.hidden = state.shown >= state.list.length;
    // Наблюдатель срабатывает только при входе в зону. Если метка после догрузки
    // так и осталась у экрана (быстрая прокрутка, высокий экран), нового события
    // не будет — переподписка заставит проверить её ещё раз.
    pager.unobserve(el.sentinel);
    pager.observe(el.sentinel);
  }

  // keep — сколько карточек уже было показано: при обновлении данных сетка не укорачивается
  function render(keep = 0) {
    el.grid.querySelectorAll('video').forEach(unwireVideo);
    el.grid.innerHTML = '';
    el.status.innerHTML = '';
    state.list = computeList();
    state.shown = 0;
    updateMeta();

    if (!state.list.length) {
      el.more.hidden = true;
      if (state.query) {
        const elsewhere = state.cat.slug ? state.items.filter((i) => norm(i.code).includes(norm(state.query))).length : 0;
        el.status.innerHTML = `
          <h2 class="status__title">Heç nə tapılmadı</h2>
          <p>“${esc(state.query)}” kodu ${state.cat.slug ? 'bu kateqoriyada ' : ''}yoxdur.</p>
          ${elsewhere ? `<button class="btn btn--ghost" type="button" data-search-all>Bütün kataloqda ${elsewhere} nəticə — göstər</button>` : ''}`;
      } else {
        el.status.innerHTML = '<h2 class="status__title">Hələ məhsul yoxdur</h2><p>Tezliklə yeniləri əlavə olunacaq.</p>';
      }
      return;
    }
    appendPage();
    while (state.shown < Math.min(keep, state.list.length)) appendPage();
  }

  el.status.addEventListener('click', (e) => {
    if (e.target.closest('[data-search-all]')) {
      const q = state.query;
      history.pushState(null, '', '/' + location.search);
      setCategory(CATS[0]);
      el.search.value = q; state.query = q;
      render();
    }
    if (e.target.closest('[data-retry]')) load();
  });

  el.more.addEventListener('click', appendPage);

  const pager = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && state.loaded && state.shown < state.list.length) appendPage();
  }, { rootMargin: '800px 0px' });
  pager.observe(el.sentinel);

  el.grid.addEventListener('click', (e) => {
    const card = e.target.closest('.card[data-index]');
    if (card) openLightbox(state.list, Number(card.dataset.index));
  });

  // ---------- Поиск ----------

  let searchTimer;
  el.search.addEventListener('input', () => {
    el.searchClear.hidden = !el.search.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const q = el.search.value.trim();
      if (q === state.query) return;
      state.query = q;
      if (state.loaded) render();
    }, 150);
  });
  el.search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') el.search.blur();
    if (e.key === 'Escape' && el.search.value) { el.search.value = ''; el.search.dispatchEvent(new Event('input')); }
  });
  el.searchClear.addEventListener('click', () => {
    el.search.value = '';
    el.search.dispatchEvent(new Event('input'));
    el.search.focus();
  });

  // ---------- Просмотр товара ----------

  let lastFocus = null;

  // Окно открывается мгновенно: сверху сразу играет лёгкая копия (она уже скачана
  // для карточки), под ней грузится полное видео и, когда готово, плавно её сменяет
  // с того же момента ролика.
  const lbLow = document.createElement('video');
  lbLow.className = 'lb__low';
  lbLow.muted = true; lbLow.loop = true; lbLow.playsInline = true;
  lbLow.setAttribute('playsinline', '');
  lbLow.setAttribute('aria-hidden', 'true');
  el.lbVideo.after(lbLow);
  let lbToken = 0;

  // Плашка «грузится оригинал» поверх видео; появляется, только если ждать заметно
  const lbLoading = document.createElement('div');
  lbLoading.className = 'lb__loading';
  lbLoading.setAttribute('role', 'status');
  lbLoading.innerHTML = '<span class="lb__spin" aria-hidden="true"></span>Orijinal video yüklənir…';
  lbLow.after(lbLoading);
  let loadingTimer = 0;
  function setLoading(on) {
    clearTimeout(loadingTimer);
    if (on) loadingTimer = setTimeout(() => lbLoading.classList.add('is-on'), 250);
    else lbLoading.classList.remove('is-on');
  }

  let lbAbort = null; // снимает обработчики прошлого товара

  function clearLow() {
    if (lbAbort) { lbAbort.abort(); lbAbort = null; }
    lbLow.classList.remove('is-on');
    lbLow.pause();
    lbLow.removeAttribute('src');
    lbLow.load();
  }

  // Сколько секунд уже скачано вперёд от момента t
  function bufferedAhead(v, t) {
    for (let i = 0; i < v.buffered.length; i++) {
      if (v.buffered.start(i) <= t + 0.1 && v.buffered.end(i) >= t) return v.buffered.end(i) - t;
    }
    return 0;
  }

  // Полное видео показываем, только когда браузер уверен, что оно доиграет без
  // остановок (canplaythrough). Если оно всё же застрянет (медленный интернет),
  // поверх снова идёт лёгкая копия с плашкой — картинка не замирает.
  function setLightboxVideo(item) {
    const token = ++lbToken;
    clearLow();
    stopWarm();
    const v = el.lbVideo;
    const mine = () => token === lbToken;
    setLoading(true);
    v.src = item.video;
    v.play().catch(() => {});

    if (item.videoSm === item.video) { // лёгкой копии нет — просто ждём само видео
      v.addEventListener('playing', () => { if (mine()) setLoading(false); }, { once: true });
      v.addEventListener('error', () => { if (mine()) setLoading(false); }, { once: true });
      return;
    }

    lbAbort = new AbortController();
    const on = { signal: lbAbort.signal };
    let full = false;   // сейчас видно полное видео
    let swapping = false;

    lbLow.src = item.videoSm;
    lbLow.classList.add('is-on');
    lbLow.play().catch(() => {});

    const showFull = () => {
      if (!mine() || full || swapping || v.readyState < 4) return;
      swapping = true;
      const finish = () => {
        swapping = false;
        if (!mine()) return;
        full = true;
        v.play().catch(() => {});
        setLoading(false);
        lbLow.classList.remove('is-on');
        setTimeout(() => { if (mine() && full) lbLow.pause(); }, 400); // после затухания
      };
      // Догоняем лёгкую копию, только если этот кусок полного видео уже скачан
      const t = lbLow.currentTime;
      if (Math.abs(v.currentTime - t) > 0.15 && bufferedAhead(v, t) > 1) {
        v.addEventListener('seeked', finish, { once: true, signal: lbAbort.signal });
        v.currentTime = t;
      } else finish();
    };

    const showLow = () => {
      if (!mine() || !full || v.seeking) return;
      full = false;
      lbLow.currentTime = v.currentTime;
      lbLow.play().catch(() => {});
      lbLow.classList.add('is-on');
      setLoading(true);
    };

    v.addEventListener('canplaythrough', showFull, on);
    v.addEventListener('progress', showFull, on); // на случай, если canplaythrough уже был
    v.addEventListener('waiting', showLow, on);
    v.addEventListener('stalled', () => { if (v.readyState < 3) showLow(); }, on);
    // Полное видео не загрузилось — остаётся лёгкая копия, плашку убираем
    v.addEventListener('error', () => { if (mine()) setLoading(false); }, on);
  }

  // На компьютере полное видео начинаем качать заранее, пока курсор над карточкой
  const warm = document.createElement('video');
  warm.muted = true;
  let warmTimer = 0;
  function stopWarm() {
    clearTimeout(warmTimer);
    if (!warm.src) return;
    warm.removeAttribute('src');
    warm.load();
  }
  el.grid.addEventListener('pointerover', (e) => {
    const media = e.target.closest('.card[data-index]');
    if (!media || e.pointerType !== 'mouse' || media.contains(e.relatedTarget)) return;
    clearTimeout(warmTimer);
    warmTimer = setTimeout(() => {
      const item = state.list[Number(media.dataset.index)];
      if (!item || item.videoSm === item.video || warm.src === item.video) return;
      warm.preload = 'auto';
      warm.src = item.video;
    }, 200);
  });
  el.grid.addEventListener('pointerout', (e) => {
    const media = e.target.closest('.card[data-index]');
    if (media && !media.contains(e.relatedTarget)) clearTimeout(warmTimer);
  });

  function showLightboxMeta(item) {
    const parts = [];
    if (item.created) parts.push(`Əlavə olunub: ${fmtDate(item.created)}`);
    if (item.views) parts.push(viewsWord(item.views));
    el.lbDate.textContent = parts.join(' · ');
  }

  // Просмотр = открытие окна товара. Браузер засчитывает товар раз в сутки
  // (сервер ещё раз проверяет по IP), открытия из админки не считаются.
  const VIEWED_KEY = 'islimi-viewed';
  function countView(item) {
    if (!item.id) return;
    let seen = {};
    try {
      if (localStorage.getItem('islimi-session')) return; // это владелец каталога
      seen = JSON.parse(localStorage.getItem(VIEWED_KEY) || '{}') || {};
    } catch { /* без хранилища считаем каждый раз — сервер всё равно отсеет повторы */ }
    const now = Date.now();
    for (const id in seen) if (now - seen[id] > 864e5) delete seen[id];
    if (seen[item.id]) return;
    seen[item.id] = now;
    try { localStorage.setItem(VIEWED_KEY, JSON.stringify(seen)); } catch {}
    fetch(`${API_BASE}/api/items/${item.id}/view`, { method: 'POST', mode: 'no-cors', keepalive: true }).catch(() => {});
    item.views += 1;
    paintViews(item);
  }

  // Обновить счётчик просмотров на уже нарисованных карточках товара
  function paintViews(item) {
    el.grid.querySelectorAll(`.card[data-id="${item.id}"] .card__views`).forEach((n) => {
      n.hidden = false;
      n.title = viewsWord(item.views);
      n.setAttribute('aria-label', viewsWord(item.views));
      n.lastElementChild.textContent = fmtViews(item.views);
    });
  }

  function fillLightbox() {
    const item = state.lbList[state.lbIndex];
    if (!item) return;
    setLightboxVideo(item);
    el.lbCat.textContent = item.category;
    el.lbCode.textContent = item.code;
    countView(item);
    showLightboxMeta(item);
    el.lbWa.href = waLink(item.code);
    el.lbPrev.disabled = state.lbIndex <= 0;
    el.lbNext.disabled = state.lbIndex >= state.lbList.length - 1;
    el.lbCounter.textContent = `${state.lbIndex + 1} / ${state.lbList.length}`;
    el.lbCounter.hidden = state.lbList.length < 2;
  }

  function showLightbox() {
    if (!el.lb.hidden) return;
    lastFocus = document.activeElement;
    el.lb.hidden = false;
    document.body.classList.add('no-scroll');
    document.querySelectorAll('main video').forEach((v) => v.pause());
    $('.lb__close', el.lb).focus({ preventScroll: true });
  }

  function hideLightbox() {
    if (el.lb.hidden) return;
    el.lb.hidden = true;
    lbToken++;
    clearLow();
    setLoading(false);
    el.lbVideo.pause();
    el.lbVideo.removeAttribute('src');
    el.lbVideo.load();
    document.body.classList.remove('no-scroll');
    state.lbIndex = -1;
    resumeVisible(); // снова запустить видимые видео
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }

  function openLightbox(list, index) {
    state.lbList = list;
    state.lbIndex = index;
    fillLightbox();
    showLightbox();
    const hash = '#' + encodeURIComponent(list[index].code);
    if (history.state && history.state.lb) history.replaceState({ lb: 1 }, '', hash);
    else history.pushState({ lb: 1 }, '', hash);
  }

  function step(dir) {
    const i = state.lbIndex + dir;
    if (i < 0 || i >= state.lbList.length) return;
    state.lbIndex = i;
    fillLightbox();
    history.replaceState(history.state, '', '#' + encodeURIComponent(state.lbList[i].code));
  }

  function closeLightbox() {
    if (history.state && history.state.lb) history.back(); // popstate закроет окно
    else { history.replaceState(null, '', location.pathname + location.search); hideLightbox(); }
  }

  function syncLightboxWithHash() {
    const code = decodeURIComponent(location.hash.slice(1));
    if (!code || !state.loaded) { hideLightbox(); return; }
    if (!el.lb.hidden && state.lbList[state.lbIndex]?.code === code) return;
    let idx = state.list.findIndex((i) => i.code === code);
    let list = state.list;
    if (idx < 0) {
      const item = state.items.find((i) => i.code.toLowerCase() === code.toLowerCase());
      if (!item) { hideLightbox(); return; }
      list = [item]; idx = 0;
    }
    state.lbList = list; state.lbIndex = idx;
    fillLightbox();
    showLightbox();
  }

  el.lb.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeLightbox(); });
  el.lbPrev.addEventListener('click', () => step(-1));
  el.lbNext.addEventListener('click', () => step(1));
  // Видео на весь экран. На iPhone requestFullscreen для видео нет — там встроенный плеер webkitEnterFullscreen.
  el.lbFull.addEventListener('click', () => {
    const v = el.lbVideo;
    v.play().catch(() => {});
    if (v.requestFullscreen) v.requestFullscreen().catch(() => { if (v.webkitEnterFullscreen) v.webkitEnterFullscreen(); });
    else if (v.webkitRequestFullscreen) v.webkitRequestFullscreen();
    else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen();
  });
  el.lbShare.addEventListener('click', async () => {
    const item = state.lbList[state.lbIndex];
    if (!item) return;
    const url = itemUrl(item);
    if (navigator.share) {
      try { await navigator.share({ title: `Islimi — ${item.code}`, url }); } catch { /* отменено */ }
    } else if (await copyText(url)) toast('Link kopyalandı');
  });

  document.addEventListener('keydown', (e) => {
    if (el.lb.hidden) {
      if (e.key === '/' && document.activeElement !== el.search && !/input|textarea/i.test(document.activeElement.tagName)) {
        e.preventDefault(); el.search.focus();
      }
      return;
    }
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'Tab') { // фокус не уходит из окна
      const f = [...el.lb.querySelectorAll('button:not([disabled]):not([hidden]), a[href], video[controls]')].filter((n) => n.offsetParent);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  // свайп влево/вправо по видео в окне
  let touchX = null, touchY = null;
  const media = $('.lb__media', el.lb);
  media.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; touchY = e.touches[0].clientY; }, { passive: true });
  media.addEventListener('touchend', (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    const dy = e.changedTouches[0].clientY - touchY;
    touchX = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
  }, { passive: true });

  // ---------- Прокрутка: тень у категорий, кнопка «вверх» ----------

  let ticking = false;
  addEventListener('scroll', () => {
    const now = performance.now();
    const dt = now - lastScroll;
    // скорость прокрутки; после паузы считаем заново
    scrollSpeed = dt > 0 && dt < 300 ? Math.abs(scrollY - lastY) / dt * 1000 : 0;
    lastScroll = now; lastY = scrollY;
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      el.header.classList.toggle('is-stuck', scrollY > 4);
      el.toTop.classList.toggle('is-visible', scrollY > 900);
      ticking = false;
    });
  }, { passive: true });
  el.toTop.addEventListener('click', () => scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }));

  // Плавающие кнопки прячутся, когда виден низ подвала (там уже есть контакты)
  const floating = $('.floating');
  const footBottom = $('.footer__bottom');
  if (floating && footBottom) {
    new IntersectionObserver((entries) => {
      floating.classList.toggle('is-away', entries[0].isIntersecting);
    }).observe(footBottom);
  }

  // ---------- Подпись в подвале: прописывается при появлении и при наведении ----------

  (function signature() {
    const a = $('.footer .sig');
    if (!a) return;
    const play = () => { a.classList.remove('play'); void a.offsetWidth; a.classList.add('play'); };
    const io = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) return;
      play(); io.disconnect();
      a.addEventListener('pointerenter', play);
    }, { threshold: 0.6 });
    io.observe(a.querySelector('svg'));
  })();

  // ---------- Старт ----------

  // Последний ответ каталога хранится в браузере: при повторном заходе сетка рисуется
  // сразу из него, а свежие данные подтягиваются в фоне.
  const CACHE_KEY = 'islimi-catalog';
  function readCache() {
    try {
      const data = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      return data && Array.isArray(data.items) && data.items.length ? data : null;
    } catch { return null; }
  }
  function writeCache(text) {
    try { localStorage.setItem(CACHE_KEY, text); } catch { /* хранилище недоступно или переполнено */ }
  }

  function applyData(data) {
    const keep = state.loaded ? state.shown : 0;
    state.items = normalize(data);
    state.updated = data.updated ? new Date(data.updated) : null;
    state.stamp = data.updated || '';
    state.loaded = true;
    updateCounts();
    renderHome();
    render(keep);
    syncLightboxWithHash();
  }

  // Каталог тот же, что уже показан: меняются только просмотры — сетку не трогаем
  function applyViews(data) {
    const views = new Map(data.items.map((i) => [Number(i.id), Number(i.views) || 0]));
    for (const item of state.items) {
      const n = views.get(item.id);
      if (n > item.views) { item.views = n; paintViews(item); }
    }
  }

  async function load() {
    el.status.innerHTML = '';
    const cached = state.loaded ? null : readCache();
    if (cached) applyData(cached);
    else if (!state.loaded) {
      el.grid.innerHTML = skeletonHTML(8);
      el.meta.textContent = '';
    }
    try {
      const res = await fetch(API_URL, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data.items)) throw new Error('Bad catalog');
      writeCache(text);
      if (state.loaded && data.updated && data.updated === state.stamp) applyViews(data);
      else applyData(data);
    } catch (err) {
      console.error(err);
      if (state.loaded) return; // остаётся каталог из памяти браузера
      el.grid.innerHTML = '';
      if (!el.statTotal.textContent) el.statTotal.textContent = '—';
      if (!el.statUpdated.textContent) el.statUpdated.textContent = '—';
      el.status.innerHTML = `
        <h2 class="status__title">Kataloq yüklənmədi</h2>
        <p>İnternet bağlantısını yoxlayıb yenidən cəhd edin.</p>
        <button class="btn btn--ghost" type="button" data-retry>Yenidən yüklə</button>`;
    }
  }

  setCategory(catFromPath(location.pathname));
  document.querySelectorAll('[data-year]').forEach((n) => { n.textContent = new Date().getFullYear(); });
  load();
})();
