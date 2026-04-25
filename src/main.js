import "./styles.css";

const DEFAULT_RETWEETERS = "/output/x_retweeters_2036816359343222971.csv";
const DEFAULT_QUOTES = "/output/x_quotes_2036816359343222971.csv";
const ARTICLES_STORAGE_KEY = "gratitude-starfield-articles";
const CURRENT_ARTICLE_KEY = "gratitude-starfield-current-article";

const canvas = document.querySelector("#starfield");
const ctx = canvas.getContext("2d");
const els = {
  retweetCount: document.querySelector("#retweetCount"),
  quoteCount: document.querySelector("#quoteCount"),
  supporterCount: document.querySelector("#supporterCount"),
  quoteSpan: document.querySelector("#quoteSpan"),
  quoteText: document.querySelector("#quoteText"),
  quoteAuthor: document.querySelector("#quoteAuthor"),
  quoteTime: document.querySelector("#quoteTime"),
  prevQuote: document.querySelector("#prevQuote"),
  nextQuote: document.querySelector("#nextQuote"),
  searchInput: document.querySelector("#searchInput"),
  peopleList: document.querySelector("#peopleList"),
  retweeterFile: document.querySelector("#retweeterFile"),
  quoteFile: document.querySelector("#quoteFile"),
  resetView: document.querySelector("#resetView"),
  articleSelect: document.querySelector("#articleSelect"),
  newArticle: document.querySelector("#newArticle"),
  saveArticle: document.querySelector("#saveArticle"),
  extractForm: document.querySelector("#extractForm"),
  tweetUrlInput: document.querySelector("#tweetUrlInput"),
  extractButton: document.querySelector("#extractButton"),
  extractStatus: document.querySelector("#extractStatus"),
  filters: [...document.querySelectorAll("[data-filter]")],
};

const palette = {
  gold: "#ffd56f",
  rose: "#ff6f91",
  cyan: "#64d7ff",
  retweet: "#ffd56f",
  quote: "#64d7ff",
  both: "#ff6f91",
  leaf: "#70e3a2",
  violet: "#b995ff",
};

const state = {
  retweeters: [],
  quotes: [],
  articles: [],
  currentArticleId: "",
  people: [],
  particles: [],
  highlightedKey: null,
  hoveredParticle: null,
  selectedQuote: 0,
  articleTitle: "第一篇文章",
  filter: "all",
  query: "",
  pointer: { x: 0, y: 0, active: false },
  isHoveringStar: false,
  lastManualFocusAt: 0,
  extractPollTimer: 0,
  camera: { x: 0, y: 0, zoom: 1 },
  size: { width: 0, height: 0, dpr: 1 },
};

