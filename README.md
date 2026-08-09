# tbstuff

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
from the database's `match_pov_videos` table. The rebuild preserves cached
Roblox CDN avatar URLs and fetches avatars only for accounts without one. Run
`python3 rebuild_tournaments.py --help` for source and avatar options.
