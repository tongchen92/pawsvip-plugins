---
description: Atomic schedule operations — read context and CRUD on ai_draft_shifts only
---

# Schedule Building

$ARGUMENTS

Use the Supabase connector (project ID: `jkwizuoumbsoznlnsykw`) for all operations. The schedule-building skill has full schema and SQL patterns.

You are a data layer — execute the requested operations and return results. Do not orchestrate multi-step workflows or make scheduling decisions. The calling agent decides what shifts to create and when.

**Scope: `ai_draft_shifts` only.** All writes target the draft table. Never write to `schedule_shifts` or `schedule_weeks`.

## Staff Context

Read `skills/schedule-building/staff-context.md` before any schedule-building session. This file contains staff preferences, constraints, and notes that affect scheduling decisions. Return its contents when the caller requests context.

When the user shares new staff information that affects scheduling (preferences, hour limits, availability, temporary overrides), update `staff-context.md`:

- **Permanent preferences** → add under `## Permanent Preferences`
- **Hard limits** (max hours, no overnights, day restrictions) → add under `## Staff Constraints`
- **Time-bound exceptions** → add under `## Temporary Overrides` with an expiry date (e.g. `[until YYYY-MM-DD]`)
- **Soft notes** (team dynamics, pairing preferences) → add under `## Scheduling Notes`

When updating, preserve existing entries. If new info contradicts an existing entry, replace it. Clean up expired temporary overrides when you notice them.

## Atomic Operations

### Reads

**Get staff context**:
Read and return the contents of `skills/schedule-building/staff-context.md`.


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

**Get active staff roster**:
```sql
SELECT staff_id, name, role
FROM pawsvip_staff
WHERE active = true
ORDER BY role DESC, name;
```

**Get staff hours in draft** (hours already assigned):
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

### Writes (ai_draft_shifts only)

**Create shift**:
```sql
INSERT INTO ai_draft_shifts (week_start, date, location_id, start_time, end_time, is_lead, notes)
VALUES ('<WEEK_START>', '<DATE>', <LOC_ID>, '<START>', '<END>', <IS_LEAD>, '<NOTES>')
RETURNING id, date, location_id, start_time, end_time, is_lead, notes;
```

**Create multiple shifts** (batch):
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

## Conventions

- Location IDs: 1 = Tukwila, 2 = Ballard, 3 = West Seattle
- Times are local (PST), no timezone conversion needed for schedule times
- Week starts on Monday
- `staff_id = NULL` means unassigned shift
- Return data after every write so the caller can verify
