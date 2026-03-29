---
name: pawsvip-data-model
description: PawsVIP database schema, business context, and tested SQL patterns. Auto-triggers on any question about PawsVIP — occupancy, staffing, gallery, leads, tills, revenue, payments, reservations, locations, roles, or business operations. Always use this skill before writing SQL or answering business questions.
user-invocable: false
---

# PawsVIP Data Model & Business Context

You are assisting the CEO of PawsVIP, a pet hotel with 3 Seattle-area locations.

## Supabase

**Project ID: `jkwizuoumbsoznlnsykw`** — pass directly to `execute_sql`. NEVER call `list_projects`, `list_tables`, or any discovery tool.

## Locations

| location_id | Name | Instagram |
|-------------|------|-----------|
| 1 | Tukwila | @pawsvip.tukwila |
| 2 | Ballard | @pawsvip.ballard |
| 3 | West Seattle | @pawsvip.westseattle |

```sql
CASE location_id WHEN 1 THEN 'Tukwila' WHEN 2 THEN 'Ballard' WHEN 3 THEN 'West Seattle' END AS location
```

## Roles

staff → lead → manager → admin (each inherits permissions from below). Stored in `pawsvip_staff.role`.

---

## Disambiguation Cheat Sheet

| Question sounds like... | Use THIS table | NOT this | Why |
|------------------------|---------------|----------|-----|
| "How many dogs" / occupancy / trends | `forecast_historical_occupancy` | `reservation` | Pre-aggregated daily; reservation has ~150K rows |
| "Revenue" / payments | `clover_transactions` | `gingr_invoices` | Clover has ~16K real transactions; gingr_invoices is empty |
| "Cash in the till" | `tills` | `clover_transactions` | Tills = physical cash counts; Clover = card payments |
| "How are leads doing" (funnel) | `leads` | `lead_outreach` | Leads has status; outreach has call/text activity |
| "How many calls/texts" (activity) | `lead_outreach` | `leads` | Individual contact attempts |
| "Customer likes" / reactions | `gallery_reactions` | `review_clicks` | Reactions = photo likes; review_clicks = Google/Yelp |
| "Gallery photos" | `pet_gallery` | — | Curated photos through the pipeline |
| "Who is this pet/owner" | `reservation` | `forecast_historical_occupancy` | Only for individual lookups by name |

---

## Table Routing

### Occupancy & Trends (~2K rows)
| Table | Use for |
|-------|---------|
| `forecast_historical_occupancy` | One row per location per day. Pre-computed boarding/daycare/grooming/total. **NEVER use `reservation` for occupancy.** |

### Individual Reservations (~150K rows)
| Table | Use for |
|-------|---------|
| `reservation` | Pet/owner lookups. camelCase columns MUST be double-quoted: `"petName"`, `"ownerId"`, `"reservationId"` |
| `customer_links` | Pet parent portal. Maps `owner_id` → `share_token`, `owner_name`, `email` |

### Financial (~16K rows)
| Table | Use for |
|-------|---------|
| `clover_transactions` | POS card payments. Amounts in cents. Filter `result = 'SUCCESS'` |
| `tills` | End-of-day cash drawer counts |

**Revenue formula:** `SUM(amount_cents - tip_amount_cents - tax_amount_cents) / 100.0` from `clover_transactions WHERE result = 'SUCCESS'`. Total = card + `tills.cash_receipts`.

### Staffing (~2K rows)
| Table | Use for |
|-------|---------|
| `pawsvip_staff` | Staff roster — name, email, role, active |
| `schedule_weeks` | Week containers (Mon→Sun) |
| `schedule_shifts` | Shift assignments. `staff_id IS NULL` = unfilled |

**Joins:** `schedule_shifts.schedule_week_id` → `schedule_weeks.id`, `.staff_id` → `pawsvip_staff.staff_id`

**Shift types** (by start_time): OPEN 05:00–12:59, CLOSE 13:00–20:59, OVERNIGHT 21:00–04:59

### Shift Tasks & Pet Care
| Table | Use for |
|-------|---------|
| `shift_task_templates` | Task definitions per location + shift type |
| `shift_task_completions` | When marked done, by whom |
| `pet_attention_alerts` | Recurring care tasks. `active = true` = ongoing |
| `pet_attention_completions` | Proof of completion (photo/note) |

### Gallery & Media (~10K rows)
| Table | Use for |
|-------|---------|
| `pet_gallery` | Gallery items. `email_notification_status`: pending → scheduled → processing → sent |
| `gallery_reactions` | Customer likes on photos (~2K rows) |
| `tag_reports` | Dog ID misidentification. `resolved_at IS NULL` = unresolved |

**Gallery pipeline:** Staff uploads → YOLO detection → DINOv2 embedding → pgvector matching → AI verification → customer-visible → email notification → customer reactions

### Leads & Sales (~170 rows)
| Table | Use for |
|-------|---------|
| `leads` | Status: 'new' → 'contacted' → 'booked' → 'converted' / 'lost' |
| `lead_outreach` | Individual calls/texts/emails linked to leads |

### Airport Services
| Table | Use for |
|-------|---------|
| `airport_requests` | Pet layover/shipping requests with billing |
| `airport_layover_tasks` | Tasks per request (pickup, feeding, etc.) |

### Customer Engagement
| Table | Use for |
|-------|---------|
| `review_clicks` | Google/Yelp review click-throughs |
| `feedback_rate_limit` | 1 feedback email per customer per service per 30 days |

---

## Key Schemas

### `forecast_historical_occupancy`
`date` (date), `location_id` (int), `boarding` (int), `daycare` (int), `grooming` (int), `total_occupancy` (int)

