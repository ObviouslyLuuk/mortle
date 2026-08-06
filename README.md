# Mortle

A simple web game where a world map shows the birthplace and place of death (with years) of a famous historical figure, and you guess who they are.

Pure frontend, no build step. Hosts on GitHub Pages as-is.

## Run locally

Double-click `serve.bat` (starts a local server and opens the page), or run:

```
python -m http.server 8000
# or
npx serve
```

Then open `http://localhost:8000`. Opening `index.html` directly from disk won't work because the quiz data is loaded with `fetch`.

## How to play

- Each game is **10 rounds**, picked randomly from the figure pool.
- The **max difficulty slider** controls the pool: a setting of *N* draws only from figures rated difficulty 1 through *N* (default 1 = the easiest tier; slide up to 5 for everyone). It's always visible; moving it immediately reshuffles the current game with the new pool. Your setting is remembered in `localStorage`, and the current difficulty is shown in the header.
- The **✨ Girlypop mode** toggle (next to the slider) limits the pool to women only. Because there aren't enough difficulty-1 women to fill a game, it forces the minimum difficulty to 2. The mode is remembered in `localStorage`.
- Recently revealed figures are **de-prioritized** to avoid immediate repeats: the last rounds you saw are tracked in `localStorage` (`mortle-history`) and weighted down, but **only if you answered correctly**. Figures you got wrong are left at full weight so they come back soon and you can learn them. The penalty is strong for the last few correct rounds and recovers slowly (about half as likely 10 rounds later, fading to normal over ~40 rounds), and it applies across difficulty and mode changes.
- The **Stats** button in the header opens your lifetime stats (current score, best streak, games played, lifetime points, total correct) at any time.
- The map shows two markers: a **green** dot with a ring for the birthplace (labelled `born 1769`) and a **red** dot for the place of death (labelled `died 1821`).
- The map auto-zooms to fit both locations (clamped so you see the surrounding region) and stays zoomable/pannable. Use the reset button to reframe.
- Type your guess below the map. Keep guessing until you get it right, or reveal the answer.
- After a correct answer the full profile is revealed: portrait, name, aliases, a one-line tagline (sometimes with a famous quote), occupation, cause of death, birthplace + year, death place + year, and age at death.

## Scoring

- Correct on the 1st guess: **1 point**
- Correct on the 2nd guess: **0.5 points**
- Correct on the 3rd guess: **0.25 points**
- ...each wrong guess halves the points for that round.
- Skipping awards **0 points** and resets your streak.
- Your streak increases with each correctly answered round and resets on a skip.

**Hints (💡):** before answering you can reveal extra information, but each hint cuts that round's potential points by a factor, and they stack:

- **Occupation** ×½
- **Cause of death** ×½
- **Image** ×¼
- **Blurb** ×⅛

E.g. taking Occupation and Blurb means a first-guess correct is worth `1 × 0.5 × 0.125 = 0.0625` points. Hints reset each round.

Your lifetime stats are saved in `localStorage` (key `mortle-stats`): total points, best streak, games played, and total correct answers.

## Answer matching

Guesses are matched leniently:

