#!/usr/bin/env python3
"""Rebuild the static tournament-site data from the main data exports.

By default this reads ~/Downloads/tbc_main_data and updates:

  tournaments/data.js
  tournaments/predictions.js
  tournaments/ratings.js

Only Python's standard library is required. Existing Roblox CDN avatar URLs are
preserved; newly seen accounts are fetched from Roblox's thumbnail API unless
--no-fetch-avatars is passed.
"""

import argparse
import csv
import json
import sqlite3
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SITE = ROOT / "tournaments"
TYPE_CODES = {
    "single elimination": "SE",
    "double elimination": "DE",
    "round robin": "RR",
}
STATE_CODES = {"complete": 0, "open": 1, "pending": 2}


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        default=Path.home() / "Downloads" / "tbc_main_data",
        help="folder containing the SQLite database and CSV exports",
    )
    parser.add_argument(
        "--refresh-avatars",
        action="store_true",
        help="request fresh CDN URLs for every resolved Roblox account",
    )
    parser.add_argument(
        "--no-fetch-avatars",
        action="store_true",
        help="do not fetch avatars for accounts without a cached URL",
    )
    parser.add_argument(
        "--skip-ratings",
        action="store_true",
        help="leave ratings.js unchanged",
    )
    return parser.parse_args()


def read_js(path, prefix):
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8").strip()
    if not text.startswith(prefix) or not text.endswith(";"):
        raise ValueError(f"{path} is not a valid {prefix} payload")
    return json.loads(text[len(prefix) : -1])