### `clover_transactions`
`clover_payment_id` (text PK), `location_id` (int), `amount_cents` (int), `tip_amount_cents` (int), `tax_amount_cents` (int), `result` (text), `created_time` (timestamptz), `created_date` (date), `card_type` (text)

### `reservation`
`"reservationId"` (text PK), `check_in_date` (timestamptz), `check_out_date` (timestamptz), `"petName"` (text), `location_id` (int), `"ownerId"` (text), `start_date` (timestamptz), `room` (text)

### `pawsvip_staff`
`staff_id` (int PK), `email` (text), `name` (text), `role` (text), `active` (bool)

### `pet_gallery`
`id` (uuid PK), `uploaded_by` (text), `uploaded_at` (timestamptz), `media_type` (text), `location_id` (int), `email_notification_status` (text)

### `leads`
`id` (bigint PK), `created_at` (timestamptz), `source` (text), `status` (text), `location_id` (int)

### `tills`
`counted_date` (date), `location_id` (int), `cash_amount` (decimal), `cash_receipts` (decimal), `cash_expenses` (decimal)

### `customer_links`
`owner_id` (int PK), `owner_name` (text), `email` (text), `created_at` (timestamptz)

---

## Tested Query Templates

### Occupancy

**Today:**
```sql
SELECT location, boarding, daycare, grooming, total_occupancy
FROM forecast_historical_occupancy, LATERAL (SELECT CASE location_id WHEN 1 THEN 'Tukwila' WHEN 2 THEN 'Ballard' WHEN 3 THEN 'West Seattle' END) AS t(location)
WHERE date = CURRENT_DATE ORDER BY location_id;
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

**YoY all locations:**
```sql
SELECT EXTRACT(YEAR FROM date)::int AS year, EXTRACT(MONTH FROM date)::int AS month,
  CASE location_id WHEN 1 THEN 'Tukwila' WHEN 2 THEN 'Ballard' WHEN 3 THEN 'West Seattle' END AS location,
  ROUND(AVG(total_occupancy), 1) AS avg_daily, ROUND(AVG(boarding), 1) AS avg_boarding
FROM forecast_historical_occupancy
GROUP BY year, month, location_id ORDER BY year, month, location_id;
```

### Revenue

**Daily by location:**
```sql
SELECT CASE location_id WHEN 1 THEN 'Tukwila' WHEN 2 THEN 'Ballard' WHEN 3 THEN 'West Seattle' END AS location,
  COUNT(*) AS txns, SUM(amount_cents - tip_amount_cents - tax_amount_cents) / 100.0 AS net_revenue
FROM clover_transactions WHERE created_date = CURRENT_DATE AND result = 'SUCCESS'
GROUP BY location_id ORDER BY location_id;
```

### Staffing

**This week's schedule:**
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

**Completion rate:**
```sql
SELECT CASE stt.location_id WHEN 1 THEN 'Tukwila' WHEN 2 THEN 'Ballard' WHEN 3 THEN 'West Seattle' END AS location,
  stt.shift_type, COUNT(stt.id) AS total, COUNT(stc.id) AS done,
  ROUND(COUNT(stc.id)::numeric / NULLIF(COUNT(stt.id), 0) * 100, 1) AS pct
FROM shift_task_templates stt
LEFT JOIN shift_task_completions stc ON stc.template_id = stt.id AND stc.shift_date = CURRENT_DATE
WHERE stt.active = true
GROUP BY stt.location_id, stt.shift_type ORDER BY stt.location_id;
```

---

## Gingr API (reservation system)

Most Gingr data is cached in Supabase. Query Supabase first.

- **`/api/v1/reservations`** — returns ALL reservations (~500 records, ~13s). `params[owner_id]` is silently ignored. Never use for bulk queries.
- **`/api/v1/owners`** with `params[id]=<ownerId>` — fast (~300ms). Returns `last_reservation` and `next_reservation`.
- **GINGR_TIMEOUT_MS = 6,000** — calls slower than 6s silently return null.
- **Sync**: webhooks (real-time check-in/out) + hourly cron. Data may be up to 1 hour stale.
- **Portal links**: `https://pawsvip.gingrapp.com/owners/view/id/{ownerId}` | `https://pawsvip.gingrapp.com/reservations/view/id/{reservationId}`

## Financial Reconciliation

Daily revenue matching: Gingr (prices/services) vs Clover (payments). Gap = difference minus tips. Positive = over-collected, negative = under-collected. Cash payments excluded (no Clover record).

---

## Timezone

- `timestamptz` → convert with `AT TIME ZONE 'America/Los_Angeles'`
- `schedule_shifts.start_time/end_time` are local PST TIME — no conversion
- `date` columns — no timezone
- Overnight cutoff: before 5:00 AM PST, "current day" = previous calendar day

## Query Logging

After every answer, silently log the interaction. Don't mention logging to the user.

```sql
INSERT INTO ceo_query_log (asked_by, question, domain, tables_used, num_queries, queries_used)
VALUES (
  'Tong',
  'the user''s original question',
  'occupancy',                        -- one of: occupancy, revenue, staffing, gallery, leads, schedule, airport, tasks, general
  ARRAY['forecast_historical_occupancy'],  -- tables actually queried
  1,                                  -- total execute_sql calls made to answer this question
  'the SQL'                           -- actual SQL executed (semicolon-separated if multiple)
);
```

Every field here is a fact you already know — no self-assessment needed. `num_queries` is the key signal: 1 = clean answer, 3+ = the skill is missing a template or the disambiguation was unclear.
