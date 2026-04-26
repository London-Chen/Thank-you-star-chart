#!/usr/bin/env node

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { URL } = require("node:url");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const OUTPUT_DIR = path.join(ROOT, "output");
const XFETCH_SESSION = path.join(process.env.HOME || "", ".config", "xfetch", "session.json");
const XFETCH_QUERY_IDS = path.join(process.env.HOME || "", ".config", "xfetch", "query-ids.json");
const PORT = Number(process.env.PORT || 3000);
const CHROME_PATH =
  process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const BEARER_TOKEN =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

const DEFAULT_FEATURES = {
  rweb_tipjar_consumption_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  articles_preview_enabled: true,
  tweetypie_unmention_optimization_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  rweb_video_timestamps_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_enhance_cards_enabled: false,
  responsive_web_twitter_article_notes_tab_enabled: true,
  subscriptions_verification_info_verified_since_enabled: true,
  subscriptions_verification_info_is_identity_verified_enabled: true,
  highlights_tweets_tab_ui_enabled: true,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  hidden_profile_subscriptions_enabled: true,
  subscriptions_feature_can_gift_premium: true,
  responsive_web_grok_show_grok_translated_post: true,
  responsive_web_grok_analyze_post_followups_enabled: true,
  premium_content_api_read_enabled: true,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_grok_analysis_button_from_backend: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: true,
  rweb_video_screen_enabled: true,
  responsive_web_jetfuel_frame: true,
};

const RETWEETERS_FEATURES = {
  ...DEFAULT_FEATURES,
  rweb_video_screen_enabled: false,
  rweb_cashtags_enabled: true,
  responsive_web_profile_redirect_enabled: false,
  rweb_tipjar_consumption_enabled: false,
  premium_content_api_read_enabled: false,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  longform_notetweets_inline_media_enabled: false,
  responsive_web_grok_annotations_enabled: true,
  content_disclosure_indicator_enabled: true,
  content_disclosure_ai_generated_indicator_enabled: true,
  post_ctas_fetch_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: true,
};

const TWEET_RESULT_FIELD_TOGGLES = {
  withArticleRichContentState: true,
  withArticlePlainText: true,
  withArticleSummaryText: true,
  withArticleVoiceOver: true,
  withGrokAnalyze: false,
  withDisallowedReplyControls: true,
};

const jobs = new Map();

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readSession() {
  if (!fs.existsSync(XFETCH_SESSION)) {
    throw new Error(
      "没有找到 X 登录信息。请先运行：xreach auth extract --browser chrome --profile Default",
    );
  }
  const session = readJson(XFETCH_SESSION);
  if (!session.authToken || !session.ct0) {
    throw new Error("X 登录信息不完整，请重新运行 xreach auth extract。");
  }
  return session;
}

function getQueryId(operationName, fallback) {
  try {
    const cache = readJson(XFETCH_QUERY_IDS);
    return cache.ids?.[operationName] || fallback;
  } catch {
    return fallback;
  }
}

function parseTweetUrl(input) {
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error("请输入完整的 X 推文链接。");
  }
  const match = parsed.pathname.match(/\/([^/]+)\/status\/(\d+)/);
  if (!match) {
    throw new Error("链接里没有找到 /status/<tweetId>。");
  }
  return {
    handle: match[1],
    tweetId: match[2],
    canonicalUrl: `https://x.com/${match[1]}/status/${match[2]}`,
  };
}

function createHeaders(session) {
  return {
    authorization: `Bearer ${BEARER_TOKEN}`,
    "x-twitter-auth-type": "OAuth2Session",
    "x-twitter-active-user": "yes",
    "x-csrf-token": session.ct0,
    cookie: `auth_token=${session.authToken}; ct0=${session.ct0}`,
    "content-type": "application/json",
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    accept: "*/*",
    "accept-language": "en-US,en;q=0.9",
    referer: "https://x.com/",
  };
}

async function graphqlGet(operationName, queryId, variables, features, session, fieldToggles = null) {
  const url = new URL(`https://x.com/i/api/graphql/${queryId}/${operationName}`);
  url.searchParams.set("variables", JSON.stringify(variables));
  url.searchParams.set("features", JSON.stringify(features));
  if (fieldToggles) url.searchParams.set("fieldToggles", JSON.stringify(fieldToggles));
  const response = await fetch(url, { headers: createHeaders(session) });
  const json = await response.json();
  if (!response.ok || json.errors) {
    throw new Error(`${operationName} 请求失败：${JSON.stringify(json.errors || json).slice(0, 500)}`);
  }
  return json;
}

