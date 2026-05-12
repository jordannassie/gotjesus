# GotJesus Reel Engine

Generate viral 9:16 Got Jesus? reels, add the official logo end card, and schedule them for social posting.

---

## Local Development

**Install dependencies**

```bash
npm install
```

**Run the development server**

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

**Build for production**

```bash
npm run build
```

---

## Deployment

This app is designed to be connected to [Netlify](https://www.netlify.com/) directly from GitHub.

1. Push this repo to GitHub.
2. In the Netlify dashboard, click **Add new site > Import an existing project**.
3. Connect your GitHub repo (`jordannassie/gotjesus`).
4. Netlify will auto-detect Next.js and configure the build settings.
5. Deploy.

No manual plugin installation is required — Netlify handles Next.js automatically.

---

## Video Format

Video generation defaults to 9:16 at 720p. Resolution is configurable through `KIE_VIDEO_RESOLUTION` if Kie.ai supports another accepted value.

---

## Tech Stack

- [Next.js](https://nextjs.org/) (App Router)
- TypeScript
- Tailwind CSS
- ESLint
