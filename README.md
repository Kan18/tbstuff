# tbstuff

## Updating the tournament archive

The current exports live in `~/tbpredictions/`:

- `main_tournaments.sqlite`
- `all_match_win_predictions.csv`
- `historical_player_leaderboards_wide_elo.csv`

Then run:

```sh
python3 rebuild_tournaments.py
```

The script regenerates `tournaments/data.js`, `predictions.js`, and
`ratings.js`. Tournament match videos are included sparsely in `data.js`
from the database's `match_pov_videos` table. The rebuild preserves cached
Roblox CDN avatar URLs and fetches avatars only for accounts without one. Run
`python3 rebuild_tournaments.py --help` for source-folder, avatar, and rating
options.
