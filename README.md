# Thank You Star Chart

Turn the retweeters and quote posts from an X post into a personal, recordable gratitude star chart.

The app runs locally, can be deployed as a static Vite site, and can be customized without touching the source code.

## Features

- Animated canvas star chart for retweeters and quote posts
- Search and filter supporters by name, handle, or quote text
- Article library stored in browser `localStorage`
- CSV upload for your own retweeter and quote data
- Optional X post extraction endpoint for local use or Vercel deployment
- Public customization through `public/star-chart.config.json`

## Local Preview

```bash
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:5173/
```

## Customize Your Chart

Edit `public/star-chart.config.json`:

```json
{
  "brandName": "Your Name",
  "appTitle": "Thank You Star Chart",
  "pageTitle": "Your Thank You Star Chart",
  "heroTitle": "Every light is someone who carried your work a little farther.",
  "defaultArticleTitle": "My First Article",
  "defaultRetweetersCsv": "/output/sample_retweeters.csv",
  "defaultQuotesCsv": "/output/sample_quotes.csv"
}
```

Put replacement demo CSV files under `public/output/`, then update `defaultRetweetersCsv` and `defaultQuotesCsv`.

Expected CSV headers:

- Retweeters: `姓名,用户名,头像`
- Quotes: `user_name,quote_text,created_at,quote_url`

## Optional Local X Extraction

The Vite dev server proxies `/api` and `/output` to the local extractor at `http://127.0.0.1:3000`.

First extract your X session locally with `xreach`:

```bash
xreach auth extract --browser chrome --profile Default
```

Then start the extractor:

```bash
cd x-extractor
npm run start
```

In another terminal, start the chart:

```bash
npm run dev
```

The extractor reads local login data from `~/.config/xfetch/session.json`, writes generated files to `x-extractor/output/`, and does not commit those generated files.

## Deploy To Vercel

- Framework Preset: `Vite`
- Build Command: `npm run build`
- Output Directory: `dist`

The public demo data lives in `public/output/` so the static site can load an initial star chart after deployment.

To enable the serverless `/api/extract` endpoint on Vercel, add these environment variables:

```text
X_AUTH_TOKEN=your_x_auth_token_cookie
X_CT0=your_x_ct0_cookie
```

Security note: these variables make the public endpoint use one X session for extraction. Use a dedicated X account/session if you make the deployed extractor available to others.

## License

MIT