async function extractTweetMeta(job, target, session) {
  job.phase = "提取文章标题";
  const queryId = getQueryId("TweetResultByRestId", "fHLDP3qFEjnTqhWBVvsREg");
  const json = await graphqlGet(
    "TweetResultByRestId",
    queryId,
    {
      tweetId: target.tweetId,
      withCommunity: true,
      includePromotedContent: true,
      withVoice: true,
    },
    DEFAULT_FEATURES,
    session,
    TWEET_RESULT_FIELD_TOGGLES,
  );
  const result = json.data?.tweetResult?.result;
  const article = result?.article?.article_results?.result;
  const title =
    article?.title ||
    article?.preview_text ||
    parseTweetText(result) ||
    `${target.handle} / ${target.tweetId}`;
  const meta = {
    title: String(title).replace(/\s+/g, " ").trim(),
    url: target.canonicalUrl,
    tweetId: target.tweetId,
    metrics: {
      retweets: result?.legacy?.retweet_count ?? null,
      quotes: result?.legacy?.quote_count ?? null,
      likes: result?.legacy?.favorite_count ?? null,
      replies: result?.legacy?.reply_count ?? null,
      bookmarks: result?.legacy?.bookmark_count ?? null,
    },
    author: parseUser(result?.core?.user_results?.result),
    article: article
      ? {
          id: article.rest_id || article.id || "",
          title: article.title || "",
          preview_text: article.preview_text || "",
          plain_text: article.plain_text || "",
        }
      : null,
  };
  log(job, `文章标题：${meta.title}`);
  return meta;
}

async function graphqlSearch(variables, session) {
  const queryId = getQueryId("SearchTimeline", "6AAys3t42mosm_yTI_QENg");
  const url = new URL(`https://x.com/i/api/graphql/${queryId}/SearchTimeline`);
  url.searchParams.set("variables", JSON.stringify(variables));
  const response = await fetch(url, {
    method: "POST",
    headers: createHeaders(session),
    body: JSON.stringify({ features: DEFAULT_FEATURES, queryId }),
  });
  const json = await response.json();
  if (!response.ok || json.errors) {
    throw new Error(`SearchTimeline 请求失败：${JSON.stringify(json.errors || json).slice(0, 500)}`);
  }
  return json;
}

function timelineEntries(json, pathParts) {
  let node = json;
  for (const part of pathParts) node = node?.[part];
  return (node?.instructions || []).flatMap((instruction) => instruction.entries || []);
}

function bottomCursor(entries) {
  for (const entry of entries) {
    if (entry.content?.cursorType === "Bottom") return entry.content.value;
    if (entry.entryId?.includes("cursor-bottom")) return entry.content?.value;
  }
  return "";
}

function parseUser(result) {
  if (!result) return null;
  return {
    name: result.core?.name || result.legacy?.name || "",
    username: result.core?.screen_name || result.legacy?.screen_name || "",
    avatar: result.avatar?.image_url || result.legacy?.profile_image_url_https || "",
  };
}

function parseTweetText(tweet) {
  const note = tweet?.note_tweet?.note_tweet_results?.result;
  return (
    note?.text ||
    note?.richtext?.text ||
    note?.rich_text?.text ||
    tweet?.legacy?.full_text ||
    tweet?.legacy?.text ||
    ""
  );
}

function parseTweetResult(result, originalTweetId) {
  const tweet = result?.tweet || result;
  if (!tweet?.legacy) return null;
  const quotedId = tweet.legacy.quoted_status_id_str;
  if (originalTweetId && quotedId !== originalTweetId) return null;
  const user = parseUser(tweet.core?.user_results?.result);
  if (!user?.username) return null;
  return {
    name: user.name,
    username: `@${user.username}`,
    avatar: user.avatar,
    quote_text: parseTweetText(tweet),
    created_at: tweet.legacy.created_at || "",
    quote_url: `https://x.com/${user.username}/status/${tweet.rest_id || tweet.legacy.id_str}`,
  };
}

