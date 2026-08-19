# Afrinext

A mobile-first marketplace directory for African businesses — search verified
suppliers, artisans, logistics and services across the continent, or list your
own business.

Built as an installable PWA with Next.js 16 (App Router), React 19, TypeScript
and Tailwind CSS v4. It runs in a phone browser and installs to the home screen
with a standalone app shell, bottom tab navigation and an offline fallback.

## Getting started

```bash
npm install
npm run dev      # http://localhost:3000
```

Other scripts:

```bash
npm run build    # production build
npm run start    # serve the production build
npm run lint     # eslint
```

The service worker only registers in production builds, so `npm run dev` never
serves stale assets.

## What's in the app

| Route           | What it does                                                     |
| --------------- | ---------------------------------------------------------------- |
| `/`             | Hero search, category grid, verified picks and recently added     |
| `/browse`       | Keyword search with category, country, verified and sort filters  |
| `/listing/[id]` | Business detail: description, tap-to-call/email contacts, related |
| `/submit`       | Validated form to publish a new listing                           |
| `/saved`        | Bookmarked listings, kept in `localStorage` on the device         |
| `/offline`      | Fallback rendered by the service worker when the network is gone  |

### API

| Endpoint             | Method | Notes                                                       |
| -------------------- | ------ | ----------------------------------------------------------- |
| `/api/listings`      | `GET`  | Accepts `q`, `category`, `country`, `verified`, `sort`       |
| `/api/listings`      | `POST` | Creates a listing; `422` with per-field errors on bad input  |
| `/api/listings/[id]` | `GET`  | Single listing, `404` when unknown                           |

```bash
curl 'http://localhost:3000/api/listings?category=logistics&verified=1'
```

## Project layout

```
src/
  app/          routes, API handlers, layout and global styles
  components/   UI: nav, header, cards, forms, save button
  lib/          types, categories, seed data, store, search, validation
public/         manifest, icons, service worker
```

## Data

Listings are seeded from `src/lib/seed.ts` into an in-memory store
(`src/lib/store.ts`). Submissions are appended at runtime and live for the
lifetime of the server process — restarting resets to the seed set. `store.ts`
is the only module that touches storage, so swapping it for a real database
does not affect the rest of the app.
