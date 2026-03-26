---
name: pawsvip-data-model
description: PawsVIP database schema and tested SQL patterns. Triggers on any question about PawsVIP data — occupancy, staffing, gallery, leads, tills, or reservations. Always use this skill before writing SQL.
user-invocable: false
---

# PawsVIP Data Model

## CRITICAL: Supabase Project ID

**Project ID: `jkwizuoumbsoznlnsykw`**

Pass this project_id directly to `execute_sql`. NEVER call `list_projects`, `list_tables`, `get_project`, or any discovery tool. You already have everything you need — the project ID above and the schemas below. Execute the query immediately.

## Table Routing — Which Table For Which Question

Before writing any query, use this decision tree. The table choice is not optional.

| Question about... | Use this table | NOT this |
|---|---|---|
| Occupancy, dog counts, trends, YoY, capacity, how many dogs | `forecast_historical_occupancy` | ~~`reservation`~~ |
| Boarding vs daycare vs grooming breakdown | `forecast_historical_occupancy` | ~~`reservation`~~ |
| Monthly/weekly/daily occupancy averages | `forecast_historical_occupancy` | ~~`reservation`~~ |
| A specific pet or owner's reservation | `reservation` | |
| Who is checked in right now (by name) | `reservation` | |
| Staff schedule, shifts, coverage | `schedule_shifts` + `pawsvip_staff` | |
| Shift task completion | `shift_task_templates` + `shift_task_completions` | |
| Gallery photos, uploads, email status | `pet_gallery` | |
| Customer reactions / likes | `gallery_reactions` | |
| Leads, marketing, conversions | `leads` | |
| Cash, till counts, reconciliation | `tills` | |
| Dog ID misidentification | `tag_reports` | |
| Pet care alerts | `pet_attention_alerts` | |

The `reservation` table has hundreds of thousands of rows with camelCase columns that require double-quoting (`"petName"`, `"ownerId"`, `"reservationId"`). It is slow and error-prone for aggregate queries. `forecast_historical_occupancy` has one row per location per day with pre-computed totals — it answers occupancy questions in milliseconds.

## Response Rules

1. Execute SQL immediately — no preamble, no "let me look up the project", no todo lists
2. Location shorthand: Tukwila = `location_id = 1`, Ballard = `location_id = 2`, West Seattle = `location_id = 3`
3. Use `CASE location_id WHEN 1 THEN 'Tukwila' WHEN 2 THEN 'Ballard' WHEN 3 THEN 'West Seattle' END` for display
4. Always include `LIMIT` unless it's an aggregation
5. Present results in a table, add a brief insight only if notable

---

## `forecast_historical_occupancy` — The Occupancy Table

One row per location per day. Pre-aggregated. This is the ONLY table for occupancy questions.

| Column | Type | Notes |
|--------|------|-------|
| date | date | NOT NULL |
| location_id | integer | 1=Tukwila, 2=Ballard, 3=West Seattle |
| boarding | integer | Boarding dog count for that day |
| daycare | integer | Daycare dog count |
| grooming | integer | Grooming dog count |
| unknown | integer | Uncategorized |
| total_occupancy | integer | Sum of all service types |
| last_updated_at | timestamptz | Last refresh time |

### Occupancy Query Templates

**Today's occupancy:**
```sql
SELECT
  CASE location_id WHEN 1 THEN 'Tukwila' WHEN 2 THEN 'Ballard' WHEN 3 THEN 'West Seattle' END AS location,
  boarding, daycare, grooming, total_occupancy
FROM forecast_historical_occupancy
WHERE date = CURRENT_DATE
ORDER BY location_id;
```

**Weekly trend (last 7 days):**
```sql
SELECT date,
  CASE location_id WHEN 1 THEN 'Tukwila' WHEN 2 THEN 'Ballard' WHEN 3 THEN 'West Seattle' END AS location,
  boarding, daycare, total_occupancy
FROM forecast_historical_occupancy
WHERE date >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY date DESC, location_id;
```

**This week vs last week:**
```sql
SELECT
  CASE location_id WHEN 1 THEN 'Tukwila' WHEN 2 THEN 'Ballard' WHEN 3 THEN 'West Seattle' END AS location,
  SUM(CASE WHEN date >= date_trunc('week', CURRENT_DATE) THEN total_occupancy END) AS this_week,
  SUM(CASE WHEN date >= date_trunc('week', CURRENT_DATE) - INTERVAL '7 days'
           AND date < date_trunc('week', CURRENT_DATE) THEN total_occupancy END) AS last_week
FROM forecast_historical_occupancy
WHERE date >= date_trunc('week', CURRENT_DATE) - INTERVAL '7 days'
GROUP BY location_id ORDER BY location_id;
```

**Year-over-year monthly occupancy (single location):**
```sql
SELECT
  EXTRACT(YEAR FROM date)::int AS year,
  EXTRACT(MONTH FROM date)::int AS month,
  ROUND(AVG(total_occupancy), 1) AS avg_daily,
  MAX(total_occupancy) AS peak_day,
  SUM(total_occupancy) AS total_dog_days
FROM forecast_historical_occupancy
WHERE location_id = 1  -- change for Ballard (2) or West Seattle (3)
GROUP BY year, month
ORDER BY year, month;
```

**Year-over-year all locations:**
```sql
SELECT
  EXTRACT(YEAR FROM date)::int AS year,
  EXTRACT(MONTH FROM date)::int AS month,
  CASE location_id WHEN 1 THEN 'Tukwila' WHEN 2 THEN 'Ballard' WHEN 3 THEN 'West Seattle' END AS location,
  ROUND(AVG(total_occupancy), 1) AS avg_daily,
  ROUND(AVG(boarding), 1) AS avg_boarding,
  ROUND(AVG(daycare), 1) AS avg_daycare
FROM forecast_historical_occupancy
GROUP BY year, month, location_id
ORDER BY year, month, location_id;
```