function extractQuotesFromJson(json, originalTweetId) {
  const quotes = [];
  const visit = (value) => {
    if (!value || typeof value !== "object") return;

    if (value.tweet_results?.result) {
      const quote = parseTweetResult(value.tweet_results.result, originalTweetId);
      if (quote) quotes.push(quote);
    }

    if (value.__typename === "Tweet" || value.tweet?.legacy) {
      const quote = parseTweetResult(value, originalTweetId);
      if (quote) quotes.push(quote);
    }

    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    for (const item of Object.values(value)) {
      if (item && typeof item === "object") visit(item);
    }
  };

  visit(json);
  return quotes;
}

function quoteDomExtractionScript() {
  return String.raw`
(() => {
  const normalize = (value) => (value || "").replace(/\u00A0/g, " ").trim();
  return Array.from(document.querySelectorAll("article")).map((card) => {
    const time = card.querySelector("time");
    const statusLink = time ? time.closest('a[href*="/status/"]') : null;
    const href = statusLink ? statusLink.getAttribute("href") || "" : "";
    const match = href.match(/^\/([^/]+)\/status\/(\d+)/);
    if (!match) return null;

    const nameBox = card.querySelector('[data-testid="User-Name"]');
    const lines = normalize(nameBox ? nameBox.innerText : "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const name = lines.find((line) => !line.startsWith("@")) || "";
    const text = normalize(
      (card.querySelector('[data-testid="tweetText"]') || {}).innerText || "",
    );
    const img = card.querySelector('img[src*="profile_images"]');

    return {
      name,
      username: "@" + match[1],
      avatar: img ? img.src : "",
      quote_text: text,
      created_at: time ? time.getAttribute("datetime") || "" : "",
      quote_url: location.origin + href,
    };
  }).filter((row) => row && row.quote_url && row.username);
})()
`;
}

function quoteKey(quote) {
  return quote?.quote_url || "";
}

