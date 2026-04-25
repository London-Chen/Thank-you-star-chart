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

The deployed app includes a serverless `/api/extract` endpoint. To enable online extraction on Vercel, add these Environment Variables in the Vercel project:

```text
X_AUTH_TOKEN=your_x_auth_token_cookie
X_CT0=your_x_ct0_cookie
```

Extraction results are returned to the browser and saved in that visitor's `localStorage`. The serverless endpoint does not keep each visitor's article library.

Security note: these environment variables make the public endpoint use one X session for extraction. Use a dedicated X account/session if you make the deployed extractor available to others.
