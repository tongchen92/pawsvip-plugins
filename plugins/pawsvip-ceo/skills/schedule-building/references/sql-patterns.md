# Schedule SQL Patterns

Tested queries for `ai_draft_shifts` operations. Use Supabase project ID `jkwizuoumbsoznlnsykw`.

## Reads

**Occupancy forecast** (date range):
```sql
SELECT forecast_date AS date, location_id,
  service_category, ROUND(predicted_count) AS predicted
FROM forecast_predictions
WHERE forecast_date BETWEEN '<START>' AND '<END>'
  AND service_category IN ('boarding', 'daycare', 'grooming')
ORDER BY forecast_date, location_id, service_category;
```

**Current draft** (week):
```sql
SELECT id, date, location_id, start_time, end_time, is_lead, staff_id, notes
FROM ai_draft_shifts
WHERE week_start = '<WEEK_START>'
ORDER BY date, location_id, start_time;
```

**Active staff roster** (basic):
```sql
SELECT staff_id, name, role
FROM pawsvip_staff
WHERE active = true
ORDER BY role DESC, name;
```

**Full scheduling context** (use for building a full week — returns all constraints per staff):
```sql
SELECT
  s.staff_id,
  s.name,  -- single column, NOT first_name + last_name
  s.role,
  s.lead,
  COALESCE(s.target_hours, CASE WHEN s.role = 'manager' THEN 40 WHEN s.lead THEN 36 ELSE 32 END) AS target_hours,
  s.allow_location_ids,
  s.schedule_context,
  s.recurring_need_off,
  s.recurring_preferred_off,

  -- Recurring weekly availability (which days/times they can work)
  (SELECT json_agg(json_build_object(
    'weekday', atr.weekday,
    'is_available', atr.is_available,
    'start_time', atr.start_time,
    'end_time', atr.end_time
  )) FROM availability_time_range atr WHERE atr.staff_id = s.staff_id) AS time_ranges,

  -- Date-specific exceptions (PTO, sick) for the target week
  (SELECT json_agg(json_build_object(
    'date', ae.local_date,
    'note', ae.note
  )) FROM availability_exceptions ae
   WHERE ae.staff_id = s.staff_id
     AND ae.local_date BETWEEN '<WEEK_START>' AND (DATE '<WEEK_START>' + INTERVAL '6 days')
  ) AS exceptions

FROM pawsvip_staff s
WHERE s.active = true
ORDER BY s.staff_id;
```

**Most recent week's shifts** (baseline for copy-forward):
```sql
-- Find the most recent schedule week with actual shifts before the target week
SELECT ss.staff_id, ps.name, ss.date, ss.start_time, ss.end_time,
  ss.location_id, ss.is_lead, ss.notes
FROM schedule_shifts ss
JOIN schedule_weeks sw ON ss.schedule_week_id = sw.id
JOIN pawsvip_staff ps ON ss.staff_id = ps.staff_id
WHERE sw.week_start = (
  SELECT MAX(sw2.week_start) FROM schedule_weeks sw2
  JOIN schedule_shifts ss2 ON ss2.schedule_week_id = sw2.id
  WHERE sw2.week_start < '<WEEK_START>'
)
ORDER BY ss.date, ss.location_id, ss.start_time;
```
This finds the latest week before the target that has actual shifts — use it as the copy-forward baseline.

**Staff availability for a week** (combines recurring availability + exceptions):

> **Weekday convention**: The `availability_time_range.weekday` column uses 0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri, 5=Sat, 6=Sun.
> This is NOT the same as PostgreSQL's `EXTRACT(DOW ...)` which uses 0=Sun, 1=Mon..6=Sat.
> Always convert dates with: `(EXTRACT(ISODOW FROM date) - 1)::int` to get 0=Mon..6=Sun.

```sql
-- Recurring weekly availability (weekday 0=Mon..6=Sun)
SELECT atr.staff_id, ps.name, atr.weekday, atr.is_available, atr.start_time, atr.end_time, atr.note
FROM availability_time_range atr
JOIN pawsvip_staff ps ON atr.staff_id = ps.staff_id
WHERE ps.active = true
ORDER BY atr.staff_id, atr.weekday;
```

