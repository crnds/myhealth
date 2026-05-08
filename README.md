# Workout Adaptation Report

A static, single-page report that visualises your Apple Watch workout history
(exported via Apple Health) so you can see how your body adapts over time.

It runs entirely in your browser — no server, no account, no upload. The only
required step is parsing the raw HealthKit XML into a small JSON file.

## What it shows

- **Lifetime summary** — total sessions, total time, total distance, total
  active calories, average sessions per week.
- **Category navigator** — every workout type Apple Health has recorded
  (Cycling, Running, Walking, Swimming, Strength Training, HIIT, Yoga,
  Pilates, Hiking, etc.) with session counts.
- **Adaptation trends** — per-category line charts of the metrics that matter
  for that activity, with a configurable moving-average smoother. Each chart
  shows the percentage change between the first and most recent session in the
  range, with an arrow that's coloured green when the direction reflects
  improvement (e.g. lower average heart rate at a given pace, lower ground
  contact time, higher running power, higher average speed).
- **Searchable session table** — filter by date or type, sort by newest,
  longest, hardest, highest heart rate, etc. Click a row to open the detail
  view.
- **Session detail** — duration, distance, heart-rate avg/min/max, pace,
  running power, stride length, vertical oscillation, ground-contact time,
  METs, indoor/outdoor, weather (when available), source device.
- **A-vs-B comparison** — pick any two sessions and see every metric side by
  side with a delta column. Deltas are direction-aware: a slower pace is
  flagged red, more distance is flagged green.

## Metrics surfaced per category

| Category               | Key metrics tracked over time |
|------------------------|-------------------------------|
| Cycling                | distance, duration, average speed, average heart rate, calories, METs |
| Running                | distance, average pace, average speed, heart rate, running power, stride length, vertical oscillation, ground contact time, METs |
| Walking / Hiking       | distance, duration, average heart rate, calories, METs |
| Swimming               | distance, duration, stroke count, average heart rate, calories |
| Yoga / Pilates         | duration, average heart rate, calories, METs |
| Strength (Trad / Func) | duration, average heart rate, peak heart rate, calories, METs |
| HIIT                   | duration, average heart rate, peak heart rate, calories, METs |

## Project structure

```
myhealth/
├── index.html            # Page skeleton
├── styles.css            # Visual styling
├── app.js                # All interaction (loads JSON, renders charts, etc.)
├── extract_workouts.py   # Stream-parses export.xml to workouts.json
└── workouts.json         # Generated locally, ignored by git
```

External dependencies are limited to [Chart.js](https://www.chartjs.org/)
loaded from a CDN.

## Setup

1. **Export your Apple Health data**
   On your iPhone open the Health app, tap your profile picture, choose
   *Export All Health Data*, and AirDrop or copy the resulting `export.zip` to
   your Mac. Unzip it to `~/Desktop/apple_health_export/` so that
   `~/Desktop/apple_health_export/export.xml` exists.

   The extractor path is hard-coded to that location — adjust the
   `EXPORT_XML` constant at the top of `extract_workouts.py` if you want to
   point it elsewhere.

2. **Generate `workouts.json`**

   ```bash
   cd ~/myhealth
   python3 extract_workouts.py
   ```

   The script uses streaming XML parsing, so the 1+ GB export file is read
   without loading it into memory. A typical run produces a few hundred KB of
   compact JSON containing one record per workout.

3. **Serve the page locally**

   Browsers refuse to `fetch()` from `file://` URLs, so a local web server is
   required:

   ```bash
   python3 -m http.server 8765
   ```

   Open <http://127.0.0.1:8765/> in any modern browser.

## Refreshing after a new export

Take a fresh export from the Health app, replace the contents of
`~/Desktop/apple_health_export/`, and re-run `extract_workouts.py`. The
generated `workouts.json` is overwritten in place; reload the page.

## Privacy

`workouts.json` is excluded from git via `.gitignore`. Your raw heart-rate
samples, GPS-adjacent statistics, and biometric data never leave your machine
when you clone this repository or push changes back to it.

If you fork or clone this repo, you'll need to run `extract_workouts.py`
against your own Apple Health export to populate `workouts.json` before the
page will display anything.

## Limitations

- The extractor reads top-level `Workout` records from `export.xml`. It does
  not read the per-second time-series in `workout-routes/*.gpx`, the
  `electrocardiograms/` folder, or the high-frequency `Record` entries (raw
  heart-rate samples, sleep, etc.) elsewhere in `export.xml`.
- Older Strava-imported workouts only carry duration and distance — heart
  rate, METs, and Apple-Watch-specific running form metrics are blank for
  those rows.
- All times are rendered in your browser's local timezone, regardless of
  where the workout was recorded.
