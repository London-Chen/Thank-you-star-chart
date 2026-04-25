# Thank You Star Chart

把 X 推文的转发者与引用者数据变成一张可录屏、可展示的感谢星图。

## Local Preview

```bash
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:5173/
```

## Deploy To Vercel

- Framework Preset: `Vite`
- Build Command: `npm run build`
- Output Directory: `dist`

The public demo data lives in `public/output/` so the static site can load an initial star chart after deployment.

## X Extraction

The in-page extraction form is designed for local use with the companion `x-extractor` service. It depends on a local authenticated X session, so it is not intended to run from the public Vercel demo yet.