function makeArticleId() {
  return `article-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function loadSavedArticles() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ARTICLES_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistArticles() {
  localStorage.setItem(ARTICLES_STORAGE_KEY, JSON.stringify(state.articles));
  if (state.currentArticleId) localStorage.setItem(CURRENT_ARTICLE_KEY, state.currentArticleId);
}

function currentArticle() {
  return state.articles.find((article) => article.id === state.currentArticleId);
}

function renderArticleSelect() {
  els.articleSelect.innerHTML = state.articles
    .map((article) => {
      const retweetCount = article.retweeters?.length || 0;
      const quoteCount = article.quotes?.length || 0;
      return `<option value="${escapeHtml(article.id)}">${escapeHtml(article.title || "未命名长文")} · ${retweetCount}/${quoteCount}</option>`;
    })
    .join("");
  els.articleSelect.value = state.currentArticleId;
}

function createArticle(title = "新的长文") {
  return {
    id: makeArticleId(),
    title,
    retweeters: [],
    quotes: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function saveCurrentArticle(message = "已保存当前文章") {
  let article = currentArticle();
  if (!article) {
    article = createArticle(state.articleTitle || "新的长文");
    state.articles.push(article);
    state.currentArticleId = article.id;
  }
  article.title = state.articleTitle || "未命名长文";
  article.retweeters = state.retweeters;
  article.quotes = state.quotes;
  article.updatedAt = new Date().toISOString();
  persistArticles();
  renderArticleSelect();
  if (message) showToast(message);
}

function loadArticle(article) {
  state.currentArticleId = article.id;
  state.articleTitle = article.title || "未命名长文";
  applyData(article.retweeters || [], article.quotes || [], { preserveArticle: true });
  persistArticles();
  renderArticleSelect();
  showToast(`已切换到：${state.articleTitle}`);
}

function parseTweetUrl(input) {
  try {
    const url = new URL(input);
    const match = url.pathname.match(/\/([^/]+)\/status\/(\d+)/);
    if (!match) return null;
    return {
      handle: match[1],
      tweetId: match[2],
      title: `${match[1]} / ${match[2]}`,
    };
  } catch {
    return null;
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => value.trim() !== "")) rows.push(row);
  if (rows.length < 2) return [];

  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((values) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = values[index]?.trim() ?? "";
    });
    return item;
  });
}

async function loadCsv(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`无法读取 ${url}`);
  return parseCsv(await response.text());
}

function normalizeHandle(value) {
  return (value || "").replace(/^@/, "").trim().toLowerCase();
}

function personKey(name, handle) {
  return normalizeHandle(handle) || name.trim().toLowerCase();
}

function normalizeData(retweeters, quotes) {
  const people = new Map();
  const peopleByName = new Map();

  retweeters.forEach((row, index) => {
    const name = row["姓名"] || row.name || row.user_name || "未命名";
    const handle = row["用户名"] || row.username || "";
    const key = personKey(name, handle) || `retweet-${index}`;
    const person = {
      key,
      name,
      handle,
      avatar: row["头像"] || row.avatar || "",
      retweeted: true,
      quoted: false,
      quoteText: "",
      quoteUrl: "",
      createdAt: "",
      rank: index,
    };
    people.set(key, person);
    peopleByName.set(name.trim().toLowerCase(), person);
  });

  quotes.forEach((row, index) => {
    const name = row.user_name || row["姓名"] || row.name || "引用者";
    const handle = row.username || row["用户名"] || "";
    const nameKey = name.trim().toLowerCase();
    const matchedByName = peopleByName.get(nameKey);
    const key = matchedByName?.key || personKey(name, handle);
    const current = people.get(key) || matchedByName || {
      key,
      name,
      handle,
      avatar: row.avatar || row["头像"] || "",
      retweeted: false,
      quoted: false,
      rank: retweeters.length + index,
    };
    current.quoted = true;
    current.handle ||= handle;
    current.avatar ||= row.avatar || row["头像"] || "";
    current.quoteText = row.quote_text || "";
    current.quoteUrl = row.quote_url || "";
    current.createdAt = row.created_at || "";
    current.name = current.name || name;
    people.set(key, current);
  });

  return [...people.values()].sort((a, b) => {
    const typeA = a.quoted ? 0 : 1;
    const typeB = b.quoted ? 0 : 1;
    return typeA - typeB || a.rank - b.rank;
  });
}

function createParticles(people) {
  const count = people.length || 1;
  return people.map((person, index) => {
    const golden = index * 2.399963229728653;
    const layer = Math.sqrt((index + 1) / count);
    const quoteBoost = person.quoted ? 0.72 : 1;
    const radius = (120 + layer * 500) * quoteBoost;
    const type = person.quoted && person.retweeted ? "both" : person.quoted ? "quote" : "retweet";
    return {
      person,
      type,
      angle: golden,
      radius,
      speed: 0.00009 + ((index % 17) + 3) * 0.000012,
      size: person.quoted ? 3.3 + (index % 4) : 1.8 + (index % 3) * 0.45,
      phase: Math.random() * Math.PI * 2,
      color: palette[type],
      gardenOffset: ((index % 9) - 4) * 9,
    };
  });
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = window.innerWidth;
  const height = window.innerHeight;
  state.size = { width, height, dpr };
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function parseDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function updateStats() {
  const quoteDates = state.quotes.map((row) => parseDate(row.created_at)).filter(Boolean);
  quoteDates.sort((a, b) => a - b);
  const span =
    quoteDates.length > 1
      ? `${Math.max(1, Math.round((quoteDates.at(-1) - quoteDates[0]) / 86400000))} 天`
      : "-";

  els.retweetCount.textContent = formatNumber(state.retweeters.length);
  els.quoteCount.textContent = formatNumber(state.quotes.length);
  els.supporterCount.textContent = formatNumber(state.people.length);
  els.quoteSpan.textContent = span;
}

function setQuote(index) {
  if (!state.quotes.length) {
    setEmptyQuoteState();
    return;
  }
  state.selectedQuote = (index + state.quotes.length) % state.quotes.length;
  const quote = state.quotes[state.selectedQuote];
  const key = personKey(quote.user_name || "", "");
  const person = state.people.find((item) => item.key === key || item.name === quote.user_name) || {
    key,
    name: quote.user_name || "引用者",
    quoted: true,
    quoteText: quote.quote_text || "",
    quoteUrl: quote.quote_url || "",
    createdAt: quote.created_at || "",
  };
  showPerson(person, { manual: true });
}

function setEmptyQuoteState() {
  els.quoteText.textContent = state.people.length
    ? "这篇文章目前只有转发数据。把鼠标移到星星上，可以查看每位转发者。"
    : "这篇文章还没有导入数据。请上传转发 CSV 和引用 CSV。";
  els.quoteAuthor.textContent = state.articleTitle || "未命名长文";
  els.quoteAuthor.href = "#";
  els.quoteTime.textContent = "数据会自动保存到当前文章";
  state.highlightedKey = null;
}

function showPerson(person, options = {}) {
  const { manual = false } = options;
  state.highlightedKey = person.key;
  if (manual) state.lastManualFocusAt = Date.now();
  if (person.quoted) {
    const quoteIndex = state.quotes.findIndex((quote) => quote.user_name === person.name || quote.quote_url === person.quoteUrl);
    if (quoteIndex >= 0) state.selectedQuote = quoteIndex;
  }

  const url = getPersonUrl(person);
  const date = parseDate(person.createdAt);

  els.quoteText.textContent = person.quoted
    ? person.quoteText || "这位朋友用一个链接完成了转述。"
    : `谢谢 ${person.name} 的转发。这个光点记录了 TA 把文章递给更多人的那一刻。`;
  els.quoteAuthor.textContent = person.quoted ? person.name || "引用者" : person.handle || person.name || "转发者";
  els.quoteAuthor.href = url || "#";
  els.quoteTime.textContent = person.quoted
    ? date
      ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date)
      : person.createdAt || "点击星星打开对应链接"
    : url
      ? "点击星星打开对应主页"
      : "这条转发数据没有可打开的链接";

  renderPeopleList();
}

function getPersonUrl(person) {
  if (person.quoteUrl) return person.quoteUrl;
  const handle = normalizeHandle(person.handle);
  return handle ? `https://x.com/${handle}` : "";
}

