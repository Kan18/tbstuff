#!/usr/bin/env python3
"""Rebuild the static tournament-site data from the main data exports.

By default this copies the current database from ~/tbc_scraping/tbc_main_data,
reads prediction and rating exports from ~/tbpredictions, and updates:

  tournaments/data.js
  tournaments/predictions.js
  tournaments/ratings.js

The prediction source's local Python dependencies are used to reconstruct the
current branch-specific rating states for the bracket simulator. Roblox CDN
avatar URLs are refreshed on every rebuild unless --no-fetch-avatars is passed
because those URLs expire.
"""

import argparse
import csv
import json
import math
import re
import shutil
import sqlite3
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from dataclasses import asdict
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
        "--database",
        type=Path,
        default=Path.home() / "tbc_scraping" / "tbc_main_data" / "main_tournaments.sqlite",
        help="current main_tournaments.sqlite export",
    )
    parser.add_argument(
        "--model-source",
        type=Path,
        default=Path.home() / "tbpredictions",
        help="folder containing prediction and rating CSV exports",
    )
    parser.add_argument(
        "--no-fetch-avatars",
        action="store_true",
        help="preserve cached avatar URLs instead of requesting fresh ones",
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


def unresolved_player_route(identity):
    name = identity.removeprefix("unresolved:")
    slug = re.sub(r"[^a-z0-9]+", "-", name).strip("-")
    if not slug:
        raise ValueError(f"Cannot build a player route for {identity!r}")
    return "unresolved-" + slug


def is_avatar_headshot_url(image_url):
    """Reject Roblox's unavailable and moderated-image placeholder URLs."""
    return bool(image_url and "/AvatarHeadshot/" in image_url)


def fetch_avatars(user_ids, avatars):
    """Resolve current CDN URLs in API-sized batches and retry pending images."""
    requested_count = len(user_ids)
    remaining = list(dict.fromkeys(user_ids))
    for attempt in range(1, 4):
        retry_ids = []
        for start in range(0, len(remaining), 100):
            batch = remaining[start : start + 100]
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
                retry_ids.extend(batch)
                continue

            returned = {
                int(item["targetId"]): item
                for item in payload.get("data", [])
            }
            for user_id in batch:
                item = returned.get(user_id)
                image_url = item.get("imageUrl") if item else None
                state = item.get("state") if item else None
                if state == "Completed" and is_avatar_headshot_url(image_url):
                    avatars[user_id] = image_url
                elif state != "Blocked":
                    retry_ids.append(user_id)
            resolved_count = requested_count - len(retry_ids) - (
                len(remaining) - min(start + 100, len(remaining))
            )
            print(f"Resolved avatars {resolved_count}/{requested_count}")

        remaining = retry_ids
        if not remaining:
            break
        if attempt < 3:
            print(f"Retrying {len(remaining)} avatars (attempt {attempt + 1}/3)")
            time.sleep(1)

    if remaining:
        print(
            f"WARNING: {len(remaining)} avatars had no new image after 3 attempts;"
            " preserving any cached images",
            file=sys.stderr,
        )


def grouped(rows):
    result = {}
    for row in rows:
        result.setdefault(row["tournament_url"], []).append(row)
    return result


def rebuild_data(database_path, fetch_avatar_images):
    old_data = read_js(SITE / "data.js", "window.TBC_DATA=") or {"players": []}
    avatars = {
        player[0]: player[3]
        for player in old_data.get("players", [])
        if (
            isinstance(player[0], int)
            and len(player) > 3
            and is_avatar_headshot_url(player[3])
        )
    }

    db = sqlite3.connect(database_path)
    db.row_factory = sqlite3.Row

    groups = db.execute(
        "SELECT group_id, group_title, date_span, document_links_json"
        " FROM tournament_groups ORDER BY group_id"
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
    avatar_ids = [user["id"] for user in users]
    if fetch_avatar_images and avatar_ids:
        fetch_avatars(avatar_ids, avatars)

    players = [
        [
            user["id"],
            user["username"],
            user["display_name"] if user["display_name"] != user["username"] else None,
            avatars.get(user["id"]),
            str(user["id"]),
        ]
        for user in users
    ]
    players.extend(
        [key, name, None, None, unresolved_player_route(key)]
        for key, name in unresolved.values()
    )
    player_routes = [player[4] for player in players]
    if len(player_routes) != len(set(player_routes)):
        raise ValueError("Player profile routes are not unique")

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
    videos_by_url = grouped(
        db.execute(
            """
            SELECT v.*, m.identifier AS match_identifier,
                   m.match_row_id
            FROM match_pov_videos v
            JOIN matches m
              ON m.tournament_url = v.tournament_url
             AND m.match_id = v.match_id
            ORDER BY v.tournament_url, m.identifier, v.side, v.video_index
            """
        ).fetchall()
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
        url_to_slug[url.rstrip("/")] = tournament["readable_id"]
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
        source_matches = matches_by_url.get(url, [])
        match_identifier_by_id = {
            match["match_id"]: match["identifier"] for match in source_matches
        }
        matches = []
        for match in source_matches:
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
                    match["match_row_id"],
                    int(bool(match["is_group_match"])),
                    match["group_name"],
                ]
            )

        videos = {}
        for video in videos_by_url.get(url, []):
            match_videos = videos.setdefault(str(video["match_row_id"]), [[], []])
            side = {"player1": 0, "player2": 1}.get(video["side"])
            if side is None:
                raise ValueError(f"{url}: unknown video side {video['side']!r}")
            item = [video["video_url"]]
            if video["video_note"]:
                item.append(video["video_note"])
            match_videos[side].append(item)

        override = None
        if url in overrides:
            source_override = overrides[url]
            override = {
                "type": source_override["override_type"],
                "reason": source_override["reason"],
                "terminal": match_identifier_by_id.get(source_override["terminal_match_id"]),
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

        tournament_data = {
            "slug": tournament["readable_id"],
            "cs": tournament["challonge_slug"],
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
        if videos:
            tournament_data["videos"] = videos
        tournaments.append(tournament_data)

    payload = {
        "generated": date.today().isoformat(),
        "groups": [
            [
                group["group_id"],
                group["group_title"],
                group["date_span"],
                json.loads(group["document_links_json"]),
            ]
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
        "videos": sum(
            len(side)
            for tournament in tournaments
            for match in tournament.get("videos", {}).values()
            for side in match
        ),
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
            match_id = int(row["match_row_id"])
            if match_id < 0:
                raise ValueError(f"Prediction has a negative match ID: {match_id}")
            tournament_predictions = predictions.setdefault(slug, [])
            if match_id >= len(tournament_predictions):
                tournament_predictions.extend(
                    [None] * (match_id + 1 - len(tournament_predictions))
                )
            tournament_predictions[match_id] = round(float(probability) * 10000)
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


def parse_model_key(key):
    pieces = key.split(":")
    values = {}
    positional = []
    for piece in pieces[1:]:
        if "=" in piece:
            name, value = piece.split("=", 1)
            values[name] = None if value == "None" else float(value)
        else:
            positional.append(float(piece))
    return pieces[0], positional, values


def build_residual_reliability(events, reference_probabilities, estimator, generated_on):
    import benchmark_player_residual_volatility as residual

    overall = defaultdict(residual._Moments)
    formatted = defaultdict(residual._Moments)
    population = residual._Moments()
    format_population = defaultdict(residual._Moments)
    position = 0

    for event in events:
        residual._advance(population, event.event_date, estimator.half_life_days)
        for team_size in {match.team_size for match in event.matches}:
            residual._advance(
                format_population[team_size], event.event_date, estimator.half_life_days
            )

        player_values = defaultdict(list)
        format_values = defaultdict(list)
        for match in event.matches:
            if match.forfeited and not estimator.include_forfeit_updates:
                position += 1
                continue
            surprise = 1.0 - float(reference_probabilities[position])
            for player_id in match.winner:
                player_values[player_id].append(surprise)
                format_values[(match.team_size, player_id)].append(surprise)
            for player_id in match.loser:
                player_values[player_id].append(-surprise)
                format_values[(match.team_size, player_id)].append(-surprise)
            position += 1

        for player_id, values in player_values.items():
            value = math.fsum(values) / len(values)
            residual._advance(
                overall[player_id], event.event_date, estimator.half_life_days
            )
            residual._observe(overall[player_id], value)
            residual._observe(population, value)
        for key, values in format_values.items():
            value = math.fsum(values) / len(values)
            residual._advance(
                formatted[key], event.event_date, estimator.half_life_days
            )
            residual._observe(formatted[key], value)
            residual._observe(format_population[key[0]], value)

    if position != len(reference_probabilities):
        raise ValueError("Residual reliability did not cover every historical match")

    residual._advance(population, generated_on, estimator.half_life_days)
    for team_size in ("1v1", "2v2"):
        residual._advance(
            format_population[team_size], generated_on, estimator.half_life_days
        )
    player_ids = sorted(overall)
    rows = []
    for player_id in player_ids:
        residual._advance(overall[player_id], generated_on, estimator.half_life_days)
        values = []
        for team_size in ("1v1", "2v2"):
            residual._advance(
                formatted[(team_size, player_id)],
                generated_on,
                estimator.half_life_days,
            )
            general = residual._snapshot(
                overall[player_id], population, estimator.prior_events
            )[estimator.residual_measure]
            specific = residual._snapshot(
                formatted[(team_size, player_id)],
                format_population[team_size],
                estimator.prior_events,
            )[estimator.residual_measure]
            values.append(
                (1.0 - estimator.format_mix) * general
                + estimator.format_mix * specific
            )
        rows.append([player_id, round(values[0], 8), round(values[1], 8)])

    defaults = []
    empty = residual._Moments(last_date=generated_on)
    for team_size in ("1v1", "2v2"):
        general = residual._snapshot(
            empty, population, estimator.prior_events
        )[estimator.residual_measure]
        specific = residual._snapshot(
            empty, format_population[team_size], estimator.prior_events
        )[estimator.residual_measure]
        defaults.append(
            (1.0 - estimator.format_mix) * general
            + estimator.format_mix * specific
        )
    return rows, [round(value, 8) for value in defaults]


def parse_residual_signal(name, prefix):
    match = re.fullmatch(
        rf"{re.escape(prefix)}_k([^_]+)_h([^_]+)_p([^_]+)", name
    )
    if not match:
        raise ValueError(f"Invalid residual signal name: {name}")
    half_life = None if match.group(2) == "None" else float(match.group(2))
    return float(match.group(1)), half_life, float(match.group(3))


def build_simulator_models(model_source, database):
    sys.path[:0] = [
        str(model_source / ".python_deps"),
        str(model_source / "src"),
    ]
    import benchmark_all_tbc_events as benchmark
    import benchmark_2v2_team_aggregation as two_v_two
    import benchmark_player_residual_volatility as residual_volatility
    import export_all_match_win_predictions as prediction_export
    from benchmark_all_tbc2_events import GeneralGlickoModel
    from benchmark_hierarchical_gaussian import (
        HierarchicalGaussianModel,
        HierarchicalGaussianParameters,
    )
    from benchmark_huntsman_dynamic import (
        DynamicGaussianModel,
        PlayerVolatilityGaussianModel,
        VolatilityDriftParameters,
    )

    config_path = model_source / "models" / "all_tbc_rating_benchmark.json"
    payload = json.loads(config_path.read_text(encoding="utf-8"))
    operational = payload["operational_model"]
    branches = operational["specialized_branches"]
    main_key = branches["tbc2"]["parameters"]["base_key"]
    teams_key = branches["tbc2_2v2"]["parameters"]["base_key"]
    huntsman_key = branches["tbc2_huntsman_1v1"]["parameters"]["base_key"]

    context = benchmark.build_context(database)
    specifications = prediction_export.branch_specifications(payload)
    required_base_keys = {
        parameters.base_key for _features, parameters in specifications.values()
    }
    for calibration_name in (
        "tbc2_rating_confidence_sharpening",
        "rating_dispersion_calibration",
    ):
        calibration = operational.get(calibration_name, {})
        if calibration.get("retained"):
            required_base_keys.update(calibration["base_keys"])
    contextual_raw = operational.get("contextual_rating_mixture", {})
    if contextual_raw.get("retained"):
        required_base_keys.update(contextual_raw["parameters"]["base_keys"])
    prediction_export.restore_missing_base_options(
        context, payload, required_base_keys
    )

    branch_pre_event = {}
    for name, (features, parameters) in specifications.items():
        branch_pre_event[name] = context.evaluator.probabilities(
            parameters, tuple(feature for feature in features if feature != "live")
        )
    reference_probabilities = branch_pre_event["general_tbc1"].copy()
    for target in context.targets:
        if target.tbc_version != "tbc2":
            continue
        branch = "tbc2"
        if target.team_size == "2v2":
            branch = "tbc2_2v2"
        elif target.team_size == "1v1" and target.match.bracket_kind == "hunts-bracket":
            branch = "tbc2_huntsman_1v1"
        reference_probabilities[target.index] = branch_pre_event[branch][target.index]

    tail_parameters = prediction_export.tail_calibration_specification(payload)
    if tail_parameters is not None:
        reference_probabilities = benchmark.apply_tbc2_main_1v1_calibration(
            reference_probabilities, context.targets, tail_parameters
        )
    newcomer_parameters = prediction_export.newcomer_confidence_specification(payload)
    if newcomer_parameters is not None:
        reference_probabilities = benchmark.apply_tbc1_3v3_newcomer_confidence(
            reference_probabilities,
            context.targets,
            context.evaluator.signals.newcomer_fraction,
            newcomer_parameters,
        )

    two_v_two_parameters = prediction_export.load_two_v_two_parameters(
        model_source / "models" / "two_v_two_team_aggregation_benchmark.json"
    )
    team_reference_probabilities = reference_probabilities.copy()
    team_signals = two_v_two.build_team_shape_signals(
        context.events,
        context.targets,
        team_reference_probabilities,
        include_forfeit_updates=False,
    )
    for version in ("tbc1", "tbc2"):
        specification = two_v_two_parameters[version]
        adjusted = two_v_two.apply_parameters(
            reference_probabilities, team_signals, specification.aggregation
        )
        if specification.glicko_dissent is not None:
            adjusted = two_v_two.apply_glicko_dissent_confirmation(
                adjusted,
                context.evaluator.signals.glicko_probability,
                specification.glicko_dissent,
            )
        if specification.event_volatility is not None:
            adjusted = two_v_two.apply_event_volatility_temperature(
                adjusted,
                adjusted,
                context.targets,
                specification.event_volatility,
                version=version,
            )
        for target in context.targets:
            if target.tbc_version == version and target.team_size == "2v2":
                reference_probabilities[target.index] = adjusted[target.index]

    family, _, main_values = parse_model_key(main_key)
    if family != "player_volatility_gaussian":
        raise ValueError(f"Unsupported TBC2 simulator model: {main_key}")
    main = PlayerVolatilityGaussianModel(
        VolatilityDriftParameters(
            tau=main_values["tau"],
            strength=main_values["strength"],
            prior_matches=main_values["prior_matches"],
            half_life_days=main_values["half_life_days"],
            multiplier_cap=main_values["multiplier_cap"],
            mean_half_life_days=main_values.get("mean_half_life_days"),
        )
    )

    family, huntsman_positionals, huntsman_values = parse_model_key(huntsman_key)
    if family != "gaussian" or len(huntsman_positionals) != 2:
        raise ValueError(f"Unsupported Huntsman simulator model: {huntsman_key}")
    huntsman = DynamicGaussianModel(
        huntsman_positionals[0], huntsman_positionals[1], 1.0, 1.0, 1.0
    )

    family, _, team_values = parse_model_key(teams_key)
    if family != "hierarchical":
        raise ValueError(f"Unsupported TBC2 2v2 simulator model: {teams_key}")
    teams = HierarchicalGaussianModel(
        HierarchicalGaussianParameters(
            overall_sigma=team_values["overall_sigma"],
            overall_tau=team_values["overall_tau"],
            format_sigma=team_values["format_sigma"],
            format_tau=team_values["format_tau"],
            pair_sigma=team_values["pair_sigma"],
            pair_tau=team_values["pair_tau"],
            beta=team_values["beta"],
            team_shared_learning_rate=team_values["team_shared_learning_rate"],
            pair_mean_half_life=team_values.get("pair_mean_half_life"),
        )
    )

    events = context.events
    targets = context.targets
    match_counts = defaultdict(int)
    event_counts = Counter()

    alternative_gaussian = DynamicGaussianModel(1.0, 0.05, 1.0, 1.0, 1.0)
    uncertainty_gaussian = DynamicGaussianModel(1.0, 0.02, 1.0, 1.0, 1.0)
    alternative_glicko = GeneralGlickoModel(150.0, 5.0, 1.0, 1.0)
    team_shape_glicko = GeneralGlickoModel(150.0, 0.0, 1.0, 1.0)
    team_shape_overall = DynamicGaussianModel(1.0, 0.02, 1.0, 1.0, 1.0)
    team_shape_format = DynamicGaussianModel(1.0, 0.02, 1.0, 1.0, 1.0)
    team_shape_solo = DynamicGaussianModel(1.0, 0.02, 1.0, 1.0, 1.0)
    for event, (event_date, rating_matches) in zip(
        events, benchmark.rating_events(events), strict=True
    ):
        main.advance(event_date)
        huntsman.advance(event_date)
        teams.advance(event_date)
        alternative_gaussian.advance(event_date)
        uncertainty_gaussian.advance(event_date)
        alternative_glicko.advance(event_date)
        team_shape_glicko.advance(event_date)
        team_shape_overall.advance(event_date)
        team_shape_format.advance(event_date)
        team_shape_solo.advance(event_date)
        for match in rating_matches:
            main.margin(match.winner, match.loser)
            for player_id in (*match.winner, *match.loser):
                match_counts[player_id] += 1
        main.update_event(rating_matches)
        huntsman.update_event(rating_matches)
        teams.update_event(event)
        alternative_gaussian.update_event(rating_matches)
        alternative_glicko.update_event(rating_matches)
        team_shape_glicko.update_event(rating_matches)
        eligible_rating_matches = tuple(
            match
            for match, historical in zip(rating_matches, event.matches, strict=True)
            if not historical.forfeited
        )
        uncertainty_gaussian.update_event(eligible_rating_matches)
        team_shape_overall.update_event(eligible_rating_matches)
        team_shape_format.update_event(
            tuple(
                match
                for match, historical in zip(rating_matches, event.matches, strict=True)
                if historical.team_size == "2v2" and not historical.forfeited
            )
        )
        team_shape_solo.update_event(
            tuple(
                match
                for match, historical in zip(rating_matches, event.matches, strict=True)
                if historical.team_size == "1v1" and not historical.forfeited
            )
        )
        for player_id in {
            player_id
            for match in event.matches
            for player_id in (*match.winner, *match.loser)
        }:
            event_counts[player_id] += 1

    generated_on = date.today()
    main.advance(generated_on)
    huntsman.advance(generated_on)
    teams.advance(generated_on)
    alternative_gaussian.advance(generated_on)
    uncertainty_gaussian.advance(generated_on)
    alternative_glicko.advance(generated_on)
    team_shape_glicko.advance(generated_on)
    team_shape_overall.advance(generated_on)
    team_shape_format.advance(generated_on)
    team_shape_solo.advance(generated_on)

    adaptive = payload["base_family_best"]["adaptive_format_elo"]
    adaptive_parameters = adaptive["model_parameters"]
    adaptive_ratings = defaultdict(float)
    adaptive_games = defaultdict(float)
    adaptive_previous_date = None
    for event in events:
        if adaptive_previous_date is not None and adaptive_parameters["half_life"] is not None:
            elapsed = max((event.event_date - adaptive_previous_date).days, 0)
            factor = 2.0 ** (-elapsed / adaptive_parameters["half_life"])
            for player_id in adaptive_ratings:
                adaptive_ratings[player_id] *= factor
        adaptive_previous_date = event.event_date
        deltas = defaultdict(float)
        for match in event.matches:
            winner_rating = math.fsum(
                adaptive_ratings[player_id] for player_id in match.winner
            ) / len(match.winner)
            loser_rating = math.fsum(
                adaptive_ratings[player_id] for player_id in match.loser
            ) / len(match.loser)
            residual = 1.0 / (1.0 + math.exp(winner_rating - loser_rating))
            for player_id in match.winner:
                experience = math.sqrt(
                    adaptive_parameters["experience_prior"]
                    / (
                        adaptive_parameters["experience_prior"]
                        + adaptive_games[player_id]
                    )
                )
                deltas[player_id] += (
                    adaptive_parameters["k"] * residual * experience / len(match.winner)
                )
            for player_id in match.loser:
                experience = math.sqrt(
                    adaptive_parameters["experience_prior"]
                    / (
                        adaptive_parameters["experience_prior"]
                        + adaptive_games[player_id]
                    )
                )
                deltas[player_id] -= (
                    adaptive_parameters["k"] * residual * experience / len(match.loser)
                )
        for player_id, delta in deltas.items():
            adaptive_ratings[player_id] += delta
        for match in event.matches:
            for player_id in (*match.winner, *match.loser):
                adaptive_games[player_id] += 1.0
    if adaptive_previous_date is not None and adaptive_parameters["half_life"] is not None:
        elapsed = max((generated_on - adaptive_previous_date).days, 0)
        factor = 2.0 ** (-elapsed / adaptive_parameters["half_life"])
        for player_id in adaptive_ratings:
            adaptive_ratings[player_id] *= factor

    overall_margins, format_margins = benchmark.simulate_adaptive_elo_components(
        events,
        targets,
        k=adaptive_parameters["k"],
        half_life=adaptive_parameters["half_life"],
        experience_prior=adaptive_parameters["experience_prior"],
    )
    mixed_margins = (
        (1.0 - adaptive_parameters["format_mix"]) * overall_margins
        + adaptive_parameters["format_mix"] * format_margins
    )
    format_probabilities = benchmark.np.clip(
        benchmark.expit(mixed_margins / adaptive["scale"]),
        adaptive["cap_floor"],
        1.0 - adaptive["cap_floor"],
    )

    attendance_fast = defaultdict(float)
    format_slow = defaultdict(float)
    roster_history = defaultdict(float)
    residual_form = defaultdict(float)
    residual_games = defaultdict(float)
    previous_date = None
    position = 0

    def decay(values, factor):
        for key in values:
            values[key] *= factor

    for event in events:
        if previous_date is not None:
            elapsed = max((event.event_date - previous_date).days, 0)
            decay(attendance_fast, 2.0 ** (-elapsed / 30.0))
            decay(format_slow, 2.0 ** (-elapsed / 365.0))
            decay(roster_history, 2.0 ** (-elapsed / 365.0))
            decay(residual_form, 2.0 ** (-elapsed / 180.0))
            decay(residual_games, 2.0 ** (-elapsed / 180.0))
        previous_date = event.event_date
        participants = set()
        format_participants = defaultdict(set)
        rosters = set()
        for match in event.matches:
            participants.update((*match.winner, *match.loser))
            format_participants[match.team_size].update((*match.winner, *match.loser))
            rosters.add(tuple(sorted(match.winner)))
            rosters.add(tuple(sorted(match.loser)))
            surprise = 1.0 - float(format_probabilities[position])
            for player_id in match.winner:
                residual_form[player_id] += surprise
                residual_games[player_id] += 1.0
            for player_id in match.loser:
                residual_form[player_id] -= surprise
                residual_games[player_id] += 1.0
            position += 1
        for player_id in participants:
            attendance_fast[player_id] += 1.0
        for team_size, player_ids in format_participants.items():
            for player_id in player_ids:
                format_slow[(team_size, player_id)] += 1.0
        for roster in rosters:
            roster_history[roster] += 1.0

    if previous_date is not None:
        elapsed = max((generated_on - previous_date).days, 0)
        decay(attendance_fast, 2.0 ** (-elapsed / 30.0))
        decay(format_slow, 2.0 ** (-elapsed / 365.0))
        decay(roster_history, 2.0 ** (-elapsed / 365.0))
        decay(residual_form, 2.0 ** (-elapsed / 180.0))
        decay(residual_games, 2.0 ** (-elapsed / 180.0))

    selected_two_v_two = two_v_two_parameters["tbc2"]
    coefficients = dict(selected_two_v_two.aggregation.coefficients)
    pair_signal_name = next(
        name for name in coefficients if name.startswith("pair_residual_")
    )
    player_signal_name = next(
        name for name in coefficients if name.startswith("player_2v2_residual_")
    )
    pair_k, pair_half_life, pair_prior = parse_residual_signal(
        pair_signal_name, "pair_residual"
    )
    player_k, player_half_life, player_prior = parse_residual_signal(
        player_signal_name, "player_2v2_residual"
    )
    pair_ratings = defaultdict(float)
    pair_games = defaultdict(float)
    player_two_v_two_ratings = defaultdict(float)
    player_two_v_two_games = defaultdict(float)
    residual_previous_date = None
    position = 0
    for event in events:
        if residual_previous_date is not None:
            elapsed = max((event.event_date - residual_previous_date).days, 0)
            if pair_half_life is not None:
                factor = 2.0 ** (-elapsed / pair_half_life)
                decay(pair_ratings, factor)
                decay(pair_games, factor)
            if player_half_life is not None:
                factor = 2.0 ** (-elapsed / player_half_life)
                decay(player_two_v_two_ratings, factor)
                decay(player_two_v_two_games, factor)
        residual_previous_date = event.event_date
        pair_deltas = defaultdict(float)
        pair_appearances = Counter()
        player_deltas = defaultdict(float)
        player_appearances = Counter()
        for match in event.matches:
            if match.team_size == "2v2" and not match.forfeited:
                surprise = 1.0 - float(team_reference_probabilities[position])
                winner_pair = tuple(sorted(match.winner))
                loser_pair = tuple(sorted(match.loser))
                pair_deltas[winner_pair] += pair_k * surprise
                pair_deltas[loser_pair] -= pair_k * surprise
                pair_appearances[winner_pair] += 1
                pair_appearances[loser_pair] += 1
                for player_id in match.winner:
                    player_deltas[player_id] += player_k * surprise
                    player_appearances[player_id] += 1
                for player_id in match.loser:
                    player_deltas[player_id] -= player_k * surprise
                    player_appearances[player_id] += 1
            position += 1
        for roster, delta in pair_deltas.items():
            pair_ratings[roster] += delta / pair_appearances[roster]
            pair_games[roster] += 1.0
        for player_id, delta in player_deltas.items():
            player_two_v_two_ratings[player_id] += (
                delta / player_appearances[player_id]
            )
            player_two_v_two_games[player_id] += 1.0
    if position != len(reference_probabilities):
        raise ValueError("2v2 residual state did not cover every historical match")
    if residual_previous_date is not None:
        elapsed = max((generated_on - residual_previous_date).days, 0)
        if pair_half_life is not None:
            factor = 2.0 ** (-elapsed / pair_half_life)
            decay(pair_ratings, factor)
            decay(pair_games, factor)
        if player_half_life is not None:
            factor = 2.0 ** (-elapsed / player_half_life)
            decay(player_two_v_two_ratings, factor)
            decay(player_two_v_two_games, factor)

    player_volatility_parameters = residual_volatility.load_recommended_parameters(
        model_source / "models" / "player_residual_volatility_benchmark.json"
    )
    if player_volatility_parameters is None:
        raise ValueError("The simulator requires player residual-volatility parameters")
    player_reliability, player_reliability_defaults = build_residual_reliability(
        events,
        reference_probabilities,
        player_volatility_parameters.estimator,
        generated_on,
    )
    field_parameters = prediction_export.event_field_volatility_specification(payload)
    if field_parameters is None:
        raise ValueError("The simulator requires event-field volatility parameters")
    field_reliability, field_reliability_defaults = build_residual_reliability(
        events,
        reference_probabilities,
        field_parameters.estimator,
        generated_on,
    )

    def dynamic_skills(model):
        return [
            [
                player_id,
                round(model.means[player_id], 6),
                round(model.variances[player_id], 6),
                match_counts[player_id],
            ]
            for player_id in sorted(model.means)
        ]

    team_skills = []
    pair_skills = []
    for key, state in teams.states.items():
        if key[0] == "overall":
            team_skills.append(
                [key[1], round(state.mean, 6), round(state.variance, 6), match_counts[key[1]]]
            )
        elif key[0] == "pair" and key[1] == "2v2":
            pair_skills.append(
                [key[2], key[3], round(state.mean, 6), round(state.variance, 6)]
            )
    team_skills.sort(key=lambda row: row[0])
    pair_skills.sort(key=lambda row: (row[0], row[1]))

    tail = operational.get("tbc2_main_1v1_tail_calibration", {})
    tail_parameters = tail.get("parameters") if tail.get("retained") else None
    feature_players = []
    for player_id in sorted(match_counts):
        feature_players.append(
            [
                player_id,
                round(attendance_fast[player_id], 6),
                round(math.log1p(format_slow[("1v1", player_id)]), 6),
                round(math.log1p(format_slow[("2v2", player_id)]), 6),
                round(residual_form[player_id] / (residual_games[player_id] + 5.0), 6),
            ]
        )
    feature_rosters = [
        [roster[0], roster[1], round(math.log1p(value), 6)]
        for roster, value in roster_history.items()
        if len(roster) == 2
    ]
    feature_rosters.sort(key=lambda row: (row[0], row[1]))

    confidence_parameters = prediction_export.rating_confidence_specification(payload)
    dispersion_parameters = prediction_export.rating_dispersion_calibration_specification(
        payload
    )
    contextual_parameters = prediction_export.contextual_rating_mixture_specification(
        payload
    )
    if confidence_parameters is None or dispersion_parameters is None or contextual_parameters is None:
        raise ValueError("The simulator requires the retained TBC2 calibration layers")
    if not (
        confidence_parameters.base_keys
        == dispersion_parameters.base_keys
        == contextual_parameters.base_keys
    ):
        raise ValueError("The retained TBC2 rating layers use different base models")

    alternative_models = []
    for key in confidence_parameters.base_keys:
        family, positional, values = parse_model_key(key)
        item = {"family": family, "scale": values["scale"], "cap": values["cap"]}
        if family == "gaussian":
            if positional != [1.0, 0.05]:
                raise ValueError(f"Unsupported simulator rating model: {key}")
            item["skills"] = dynamic_skills(alternative_gaussian)
            item["beta"] = 1.0
        elif family == "adaptive_elo":
            if positional != [1.0, 1460.0, 10.0, 0.0]:
                raise ValueError(f"Unsupported simulator rating model: {key}")
            item["skills"] = [
                [player_id, round(adaptive_ratings[player_id], 8)]
                for player_id in sorted(adaptive_ratings)
            ]
        elif family == "glicko":
            if positional != [150.0, 5.0]:
                raise ValueError(f"Unsupported simulator rating model: {key}")
            item["skills"] = [
                [
                    player_id,
                    round(alternative_glicko.ratings[player_id], 6),
                    round(alternative_glicko.deviations[player_id], 6),
                ]
                for player_id in sorted(alternative_glicko.ratings)
            ]
        else:
            raise ValueError(f"Unsupported simulator rating model: {key}")
        alternative_models.append(item)

    pair_residual_rows = [
        [
            roster[0],
            roster[1],
            round(pair_ratings[roster], 8),
            round(pair_games[roster], 8),
        ]
        for roster in sorted(pair_ratings)
    ]
    player_two_v_two_rows = [
        [
            player_id,
            round(player_two_v_two_ratings[player_id], 8),
            round(player_two_v_two_games[player_id], 8),
        ]
        for player_id in sorted(player_two_v_two_ratings)
    ]
    return {
        "generated": generated_on.isoformat(),
        "scope": "current TBC2 production model states for hypothetical brackets",
        "features": {
            "players": feature_players,
            "rosters": feature_rosters,
        },
        "models": {
            "main": {
                "scale": main_values["scale"],
                "cap": main_values["cap"],
                "beta": 1.0,
                "skills": dynamic_skills(main),
                "featureWeights": {
                    "attendanceFast": branches["tbc2"]["parameters"]["attendance_fast_coefficient"],
                    "attendanceSlow": branches["tbc2"]["parameters"]["attendance_slow_coefficient"],
                    "opponentForm": 0.0,
                    "roster": 0.0,
                },
                "tail": (
                    {
                        "temperature": tail_parameters["temperature"],
                        "threshold": tail_parameters["threshold"],
                        "tailTemperature": tail_parameters["tail_temperature"],
                    }
                    if tail_parameters
                    else None
                ),
            },
            "huntsman": {
                "scale": huntsman_values["scale"],
                "cap": huntsman_values["cap"],
                "beta": 1.0,
                "skills": dynamic_skills(huntsman),
                "featureWeights": {
                    "attendanceFast": branches["tbc2_huntsman_1v1"]["parameters"]["attendance_fast_coefficient"],
                    "attendanceSlow": branches["tbc2_huntsman_1v1"]["parameters"]["attendance_slow_coefficient"],
                    "opponentForm": branches["tbc2_huntsman_1v1"]["parameters"]["opponent_form_coefficient"],
                    "roster": 0.0,
                },
                "live": {
                    "learningRate": branches["tbc2_huntsman_1v1"]["parameters"]["live_learning_rate"],
                    "retention": branches["tbc2_huntsman_1v1"]["parameters"]["live_retention"],
                    "surpriseTemperature": branches["tbc2_huntsman_1v1"]["parameters"]["live_surprise_temperature"],
                },
            },
            "2v2": {
                "scale": team_values["scale"],
                "cap": team_values["cap"],
                "beta": team_values["beta"],
                "pairPriorVariance": team_values["pair_sigma"] ** 2,
                "skills": team_skills,
                "pairs": pair_skills,
                "featureWeights": {
                    "attendanceFast": branches["tbc2_2v2"]["parameters"]["attendance_fast_coefficient"],
                    "attendanceSlow": branches["tbc2_2v2"]["parameters"]["attendance_slow_coefficient"],
                    "opponentForm": branches["tbc2_2v2"]["parameters"]["opponent_form_coefficient"],
                    "roster": branches["tbc2_2v2"]["parameters"]["roster_coefficient"],
                },
            },
        },
        "production": {
            "alternatives": alternative_models,
            "uncertaintySkills": dynamic_skills(uncertainty_gaussian),
            "eventCounts": [
                [player_id, count] for player_id, count in sorted(event_counts.items())
            ],
            "playerResidualVolatility": {
                "parameters": asdict(player_volatility_parameters),
                "players": player_reliability,
                "defaults": player_reliability_defaults,
            },
            "eventFieldVolatility": {
                "parameters": asdict(field_parameters),
                "players": field_reliability,
                "defaults": field_reliability_defaults,
            },
            "ratingConfidence": asdict(confidence_parameters),
            "ratingDispersion": asdict(dispersion_parameters),
            "contextualRatingMixture": asdict(contextual_parameters),
            "twoVTwo": {
                "aggregation": asdict(selected_two_v_two.aggregation),
                "glickoDissent": asdict(selected_two_v_two.glicko_dissent),
                "dependencyLive": asdict(selected_two_v_two.dependency_live),
                "eventVolatility": asdict(selected_two_v_two.event_volatility),
                "glicko": {
                    "scale": payload["base_family_best"]["event_glicko"]["scale"],
                    "cap": payload["base_family_best"]["event_glicko"]["cap_floor"],
                    "skills": [
                        [
                            player_id,
                            round(team_shape_glicko.ratings[player_id], 6),
                            round(team_shape_glicko.deviations[player_id], 6),
                        ]
                        for player_id in sorted(team_shape_glicko.ratings)
                    ],
                },
                "signals": {
                    "overall": dynamic_skills(team_shape_overall),
                    "format": dynamic_skills(team_shape_format),
                    "solo": dynamic_skills(team_shape_solo),
                    "pairResidual": {
                        "name": pair_signal_name,
                        "prior": pair_prior,
                        "values": pair_residual_rows,
                    },
                    "playerResidual": {
                        "name": player_signal_name,
                        "prior": player_prior,
                        "values": player_two_v_two_rows,
                    },
                },
            },
        },
    }


def rebuild_ratings(csv_path, site_player_ids, site_unresolved_ids, simulator_models):
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
            "predictor": simulator_models,
        },
    )
    return {
        "rating_snapshots": len(snapshots),
        "rating_players": len(players),
        "rating_rows": row_count,
    }


def main():
    args = parse_args()
    database_source = args.database.expanduser().resolve()
    model_source = args.model_source.expanduser().resolve()
    predictions_csv = model_source / "all_match_win_predictions.csv"
    ratings_csv = model_source / "historical_player_leaderboards_wide_elo.csv"
    required = [database_source, predictions_csv, ratings_csv]
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        raise FileNotFoundError("Missing source files:\n" + "\n".join(missing))

    database = ROOT / "main_tournaments.sqlite"
    if database_source != database.resolve():
        shutil.copy2(database_source, database)

    summary = rebuild_data(
        database,
        fetch_avatar_images=not args.no_fetch_avatars,
    )
    summary.update(rebuild_predictions(predictions_csv, summary.pop("url_to_slug")))
    unresolved_ids = summary.pop("unresolved_ids")
    player_data = read_js(SITE / "data.js", "window.TBC_DATA=")
    player_ids = {player[0] for player in player_data["players"]}
    simulator_models = build_simulator_models(model_source, database)
    summary.update(
        rebuild_ratings(ratings_csv, player_ids, unresolved_ids, simulator_models)
    )

    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
