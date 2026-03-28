---
name: pawsvip-data-model
description: PawsVIP database schema and tested SQL patterns. Triggers on any question about PawsVIP data — occupancy, staffing, gallery, leads, tills, revenue, payments, clover, or reservations. Always use this skill before writing SQL.
user-invocable: false
---

# PawsVIP Data Model

## CRITICAL: Supabase Project ID

**Project ID: `jkwizuoumbsoznlnsykw`**

Pass this project_id directly to `execute_sql`. NEVER call `list_projects`, `list_tables`, `get_project`, or any discovery tool. You already have everything you need — the project ID above and the schemas below. Execute the query immediately.

## Disambiguation Cheat Sheet

**Read this FIRST.** When a question could match multiple tables, this resolves the ambiguity.

| If the question sounds like... | Use THIS table | NOT this | Why |
|-------------------------------|---------------|----------|-----|
| "How many dogs" / occupancy / capacity / trends | `forecast_historical_occupancy` | `reservation` | Pre-aggregated daily counts; reservation has ~150K raw rows |
| "Revenue" / "how much did we make" / payments | `clover_transactions` | `gingr_invoices` | Clover has ~16K real transactions; gingr_invoices is empty |
| "Cash in the till" / cash drawer | `tills` | `clover_transactions` | Tills = physical cash counts; Clover = card payments |
| "How are leads doing" (funnel/status) | `leads` | `lead_outreach` | Leads has status progression; outreach has call/text activity |
| "How many calls/texts to leads" (activity) | `lead_outreach` | `leads` | Outreach tracks individual contact attempts |
| "Customer likes" / hearts / reactions | `gallery_reactions` | `review_clicks` | Reactions = gallery photo likes; review_clicks = Google/Yelp clicks |
| "Customer reviews" (Google/Yelp) | `review_clicks` | `gallery_reactions` | Tracks click-throughs to external review sites |
| "Gallery photos" (customer-facing) | `pet_gallery` | — | Curated photos that made it through the pipeline |
| "Who is this specific pet/owner" | `reservation` | `forecast_historical_occupancy` | Only use reservation for individual lookups by name |

---

## Table Routing by Domain

### Occupancy & Trends (~2K rows)

For ALL questions about dog counts, capacity, trends, YoY, boarding vs daycare splits.

| Table | Use for |
|-------|---------|
| `forecast_historical_occupancy` | One row per location per day. Pre-computed boarding/daycare/grooming/total. Millisecond queries. |

**NEVER use `reservation` for occupancy.** It has ~150K rows, camelCase columns, no service-type breakdown, and is orders of magnitude slower.

### Individual Reservations & Pets (~150K rows)

For finding a specific pet, owner, or room assignment. NOT for counting or aggregating.

| Table | Use for |
|-------|---------|
| `reservation` | Individual pet/owner lookups. camelCase columns MUST be double-quoted: `"petName"`, `"ownerId"`, `"reservationId"` |
| `customer_links` | Pet parent portal access. Maps Gingr `owner_id` to `share_token`, `owner_name`, `email` |

### Financial & Revenue (~16K rows)

For revenue, payments, transaction analysis, and cash reconciliation.

| Table | Use for |
|-------|---------|
| `clover_transactions` | **POS card payments — the bulk of revenue.** Amounts stored in cents. |
| `tills` | End-of-day cash drawer counts entered by shift leads |
| `gingr_invoices` | Gingr-side invoice records (currently empty — do NOT use for revenue) |

**Revenue formula:** Card revenue = `SUM(amount_cents - tip_amount_cents - tax_amount_cents) / 100.0` from `clover_transactions WHERE result = 'SUCCESS'`. Total revenue = card revenue + `tills.cash_receipts`.

### Staffing & Schedules (~2K rows)

For who's working, shift coverage, unfilled shifts, staff hours.

| Table | Use for |
|-------|---------|
| `pawsvip_staff` | Staff roster — names, emails, roles, active status |
| `schedule_weeks` | Week containers. Mon→Sun. Find most recent week with shifts for baseline |
| `schedule_shifts` | Individual shift assignments. `staff_id IS NULL` = unfilled |

**Joins:** `schedule_shifts.schedule_week_id` → `schedule_weeks.id`, `schedule_shifts.staff_id` → `pawsvip_staff.staff_id`

### Shift Tasks & Pet Care

For task completion rates, checklists, and recurring pet care alerts.

| Table | Use for |
|-------|---------|
| `shift_task_templates` | Admin-configured task definitions per location + shift type (OPEN/CLOSE/OVERNIGHT) |
| `shift_task_completions` | When a task was marked done, and by whom (~2K rows) |
| `pet_attention_alerts` | Recurring pet care tasks (medication, special needs). `active = true` = ongoing |
| `pet_attention_completions` | Proof of pet care completion (photo/note) |

**Joins:** `shift_task_completions.template_id` → `shift_task_templates.id`, `pet_attention_completions.alert_id` → `pet_attention_alerts.id`

### Gallery & Media (~10K rows)

For gallery photos, email notification pipeline, customer engagement.

| Table | Use for |
|-------|---------|
| `pet_gallery` | Gallery items visible to customers. Tracks email notification status |
| `gallery_reactions` | Customer likes/hearts on gallery photos (~2K rows) |
| `tag_reports` | Dog ID misidentification reports. `resolved_at IS NULL` = unresolved (~160 rows) |

**Joins:** `gallery_reactions.gallery_item_id` → `pet_gallery.id`

### Leads & Sales (~170 rows)

