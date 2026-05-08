#!/usr/bin/env python3
"""Stream-parse Apple Health export.xml and emit a compact workouts.json."""

import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

EXPORT_XML = Path("/Users/eunitembam3/Desktop/apple_health_export/export.xml")
OUT_JSON = Path(__file__).parent / "workouts.json"

ACTIVITY_PREFIX = "HKWorkoutActivityType"
STAT_PREFIX = "HKQuantityTypeIdentifier"


def short_type(s: str) -> str:
    if s and s.startswith(ACTIVITY_PREFIX):
        return s[len(ACTIVITY_PREFIX):]
    if s and s.startswith(STAT_PREFIX):
        return s[len(STAT_PREFIX):]
    return s


def parse_num(v):
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def f_to_c(f):
    return round((f - 32) * 5 / 9, 1)


def parse_weather_temp(raw):
    """Apple stores e.g. '88 degF' or '24 degC'."""
    if not raw:
        return None
    m = re.match(r"([-\d.]+)\s*deg([CF])", raw)
    if not m:
        return None
    val = float(m.group(1))
    return val if m.group(2) == "C" else f_to_c(val)


def parse_humidity(raw):
    if not raw:
        return None
    m = re.match(r"([-\d.]+)", raw)
    if not m:
        return None
    # Apple stores humidity *100 (e.g. 7400 % = 74%)
    n = float(m.group(1))
    return round(n / 100.0, 1) if n > 100 else n


def parse_mets(raw):
    if not raw:
        return None
    m = re.match(r"([-\d.]+)", raw)
    return float(m.group(1)) if m else None


def short_source(s):
    if not s:
        return ""
    if "Apple Watch" in s:
        return "Apple Watch"
    return s


def main():
    if not EXPORT_XML.exists():
        sys.exit(f"Export not found: {EXPORT_XML}")

    workouts = []
    n_total = 0

    print(f"Streaming {EXPORT_XML} ...", flush=True)

    # Tags that live inside a <Workout> — we must NOT clear them mid-flight,
    # otherwise their attributes are gone by the time we process the parent.
    WORKOUT_CHILDREN = {
        "WorkoutStatistics", "MetadataEntry", "WorkoutEvent",
        "WorkoutRoute", "FileReference",
    }

    context = ET.iterparse(str(EXPORT_XML), events=("end",))
    for _, elem in context:
        if elem.tag != "Workout":
            # Free anything that isn't part of a Workout; children of a Workout
            # will be released when we clear the parent below.
            if elem.tag not in WORKOUT_CHILDREN:
                elem.clear()
            continue

        n_total += 1

        w = {
            "type": short_type(elem.get("workoutActivityType", "")),
            "duration": parse_num(elem.get("duration")),
            "durationUnit": elem.get("durationUnit", "min"),
            "totalDistance": parse_num(elem.get("totalDistance")),
            "totalDistanceUnit": elem.get("totalDistanceUnit"),
            "totalEnergyBurned": parse_num(elem.get("totalEnergyBurned")),
            "totalEnergyBurnedUnit": elem.get("totalEnergyBurnedUnit"),
            "source": short_source(elem.get("sourceName")),
            "startDate": elem.get("startDate"),
            "endDate": elem.get("endDate"),
            "stats": {},
            "meta": {},
        }

        for child in list(elem):
            if child.tag == "WorkoutStatistics":
                t = short_type(child.get("type", ""))
                entry = {
                    "unit": child.get("unit"),
                }
                for k in ("average", "minimum", "maximum", "sum"):
                    v = parse_num(child.get(k))
                    if v is not None:
                        entry[k] = v
                w["stats"][t] = entry

            elif child.tag == "MetadataEntry":
                key = child.get("key", "")
                val = child.get("value")
                if key == "HKIndoorWorkout":
                    w["meta"]["indoor"] = val == "1"
                elif key == "HKTimeZone":
                    w["meta"]["timeZone"] = val
                elif key == "HKWeatherTemperature":
                    t = parse_weather_temp(val)
                    if t is not None:
                        w["meta"]["tempC"] = t
                elif key == "HKWeatherHumidity":
                    h = parse_humidity(val)
                    if h is not None:
                        w["meta"]["humidity"] = h
                elif key == "HKAverageMETs":
                    m = parse_mets(val)
                    if m is not None:
                        w["meta"]["averageMETs"] = m
                elif key == "HKElevationAscended":
                    e = parse_num(val.split()[0]) if val else None
                    if e is not None:
                        w["meta"]["elevationAscendedM"] = e

        # Backfill totals from stats when Apple put them only in WorkoutStatistics
        if w["totalEnergyBurned"] is None and "ActiveEnergyBurned" in w["stats"]:
            s = w["stats"]["ActiveEnergyBurned"].get("sum")
            if s is not None:
                w["totalEnergyBurned"] = s
                w["totalEnergyBurnedUnit"] = w["stats"]["ActiveEnergyBurned"].get("unit", "kcal")

        if w["totalDistance"] is None:
            for key in ("DistanceWalkingRunning", "DistanceCycling", "DistanceSwimming"):
                if key in w["stats"]:
                    s = w["stats"][key].get("sum")
                    if s is not None:
                        w["totalDistance"] = s
                        w["totalDistanceUnit"] = w["stats"][key].get("unit", "km")
                        break

        workouts.append(w)
        # Drop the Workout subtree (and its children) to keep memory low.
        elem.clear()

    workouts.sort(key=lambda x: x.get("startDate") or "")

    out = {
        "exportedAt": None,  # filled below
        "count": len(workouts),
        "workouts": workouts,
    }
    OUT_JSON.write_text(json.dumps(out, separators=(",", ":")))
    size_kb = OUT_JSON.stat().st_size / 1024
    print(f"Wrote {len(workouts)}/{n_total} workouts -> {OUT_JSON} ({size_kb:.1f} KB)")


if __name__ == "__main__":
    main()