def write_js(path, prefix, value):
    path.write_text(
        prefix + json.dumps(value, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )


def normalize(value):
    return (value or "").strip().lower()


def fetch_avatars(user_ids, avatars):
    """Resolve final CDN URLs in API-sized batches, retaining cached values."""
    for start in range(0, len(user_ids), 100):
        batch = user_ids[start : start + 100]
        query = urllib.parse.urlencode(
            {
                "userIds": ",".join(str(user_id) for user_id in batch),
                "size": "48x48",
                "format": "Png",
                "isCircular": "true",
            }
        )
        request = urllib.request.Request(
            "https://thumbnails.roblox.com/v1/users/avatar-headshot?" + query,
            headers={"User-Agent": "TBC-Stats-Static-Exporter/1.0"},
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = json.load(response)
        except Exception as error:
            print(f"WARNING: avatar batch failed: {error}", file=sys.stderr)
            continue
        returned = set()
        for item in payload.get("data", []):
            user_id = int(item["targetId"])
            returned.add(user_id)
            avatars[user_id] = item.get("imageUrl") if item.get("state") == "Completed" else None
        for user_id in batch:
            if user_id not in returned:
                avatars[user_id] = None
        print(f"Resolved avatars {min(start + 100, len(user_ids))}/{len(user_ids)}")


def grouped(rows):
    result = {}
    for row in rows:
        result.setdefault(row["tournament_url"], []).append(row)
    return result


def rebuild_data(database_path, fetch_missing_avatars, refresh_avatars):
    old_data = read_js(SITE / "data.js", "window.TBC_DATA=") or {"players": []}
    avatars = {
        player[0]: player[3]
        for player in old_data.get("players", [])
        if isinstance(player[0], int) and len(player) > 3
    }

    db = sqlite3.connect(database_path)
    db.row_factory = sqlite3.Row

    groups = db.execute(
        "SELECT group_id, group_title, date_span FROM tournament_groups ORDER BY group_id"
    ).fetchall()
    group_index = {group["group_id"]: index for index, group in enumerate(groups)}

    unresolved_rows = db.execute(
        """
        SELECT raw_name FROM participant_members
        WHERE is_resolved = 0
          AND COALESCE(candidate_source, '') <> 'manual_ignore_raw_member'
        GROUP BY LOWER(TRIM(raw_name))
        ORDER BY LOWER(TRIM(raw_name))
        """
    ).fetchall()
    unresolved = {
        normalize(row["raw_name"]): (
            "unresolved:" + normalize(row["raw_name"]),
            row["raw_name"],
        )
        for row in unresolved_rows
    }

    users = db.execute(
        "SELECT id, username, display_name FROM roblox_users ORDER BY id"
    ).fetchall()
    if refresh_avatars:
        avatar_ids = [user["id"] for user in users]
    else:
        avatar_ids = [user["id"] for user in users if not avatars.get(user["id"])]
    if fetch_missing_avatars and avatar_ids:
        fetch_avatars(avatar_ids, avatars)

    players = [
        [
            user["id"],
            user["username"],
            user["display_name"] if user["display_name"] != user["username"] else None,
            avatars.get(user["id"]),
        ]
        for user in users
    ]
    players.extend([key, name, None, None] for key, name in unresolved.values())

    parts_by_url = grouped(
        db.execute(
            "SELECT * FROM participants ORDER BY tournament_url,"
            " (seed IS NULL), seed, challonge_participant_id"
        ).fetchall()
    )
    members_by_url = grouped(
        db.execute(
            "SELECT * FROM participant_members ORDER BY tournament_url,"
            " challonge_participant_id, member_index"
        ).fetchall()
    )
    matches_by_url = grouped(
        db.execute("SELECT * FROM matches ORDER BY tournament_url, identifier").fetchall()
    )
    winners_by_url = grouped(
        db.execute(
            "SELECT * FROM tournament_winners ORDER BY tournament_url, winner_index"
        ).fetchall()
    )
    overrides = {
        row["tournament_url"]: row
        for row in db.execute("SELECT * FROM tournament_result_overrides")
    }
    override_entries = grouped(
        db.execute(
            "SELECT * FROM tournament_result_override_entries"
            " ORDER BY tournament_url, entry_kind, entry_index"
        ).fetchall()
    )

    tournaments = []
    url_to_slug = {}
    unresolved_occurrences = 0
    ignored_occurrences = 0
    tournament_rows = db.execute(
        "SELECT * FROM tournaments ORDER BY created_on_iso,"
        " tournament_group_id, tournament_group_order"
    ).fetchall()
    for tournament in tournament_rows:
        url = tournament["url"]
        url_to_slug[url.rstrip("/")] = tournament["slug"]
        identities_by_participant = {}
        raw_by_participant = {}
        for member in members_by_url.get(url, []):
            if member["is_resolved"] and member["roblox_user_id"] is not None:
                identity = member["roblox_user_id"]
            else:
                item = unresolved.get(normalize(member["raw_name"]))
                if item and member["candidate_source"] != "manual_ignore_raw_member":
                    identity = item[0]
                    unresolved_occurrences += 1
                else:
                    identity = member["raw_name"] or "?"
                    ignored_occurrences += 1
            participant_id = member["challonge_participant_id"]
            identities_by_participant.setdefault(participant_id, []).append(identity)
            link_identity = (
                identity
                if isinstance(identity, int) or str(identity).startswith("unresolved:")
                else None
            )
            raw_by_participant.setdefault(participant_id, []).append(
                [member["raw_name"] or "?", link_identity]
            )

        source_parts = parts_by_url.get(url, [])
        participant_to_local = {
            part["challonge_participant_id"]: index
            for index, part in enumerate(source_parts)
        }

        def local(participant_id):
            if participant_id is None:
                return -1
            if participant_id not in participant_to_local:
                raise ValueError(f"{url}: unknown participant ID {participant_id}")
            return participant_to_local[participant_id]

        parts = [
            [
                part["seed"],
                part["display_name"],
                identities_by_participant.get(part["challonge_participant_id"], []),
                raw_by_participant.get(part["challonge_participant_id"], []),
            ]
            for part in source_parts
        ]
        matches = []
        for match in matches_by_url.get(url, []):
            scores = json.loads(match["scores_json"]) if match["scores_json"] else []
            matches.append(
                [
                    match["identifier"],
                    match["round"],
                    local(match["player1_participant_id"]),
                    local(match["player2_participant_id"]),
                    local(match["winner_participant_id"]),
                    scores[0] if scores else None,
                    scores[1] if len(scores) > 1 else None,
                    match["player1_prereq_identifier"],
                    match["player2_prereq_identifier"],
                    STATE_CODES.get(match["state"], 0),
                ]
            )

        override = None
        if url in overrides:
            source_override = overrides[url]
            override = {
                "type": source_override["override_type"],
                "reason": source_override["reason"],
                "entries": [
                    [
                        entry["entry_kind"],
                        entry["entry"],
                        entry["record"],
                        local(entry["challonge_participant_id"]),
                    ]
                    for entry in override_entries.get(url, [])
                ],
            }

        tournaments.append(
            {
                "slug": tournament["slug"],
                "url": url,
                "title": tournament["title"],
                "date": tournament["created_on_iso"],
                "g": group_index[tournament["tournament_group_id"]],
                "go": tournament["tournament_group_order"],
                "bk": tournament["bracket_kind"],
                "v": tournament["tbc_version"],
                "s": tournament["session"],
                "ts": tournament["team_size_category"],
                "type": TYPE_CODES.get(
                    tournament["module_tournament_type"],
                    tournament["module_tournament_type"] or "?",
                ),
                "ws": tournament["winner_source"],
                "parts": parts,
                "matches": matches,
                "winners": [
                    local(winner["challonge_participant_id"])
                    for winner in winners_by_url.get(url, [])
                ],
                "override": override,
            }
        )

    payload = {
        "generated": date.today().isoformat(),
        "groups": [
            [group["group_id"], group["group_title"], group["date_span"]]
            for group in groups
        ],
        "players": players,
        "tournaments": tournaments,
    }
    write_js(SITE / "data.js", "window.TBC_DATA=", payload)
    db.close()
    return {
        "url_to_slug": url_to_slug,
        "groups": len(groups),
        "tournaments": len(tournaments),
        "players": len(players),
        "resolved_players": len(users),
        "unresolved_players": len(unresolved),
        "unresolved_ids": {item[0] for item in unresolved.values()},
        "unresolved_occurrences": unresolved_occurrences,
        "ignored_occurrences": ignored_occurrences,
        "matches": sum(len(tournament["matches"]) for tournament in tournaments),
        "entries": sum(len(tournament["parts"]) for tournament in tournaments),
    }


def rebuild_predictions(csv_path, url_to_slug):
    predictions = {}
    row_count = 0
    with csv_path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            probability = row["recommended_player1_win_probability"]
            if not probability:
                continue
            url = row["tournament_url"].rstrip("/")
            if url not in url_to_slug:
                raise ValueError(f"Prediction references unknown tournament: {url}")
            slug = url_to_slug[url]
            predictions.setdefault(slug, {})[row["identifier"]] = round(
                float(probability) * 10000
            )
            row_count += 1
    write_js(
        SITE / "predictions.js",
        "window.TBC_MATCH_PREDICTIONS=",
        {
            "source": csv_path.name,
            "probability": "recommended",
            "matches": predictions,
        },
    )
    return {"prediction_tournaments": len(predictions), "predictions": row_count}


def rebuild_ratings(csv_path, site_player_ids, site_unresolved_ids):
    snapshots = {}
    series = defaultdict(list)
    rating_unresolved = set()
    row_count = 0
    with csv_path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            row_count += 1
            snapshot = int(row["snapshot_index"]) - 1
            snapshots.setdefault(
                snapshot,
                [row["tournament_group_id"], row["event_date"], row["event_key"]],
            )
            if row["identity_status"] == "resolved":
                identity = int(row["roblox_user_id"])
            else:
                identity = row["player_key"]
                rating_unresolved.add(identity)
            if identity not in site_player_ids:
                raise ValueError(f"Rating references unknown player identity: {identity}")
            series[identity].append((snapshot, int(row["wide_elo_rating"])))

    unknown_unresolved = rating_unresolved - site_unresolved_ids
    if unknown_unresolved:
        raise ValueError(f"Ratings contain unknown unresolved identities: {unknown_unresolved}")
    unrated_unresolved = site_unresolved_ids - rating_unresolved
    if unrated_unresolved:
        print(
            f"NOTE: {len(unrated_unresolved)} unresolved players do not yet have ratings.",
            file=sys.stderr,
        )
    if sorted(snapshots) != list(range(len(snapshots))):
        raise ValueError("Rating snapshots are not contiguous")

    players = []
    for identity in sorted(series, key=lambda value: (isinstance(value, str), str(value))):
        values = series[identity]
        start = values[0][0]
        if [index for index, _ in values] != list(range(start, start + len(values))):
            raise ValueError(f"Rating history is not contiguous for {identity}")
        ratings = [rating for _, rating in values]
        players.append(
            [
                identity,
                start,
                ratings[0],
                *[
                    current - previous
                    for previous, current in zip(ratings, ratings[1:])
                ],
            ]
        )

    write_js(
        SITE / "ratings.js",
        "window.TBC_RATING_HISTORY=",
        {
            "source": csv_path.name,
            "rating": "wide_elo_rating",
            "encoding": "delta",
            "snapshots": [snapshots[index] for index in range(len(snapshots))],
            "players": players,
        },
    )
    return {
        "rating_snapshots": len(snapshots),
        "rating_players": len(players),
        "rating_rows": row_count,
    }


def main():
    args = parse_args()
    source = args.source.expanduser().resolve()
    database = source / "main_tournaments.sqlite"
    predictions_csv = source / "all_match_win_predictions.csv"
    ratings_csv = source / "historical_player_leaderboards_wide_elo.csv"
    required = [database, predictions_csv]
    if not args.skip_ratings:
        required.append(ratings_csv)
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        raise FileNotFoundError("Missing source files:\n" + "\n".join(missing))

    summary = rebuild_data(
        database,
        fetch_missing_avatars=not args.no_fetch_avatars,
        refresh_avatars=args.refresh_avatars,
    )
    summary.update(rebuild_predictions(predictions_csv, summary.pop("url_to_slug")))
    unresolved_ids = summary.pop("unresolved_ids")
    if not args.skip_ratings:
        player_data = read_js(SITE / "data.js", "window.TBC_DATA=")
        player_ids = {player[0] for player in player_data["players"]}
        summary.update(rebuild_ratings(ratings_csv, player_ids, unresolved_ids))

    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