**Seasonal comparison (same month across years):**
```sql
SELECT
  EXTRACT(YEAR FROM date)::int AS year,
  CASE location_id WHEN 1 THEN 'Tukwila' WHEN 2 THEN 'Ballard' WHEN 3 THEN 'West Seattle' END AS location,
  ROUND(AVG(total_occupancy), 1) AS avg_daily,
  MAX(total_occupancy) AS peak
FROM forecast_historical_occupancy
WHERE EXTRACT(MONTH FROM date) = 3  -- change month number
GROUP BY year, location_id
ORDER BY year, location_id;
```

**Busiest days of the week:**
```sql
SELECT
  TO_CHAR(date, 'Day') AS day_of_week,
  EXTRACT(DOW FROM date) AS dow,
  ROUND(AVG(total_occupancy), 1) AS avg_daily
FROM forecast_historical_occupancy
WHERE location_id = 1 AND date >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY day_of_week, dow
ORDER BY dow;
```

---

## Other Tables

### `reservation`
Synced from Gingr. Use ONLY for individual pet/owner lookups, NOT for occupancy counts.

| Column | Type | Notes |
|--------|------|-------|
| "reservationId" | text | PK. camelCase — MUST double-quote in SQL |
| check_in_date | timestamptz | NULL = not yet checked in |
| check_out_date | timestamptz | NULL = still checked in |
| "petName" | text | camelCase — MUST double-quote |
| location_id | integer | 1, 2, or 3 |
| "ownerId" | text | camelCase — MUST double-quote |
| start_date | timestamptz | Reservation start |
| room | text | Room assignment |

### `pawsvip_staff`
| Column | Type | Notes |
|--------|------|-------|
| staff_id | integer | PK |
| email | text | Unique |
| name | text | Display name |
| role | text | 'admin', 'manager', 'lead', 'staff' |
| active | boolean | Default true |

### `schedule_weeks` / `schedule_shifts`
Schedule runs Mon-Sun. `schedule_weeks.status` = 'draft' or 'published'. `schedule_shifts.staff_id IS NULL` = unfilled shift.

**Staff schedule query:**
```sql
SELECT ss.date, ss.start_time, ss.end_time, ps.name, ss.is_lead,
  CASE ss.location_id WHEN 1 THEN 'Tukwila' WHEN 2 THEN 'Ballard' WHEN 3 THEN 'West Seattle' END AS location
FROM schedule_shifts ss
JOIN schedule_weeks sw ON ss.schedule_week_id = sw.id
LEFT JOIN pawsvip_staff ps ON ss.staff_id = ps.staff_id
WHERE sw.week_start = '2026-03-23' AND sw.status = 'published'
ORDER BY ss.date, ss.location_id, ss.start_time LIMIT 200;
```

### `shift_task_templates` / `shift_task_completions`
**Completion rate query:**
```sql
SELECT
  CASE stt.location_id WHEN 1 THEN 'Tukwila' WHEN 2 THEN 'Ballard' WHEN 3 THEN 'West Seattle' END AS location,
  stt.shift_type, COUNT(stt.id) AS total, COUNT(stc.id) AS done,
  ROUND(COUNT(stc.id)::numeric / NULLIF(COUNT(stt.id), 0) * 100, 1) AS pct
FROM shift_task_templates stt
LEFT JOIN shift_task_completions stc ON stc.template_id = stt.id AND stc.shift_date = CURRENT_DATE
WHERE stt.active = true
GROUP BY stt.location_id, stt.shift_type ORDER BY stt.location_id LIMIT 50;
```

### `pet_gallery`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| uploaded_by | text | Staff email |
| uploaded_at | timestamptz | Upload time |
| media_type | text | 'image' or 'video' |
| location_id | integer | Upload location |
| email_notification_status | text | 'pending'→'scheduled'→'processing'→'sent' |

### `gallery_reactions`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| gallery_item_id | uuid | FK to pet_gallery |
| uploaded_by | text | Staff who took the photo |
| created_at | timestamptz | When reacted |

### `leads`
| Column | Type | Notes |
|--------|------|-------|
| id | bigint | PK |
| created_at | timestamptz | When lead arrived |
| source | text | UTM source |
| status | text | 'new', 'contacted', 'booked', 'converted', 'existing', 'lost' |
| location_id | integer | Location |

### `tills`
| Column | Type | Notes |
|--------|------|-------|
| counted_date | date | Date counted |
| location_id | integer | 1, 2, or 3 |
| cash_amount | decimal | End-of-day till count |
| cash_receipts | decimal | Cash revenue |
| cash_expenses | decimal | Cash spent |

### `customer_links`
| Column | Type | Notes |
|--------|------|-------|
| owner_id | integer | PK (Gingr owner ID) |
| owner_name | text | Pet parent name |
| email | text | Pet parent email |
| created_at | timestamptz | When created |

### `tag_reports`
Dog ID misidentification reports. `resolved_at IS NULL` = unresolved.

### `pet_attention_alerts`
Active care tasks. `active = true` = currently active.

---

## Timezone Rules

- Most timestamps are `timestamptz` — convert to PST with `AT TIME ZONE 'America/Los_Angeles'`
- `schedule_shifts.start_time/end_time` are local TIME — no conversion
- `date` columns are date-only — no timezone

## Query Logging

After answering, log the interaction:
```sql
INSERT INTO ceo_query_log (asked_by, question, queries_used, confidence, command)
VALUES ('Tong', 'the question', 'the SQL', 'high', 'ad-hoc');
```
