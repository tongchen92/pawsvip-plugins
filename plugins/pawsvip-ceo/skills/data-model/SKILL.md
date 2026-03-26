---
name: pawsvip-data-model
description: PawsVIP database schema, column semantics, timezone rules, and tested SQL query patterns. Use automatically when writing SQL queries against the PawsVIP Supabase database.
user-invocable: false
---

# PawsVIP Data Model

## Critical Rules — Read Before Every Query

1. **Occupancy questions → `forecast_historical_occupancy`**. NEVER scan the `reservation` table for occupancy counts. The `forecast_historical_occupancy` table has pre-aggregated daily totals by service type (boarding, daycare, grooming) and location. It is fast and indexed.
2. **No project ID lookup needed** — just execute SQL directly. Do not call list_projects or get_project_url.
3. **Case-sensitive columns in `reservation`** — these columns use camelCase and MUST be double-quoted in SQL: `"petName"`, `"ownerId"`, `"reservationId"`. All other tables use snake_case.
4. **No `locations` table** — use `CASE location_id WHEN 1 THEN 'Tukwila' WHEN 2 THEN 'Ballard' WHEN 3 THEN 'West Seattle' END`
5. **Location filter shorthand** — when the user says "Tukwila" use `location_id = 1`, "Ballard" use `location_id = 2`, "West Seattle" use `location_id = 3`
6. **Always include LIMIT** — default to `LIMIT 100` unless the query is an aggregation
7. **Skip preamble** — go straight to writing and executing the SQL query. Do not explain what you're about to do. Just do it.

## Query Efficiency

- **Use date ranges** — always bound with date filters, never scan all history
- **Use FILTER for conditional aggregates** — `COUNT(*) FILTER (WHERE ...)` is faster than CASE
- **Avoid full table scans** — the `reservation` table has hundreds of thousands of rows

## Timezone Rules

**Most timestamps are `timestamptz` (UTC-aware)** — convert to PST for display:
```sql
created_at AT TIME ZONE 'America/Los_Angeles'
```

**Exceptions — PST-naive columns (NO timezone conversion needed):**
- `airport_requests.arrival_time`, `departure_time`, `pickup_time`, `dropoff_time` — stored as local PST
- `airport_layover_tasks.scheduled_time` — stored as local PST
- `schedule_shifts.start_time`, `end_time` — stored as local time (TIME type, no date)
- `shift_task_templates.start_time`, `end_time` — stored as local time

**Date columns** (`schedule_shifts.date`, `tills.counted_date`, etc.) are **date-only, no timezone**.

## Query Logging

After answering each question, INSERT a log entry into the `ceo_query_log` table:

```sql
INSERT INTO ceo_query_log (asked_by, question, queries_used, confidence, notes, command)
VALUES (
  'Tong',                          -- replace with the user's name
  'How many dogs at Tukwila?',     -- the actual question asked
  'SELECT COUNT(*) FROM ...',      -- the SQL queries you executed (truncate if very long)
  'high',                          -- 'high', 'medium', or 'low'
  null,                            -- any issues or improvement suggestions
  'ad-hoc'                         -- 'morning-briefing', 'weekly-review', 'investigate', or 'ad-hoc'
);
```

This log is shared across all users and helps improve the plugin over time. To review recent queries:
```sql
SELECT asked_at, asked_by, question, confidence, notes
FROM ceo_query_log
ORDER BY asked_at DESC
LIMIT 20;
```

---

## Core Tables

### `reservation`
Synced from Gingr. Table name comes from env var `NEXT_PUBLIC_RESERVATION_TABLE_NAME` — the production name is `reservation`.

| Column | Type | Notes |
|--------|------|-------|
| reservationId | text | Primary key, from Gingr |
| check_in_date | timestamptz | When the pet was checked in. NULL = not yet checked in |
| check_out_date | timestamptz | When the pet was checked out. NULL = still checked in |
| petName | text | Pet's name (case-sensitive) |
| location_id | integer | 1=Tukwila, 2=Ballard, 3=West Seattle |
| ownerId | text | Owner ID from Gingr (maps to customer_links.owner_id) |
| room | text | Room assignment (nullable) |
| start_date | timestamptz | Reservation start date |
| owner_cell_phone | text | Owner cell phone |
| owner_home_phone | text | Owner home phone |
| owner_cell_phone_digits | text (generated) | Digits-only normalized phone |
| owner_home_phone_digits | text (generated) | Digits-only normalized phone |

