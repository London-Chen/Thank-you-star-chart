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
  subscriptions_feature_can_gift_premium: true,
  responsive_web_grok_show_grok_translated_post: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: true,
  rweb_video_screen_enabled: true,
};

const RETWEETERS_FEATURES = {
  ...DEFAULT_FEATURES,
  rweb_video_screen_enabled: false,
  responsive_web_profile_redirect_enabled: false,
  premium_content_api_read_enabled: false,
  longform_notetweets_inline_media_enabled: false,
  responsive_web_grok_annotations_enabled: true,
  content_disclosure_indicator_enabled: true,
  content_disclosure_ai_generated_indicator_enabled: true,
  post_ctas_fetch_enabled: true,
};

const TWEET_FIELD_TOGGLES = {
  withArticleRichContentState: true,
  withArticlePlainText: true,
  withArticleSummaryText: true,
  withArticleVoiceOver: true,
  withGrokAnalyze: false,
  withDisallowedReplyControls: true,
};

const QUERY_IDS = {
  TweetResultByRestId: "fHLDP3qFEjnTqhWBVvsREg",
  Retweeters: "nPdDY4-nwRk281j8VGR4Mg",
  SearchTimeline: "6AAys3t42mosm_yTI_QENg",
};

function parseTweetUrl(input) {
  const parsed = new URL(input);
  const match = parsed.pathname.match(/\/([^/]+)\/status\/(\d+)/);
  if (!match) throw new Error("链接里没有找到 /status/<tweetId>。");
  return {
    handle: match[1],
    tweetId: match[2],
    canonicalUrl: `https://x.com/${match[1]}/status/${match[2]}`,
  };
}

function sessionFromEnv() {
  const authToken = process.env.X_AUTH_TOKEN;
  const ct0 = process.env.X_CT0;
  if (!authToken || !ct0) {
    throw new Error("Vercel 还没有配置 X_AUTH_TOKEN 和 X_CT0 环境变量。");
  }
  return { authToken, ct0 };
}

function headers(session) {
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

async function graphqlGet(operationName, variables, features, session, fieldToggles) {
  const url = new URL(`https://x.com/i/api/graphql/${QUERY_IDS[operationName]}/${operationName}`);
  url.searchParams.set("variables", JSON.stringify(variables));
  url.searchParams.set("features", JSON.stringify(features));
  if (fieldToggles) url.searchParams.set("fieldToggles", JSON.stringify(fieldToggles));
  const response = await fetch(url, { headers: headers(session) });
  const json = await response.json();
  if (!response.ok || json.errors) {
    throw new Error(`${operationName} 请求失败：${JSON.stringify(json.errors || json).slice(0, 300)}`);
  }
  return json;
}

async function graphqlSearch(variables, session) {
  const url = new URL(`https://x.com/i/api/graphql/${QUERY_IDS.SearchTimeline}/SearchTimeline`);
  url.searchParams.set("variables", JSON.stringify(variables));
  const response = await fetch(url, {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ features: DEFAULT_FEATURES, queryId: QUERY_IDS.SearchTimeline }),
  });
  const json = await response.json();
  if (!response.ok || json.errors) {
    throw new Error(`SearchTimeline 请求失败：${JSON.stringify(json.errors || json).slice(0, 300)}`);
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
  return note?.text || note?.richtext?.text || tweet?.legacy?.full_text || tweet?.legacy?.text || "";
}

function parseTweetResult(result, originalTweetId) {
  const tweet = result?.tweet || result;
  if (!tweet?.legacy) return null;
  if (originalTweetId && tweet.legacy.quoted_status_id_str !== originalTweetId) return null;
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
      value.forEach(visit);
      return;
    }
    Object.values(value).forEach(visit);
  };
  visit(json);
  return quotes;
}

async function extractTweetMeta(target, session) {
  const json = await graphqlGet(
    "TweetResultByRestId",
    { tweetId: target.tweetId, withCommunity: true, includePromotedContent: true, withVoice: true },
    DEFAULT_FEATURES,
    session,
    TWEET_FIELD_TOGGLES,
  );
  const result = json.data?.tweetResult?.result;
  const article = result?.article?.article_results?.result;
  const title =
    article?.title || article?.preview_text || parseTweetText(result) || `${target.handle} / ${target.tweetId}`;
  return {
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
  };
}

async function extractRetweeters(tweetId, session) {
  const seen = new Map();
  let cursor = "";
  for (let page = 1; page <= 8; page += 1) {
    const variables = { tweetId, count: 100, enableRanking: true, includePromotedContent: true };
    if (cursor) variables.cursor = cursor;
    const json = await graphqlGet("Retweeters", variables, RETWEETERS_FEATURES, session);
    const entries = timelineEntries(json, ["data", "retweeters_timeline", "timeline"]);
    for (const entry of entries) {
      const user = parseUser(entry.content?.itemContent?.user_results?.result);
      if (!user?.username) continue;
      seen.set(user.username.toLowerCase(), {
        name: user.name,
        username: `@${user.username}`,
        avatar: user.avatar,
      });
    }
    const nextCursor = bottomCursor(entries);
    if (!nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
  }
  return [...seen.values()];
}

async function extractQuotes(tweetId, session) {
  const seen = new Map();
  for (const product of ["Latest", "Top"]) {
    let cursor = "";
    for (let page = 1; page <= 8; page += 1) {
      const variables = { rawQuery: tweetId, count: 100, querySource: "typed_query", product };
      if (cursor) variables.cursor = cursor;
      const json = await graphqlSearch(variables, session);
      for (const quote of extractQuotesFromJson(json, tweetId)) {
        if (quote.quote_url) seen.set(quote.quote_url, quote);
      }
      const entries = timelineEntries(json, [
        "data",
        "search_by_raw_query",
        "search_timeline",
        "timeline",
      ]);
      const nextCursor = bottomCursor(entries);
      if (!nextCursor || nextCursor === cursor) break;
      cursor = nextCursor;
    }
  }
  return [...seen.values()];
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("allow", "POST");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const target = parseTweetUrl(request.body?.url || "");
    const session = sessionFromEnv();
    const tweet = await extractTweetMeta(target, session);
    const [retweeters, quotes] = await Promise.all([
      extractRetweeters(target.tweetId, session),
      extractQuotes(target.tweetId, session),
    ]);
    response.status(200).json({
      status: "done",
      tweet,
      retweeters,
      quotes,
      counts: { retweeters: retweeters.length, quotes: quotes.length },
      note: "serverless",
    });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