function classify(person) {
  if (person.quoted && person.retweeted) return "同时转发与引用";
  if (person.quoted) return "引用";
  return "转发";
}

function filteredPeople() {
  const query = state.query.trim().toLowerCase();
  return state.people
    .filter((person) => {
      if (state.filter === "quote" && !person.quoted) return false;
      if (state.filter === "retweet" && !person.retweeted) return false;
      if (!query) return true;
      return [person.name, person.handle, person.quoteText].join(" ").toLowerCase().includes(query);
    })
    .slice(0, 80);
}

function renderPeopleList() {
  const people = filteredPeople();
  els.peopleList.innerHTML = people
    .map((person) => {
      const avatar = person.avatar
        ? `<img src="${escapeHtml(person.avatar)}" alt="">`
        : `<span class="avatar-fallback">${escapeHtml(person.name.slice(0, 1).toUpperCase())}</span>`;
      return `<button class="person" type="button" data-key="${escapeHtml(person.key)}">
        ${avatar}
        <span>
          <strong>${escapeHtml(person.name)}</strong>
          <span class="people-meta">${escapeHtml(person.handle || classify(person))}</span>
        </span>
      </button>`;
    })
    .join("");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function drawBackground(time) {
  const { width, height } = state.size;
  const gradient = ctx.createRadialGradient(width * 0.5, height * 0.5, 20, width * 0.5, height * 0.5, width * 0.72);
  gradient.addColorStop(0, "#11172b");
  gradient.addColorStop(0.35, "#070b17");
  gradient.addColorStop(0.72, "#060912");
  gradient.addColorStop(1, "#02040a");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.globalAlpha = 0.22;
  for (let i = 0; i < 7; i += 1) {
    const x = width * (0.12 + i * 0.14) + Math.sin(time * 0.0002 + i) * 28;
    const y = height * (0.3 + (i % 3) * 0.16);
    const r = 140 + (i % 4) * 38;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, [palette.rose, palette.cyan, palette.leaf, palette.gold][i % 4]);
    g.addColorStop(1, "transparent");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function particlePosition(particle, time) {
  const { width, height } = state.size;
  const angle = particle.angle + time * particle.speed;
  const sway = Math.sin(time * 0.0005 + particle.phase) * 18;
  const x = width / 2 + Math.cos(angle) * (particle.radius + sway) * state.camera.zoom + state.camera.x;
  const y =
    height / 2 +
    Math.sin(angle) * (particle.radius * 0.58 + particle.gardenOffset) * state.camera.zoom +
    state.camera.y;
  return { x, y };
}

function drawField(time) {
  const { width, height } = state.size;
  const centerX = width / 2 + state.camera.x;
  const centerY = height / 2 + state.camera.y;

  ctx.save();
  ctx.strokeStyle = "rgba(255, 213, 111, 0.12)";
  for (let i = 1; i <= 5; i += 1) {
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, i * 115 * state.camera.zoom, i * 66 * state.camera.zoom, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  state.particles.forEach((particle) => {
    const { x, y } = particlePosition(particle, time);
    const highlighted = particle.person.key === state.highlightedKey;
    const pulse = 0.65 + Math.sin(time * 0.004 + particle.phase) * 0.35;
    const size = particle.size * (highlighted ? 2.6 : 1) * (0.84 + pulse * 0.3);

    ctx.save();
    ctx.globalAlpha = highlighted ? 0.98 : particle.type === "retweet" ? 0.58 : 0.84;
    ctx.shadowBlur = highlighted ? 30 : particle.type === "retweet" ? 9 : 18;
    ctx.shadowColor = particle.color;
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (highlighted) {
      drawLabel(particle.person.name, x + 10, y - 10, highlighted);
    }
  });

  drawCore(centerX, centerY, time);
}

function drawCore(x, y, time) {
  const pulse = 1 + Math.sin(time * 0.002) * 0.06;
  const g = ctx.createRadialGradient(x, y, 0, x, y, 86 * pulse);
  g.addColorStop(0, "rgba(255, 249, 216, 1)");
  g.addColorStop(0.22, "rgba(255, 213, 111, 0.95)");
  g.addColorStop(0.6, "rgba(255, 111, 145, 0.22)");
  g.addColorStop(1, "transparent");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, 86 * pulse, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#17110b";
  ctx.beginPath();
  ctx.arc(x, y, 39 * pulse, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#fff7e8";
  ctx.font = "800 12px system-ui, sans-serif";
  ctx.textAlign = "center";
  drawCoreTitle(state.articleTitle, x, y, 68);
}

function drawCoreTitle(text, x, y, maxWidth) {
  const value = text.trim() || "第一篇文章";
  const chars = [...value];
  let line = "";
  const lines = [];
  chars.forEach((char) => {
    const next = `${line}${char}`;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = char;
    } else {
      line = next;
    }
  });
  if (line) lines.push(line);
  const visible = lines.slice(0, 2);
  const startY = y - (visible.length - 1) * 7;
  visible.forEach((item, index) => {
    ctx.fillText(item, x, startY + index * 14);
  });
}

function drawLabel(text, x, y, strong) {
  ctx.save();
  ctx.font = `${strong ? 700 : 600} 12px system-ui, sans-serif`;
  const width = Math.min(ctx.measureText(text).width + 18, 180);
  ctx.fillStyle = strong ? "rgba(255, 247, 232, 0.9)" : "rgba(13, 16, 24, 0.72)";
  ctx.strokeStyle = strong ? "rgba(255, 213, 111, 0.9)" : "rgba(255,255,255,0.2)";
  roundRect(ctx, x, y - 20, width, 28, 7);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = strong ? "#20170b" : "#fff7e8";
  ctx.textAlign = "left";
  ctx.fillText(text.slice(0, 18), x + 9, y - 2);
  ctx.restore();
}

function roundRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function animate(time = 0) {
  drawBackground(time);
  drawField(time);
  requestAnimationFrame(animate);
}

function showToast(message) {
  let toast = document.querySelector(".toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 1800);
}

function setExtractStatus(message, isRunning = false) {
  els.extractStatus.textContent = message;
  els.extractButton.disabled = isRunning;
  els.extractButton.textContent = isRunning ? "提取中" : "提取";
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}

function normalizeExtractorQuotes(rows) {
  return rows.map((row) => ({
    user_name: row.user_name || row.name || row["姓名"] || row.username || "引用者",
    quote_text: row.quote_text || row["引用文本"] || "",
    created_at: row.created_at || row["引用发布时间"] || "",
    quote_url: row.quote_url || row["引用链接"] || "",
    name: row.name || row.user_name || row["姓名"] || "",
    username: row.username || row["用户名"] || "",
    avatar: row.avatar || row["头像"] || "",
  }));
}

function normalizeExtractorRetweeters(rows) {
  return rows.map((row) => ({
    姓名: row["姓名"] || row.name || row.user_name || "未命名",
    用户名: row["用户名"] || row.username || "",
    头像: row["头像"] || row.avatar || "",
  }));
}

async function applyExtractionResult(job) {
  let retweetersRaw = job.retweeters;
  let quotesRaw = job.quotes;

  if (!retweetersRaw && job.files?.retweetersJson) {
    retweetersRaw = await fetchJson(job.files.retweetersJson);
  }
  if (!quotesRaw && job.files?.quotesJson) {
    quotesRaw = await fetchJson(job.files.quotesJson);
  }

  if (!retweetersRaw || !quotesRaw) {
    throw new Error("提取完成，但没有返回 JSON 文件。");
  }

  const retweeters = normalizeExtractorRetweeters(retweetersRaw);
  const quotes = normalizeExtractorQuotes(quotesRaw);
  let summary = "提取完成，已保存到当前文章。";
  if (job.tweet?.title) {
    state.articleTitle = job.tweet.title;
  }
  applyData(retweeters, quotes);
  const metrics = job.tweet?.metrics;
  if (metrics) {
    const parts = [];
    if (Number.isFinite(metrics.retweets)) parts.push(`X 显示转发 ${metrics.retweets}`);
    if (Number.isFinite(metrics.quotes)) parts.push(`X 显示引用 ${metrics.quotes}`);
    if (parts.length) {
      summary = `${parts.join(" / ")}；当前抓到可见转发 ${retweeters.length}、可见引用 ${quotes.length}。`;
    }
  }
  saveCurrentArticle(`已导入：${retweeters.length} 个转发者，${quotes.length} 条引用`);
  return summary;
}

async function pollExtractionJob(id) {
  const job = await fetchJson(`/api/jobs/${encodeURIComponent(id)}`);
  const lastLine = job.progress?.at(-1) || "";
  setExtractStatus(
    `${job.phase || "运行中"} · 转发 ${job.counts?.retweeters ?? 0} / 引用 ${
      job.counts?.quotes ?? 0
    }${lastLine ? ` · ${lastLine.replace(/^\[[^\]]+\]\s*/, "")}` : ""}`,
    true,
  );

  if (job.status === "done") {
    window.clearInterval(state.extractPollTimer);
    state.extractPollTimer = 0;
    const summary = await applyExtractionResult(job);
    setExtractStatus(summary);
    return;
  }

  if (job.status === "error") {
    window.clearInterval(state.extractPollTimer);
    state.extractPollTimer = 0;
    throw new Error(job.error || "提取失败");
  }
}

async function startExtraction(url) {
  const parsed = parseTweetUrl(url);
  if (!parsed) throw new Error("请输入完整的 X 推文链接，例如 https://x.com/name/status/123");

  if (!state.currentArticleId || !state.retweeters.length && !state.quotes.length) {
    state.articleTitle = state.articleTitle || parsed.title;
    saveCurrentArticle("");
  }

  window.clearInterval(state.extractPollTimer);
  setExtractStatus("任务已提交，正在连接提取器...", true);
  const payload = await fetchJson("/api/extract", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });

  if (payload.status === "done" && (payload.retweeters || payload.quotes)) {
    const summary = await applyExtractionResult(payload);
    setExtractStatus(summary);
    return;
  }

  if (!payload.id) {
    throw new Error("提取接口没有返回任务 ID 或结果。");
  }

  await pollExtractionJob(payload.id);
  state.extractPollTimer = window.setInterval(() => {
    pollExtractionJob(payload.id).catch((error) => {
      window.clearInterval(state.extractPollTimer);
      state.extractPollTimer = 0;
      setExtractStatus(error.message);
      showToast(error.message);
    });
  }, 1200);
}

async function readFile(file) {
  return parseCsv(await file.text());
}

function applyData(retweeters, quotes, options = {}) {
  state.retweeters = retweeters;
  state.quotes = quotes;
  state.people = normalizeData(retweeters, quotes);
  state.particles = createParticles(state.people);
  updateStats();
  setQuote(0);
  renderPeopleList();
  if (!options.preserveArticle) saveCurrentArticle("");
}

async function boot() {
  resize();
  state.articles = loadSavedArticles();

  if (!state.articles.length) {
    try {
      const [retweeters, quotes] = await Promise.all([loadCsv(DEFAULT_RETWEETERS), loadCsv(DEFAULT_QUOTES)]);
      const seed = createArticle("第一篇文章");
      seed.retweeters = retweeters;
      seed.quotes = quotes;
      state.articles = [seed];
      state.currentArticleId = seed.id;
      persistArticles();
      loadArticle(seed);
      showToast("已创建默认文章库");
    } catch (error) {
      const blank = createArticle("第一篇文章");
      state.articles = [blank];
      state.currentArticleId = blank.id;
      persistArticles();
      loadArticle(blank);
      showToast("已创建空文章，请上传 CSV");
    }
  } else {
    const savedId = localStorage.getItem(CURRENT_ARTICLE_KEY);
    const article = state.articles.find((item) => item.id === savedId) || state.articles[0];
    loadArticle(article);
  }

  animate();
}

els.prevQuote.addEventListener("click", () => setQuote(state.selectedQuote - 1));
els.nextQuote.addEventListener("click", () => setQuote(state.selectedQuote + 1));

els.articleSelect.addEventListener("change", (event) => {
  const article = state.articles.find((item) => item.id === event.target.value);
  if (article) loadArticle(article);
});

els.newArticle.addEventListener("click", () => {
  const article = createArticle(`新的长文 ${state.articles.length + 1}`);
  state.articles.push(article);
  loadArticle(article);
});

els.saveArticle.addEventListener("click", () => {
  saveCurrentArticle("已保存到文章库");
});

els.extractForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = els.tweetUrlInput.value.trim();
  if (!url) {
    setExtractStatus("请先输入一条 X 推文链接。");
    return;
  }
  try {
    await startExtraction(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setExtractStatus(message);
    showToast(message);
  }
});

els.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  renderPeopleList();
});