**Staff exceptions (PTO/sick) for a date range**:
```sql
SELECT ae.staff_id, ps.name, ae.local_date, ae.note
FROM availability_exceptions ae
JOIN pawsvip_staff ps ON ae.staff_id = ps.staff_id
WHERE ae.local_date BETWEEN '<START>' AND '<END>'
ORDER BY ae.local_date, ps.name;
```

**Available staff for a specific date** (checks both recurring + exceptions in one query):
```sql
-- Returns who CAN work on a given date, with their time window
-- Combines recurring availability with exception check
SELECT atr.staff_id, ps.name, ps.role, atr.start_time, atr.end_time
FROM availability_time_range atr
JOIN pawsvip_staff ps ON atr.staff_id = ps.staff_id
WHERE ps.active = true
  AND atr.weekday = (EXTRACT(ISODOW FROM DATE '<DATE>') - 1)::int
  AND atr.is_available = true
  AND atr.staff_id NOT IN (
    SELECT ae.staff_id FROM availability_exceptions ae
    WHERE ae.local_date = '<DATE>'
  )
ORDER BY ps.name;
```

**Overnight availability note**: When `end_time < start_time` (e.g., 21:00–05:00), the window wraps past midnight. A shift starting at 21:00 on Monday uses Monday's availability row, even though it ends Tuesday morning.

**Staff hours in draft** (handles overnight shifts crossing midnight):
```sql
SELECT ds.staff_id, ps.name, ps.role,
  COUNT(*) AS shift_count,
  SUM(EXTRACT(EPOCH FROM (
    CASE WHEN ds.end_time < ds.start_time THEN ds.end_time + INTERVAL '24 hours' ELSE ds.end_time END - ds.start_time
  )) / 3600) AS hours_assigned
FROM ai_draft_shifts ds
JOIN pawsvip_staff ps ON ds.staff_id = ps.staff_id
WHERE ds.week_start = '<WEEK_START>' AND ds.staff_id IS NOT NULL
GROUP BY ds.staff_id, ps.name, ps.role
ORDER BY hours_assigned DESC;
```

**Airport tasks** (date range):
```sql
SELECT id, scheduled_time,
  scheduled_time::date AS date,
  EXTRACT(HOUR FROM scheduled_time) AS hour
FROM airport_layover_tasks
WHERE scheduled_time >= '<START>T00:00:00'
  AND scheduled_time < '<END_PLUS_1>T00:00:00'
  AND status != 'cancelled'
ORDER BY scheduled_time;
```

## Writes

**Create shift(s)**:
```sql
INSERT INTO ai_draft_shifts (week_start, date, location_id, start_time, end_time, is_lead, notes)
VALUES ('<WEEK_START>', '<DATE>', <LOC_ID>, '<START>', '<END>', <IS_LEAD>, '<NOTES>')
RETURNING id, date, location_id, start_time, end_time, is_lead, notes;
```
Batch: add multiple `VALUES` rows.

**Update shift**:
```sql
UPDATE ai_draft_shifts
SET start_time = '<START>', end_time = '<END>', is_lead = <IS_LEAD>,
    location_id = <LOC_ID>, notes = '<NOTES>'
WHERE id = '<SHIFT_ID>'
RETURNING *;
```

**Assign / unassign staff**:
```sql
UPDATE ai_draft_shifts SET staff_id = <STAFF_ID> WHERE id = '<SHIFT_ID>' RETURNING *;
UPDATE ai_draft_shifts SET staff_id = NULL WHERE id = '<SHIFT_ID>' RETURNING *;
```

**Delete shift**:
```sql
DELETE FROM ai_draft_shifts WHERE id = '<SHIFT_ID>' RETURNING *;
```

**Delete by filter** (e.g. all shifts for a day+location):
```sql
DELETE FROM ai_draft_shifts
WHERE week_start = '<WEEK_START>' AND date = '<DATE>' AND location_id = <LOC_ID>
RETURNING id, start_time, end_time;
```

**Clear entire draft week** (destructive — confirm with caller first):
```sql
DELETE FROM ai_draft_shifts WHERE week_start = '<WEEK_START>' RETURNING id;
```
