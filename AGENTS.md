# Afrinext

Mobile-first PWA marketplace directory for African businesses. Next.js 16 (App
Router) + React 19 + TypeScript + Tailwind CSS v4.

## Commands

```bash
npm run dev      # dev server
npm run build    # production build (also typechecks)
npm run lint     # eslint — must be clean before committing
npm run start    # serve the production build
```

## Conventions

- **Mobile first.** The layout is capped at `max-w-md` and centred; every page
  sits above a fixed bottom tab bar. Use the `app-scroll` class's bottom padding
  and `env(safe-area-inset-*)` rather than hard-coded offsets.
- **Colours come from CSS variables** in `src/app/globals.css`, exposed to
  Tailwind through `@theme inline` (`bg-surface`, `text-muted`, `bg-primary`…).
  Do not hard-code hex values in components — both light and dark palettes are
  defined there.
- **Server components by default.** Add `"use client"` only for interactivity
  (nav, filters, forms, save button).
- **All storage goes through `src/lib/store.ts`.** It is an in-memory store
  today; keep the read/write surface there so it can be swapped for a database.
- Submissions are validated in `src/lib/validate.ts`, used by the API route.
  Client-side checks are a convenience — the server always revalidates.
- Search and filter logic lives in `src/lib/search.ts` and is driven entirely by
  URL search params, so results are linkable and the back button works.

## PWA

`public/manifest.webmanifest`, `public/sw.js` and
`src/components/ServiceWorker.tsx`. The worker is network-first for navigations,
cache-first for `/_next/static`, and falls back to `/offline`. Bump `CACHE` in
`sw.js` when changing precached assets.