**Data freshness:** Synced from Gingr via webhooks (real-time for check-in/out) and hourly cron (bulk sync). May be up to 1 hour stale for non-check-in/out changes.

### `pawsvip_staff`
| Column | Type | Notes |
|--------|------|-------|
| staff_id | integer | Primary key (auto-increment) |
| email | text | Unique |
| name | text | Display name |
| role | text | 'admin', 'manager', 'lead', 'staff' |
| active | boolean | Default true |
| allow_location_ids | text[] | Location access. NULL = all locations |

### `schedule_weeks`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| week_start | date | Monday of the week (unique) |
| status | text | 'draft' or 'published' |
| published_at | timestamptz | When published |
| location_notes | jsonb | Per-location notes |

**Index:** `idx_schedule_weeks_week_start` (week_start DESC)

### `schedule_shifts`
| Column | Type | Notes |
|--------|------|-------|
| id | text | Primary key |
| schedule_week_id | uuid | FK to schedule_weeks |
| date | date | Shift date |
| start_time | time | Local PST time (no TZ conversion) |
| end_time | time | Local PST time |
| staff_id | integer | FK to pawsvip_staff. NULL = unfilled shift |
| is_lead | boolean | Shift lead flag |
| location_id | integer | 1, 2, or 3 |
| notes | text | Optional |

**Indexes:** `idx_schedule_shifts_week_id`, `idx_schedule_shifts_date`, `idx_schedule_shifts_staff_id`

### `pet_gallery`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| media_url | text | Photo/video URL (unique) |
| media_type | text | 'image' or 'video' |
| thumbnail_url | text | Video thumbnail |
| animal_ids | text[] | Auto-tagged animal IDs (GIN indexed) |
| caption | text | Optional caption |
| uploaded_by | text | Staff email |
| uploaded_at | timestamptz | Upload time |
| is_visible | boolean | Visible on customer portal |
| email_notification_status | text | 'pending', 'scheduled', 'processing', 'sent', 'failed', 'skipped', 'ai_rejected' |
| email_sent_at | timestamptz | When notification was sent |
| location_id | integer | Upload location |
| visible_at | timestamptz | When photo became visible |
| email_scheduled_at | timestamptz | Scheduled send time |
| ai_verification | jsonb | Gemini vision check result |
| processing_started_at | timestamptz | Cron processing claim time |

**Indexes:** `idx_pet_gallery_email_status`, `idx_pet_gallery_location_id`, `idx_pet_gallery_uploaded_at`, `idx_pet_gallery_uploaded_by`

### `gallery_reactions`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| gallery_item_id | uuid | FK to pet_gallery |
| owner_id | integer | Customer who reacted |
| reaction_type | text | Default 'heart' |
| note | text | Optional thank-you note (max 500 chars) |
| pet_name | text | Denormalized |
| owner_name | text | Denormalized |
| media_url | text | Denormalized photo URL |
| uploaded_by | text | Denormalized staff email |
| created_at | timestamptz | When reacted |

**Index:** `idx_gallery_reactions_created_at` (created_at DESC)

### `customer_links`
| Column | Type | Notes |
|--------|------|-------|
| owner_id | integer | Primary key (Gingr owner ID) |
| share_token | text | Unique portal access token |
| owner_name | text | Pet parent name |
| email | text | Pet parent email |
| created_at | timestamptz | When created |

### `tills`
| Column | Type | Notes |
|--------|------|-------|
| id | bigint | Primary key |
| location_id | integer | 1, 2, or 3 |
| staff_id | integer | Who counted |
| cash_amount | decimal(10,2) | End-of-day till count |
| cash_receipts | decimal(10,2) | Cash revenue collected |
| cash_expenses | decimal(10,2) | Cash spent |
| cash_taken_home | decimal(10,2) | Cash removed from till |
| counted_date | date | Date counted |
| notes | text | Optional |
| created_at | timestamptz | Record creation time |

