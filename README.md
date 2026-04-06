# Wordle Friends Leaderboard

Static front end for GitHub Pages, backed by Supabase for auth, database, and screenshot storage.

## What this starter includes
- GitHub Pages friendly static site
- Wordle share-text parser
- Email/password + magic-link ready auth helpers
- Submit form for share text + screenshot
- Today page, leaderboard page, daily archive page, profile page
- Supabase SQL schema and policy starter

## Project structure
- `index.html` — home / today's puzzle / submit form
- `leaderboard.html` — all-time and recent leaderboard
- `daily.html` — daily results by puzzle number
- `profile.html` — logged-in player's stats/history
- `css/styles.css` — theme and layout
- `js/config.example.js` — copy to `js/config.js` and fill in keys
- `js/supabase-client.js` — creates Supabase client
- `js/parser.js` — parses Wordle share text
- `js/auth.js` — sign up / sign in / sign out / session helpers
- `js/app.js` — home page logic
- `js/leaderboard.js` — leaderboard logic
- `js/daily.js` — daily results logic
- `js/profile.js` — profile logic
- `sql/schema.sql` — tables, storage notes, policies starter

## Setup
1. Create a Supabase project.
2. Run `sql/schema.sql` in the Supabase SQL editor.
3. In Supabase Storage, create a bucket named `screenshots`.
4. Copy `js/config.example.js` to `js/config.js` and add your project URL and anon key.
5. Push these files to a GitHub repo.
6. Enable GitHub Pages on the repo.

## Important note about screenshot visibility
This front end only requests screenshots after checking whether the viewer has already submitted that day's puzzle. The final lock/unlock rule should also be enforced with database / storage policies in Supabase.

## Local testing
Because this uses ES modules, serve it with a simple local server:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## GitHub Pages
You can host this directly from the repo root or from a `docs/` folder. If you want, I can restructure this starter specifically for your preferred GitHub Pages setup next.


## Added in this version
- Chicago-time weekly leaderboard (resets Monday)
- Chicago-time calendar-month leaderboard
- Play Today's Puzzle button on the home page
- Past Answers page backed by the Wordle Hints API
- 12-hour browser caching for Past Answers responses to reduce repeated API calls


## New in v4
- Private `avatars` bucket for circular profile pictures
- Catchphrase field on profiles
- Chicago-based week/month leaderboard windows
- Consistent `Wordle Nerdles` page titles and headers

### Supabase reminder
After updating, re-run `sql/schema.sql` and create a private storage bucket named `avatars` with image MIME types enabled.


## v5 update
- Avatars now show on the home race board, archive results, and leaderboard tables.
- Catchphrases appear under names when available.