- case-insensitive, accent-insensitive, special-character-insensitive
- accept the **full name**, the **last name**, or **any single name token** (so "Napoleon" counts)
- accept any listed **alias** (e.g. "Farrokh Bulsara" for Freddie Mercury, "Joan of Arc" for Jeanne d'Arc)
- tolerate small misspellings via a Levenshtein-distance threshold

Press **Enter** to submit a guess, to advance to the next round after a reveal, and to restart from the results screen.

## Difficulty ratings

Every figure has a `difficulty` score from **1 to 5**:

1. Someone 99% of people have heard of, and know roughly where they were born and died.
2. Someone 95% of people have heard of, and know roughly where they're from.
3. Someone most people have heard of vaguely.
4. Someone history nerds have likely heard of.
5. Someone even history nerds might not know.

**Rule for difficulty 1** — a figure only qualifies if *all* of these hold:
- everyone knows them, **and**
- their life or death is tied to a greater historical event/period that most people also know (e.g. WWI, WWII, the French Revolution, the American Revolution, Ancient Greece, Ancient Rome, Ancient China), **and**
- their death location is related to that event.

A very unique birthplace (e.g. Zanzibar, the Netherlands) can also count toward tier 1. If a figure fails any requirement, bump it to a higher tier.

The **max difficulty slider** is always visible; changing it reshuffles the current game so it draws only from figures up to that difficulty. The current difficulty is also shown in the header.

## Data format (`historical_figures_quiz.json`)

```jsonc
{
  "name": "Marie Curie",              // display name (the "most known" name)
  "gender": "woman",                  // used by Girlypop mode (women-only)
  "occupation": "Physicist / Chemist",
  "cause_of_death": "Radiation",
  "blurb": "pioneer of radioactivity who discovered polonium and radium",  // one-line tagline, see style notes below
  "aliases": ["Maria Sklodowska-Curie"],   // extra valid names, shown under the name in the reveal
  "difficulty": 1,                    // 1-5, see difficulty ratings above
  "birth":  { "place": "Warsaw, Russian Empire (modern day Poland)", "year": 1867, "lat": 52.2297, "lng": 21.0122 },
  "death":  { "place": "Passy, France",   "year": 1934, "lat": 45.9237, "lng": 6.6862  },
  "images": [                          // portrait + fallbacks, tried in order
    "https://upload.wikimedia.org/.../330px-....jpg",
    "https://commons.wikimedia.org/wiki/Special:FilePath/...jpg?width=320",
    "https://commons.wikimedia.org/wiki/Special:FilePath/...jpg?width=640"
  ]
}
```

Notes:

- Negative years are BC (`-356` renders as "356 BC"); the age at death is computed from the year difference.
- **Place names use the historical name and contemporary polity** (e.g. "Genoa, Republic of Genoa", "Rome, Roman Republic", "Missolonghi, Ottoman Empire (modern day Greece)"). Add "(modern day ...)" only when it genuinely clarifies: a renamed city (e.g. "Freiberg in Mähren (modern day Příbor, Czech Republic)") or a country that clearly changed (e.g. "Üsküp, Ottoman Empire (modern day Skopje, North Macedonia)"). Don't annotate the obvious (e.g. "Ulm, German Empire", not "... (modern day Germany)").
- `images` is an ordered list. If one fails to load, the next is tried; if all fail, an initials avatar is shown.
- Add, remove, or edit figures freely; the game reads the whole file each game.

### Blurb style

The `blurb` is the one-line tagline shown under the name in the reveal. Guidelines:

- Keep it a single, descriptive line.
- Prefer a striking, concrete fact over a generic description, and include notable **ages** where they're genuinely impressive (e.g. Mary Shelley: *"wrote Frankenstein at 18"*, Alexander the Great: *"...before dying at 32"*).
- Append a famous **quote** after a period when one exists and fits (e.g. `...Republic. "Veni, vidi, vici."` for Caesar, Confucius, Gandhi).
- No em dashes and no colons introducing quotes: use a plain period instead.

## Technology

- **Leaflet 1.9** with **CARTO `dark_nolabels`** tiles: a dark, land/water-only basemap with no place labels. The whole UI is dark-themed.
- Vanilla JS, no framework, no build step.
- Portraits are hotlinked from **Wikimedia Commons** (retrieved via the Wikipedia REST API).

## Deploy to GitHub Pages

1. Push this folder to a GitHub repository.
2. In the repo: **Settings → Pages → Build and deployment → Deploy from a branch → `main`**.
3. The game is live at `https://<user>.github.io/<repo>/`.

The JSON `fetch` works fine on GitHub Pages (same origin).

## Attribution

- Quiz concept by [@solunaaaa16](https://www.instagram.com/solunaaaa16/).
- Map tiles © OpenStreetMap contributors, © CARTO.
- Portraits © their original uploaders via Wikimedia Commons.
