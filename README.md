# tbstuff

## Updating the tournament archive

Put these current exports in `~/Downloads/tbc_main_data/`:

- `main_tournaments.sqlite`
- `all_match_win_predictions.csv`
- `historical_player_leaderboards_wide_elo.csv`

Then run:

```sh
python3 rebuild_tournaments.py
```

The script regenerates `tournaments/data.js`, `predictions.js`, and
`ratings.js`. It preserves cached Roblox CDN avatar URLs and fetches avatars
only for accounts without one. Run `python3 rebuild_tournaments.py --help` for
source-folder, avatar, and rating options.
