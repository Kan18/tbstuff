# tbstuff

Live site: [Tower Battles Tournament Archive](https://kan18.github.io/tbstuff/tournaments/)

## Updating the tournament archive

The current database lives at:

- `~/tbc_scraping/tbc_main_data/main_tournaments.sqlite`

Prediction and rating exports live in `~/tbpredictions/`:

- `all_match_win_predictions.csv`
- `historical_player_leaderboards_wide_elo.csv`

Then run:

```sh
python3 rebuild_tournaments.py
```

The script copies the database into this repository and regenerates
`tournaments/data.js`, `predictions.js`, and `ratings.js`. Predictions and
ratings are always updated together. Tournament match videos are included sparsely in `data.js`
from the database's `match_pov_videos` table. The rebuild refreshes every Roblox
avatar because Roblox's CDN URLs expire. Run
`python3 rebuild_tournaments.py --help` for source and avatar options.

The database copy and generated site are ignored by Git. The compact JavaScript
data files are the committed source used to publish the archive.

## Building the published site

Run:

```sh
node build_site.js
```

This writes the complete GitHub Pages artifact to `_site/`, including static
event, tournament, and player pages plus `tournaments/sitemap.xml`. GitHub
Actions runs the same command and deploys the artifact whenever `main` changes,
so generated pages are never committed.