**Indexes:** `idx_tills_location_id`, `idx_tills_counted_date` (DESC)

### `shift_task_templates`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| location_id | integer | 1, 2, or 3 |
| shift_type | shift_kind | OPEN, CLOSE, or OVERNIGHT |
| name | text | Task name |
| description | text | Optional instructions |
| start_time | time | When task should begin (local PST) |
| end_time | time | When task should be done (local PST) |
| sort_order | integer | Display ordering |
| active | boolean | Soft delete flag |

### `shift_task_completions`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| template_id | uuid | FK to shift_task_templates |
| shift_date | date | Which day |
| completed_at | timestamptz | When completed |
| completed_by | integer | Staff ID |
| completed_by_name | text | Denormalized |

**Unique:** (template_id, shift_date) — one completion per task per day

### `leads`
| Column | Type | Notes |
|--------|------|-------|
| id | bigint | Primary key |
| created_at | timestamptz | When lead arrived |
| phone | text | Unique |
| source | text | UTM source |
| campaign | text | UTM campaign |
| keywords | text | UTM term |
| notes | text | Immutable form context |
| staff_notes | text | Mutable staff annotations |
| status | text | 'new', 'contacted', 'booked', 'converted', 'existing', 'lost', 'owner_created' |
| submit_count | integer | Default 1 |
| utm_raw | jsonb | Full UTM data |
| status_updated_at | timestamptz | Last status change |
| status_updated_by | text | Who changed status |
| gingr_owner_id | text | Linked Gingr owner |
| location_id | integer | Location |

**Indexes:** `idx_leads_created_at` (DESC), `idx_leads_status`, `idx_leads_source`

### `tag_reports`
Dog ID misidentification reports.

| Column | Type | Notes |
|--------|------|-------|
| id | text | Primary key |
| item_id | text | Gallery item ID |
| item_type | text | 'update' or 'gallery' |
| owner_id | integer | Reporter |
| reported_animal_ids | text[] | Animals reported as misidentified |
| reported_at | timestamptz | When reported |
| resolved_at | timestamptz | NULL while unresolved |
| investigation_status | text | Investigation workflow state |
| investigation_root_cause | text | What caused the misidentification |
| investigation_confidence | text | Confidence level |
| investigation_proposed_actions | jsonb | Array of proposed fixes |
| investigated_at | timestamptz | When investigated |

### `pet_attention_alerts`
Recurring care tasks for dogs needing treatment.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| location_id | integer | 1, 2, or 3 |
| reservation_id | text | Linked reservation |
| animal_id | text | Which animal |
| pet_name | text | Pet name |
| description | text | What care is needed |
| interval_hours | integer | How often (hours) |
| active | boolean | Currently active |
| created_at | timestamptz | When created |
| closed_at | timestamptz | When deactivated |

**Index:** `idx_pet_attention_alerts_location_active` (location_id, active)

### `forecast_historical_occupancy`
Pre-aggregated daily occupancy counts by service type. **Use this instead of scanning the `reservation` table for occupancy queries.**

| Column | Type | Notes |
|--------|------|-------|
| date | date | NOT NULL, primary key (with location_id) |
| location_id | integer | NOT NULL, default 1. 1=Tukwila, 2=Ballard, 3=West Seattle |
| boarding | integer | NOT NULL, default 0. Boarding dog count |
| daycare | integer | NOT NULL, default 0. Daycare dog count |
| grooming | integer | NOT NULL, default 0. Grooming dog count |
| unknown | integer | NOT NULL, default 0. Uncategorized |
| total_occupancy | integer | Sum of all service types |
| last_updated_at | timestamptz | When this row was last refreshed |
| created_at | timestamptz | When this row was first created |

**Data freshness:** Populated by a daily cron job. Historical data is stable; today's row may lag until the next sync.

### `media_ingestion_ledger`
Tracks all PawsDrop uploads.

