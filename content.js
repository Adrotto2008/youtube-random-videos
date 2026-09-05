(function () {
  let API_KEY = null;

  function getApiKey() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(["apiKey"], (res) => resolve((res && res.apiKey) || null));
      } catch (e) {
        resolve(null);
      }
    });
  }

  const SORT_LABELS = ["Più recenti", "Popolari", "Meno recenti", "Latest", "Popular", "Oldest"];
  const CUSTOM_LABEL = "Casuale";
  const PAGE_SIZE = 100;
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 ore

  function isVideosTab() {
    return /^\/(@[^/]+|channel\/UC[\w-]+|c\/[^/]+|user\/[^/]+)\/videos/.test(
      location.pathname
    );
  }

  // ---------- Ricerca del menu di ordinamento (metodo semplice + fallback shadow DOM) ----------

  function findSortMenuSimple() {
    const allElements = Array.from(document.querySelectorAll("body *"));
    const leaves = allElements.filter((el) => {
      const t = (el.textContent || "").trim();
      return SORT_LABELS.includes(t);
    });
    const innermost = leaves.filter(
      (el) => !leaves.some((other) => other !== el && el.contains(other))
    );

    for (const leaf of innermost) {
      let ancestor = leaf.parentElement;
      let depth = 0;
      while (ancestor && depth < 8) {
        const text = ancestor.textContent || "";
        const distinct = new Set(SORT_LABELS.filter((l) => text.includes(l)));
        if (distinct.size >= 2) return ancestor;
        ancestor = ancestor.parentElement;
        depth++;
      }
    }
    return null;
  }

  function getComposedText(el) {
    let text = "";
    (function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      for (const child of node.childNodes) walk(child);
      if (node.shadowRoot) {
        for (const child of node.shadowRoot.childNodes) walk(child);
      }
    })(el);
    return text;
  }

  function collectComposed(root, parentMap, out) {
    for (const child of root.childNodes) {
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      out.push(child);
      parentMap.set(child, root.nodeType === Node.ELEMENT_NODE ? root : null);
      collectComposed(child, parentMap, out);
      if (child.shadowRoot) {
        collectComposed(child.shadowRoot, parentMap, out);
        for (const sc of child.shadowRoot.childNodes) {
          if (sc.nodeType === Node.ELEMENT_NODE) parentMap.set(sc, child);
        }
      }
    }
  }

  function findSortMenuComposed() {
    const parentMap = new Map();
    const allElements = [];
    collectComposed(document.body, parentMap, allElements);

    const leaves = allElements.filter((el) => {
      const t = getComposedText(el).trim();
      return SORT_LABELS.includes(t);
    });

    for (const leaf of leaves) {
      let ancestor = parentMap.get(leaf);
      let depth = 0;
      while (ancestor && depth < 10) {
        const text = getComposedText(ancestor);
        const distinct = new Set(SORT_LABELS.filter((l) => text.includes(l)));
        if (distinct.size >= 2) return ancestor;
        ancestor = parentMap.get(ancestor);
        depth++;
      }
    }
    return null;
  }

  function findSortMenuContainer() {
    return findSortMenuSimple() || findSortMenuComposed();
  }

  function injectRandomOption() {
    const container = findSortMenuContainer();
    if (!container) return;

    const target = container.shadowRoot || container;
    if (target.querySelector(".random-sort-option")) return;

    const btn = document.createElement("div");
    btn.className = "random-sort-option";
    btn.textContent = CUSTOM_LABEL;
    btn.style.cssText = `
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0 16px;
      height: 32px;
      margin: 4px 8px;
      border-radius: 8px;
      border: 1px solid rgba(128,128,128,0.4);
      background: rgba(128,128,128,0.15);
      color: var(--yt-spec-text-primary, #f1f1f1);
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
      user-select: none;
    `;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onRandomClick(btn);
    });

    target.appendChild(btn);
  }

  // ---------- Recupero dati canale/video ----------

  function getChannelIdFromPage() {
    const meta = document.querySelector('meta[itemprop="channelId"]');
    if (meta) return meta.content;
    const canon = document.querySelector('link[rel="canonical"]');
    if (canon) {
      const m = canon.href.match(/\/channel\/(UC[\w-]+)/);
      if (m) return m[1];
    }
    return null;
  }

  async function resolveChannelId() {
    const idFromPage = getChannelIdFromPage();
    if (idFromPage) return idFromPage;
    const m = location.pathname.match(/^\/(@[^/]+)/);
    if (m) {
      const handle = m[1].slice(1);
      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${encodeURIComponent(handle)}&key=${API_KEY}`
      );
      const data = await res.json();
      if (data.items && data.items.length) return data.items[0].id;
    }
    return null;
  }

  async function fetchBaseList(channelId, onProgress) {
    const chRes = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channelId}&key=${API_KEY}`
    );
    const chData = await chRes.json();
    const playlistId =
      chData.items && chData.items[0] && chData.items[0].contentDetails.relatedPlaylists.uploads;
    if (!playlistId) throw new Error("Playlist caricamenti non trovata");

    const videos = [];
    let pageToken = "";
    const MAX_VIDEOS = 6000;

    while (videos.length < MAX_VIDEOS) {
      const url =
        `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${playlistId}&key=${API_KEY}` +
        (pageToken ? `&pageToken=${pageToken}` : "");
      const res = await fetch(url);
      const data = await res.json();
      if (!data.items) break;

      for (const item of data.items) {
        const s = item.snippet;
        if (!s || !s.resourceId || !s.resourceId.videoId) continue;
        const thumb =
          s.thumbnails && (s.thumbnails.medium || s.thumbnails.default || s.thumbnails.high);
        videos.push({ id: s.resourceId.videoId, title: s.title, thumb: thumb && thumb.url });
      }
      if (onProgress) onProgress(videos.length);
      if (!data.nextPageToken) break;
      pageToken = data.nextPageToken;
    }
    return videos;
  }

  async function enrichWithStats(videos, onProgress) {
    const enriched = [];
    for (let i = 0; i < videos.length; i += 50) {
      const batch = videos.slice(i, i + 50);
      const ids = batch.map((v) => v.id).join(",");
      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=statistics,contentDetails,snippet&id=${ids}&key=${API_KEY}`
      );
      const data = await res.json();
      const byId = {};
      for (const item of data.items || []) byId[item.id] = item;

      for (const v of batch) {
        const item = byId[v.id];
        if (item) {
          enriched.push({
            ...v,
            views: item.statistics && item.statistics.viewCount != null ? parseInt(item.statistics.viewCount, 10) : null,
            publishedAt: item.snippet && item.snippet.publishedAt,
            duration: item.contentDetails && item.contentDetails.duration,
          });
        } else {
          enriched.push(v);
        }
      }
      if (onProgress) onProgress(i + batch.length, videos.length);
    }
    return enriched;
  }

  async function fetchAllChannelVideos(channelId, onProgress) {
    const cacheKey = `ytRandomCache_${channelId}`;
    const cachedRaw = localStorage.getItem(cacheKey);
    if (cachedRaw) {
      try {
        const cached = JSON.parse(cachedRaw);
        if (cached.timestamp && Date.now() - cached.timestamp < CACHE_TTL_MS) {
          return cached.videos;
        }
      } catch (e) {
        /* cache corrotta, ignoro */
      }
    }

    const base = await fetchBaseList(channelId, (count) => onProgress("elenco", count));
    const enriched = await enrichWithStats(base, (done, total) => onProgress("dettagli", done, total));

    try {
      localStorage.setItem(cacheKey, JSON.stringify({ timestamp: Date.now(), videos: enriched }));
    } catch (e) {
      /* storage pieno: va bene lo stesso, semplicemente niente cache */
    }
    return enriched;
  }

  // ---------- Formattazione stile YouTube ----------

  function formatViews(n) {
    if (n == null) return "";
    if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace(".0", "")} Mld visualizzazioni`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(".0", "")} Mln visualizzazioni`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(".0", "")} mila visualizzazioni`;
    return `${n} visualizzazioni`;
  }

  function formatRelativeDate(iso) {
    if (!iso) return "";
    const diffMs = Date.now() - new Date(iso).getTime();
    const day = diffMs / 86400000;
    const month = day / 30.44;
    const year = day / 365.25;

    if (year >= 1) {
      const y = Math.floor(year);
      return `${y} ${y === 1 ? "anno" : "anni"} fa`;
    }
    if (month >= 1) {
      const m = Math.floor(month);
      return `${m} mes${m === 1 ? "e" : "i"} fa`;
    }
    if (day >= 1) {
      const d = Math.floor(day);
      return `${d} giorn${d === 1 ? "o" : "i"} fa`;
    }
    return "oggi";
  }

  function formatDuration(iso) {
    if (!iso) return "";
    const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return "";
    const h = parseInt(m[1] || "0", 10);
    const mnt = parseInt(m[2] || "0", 10);
    const s = parseInt(m[3] || "0", 10);
    const pad = (x) => String(x).padStart(2, "0");
    return h > 0 ? `${h}:${pad(mnt)}:${pad(s)}` : `${mnt}:${pad(s)}`;
  }

  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s || "";
    return div.innerHTML;
  }

  // ---------- Rendering della griglia ----------

  function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function getGridContainer() {
    return document.querySelector(
      "ytd-rich-grid-renderer #contents, ytd-two-column-browse-results-renderer ytd-rich-grid-renderer #contents"
    );
  }

  function renderRandomGrid(shuffledVideos) {
    const grid = getGridContainer();
    if (!grid) return;

    grid.innerHTML = "";
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = "repeat(auto-fill, minmax(240px, 1fr))";
    grid.style.gap = "16px 8px";

    let shown = 0;

    function renderBatch() {
      const slice = shuffledVideos.slice(shown, shown + PAGE_SIZE);
      for (const v of slice) {
        const a = document.createElement("a");
        a.href = `https://www.youtube.com/watch?v=${v.id}`;
        a.style.cssText = "display:block;text-decoration:none;";

        const durationBadge = v.duration
          ? `<span style="position:absolute;bottom:4px;right:4px;background:rgba(0,0,0,0.8);color:#fff;font-size:12px;padding:1px 4px;border-radius:4px;">${formatDuration(v.duration)}</span>`
          : "";

        const metaParts = [];
        if (v.views != null) metaParts.push(formatViews(v.views));
        if (v.publishedAt) metaParts.push(formatRelativeDate(v.publishedAt));

        a.innerHTML = `
          <div style="position:relative;">
            <img src="${v.thumb || ""}" loading="lazy" style="width:100%;border-radius:12px;display:block;aspect-ratio:16/9;object-fit:cover;background:#222;">
            ${durationBadge}
          </div>
          <div style="margin-top:8px;font-size:14px;font-weight:500;line-height:1.3;max-height:2.6em;overflow:hidden;color:var(--yt-spec-text-primary,#f1f1f1);">${escapeHtml(v.title)}</div>
          <div style="margin-top:4px;font-size:12px;color:var(--yt-spec-text-secondary,#aaaaaa);">${escapeHtml(metaParts.join(" · "))}</div>
        `;
        grid.appendChild(a);
      }
      shown += slice.length;

      if (shown < shuffledVideos.length) {
        const more = document.createElement("button");
        more.textContent = `Mostra altri ${Math.min(PAGE_SIZE, shuffledVideos.length - shown)} video`;
        more.style.cssText =
          "grid-column:1/-1;padding:12px;border-radius:8px;border:none;background:rgba(128,128,128,0.2);color:var(--yt-spec-text-primary,#f1f1f1);cursor:pointer;font-weight:500;";
        more.addEventListener("click", () => {
          more.remove();
          renderBatch();
        });
        grid.appendChild(more);
      }
    }

    renderBatch();
  }

  async function onRandomClick(btn) {
    const original = btn.textContent;
    try {
      API_KEY = await getApiKey();
      if (!API_KEY) {
        btn.textContent = "Imposta la chiave API (Opzioni estensione)";
        setTimeout(() => (btn.textContent = original), 4000);
        return;
      }

      btn.textContent = "Cerco canale...";
      const channelId = await resolveChannelId();
      if (!channelId) throw new Error("Canale non identificato");

      const videos = await fetchAllChannelVideos(channelId, (phase, a, b) => {
        btn.textContent = phase === "elenco" ? `Carico elenco... ${a}` : `Carico dettagli... ${a}/${b}`;
      });
      if (!videos.length) throw new Error("Nessun video trovato");

      btn.textContent = `${CUSTOM_LABEL} (${videos.length})`;
      renderRandomGrid(shuffleArray(videos.slice()));
    } catch (err) {
      console.error("[Video Casuale]", err);
      btn.textContent = "Errore, riprova";
      setTimeout(() => (btn.textContent = original), 2500);
    }
  }

  function tryInject() {
    if (!isVideosTab()) return;
    injectRandomOption();
  }

  const observer = new MutationObserver(() => tryInject());
  observer.observe(document.body, { childList: true, subtree: true });

  document.addEventListener("yt-navigate-finish", () => {
    setTimeout(tryInject, 500);
  });

  tryInject();
})();
