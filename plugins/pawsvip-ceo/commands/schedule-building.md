---
description: Atomic schedule operations — read context, create/modify/delete shifts, promote drafts, and query staffing data
---

# Schedule Building

$ARGUMENTS

Use the Supabase connector (project ID: `jkwizuoumbsoznlnsykw`) for all operations. The schedule-building skill has full schema and SQL patterns.

You are a data layer — execute the requested operations and return results. Do not orchestrate multi-step workflows or make scheduling decisions. The calling agent decides what shifts to create and when.

## Atomic Operations

### Reads

**Get occupancy forecast** for a date range:
```sql
SELECT forecast_date AS date, location_id,
  service_category, ROUND(predicted_count) AS predicted
FROM forecast_predictions
WHERE forecast_date >= '<START>' AND forecast_date <= '<END>'
  AND service_category IN ('boarding', 'daycare', 'grooming')
ORDER BY forecast_date, location_id, service_category;
```

**Get current draft** for a week:
```sql
SELECT id, date, location_id, start_time, end_time, is_lead, staff_id, notes
FROM ai_draft_shifts
WHERE week_start = '<WEEK_START>'
ORDER BY date, location_id, start_time;
```

**Get published schedule** for a week:
```sql
SELECT ss.id, ss.date, ss.location_id, ss.start_time, ss.end_time,
  ss.is_lead, ss.is_training, ss.staff_id, ps.name AS staff_name, ss.notes
FROM schedule_shifts ss
JOIN schedule_weeks sw ON ss.schedule_week_id = sw.id
LEFT JOIN pawsvip_staff ps ON ss.staff_id = ps.staff_id
WHERE sw.week_start = '<WEEK_START>'
ORDER BY ss.date, ss.location_id, ss.start_time;
```

**Get schedule week status**:
```sql
SELECT id, week_start, status, published_at
FROM schedule_weeks
WHERE week_start = '<WEEK_START>';
```

**Get active staff roster**:
```sql
SELECT staff_id, name, role
FROM pawsvip_staff
WHERE active = true
ORDER BY role DESC, name;
```

**Get staff availability** (hours already assigned in draft):
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

**Get airport tasks** for a date range:
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

**Get historical schedule** (what was published for a past week):
```sql
SELECT ss.date, ss.location_id, ss.start_time, ss.end_time,
  ss.is_lead, ps.name AS staff_name
FROM schedule_shifts ss
JOIN schedule_weeks sw ON ss.schedule_week_id = sw.id
LEFT JOIN pawsvip_staff ps ON ss.staff_id = ps.staff_id
WHERE sw.week_start = '<WEEK_START>' AND sw.status = 'published'
ORDER BY ss.date, ss.location_id, ss.start_time;
```

**Get latest scheduled week**:
```sql
SELECT week_start, status FROM schedule_weeks ORDER BY week_start DESC LIMIT 1;
```

### Writes

**Create shift** in draft:
```sql
INSERT INTO ai_draft_shifts (week_start, date, location_id, start_time, end_time, is_lead, notes)
VALUES ('<WEEK_START>', '<DATE>', <LOC_ID>, '<START>', '<END>', <IS_LEAD>, '<NOTES>')
RETURNING id, date, location_id, start_time, end_time, is_lead, notes;
```

**Create multiple shifts** in draft (batch):
```sql
INSERT INTO ai_draft_shifts (week_start, date, location_id, start_time, end_time, is_lead, notes)
VALUES
  ('<WEEK_START>', '<DATE>', <LOC_ID>, '<START>', '<END>', <IS_LEAD>, '<NOTES>'),
  ...
RETURNING id, date, location_id, start_time, end_time, is_lead, notes;
```

**Update shift**:
```sql
UPDATE ai_draft_shifts
SET start_time = '<START>', end_time = '<END>', is_lead = <IS_LEAD>,
    location_id = <LOC_ID>, notes = '<NOTES>'
WHERE id = '<SHIFT_ID>'
RETURNING *;
```

**Assign staff to shift**:
```sql
UPDATE ai_draft_shifts SET staff_id = <STAFF_ID> WHERE id = '<SHIFT_ID>' RETURNING *;
```

**Unassign staff from shift**:
```sql
UPDATE ai_draft_shifts SET staff_id = NULL WHERE id = '<SHIFT_ID>' RETURNING *;
```

**Delete shift**:
```sql
DELETE FROM ai_draft_shifts WHERE id = '<SHIFT_ID>' RETURNING *;
```

**Delete shifts by filter** (e.g. all shifts for a day-location):
```sql
DELETE FROM ai_draft_shifts
WHERE week_start = '<WEEK_START>' AND date = '<DATE>' AND location_id = <LOC_ID>
RETURNING id, start_time, end_time;
```

**Clear entire draft week**:
```sql
DELETE FROM ai_draft_shifts WHERE week_start = '<WEEK_START>'
RETURNING id;
```

**Promote draft to schedule** (3-step — execute in order):

Step 1 — Ensure schedule_weeks row exists:
```sql
INSERT INTO schedule_weeks (week_start, status)
VALUES ('<WEEK_START>', 'draft')
ON CONFLICT (week_start) DO NOTHING
RETURNING id;
```
If no row returned, fetch the existing id:
```sql
SELECT id FROM schedule_weeks WHERE week_start = '<WEEK_START>';
```

Step 2 — Replace existing shifts:
```sql
DELETE FROM schedule_shifts WHERE schedule_week_id = '<WEEK_ID>';
```

Step 3 — Copy from draft:
```sql
INSERT INTO schedule_shifts (schedule_week_id, date, start_time, end_time, staff_id, location_id, is_lead, notes)
SELECT '<WEEK_ID>', date, start_time, end_time, staff_id, location_id, is_lead, notes
FROM ai_draft_shifts WHERE week_start = '<WEEK_START>'
RETURNING id;
```

Note: This sets the week to draft status. Publishing is always manual in the app.

## Conventions

- Location IDs: 1 = Tukwila, 2 = Ballard, 3 = West Seattle
- Times are local (PST), no timezone conversion needed for schedule times
- Week starts on Monday
- `staff_id = NULL` means unfilled shift
- Return data after every write so the caller can verify
