# Galaxy Movies Devvit app

Posts a weekly streaming-availability digest to the subreddit it is installed on
(r/galaxymovies). Content is fetched read-only from galaxymovies.app; the app
posts once per week and collects no user data.

## Fetch Domains

The following domains are requested for this app:

- `www.galaxymovies.app` — fetches the weekly broadcast payload
  (`/api/reddit-payload`, a public read-only JSON endpoint returning the digest
  title, body text, link, and a weekly dedupe key). The app performs no other
  outbound requests.

## Commands

- `npm run build` — bundle the server to `dist/server`
- `npm run dev` — `devvit playtest` against a test subreddit
- `npm run upload` — upload a version to the Developer Portal
