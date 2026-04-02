# PlayGen — Migration Plan

## Source File Analysis

### File 1: `iFM Manila - May 19 Tuesday 2015.xlsm` — Output File

This file is the **end product** of the scheduling process: a rendered daily playlist for iFM Manila, dated May 19, 2015 (Tuesday).

**Sheets**: `iFM Playlist` (active, 94 rows × 34 cols), `Sheet2` (empty), `Sheet3` (empty)

**iFM Playlist structure**:
- Row 0: date (2015-05-19) + hourly time slot headers (4:00 AM through 3:00 AM next day)
- Subsequent rows: song entries grouped into blocks per hour
- Each song entry: `[index, title, category_code, formatted_display_string]`
- Columns 10–33: hourly schedule grid (which songs appear in which hour)
- Songs grouped in blocks separated by blank rows; each block = one hour's rotation

**Sample entries**:
```
Row 1: index=1, title="Alaala - True Faith", category="Ap", display="Ap9  Alaala - True Faith"
Row 2: title="Rain - Donna Cruz", category="Ap", display="Ap9  Rain - Donna Cruz"
Row 3: title="Hindi Ko Kaya - Richard Reynoso", category="Ap", display="Ap8  Hindi Ko Kaya..."
```

Note: iFM Manila uses its own category codes (`Ap`, `Ap9`, `Ap8`, `Ap7`) which are station-specific translations of the PlayGen category system (`FGs`, `7`, `8`, `PGs` etc).

---

### File 2: `PlayGen Encoder2.2.xlsm` — The Engine

The scheduling engine with 39 sheets. This is the file being migrated to a web application.

#### Sheet Inventory

| Sheet | Shape | Type | Description |
|---|---|---|---|
| `LOAD` | 3052 × 397 | Master tracker | Cumulative play count matrix (all songs × all time slots) |
| `3 hr template` | 503 × 207 | Template | 3-hour scheduling block skeleton |
| `1 day template` | 502 × 296 | Template | Full day skeleton |
| `1 day by 4 hr template` | — | Template | 1-day broken into 4-hour chunks |
| `4 hour template` | 3456 × 211 | Template | 4-hour scheduling block skeleton |
| `FGs` | 211 × 296 | Song library | Foreign Golden Standards (slow) |
| `FGf` | 79 × 296 | Song library | Foreign Golden (fast/uptempo) |
| `PGs` | 40 × 296 | Song library | Philippine Golden Standards (slow) |
| `PGf` | — | Song library | Philippine Golden (fast) |
| `JBx` | 61 × 296 | Song library | Philippine OPM / Jeepney Beat |
| `7` / `7B` | 223 × 211 | Song library | 70s music (A/B sub-pools) |
| `8` / `8B` | — | Song library | 80s music |
| `9` / `9B` | — | Song library | 90s music |
| `c1`–`c3` | — | Song library | Contemporary (3 rotation sub-pools) |
| `y1`, `y1B`, `y2`, `y2B` | — | Song library | Young Contemporary |
| `duplex`, `duplexB` | — | Song library | Unconfirmed — needs clarification |
| `x` | — | Song library | Unconfirmed |
| `pd` | — | Song library | Unconfirmed (possibly Promo/Dedication) |
| `d1`–`d4`, `d9`, `dc`, `dr` | — | Song library | Dedication categories |
| `xmas 24` | — | Seasonal | Christmas special rotation |
| `Sheet1`, `Sheet2`, `Sheet3`, `Sheet4` | — | Empty | Unused |

#### Song Entry Format

Every song in every category sheet follows this format in column B:

```
FGsA     Song Title - Artist {CategoryCode_Hour-CategoryCode_Hour-}
```

Examples:
```
FGsA     A Man Without Love - Engelbert Humperdinck {FGsA_4-FGsA_5-FGsA_6-}
FGfA     A Hard Day's Night - Beatles {FGfA_4-FGfA_5-FGfA_6-}
JBxA     Bakit Ako Mahihiya - Didith Reyes {JBxA_9-JBxA_10-}
A7       A Love Song - Kenny Rogers {A7_4-A7_9-A7_10-A7_13-A7_14-}
```

