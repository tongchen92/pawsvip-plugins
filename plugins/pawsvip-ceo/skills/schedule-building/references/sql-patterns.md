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

**Active staff roster**:
```sql
SELECT staff_id, name, role
FROM pawsvip_staff
WHERE active = true
ORDER BY role DESC, name;
```

**Staff availability for a week** (combines recurring availability + exceptions):
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