| Column | Type | Notes |
|--------|------|-------|
| uploader_email | text | Staff email |
| content_type | text | MIME type (image/*, video/*) |
| location_id | integer | Upload location |
| created_at | timestamptz | Upload time |

---

## Tested Example Queries

Use these patterns as templates. They use correct column names and table relationships.

### 1. Daily occupancy by location (today or any date)
```sql
SELECT
  CASE location_id
    WHEN 1 THEN 'Tukwila'
    WHEN 2 THEN 'Ballard'
    WHEN 3 THEN 'West Seattle'
  END AS location_name,
  boarding, daycare, grooming, total_occupancy
FROM forecast_historical_occupancy
WHERE date = CURRENT_DATE
ORDER BY location_id;
```

### 2. Weekly occupancy trend (7-day daily counts)
```sql
SELECT
  date,
  CASE location_id
    WHEN 1 THEN 'Tukwila'
    WHEN 2 THEN 'Ballard'
    WHEN 3 THEN 'West Seattle'
  END AS location_name,
  boarding, daycare, grooming, total_occupancy
FROM forecast_historical_occupancy
WHERE date >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY date DESC, location_id
LIMIT 100;
```

### 3. Occupancy comparison: this week vs last week
```sql
SELECT
  CASE location_id
    WHEN 1 THEN 'Tukwila'
    WHEN 2 THEN 'Ballard'
    WHEN 3 THEN 'West Seattle'
  END AS location_name,
  SUM(CASE WHEN date >= date_trunc('week', CURRENT_DATE) THEN total_occupancy END) AS this_week_total,
  SUM(CASE WHEN date >= date_trunc('week', CURRENT_DATE) - INTERVAL '7 days'
           AND date < date_trunc('week', CURRENT_DATE) THEN total_occupancy END) AS last_week_total
FROM forecast_historical_occupancy
WHERE date >= date_trunc('week', CURRENT_DATE) - INTERVAL '7 days'
GROUP BY location_id
ORDER BY location_id;
```

### 4. Year-over-year monthly occupancy for a location
```sql
SELECT
  EXTRACT(YEAR FROM date) AS year,
  EXTRACT(MONTH FROM date) AS month,
  ROUND(AVG(total_occupancy), 1) AS avg_daily_occupancy,
  MAX(total_occupancy) AS peak_day,
  SUM(total_occupancy) AS total_dog_days
FROM forecast_historical_occupancy
WHERE location_id = 1  -- 1=Tukwila, 2=Ballard, 3=West Seattle
GROUP BY EXTRACT(YEAR FROM date), EXTRACT(MONTH FROM date)
ORDER BY year, month;
```

### 5. Monthly occupancy trend across all locations
```sql
SELECT
  EXTRACT(YEAR FROM date) AS year,
  EXTRACT(MONTH FROM date) AS month,
  CASE location_id
    WHEN 1 THEN 'Tukwila'
    WHEN 2 THEN 'Ballard'
    WHEN 3 THEN 'West Seattle'
  END AS location_name,
  ROUND(AVG(total_occupancy), 1) AS avg_daily_occupancy,
  ROUND(AVG(boarding), 1) AS avg_boarding,
  ROUND(AVG(daycare), 1) AS avg_daycare
FROM forecast_historical_occupancy
GROUP BY EXTRACT(YEAR FROM date), EXTRACT(MONTH FROM date), location_id
ORDER BY year, month, location_id;
```

### 6. Staff schedule for a given week
```sql
SELECT
  ss.date,
  ss.start_time,
  ss.end_time,
  ps.name AS staff_name,
  ss.is_lead,
  CASE ss.location_id
    WHEN 1 THEN 'Tukwila'
    WHEN 2 THEN 'Ballard'
    WHEN 3 THEN 'West Seattle'
  END AS location_name,
  ss.notes
FROM schedule_shifts ss
JOIN schedule_weeks sw ON ss.schedule_week_id = sw.id
LEFT JOIN pawsvip_staff ps ON ss.staff_id = ps.staff_id
WHERE sw.week_start = '2026-03-23'  -- replace with target Monday
  AND sw.status = 'published'
ORDER BY ss.date, ss.location_id, ss.start_time
LIMIT 200;
```

### 7. Shift task completion rate by location and date
```sql
SELECT
  CASE stt.location_id
    WHEN 1 THEN 'Tukwila'
    WHEN 2 THEN 'Ballard'
    WHEN 3 THEN 'West Seattle'
  END AS location_name,
  stt.shift_type,
  COUNT(stt.id) AS total_tasks,
  COUNT(stc.id) AS completed_tasks,
  ROUND(COUNT(stc.id)::numeric / NULLIF(COUNT(stt.id), 0) * 100, 1) AS completion_pct
FROM shift_task_templates stt
LEFT JOIN shift_task_completions stc
  ON stc.template_id = stt.id AND stc.shift_date = CURRENT_DATE
WHERE stt.active = true
GROUP BY stt.location_id, stt.shift_type
ORDER BY stt.location_id, stt.shift_type
LIMIT 50;
```

### 8. Gallery items uploaded today by location
```sql
SELECT
  CASE location_id
    WHEN 1 THEN 'Tukwila'
    WHEN 2 THEN 'Ballard'
    WHEN 3 THEN 'West Seattle'
  END AS location_name,
  COUNT(*) AS uploads_today,
  COUNT(*) FILTER (WHERE media_type = 'image') AS photos,
  COUNT(*) FILTER (WHERE media_type = 'video') AS videos
FROM pet_gallery
WHERE uploaded_at >= (CURRENT_DATE AT TIME ZONE 'America/Los_Angeles')::timestamptz
GROUP BY location_id
ORDER BY location_id;
```

### 9. Unresolved tag reports
```sql
SELECT
  id,
  item_type,
  reported_animal_ids,
  reported_at,
  investigation_status
FROM tag_reports
WHERE resolved_at IS NULL
ORDER BY reported_at DESC
LIMIT 50;
```

### 10. Till / cash balance by location for date range
```sql
SELECT
  counted_date,
  CASE location_id
    WHEN 1 THEN 'Tukwila'
    WHEN 2 THEN 'Ballard'
    WHEN 3 THEN 'West Seattle'
  END AS location_name,
  cash_amount AS till_count,
  cash_receipts,
  cash_expenses,
  cash_taken_home,
  (cash_amount - COALESCE(cash_receipts, 0) + COALESCE(cash_expenses, 0) + COALESCE(cash_taken_home, 0)) AS variance
FROM tills
WHERE counted_date >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY counted_date DESC, location_id
LIMIT 50;
```

### 11. Active pet attention alerts
```sql
SELECT
  CASE location_id
    WHEN 1 THEN 'Tukwila'
    WHEN 2 THEN 'Ballard'
    WHEN 3 THEN 'West Seattle'
  END AS location_name,
  pet_name,
  description,
  interval_hours,
  created_at
FROM pet_attention_alerts
WHERE active = true
ORDER BY location_id, pet_name
LIMIT 50;
```

### 12. New customers this week
```sql
SELECT
  COUNT(*) AS new_customers,
  MIN(created_at) AS earliest,
  MAX(created_at) AS latest
FROM customer_links
WHERE created_at >= date_trunc('week', CURRENT_DATE)
LIMIT 1;
```

### 13. Gallery reactions received this week
```sql
SELECT
  gr.uploaded_by AS staff_email,
  COUNT(*) AS reactions_received,
  COUNT(DISTINCT gr.gallery_item_id) AS unique_photos_liked
FROM gallery_reactions gr
WHERE gr.created_at >= date_trunc('week', CURRENT_DATE)
GROUP BY gr.uploaded_by
ORDER BY reactions_received DESC
LIMIT 50;
```

### 14. Leads by status and source
```sql
SELECT
  status,
  source,
  COUNT(*) AS lead_count,
  MIN(created_at) AS earliest,
  MAX(created_at) AS latest
FROM leads
GROUP BY status, source
ORDER BY lead_count DESC
LIMIT 50;
```
