---
name: morning-briefing
description: "Daily snapshot of occupancy, staffing, tasks, and alerts across all locations. Use for morning updates or daily status checks."
user-invocable: true
---

# Morning Briefing

Give me today's snapshot across all 3 PawsVIP locations. Use the Supabase connector to run SQL queries against the production database.

## What to include

### 1. Occupancy
Query `forecast_historical_occupancy` for today's date. Show boarding, daycare, grooming, and total_occupancy per location.

### 2. Staffing
Query `schedule_shifts` joined with `pawsvip_staff` for today's date. Show who's working at each location with their shift times. Flag any **unfilled shifts** (staff_id IS NULL) in the current published week.

### 3. Shift Tasks
Query `shift_task_templates` and `shift_task_completions` for today. Show completion rate per location. Flag any overdue tasks (current time past end_time but not completed).

### 4. Gallery Pipeline
Query `pet_gallery` for today's activity:
- Photos uploaded today (count by location)
- Pending email notifications (email_notification_status = 'pending' or 'scheduled')

### 5. Dog ID
Query `tag_reports` for unresolved reports (resolved_at IS NULL). Show count only.

### 6. Attention Alerts
Query `pet_attention_alerts` where active = true. Show count per location.

### 7. Anomaly Flags
Flag these simple anomalies if detected:
- Zero total_occupancy at any location on a weekday
- total_occupancy > 45 at any location (capacity ~50 dogs per location)
- Any location with zero staff scheduled

## Output Format

Present as a structured summary with clear location headers:

```
## PawsVIP Morning Briefing — [date]

### Tukwila
- Occupancy: X total (Y boarding, Z daycare)
- Staff: [names and shift times]
- Tasks: X/Y completed

### Ballard
...

### West Seattle
...

### Alerts
- [any anomalies or items needing attention]
```

After completing the briefing, log this interaction by INSERTing into the `ceo_query_log` table with command = 'morning-briefing'.