The `{Code_Hour-}` tokens define **eligible time slots**. The suffix hour number (4, 5, 9, 10, etc.) represents the broadcast hour (24-hour format) when this song is allowed to be scheduled.

#### Template Structure

Template sheets use a grid where:
- **Rows**: numbered song positions (1 through N per hour)
- **Columns**: grouped by hour (every 4 columns = 1 hour, positions 1–4)
- **Row 0**: hour labels (`04:00:00`, `05:00:00`, ...)
- **Row 1**: sub-position labels (`1`, `2`, `3`, `4`, repeating)
- **Data cells**: category assignment code or `0` for empty

Column mapping formula:
```
hour_index = (col - first_data_col) // 4
position   = (col - first_data_col) % 4 + 1
```
Where `first_data_col` = 4 for `1 day template`, 2 for `3 hr template` and `4 hour template`.

#### LOAD Sheet

- Shape: 3052 rows × 397 columns
- Row 0: time slot headers (`MON-FRI`, `04:00:00`, `05:00:00`, ...)
- Rows 1+: song rows from all categories (aggregated)
- Values: cumulative play count integers (0 = never played)
- Used for rotation: the system picks songs with lower cumulative counts

---

## Migration Decisions

### What maps to what

| Excel | Web App |
|---|---|
| Category sheet (e.g., FGs) | `categories` table + `songs` table |
| Song entry string | `songs.title`, `songs.artist`, `song_slots.eligible_hour` |
| Template sheet | `templates` + `template_slots` tables |
| LOAD sheet matrix | `play_history` table (normalized, one row per play event) |
| iFM Manila output | `playlists` + `playlist_entries` tables + XLSX export |
| VBA macro (scheduling) | `scheduler-service` generation algorithm |

### Algorithm Reconstruction

The VBA macro behavior was inferred from data structures (see `LESSONS.md` L-001). The reconstructed algorithm:

```
For each slot in template (ordered by hour ASC, position ASC):
  1. Look up required_category for this slot
  2. Get all active songs in that category eligible for this hour (via song_slots)
  3. Apply rotation_rules filters:
     a. Exclude songs played within min_gap_hours today
     b. Exclude songs where same artist already in adjacent artist_separation_slots slots
     c. Exclude songs that hit max_plays_per_day
  4. From remaining candidates: ORDER BY last played_at ASC (least recently played first)
  5. Pick first candidate
  6. If no candidates: log warning, relax rules and retry (fallback)
  7. Insert playlist_entry, insert play_history record
```

### Data Import Plan

#### Song Library Import
1. Parse each category sheet from `PlayGen Encoder2.2.xlsm`
2. For each row after header (rows 2+), parse column B with `parseMaterialString()`
3. Create `category` record (if new), `song` record, and `song_slots` records
4. Flag `raw_material` with original string for audit

#### Historical LOAD Data Import
1. Read non-zero cells from LOAD sheet matrix
2. For each non-zero `(row=song, col=time_slot, value=count)`:
   - Find matching song by `raw_material`
   - Back-calculate approximate `played_at` as `NOW() - (count * 1 day)` (rough approximation)
   - Set `source = 'imported'`
3. Used for testing rotation algorithm with realistic data; not critical for production accuracy

---

## Phased Delivery

| Phase | Deliverable |
|---|---|
| 1 | Auth, Company/Station, DB schema, Docker setup |
| 2 | Song Library + bulk XLSM import + seed data |
| 3 | Template Builder |
| 4 | Scheduler Engine + Playlist Editor + XLSX Export |
| 5 | Rotation Rules UI + Analytics Dashboard |
| 6 | Broadcast system export adapters (future) |

See `TODO.md` for detailed task breakdown per phase.