els.filters.forEach((button) => {
  button.addEventListener("click", () => {
    els.filters.forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.filter = button.dataset.filter;
    renderPeopleList();
  });
});

els.peopleList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-key]");
  if (!button) return;
  const person = state.people.find((item) => item.key === button.dataset.key);
  if (!person) return;
  showPerson(person, { manual: true });
  if (person.quoted) {
    const index = state.quotes.findIndex((quote) => quote.user_name === person.name || personKey(quote.user_name || "", "") === person.key);
    if (index >= 0) state.selectedQuote = index;
  } else {
    showToast(`谢谢 ${person.name} 的转发`);
  }
});

els.retweeterFile.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  applyData(await readFile(file), state.quotes);
  saveCurrentArticle("已保存转发数据");
});

els.quoteFile.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  applyData(state.retweeters, await readFile(file));
  saveCurrentArticle("已保存引用数据");
});

els.resetView.addEventListener("click", () => {
  state.camera = { x: 0, y: 0, zoom: 1 };
  state.highlightedKey = null;
  state.hoveredParticle = null;
  state.isHoveringStar = false;
  showToast("镜头已重置");
});

canvas.addEventListener("pointermove", (event) => {
  state.pointer = { x: event.clientX, y: event.clientY, active: true };
  let nearest = null;
  let nearestDistance = 28;
  const now = performance.now();
  state.particles.forEach((particle) => {
    const position = particlePosition(particle, now);
    const distance = Math.hypot(position.x - event.clientX, position.y - event.clientY);
    if (distance < nearestDistance) {
      nearest = particle;
      nearestDistance = distance;
    }
  });
  state.hoveredParticle = nearest;
  state.isHoveringStar = Boolean(nearest);
  canvas.style.cursor = nearest ? "pointer" : "default";
  if (nearest) showPerson(nearest.person);
});

canvas.addEventListener("pointerleave", () => {
  state.hoveredParticle = null;
  state.isHoveringStar = false;
  canvas.style.cursor = "default";
});

canvas.addEventListener("click", () => {
  if (!state.hoveredParticle) return;
  const url = getPersonUrl(state.hoveredParticle.person);
  if (!url) {
    showToast("这个光点没有可打开的链接");
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
});

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const next = state.camera.zoom * (event.deltaY > 0 ? 0.94 : 1.06);
  state.camera.zoom = Math.min(1.8, Math.max(0.55, next));
});

window.addEventListener("resize", resize);
window.setInterval(() => {
  if (state.quotes.length && !state.isHoveringStar && Date.now() - state.lastManualFocusAt > 6000) {
    setQuote(state.selectedQuote + 1);
  }
}, 8500);

boot();