function mergeQuote(map, quote) {
  const key = quoteKey(quote);
  if (!key) return false;
  const existing = map.get(key);
  if (!existing) {
    map.set(key, quote);
    return true;
  }
  map.set(key, {
    ...existing,
    ...Object.fromEntries(
      Object.entries(quote).filter(([, value]) => value !== undefined && value !== null && value !== ""),
    ),
  });
  return false;
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

async function writeOutputs(tweetId, retweeters, quotes) {
  await fsp.mkdir(OUTPUT_DIR, { recursive: true });
  const files = {
    retweetersCsv: path.join(OUTPUT_DIR, `x_${tweetId}_retweeters.csv`),
    retweetersJson: path.join(OUTPUT_DIR, `x_${tweetId}_retweeters.json`),
    quotesCsv: path.join(OUTPUT_DIR, `x_${tweetId}_quotes.csv`),
    quotesJson: path.join(OUTPUT_DIR, `x_${tweetId}_quotes.json`),
  };

  const retweetersCsv = [
    "姓名,用户名,头像",
    ...retweeters.map((row) => [row.name, row.username, row.avatar].map(csvCell).join(",")),
  ].join("\n");
  const quotesCsv = [
    "姓名,用户名,头像,引用文本,引用发布时间,引用链接",
    ...quotes.map((row) =>
      [row.name, row.username, row.avatar, row.quote_text, row.created_at, row.quote_url]
        .map(csvCell)
        .join(","),
    ),
  ].join("\n");

  await Promise.all([
    fsp.writeFile(files.retweetersCsv, `${retweetersCsv}\n`, "utf8"),
    fsp.writeFile(files.retweetersJson, JSON.stringify(retweeters, null, 2), "utf8"),
    fsp.writeFile(files.quotesCsv, `${quotesCsv}\n`, "utf8"),
    fsp.writeFile(files.quotesJson, JSON.stringify(quotes, null, 2), "utf8"),
  ]);

  return Object.fromEntries(
    Object.entries(files).map(([key, filePath]) => [
      key,
      `/output/${path.basename(filePath)}`,
    ]),
  );
}

function makeJob(url) {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const job = {
    id,
    url,
    status: "running",
    phase: "准备中",
    progress: [],
    counts: { retweeters: 0, quotes: 0 },
    files: null,
    tweet: null,
    error: "",
    createdAt: new Date().toISOString(),
  };
  jobs.set(id, job);
  return job;
}

function log(job, line) {
  job.progress.push(`[${new Date().toLocaleTimeString()}] ${line}`);
  if (job.progress.length > 200) job.progress.shift();
}

async function extractRetweeters(job, tweetId, session) {
  job.phase = "提取转发者";
  const queryId = getQueryId("Retweeters", "nPdDY4-nwRk281j8VGR4Mg");
  const seen = new Map();
  let cursor = "";
  let stalePages = 0;

  for (let page = 1; page <= 40; page += 1) {
    const variables = {
      tweetId,
      count: 100,
      enableRanking: true,
      includePromotedContent: true,
    };
    if (cursor) variables.cursor = cursor;

    const json = await graphqlGet("Retweeters", queryId, variables, RETWEETERS_FEATURES, session);
    const entries = timelineEntries(json, ["data", "retweeters_timeline", "timeline"]);
    let added = 0;
    for (const entry of entries) {
      const user = parseUser(entry.content?.itemContent?.user_results?.result);
      if (!user?.username) continue;
      const key = user.username.toLowerCase();
      if (seen.has(key)) continue;
      seen.set(key, { name: user.name, username: `@${user.username}`, avatar: user.avatar });
      added += 1;
    }
    job.counts.retweeters = seen.size;
    log(job, `转发者 page ${page}: 新增 ${added}，累计 ${seen.size}`);

    const nextCursor = bottomCursor(entries);
    if (!nextCursor || nextCursor === cursor) break;
    stalePages = added === 0 ? stalePages + 1 : 0;
    if (stalePages >= 2) break;
    cursor = nextCursor;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return [...seen.values()];
}

async function extractQuotesBySearch(job, tweetId, session, seen) {
  job.phase = "提取引用：接口搜索";
  const queries = [
    { rawQuery: tweetId, product: "Latest" },
    { rawQuery: tweetId, product: "Top" },
  ];

  for (const query of queries) {
    let cursor = "";
    let stalePages = 0;

    for (let page = 1; page <= 12; page += 1) {
      const variables = {
        rawQuery: query.rawQuery,
        count: 100,
        querySource: "typed_query",
        product: query.product,
      };
      if (cursor) variables.cursor = cursor;

      const json = await graphqlSearch(variables, session);
      const quotes = extractQuotesFromJson(json, tweetId);
      let added = 0;
      for (const quote of quotes) {
        if (mergeQuote(seen, quote)) added += 1;
      }
      job.counts.quotes = seen.size;
      log(job, `引用搜索 ${query.product} page ${page}: 新增 ${added}，累计 ${seen.size}`);

      const entries = timelineEntries(json, [
        "data",
        "search_by_raw_query",
        "search_timeline",
        "timeline",
      ]);
      const nextCursor = bottomCursor(entries);
      if (!nextCursor || nextCursor === cursor) break;
      stalePages = added === 0 ? stalePages + 1 : 0;
      if (stalePages >= 3) break;
      cursor = nextCursor;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

async function waitForJson(url, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // Keep waiting for Chrome to expose its DevTools endpoint.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Chrome DevTools 启动超时。");
}

function createCdpClient(webSocketUrl) {
  let nextId = 0;
  const pending = new Map();
  const handlers = new Set();
  const socket = new WebSocket(webSocketUrl);

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
      return;
    }
    for (const handler of handlers) handler(message);
  };

  const opened = new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });

  return {
    async send(method, params = {}, sessionId = "") {
      await opened;
      return new Promise((resolve, reject) => {
        const id = (nextId += 1);
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
    onEvent(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    async close() {
      await opened.catch(() => {});
      socket.close();
    },
  };
}

async function extractQuotesByScrolling(job, target, session, seen) {
  job.phase = "提取引用：滚动加载";

  if (!fs.existsSync(CHROME_PATH)) {
    log(job, `没有找到 Chrome：${CHROME_PATH}，跳过滚动补全。`);
    return;
  }

  const port = 9300 + Math.floor(Math.random() * 500);
  const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "x-extractor-chrome-"));
  const chrome = spawn(
    CHROME_PATH,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--disable-dev-shm-usage",
    ],
    { stdio: ["ignore", "ignore", "ignore"] },
  );

  let cdp;
  let pageSessionId = "";
  const networkRequests = new Map();
  let lastTotal = seen.size;
  let staleRounds = 0;

  try {
    const version = await waitForJson(`http://127.0.0.1:${port}/json/version`);
    cdp = createCdpClient(version.webSocketDebuggerUrl);

    cdp.onEvent(async (message) => {
      try {
        if (
          message.method === "Network.responseReceived" &&
          message.params?.response?.url?.includes("/i/api/graphql/")
        ) {
          networkRequests.set(message.params.requestId, {
            sessionId: message.sessionId,
            url: message.params.response.url,
          });
        }

        if (message.method === "Network.loadingFinished" && networkRequests.has(message.params?.requestId)) {
          const request = networkRequests.get(message.params.requestId);
          networkRequests.delete(message.params.requestId);
          const body = await cdp.send(
            "Network.getResponseBody",
            { requestId: message.params.requestId },
            request.sessionId,
          );
          const text = body.base64Encoded
            ? Buffer.from(body.body, "base64").toString("utf8")
            : body.body;
          const json = JSON.parse(text);
          let added = 0;
          for (const quote of extractQuotesFromJson(json, target.tweetId)) {
            if (mergeQuote(seen, quote)) added += 1;
          }
          if (added > 0) {
            job.counts.quotes = seen.size;
            log(job, `引用滚动网络响应: 新增 ${added}，累计 ${seen.size}`);
          }
        }
      } catch {
        // Some GraphQL responses are unrelated or already evicted by Chrome.
      }
    });

    const created = await cdp.send("Target.createTarget", { url: "about:blank" });
    const attached = await cdp.send("Target.attachToTarget", {
      targetId: created.targetId,
      flatten: true,
    });
    pageSessionId = attached.sessionId;
    await cdp.send("Network.enable", {}, pageSessionId);
    await cdp.send("Page.enable", {}, pageSessionId);
    await cdp.send("Runtime.enable", {}, pageSessionId);

    for (const domain of [".x.com", ".twitter.com"]) {
      await cdp.send(
        "Network.setCookie",
        {
          name: "auth_token",
          value: session.authToken,
          domain,
          path: "/",
          secure: true,
          httpOnly: true,
          sameSite: "None",
        },
        pageSessionId,
      );
      await cdp.send(
        "Network.setCookie",
        {
          name: "ct0",
          value: session.ct0,
          domain,
          path: "/",
          secure: true,
          httpOnly: false,
          sameSite: "Lax",
        },
        pageSessionId,
      );
    }

    await cdp.send(
      "Page.navigate",
      { url: `https://x.com/${target.handle}/status/${target.tweetId}/quotes` },
      pageSessionId,
    );
    await new Promise((resolve) => setTimeout(resolve, 9000));

    const minScrollRounds = 90;
    const maxScrollRounds = 180;

    for (let round = 1; round <= maxScrollRounds; round += 1) {
      const domRows = await cdp.send(
        "Runtime.evaluate",
        { expression: quoteDomExtractionScript(), returnByValue: true },
        pageSessionId,
      );
      let added = 0;
      for (const quote of domRows.result?.value || []) {
        if (mergeQuote(seen, quote)) added += 1;
      }
      if (added > 0) {
        job.counts.quotes = seen.size;
        log(job, `引用滚动可见卡片 round ${round}: 新增 ${added}，累计 ${seen.size}`);
      }

      await cdp.send(
        "Runtime.evaluate",
        { expression: "window.scrollBy(0, Math.max(900, window.innerHeight * 1.5)); undefined" },
        pageSessionId,
      );
      await new Promise((resolve) => setTimeout(resolve, 1200));

      const position = await cdp.send(
        "Runtime.evaluate",
        { expression: "({ y: scrollY, h: document.body.scrollHeight })", returnByValue: true },
        pageSessionId,
      );
      if (round % 10 === 0) {
        log(
          job,
          `引用滚动 round ${round}: 累计 ${seen.size}，位置 ${Math.round(
            position.result.value.y,
          )}/${Math.round(position.result.value.h)}`,
        );
      }

      staleRounds = seen.size === lastTotal ? staleRounds + 1 : 0;
      lastTotal = seen.size;
      const nearBottom =
        position.result.value.y + 1200 >= position.result.value.h ||
        position.result.value.h < 1000;
      if (round >= minScrollRounds && nearBottom && staleRounds >= 20) break;
    }
  } finally {
    if (cdp) await cdp.close();
    chrome.kill();
    await fsp.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function extractQuotes(job, target, session) {
  const seen = new Map();
  await extractQuotesBySearch(job, target.tweetId, session, seen);
  await extractQuotesByScrolling(job, target, session, seen);
  return [...seen.values()];
}

async function extractQuotesLegacy(job, tweetId, session) {
  job.phase = "提取引用";
  const seen = new Map();
  let cursor = "";
  let stalePages = 0;

  for (let page = 1; page <= 30; page += 1) {
    const variables = {
      rawQuery: tweetId,
      count: 100,
      querySource: "typed_query",
      product: "Latest",
    };
    if (cursor) variables.cursor = cursor;

    const json = await graphqlSearch(variables, session);
    const entries = timelineEntries(json, [
      "data",
      "search_by_raw_query",
      "search_timeline",
      "timeline",
    ]);
    let added = 0;
    for (const entry of entries) {
      const result = entry.content?.itemContent?.tweet_results?.result;
      const quote = parseTweetResult(result, tweetId);
      if (!quote?.quote_url || seen.has(quote.quote_url)) continue;
      seen.set(quote.quote_url, quote);
      added += 1;
    }
    job.counts.quotes = seen.size;
    log(job, `引用 page ${page}: 新增 ${added}，累计 ${seen.size}`);

    const nextCursor = bottomCursor(entries);
    if (!nextCursor || nextCursor === cursor) break;
    stalePages = added === 0 ? stalePages + 1 : 0;
    if (stalePages >= 4) break;
    cursor = nextCursor;
    await new Promise((resolve) => setTimeout(resolve, 700));
  }

  return [...seen.values()];
}

async function runJob(job) {
  try {
    const target = parseTweetUrl(job.url);
    const session = readSession();
    log(job, `开始处理 ${target.canonicalUrl}`);
    job.tweet = await extractTweetMeta(job, target, session);
    const retweeters = await extractRetweeters(job, target.tweetId, session);
    const quotes = await extractQuotes(job, target, session);
    job.phase = "写入文件";
    job.files = await writeOutputs(target.tweetId, retweeters, quotes);
    job.status = "done";
    job.phase = "完成";
    log(job, `完成：转发者 ${retweeters.length}，引用 ${quotes.length}`);
  } catch (error) {
    job.status = "error";
    job.phase = "失败";
    job.error = error instanceof Error ? error.message : String(error);
    log(job, job.error);
  }
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

async function readRequestJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function serveStatic(response, filePath) {
  try {
    const data = await fsp.readFile(filePath);
    const ext = path.extname(filePath);
    const type =
      ext === ".html"
        ? "text/html; charset=utf-8"
        : ext === ".js"
          ? "text/javascript; charset=utf-8"
          : ext === ".css"
            ? "text/css; charset=utf-8"
            : ext === ".csv"
              ? "text/csv; charset=utf-8"
              : "application/json; charset=utf-8";
    response.writeHead(200, { "content-type": type });
    response.end(data);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "POST" && url.pathname === "/api/extract") {
    try {
      const body = await readRequestJson(request);
      const job = makeJob(body.url || "");
      runJob(job);
      sendJson(response, 202, { id: job.id });
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/jobs/")) {
    const id = decodeURIComponent(url.pathname.slice("/api/jobs/".length));
    const job = jobs.get(id);
    if (!job) {
      sendJson(response, 404, { error: "任务不存在" });
      return;
    }
    sendJson(response, 200, job);
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/output/")) {
    await serveStatic(response, path.join(OUTPUT_DIR, path.basename(url.pathname)));
    return;
  }

  if (request.method === "GET") {
    const requested = url.pathname === "/" ? "/index.html" : url.pathname;
    await serveStatic(response, path.join(PUBLIC_DIR, path.basename(requested)));
    return;
  }

  response.writeHead(405);
  response.end("Method not allowed");
});

server.listen(PORT, () => {
  console.log(`X extractor running at http://localhost:${PORT}`);
});