For marketing leads, conversion funnel, outreach activity.

| Table | Use for |
|-------|---------|
| `leads` | Inbound leads. Status: 'new' → 'contacted' → 'booked' → 'converted' / 'lost' |
| `lead_outreach` | Individual outreach attempts (calls, texts, emails) linked to leads (~180 rows) |

**Joins:** `lead_outreach.lead_id` → `leads.id`

### Airport Services

For pet layover/shipping requests and their tasks.

| Table | Use for |
|-------|---------|
| `airport_requests` | Pet layover/shipping requests with billing (~17 rows) |
| `airport_layover_tasks` | Tasks for each airport request (pickup, feeding, etc.) |
| `airport_request_changes` | Audit log of changes to airport requests |

**Joins:** `airport_layover_tasks.request_id` → `airport_requests.id`

### Customer Engagement

For review tracking and feedback rate limiting.

| Table | Use for |
|-------|---------|
| `review_clicks` | Tracks when customers click Google/Yelp review links (~15 rows) |
| `feedback_rate_limit` | Rate-limits feedback emails: 1 per customer per service type per 30 days (~115 rows) |

---

## Response Rules

1. Execute SQL immediately — no preamble, no "let me look up the project", no todo lists
2. Location shorthand: Tukwila = `location_id = 1`, Ballard = `location_id = 2`, West Seattle = `location_id = 3`
3. Use `CASE location_id WHEN 1 THEN 'Tukwila' WHEN 2 THEN 'Ballard' WHEN 3 THEN 'West Seattle' END` for display
4. Always include `LIMIT` unless it's an aggregation
5. Present results in a table, add a brief insight only if notable

---

## Key Table Schemas

### `forecast_historical_occupancy`

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

### `clover_transactions`

POS card payments. Amounts in cents. Filter `result = 'SUCCESS'` for valid payments.

| Column | Type | Notes |
|--------|------|-------|
| clover_payment_id | text | Unique Clover payment ID |
| location_id | integer | 1=Tukwila, 2=Ballard, 3=West Seattle |
| amount_cents | integer | Total charge in cents (includes tip + tax) |
| tip_amount_cents | integer | Tip portion in cents (default 0) |
| tax_amount_cents | integer | Tax portion in cents (default 0) |
| result | text | Payment result — filter on 'SUCCESS' |
| created_time | timestamptz | When payment was made |
| created_date | date | Date only — use for daily aggregation |
| card_type | text | VISA, MC, AMEX, etc. |
| tender_label | text | Payment method label |

**Net revenue per transaction:** `(amount_cents - tip_amount_cents - tax_amount_cents) / 100.0`

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

Schedule runs Mon-Sun. `schedule_shifts.staff_id IS NULL` = unfilled shift. `schedule_shifts.location_id` = 1 (Tukwila), 2 (Ballard), 3 (West Seattle).

### `pet_gallery`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| uploaded_by | text | Staff email |
| uploaded_at | timestamptz | Upload time |
| media_type | text | 'image' or 'video' |
| location_id | integer | Upload location |
| email_notification_status | text | 'pending' → 'scheduled' → 'processing' → 'sent' |

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
| status | text | 'new', 'contacted', 'booked', 'converted', 'existing', 'lost', 'owner_created' |
| location_id | integer | Location |

### `tills`

| Column | Type | Notes |
|--------|------|-------|
| counted_date | date | Date counted |
| location_id | integer | 1, 2, or 3 |
| cash_amount | decimal | End-of-day till count (staff enters) |
| cash_receipts | decimal | Cash revenue collected that day |
| cash_expenses | decimal | Cash spent during the day |

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

## Tested Query Templates

### Occupancy

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

### Revenue

**Daily revenue by location:**
```sql
SELECT
  CASE location_id WHEN 1 THEN 'Tukwila' WHEN 2 THEN 'Ballard' WHEN 3 THEN 'West Seattle' END AS location,
  COUNT(*) AS transactions,
  SUM(amount_cents - tip_amount_cents - tax_amount_cents) / 100.0 AS net_revenue,
  SUM(tip_amount_cents) / 100.0 AS tips
FROM clover_transactions
WHERE created_date = CURRENT_DATE AND result = 'SUCCESS'
GROUP BY location_id ORDER BY location_id;
```

**Weekly revenue trend:**
```sql
SELECT created_date,
  CASE location_id WHEN 1 THEN 'Tukwila' WHEN 2 THEN 'Ballard' WHEN 3 THEN 'West Seattle' END AS location,
  SUM(amount_cents - tip_amount_cents - tax_amount_cents) / 100.0 AS net_revenue
FROM clover_transactions
WHERE created_date >= CURRENT_DATE - INTERVAL '7 days' AND result = 'SUCCESS'
GROUP BY created_date, location_id
ORDER BY created_date DESC, location_id;
```

### Staffing

**Staff schedule query:**
```sql
SELECT ss.date, ss.start_time, ss.end_time, ps.name, ss.is_lead,
  CASE ss.location_id WHEN 1 THEN 'Tukwila' WHEN 2 THEN 'Ballard' WHEN 3 THEN 'West Seattle' END AS location
FROM schedule_shifts ss
JOIN schedule_weeks sw ON ss.schedule_week_id = sw.id
LEFT JOIN pawsvip_staff ps ON ss.staff_id = ps.staff_id
WHERE sw.week_start = date_trunc('week', CURRENT_DATE)::date
ORDER BY ss.date, ss.location_id, ss.start_time LIMIT 200;
```

### Shift Tasks

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
