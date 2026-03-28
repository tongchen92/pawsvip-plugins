---
name: pawsvip-schedule-building
description: Schedule data model, staffing rules, and constraints for PawsVIP weekly staff schedules. Triggers on any question about shifts, schedule drafts, staffing levels, or schedule building.
user-invocable: false
---

# Schedule Building Reference

Context for agents building or modifying PawsVIP staff schedules. This is reference data — the calling agent makes all scheduling decisions.

## Data Model

### `ai_draft_shifts` — Working draft (staging area)

| Column | Type | Notes |
|--------|------|-------|
| id | text | PK (auto-generated) |
| week_start | date | Monday of the week |
| date | date | Shift date |
| start_time | time | Local PST time |
| end_time | time | Local PST time |
| staff_id | integer | FK to pawsvip_staff. NULL = unassigned |
| location_id | integer | 1=Tukwila, 2=Ballard, 3=West Seattle |
| is_lead | boolean | Lead shift flag |
| notes | text | Optional context (e.g. "airport bridge") |

### `schedule_shifts` — Live schedule (visible to staff)

| Column | Type | Notes |
|--------|------|-------|
| id | text | PK |
| schedule_week_id | uuid | FK to schedule_weeks.id |
| date | date | Shift date |
| start_time | time | Local PST time |
| end_time | time | Local PST time |
| staff_id | integer | FK to pawsvip_staff. NULL = unfilled |
| location_id | integer | 1=Tukwila, 2=Ballard, 3=West Seattle |
| is_lead | boolean | Shift lead flag |
| is_training | boolean | Training shift (default false) |
| notes | text | Optional |

### `schedule_weeks` — Week container

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| week_start | date | Monday (UNIQUE) |
| status | text | `'draft'` or `'published'` |
| published_at | timestamptz | NULL if draft |
| location_notes | jsonb | Per-location notes, default `{}` |

### `pawsvip_staff` — Staff roster

| Column | Type | Notes |
|--------|------|-------|
| staff_id | integer | PK |
| name | text | Display name |
| role | text | `'staff'`, `'lead'`, `'manager'`, `'admin'` |
| active | boolean | Default true |

### `forecast_predictions` — Occupancy forecast

| Column | Type | Notes |
|--------|------|-------|
| forecast_date | date | Predicted date |
| location_id | integer | 1, 2, or 3 |
| service_category | text | `'boarding'`, `'daycare'`, `'grooming'` |
| predicted_count | numeric | Forecasted count |

### `airport_layover_tasks` — Airport pickup/dropoff tasks

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| scheduled_time | timestamptz | When the task is scheduled |
| status | text | Filter out `'cancelled'` |

Airport tasks only affect Tukwila (location_id = 1).

## Shift Types

| Type | Start Range | Standard Template |
|------|-------------|------------------|
| OPEN | 05:00-12:59 | 05:00-13:00 |
| MID | 09:00-12:59 | 09:00-17:00 |
| CLOSE | 13:00-20:59 | 13:00-21:00 |
| OVERNIGHT | 21:00-04:59 | 21:00-05:00 |

## Constraints

These are hard constraints. Violations make a schedule invalid.

| Constraint | Value |
|-----------|-------|
| Minimum shift duration | 4 hours |
| Max shifts per staff per week | 5 |
| Max hours per staff per week | 42 |
| Lead shifts require role | `'lead'` or `'manager'` |
| Required daily coverage per location | Open (lead) + Close (lead) + Overnight |
| Valid location IDs | 1, 2, 3 |
| Week boundary | Monday through Sunday |

## Staffing Guidelines

These are soft guidelines. The calling agent should use these to make decisions.

### Dogs-per-FTE Ratios

FTE = total_staff_hours / 8

| Location | Min | Target | Warning | Critical |
|----------|-----|--------|---------|----------|
| Tukwila | 9 | 9-14 | >16 | >20 |
| Ballard | 6 | 6-12 | >13 | >16 |
| West Seattle | 5 | 5-9 | >11 | >14 |

### Location-Specific Patterns

**Tukwila** (busiest, ~5 base shifts/day):
- Add mid shift (09:00-17:00) when total_pets >= 70 on Mon-Thu
- Airport bridge shift when 3+ tasks between 19:00-01:00 → 19:00-01:00; 1-2 tasks → 18:00-00:00
- 2nd overnight when 6+ combined evening + early-morning airport tasks

**Ballard** (~3 base shifts/day):
- Weekends: skeleton crew only (05:00-13:00 lead + 09:00-21:00 lead)

**West Seattle** (~3 base shifts/day):
- Mon-Thu: Bree slot 05:00-14:30, Enrique slot 14:30-21:00

### Slow Hours

05:00-07:00 and 19:00-21:00 — max 2 concurrent staff is sufficient. Avoid scheduling 4+ staff in these windows.

### Staff Target Hours

~24 hours/week per staff member is the default target.

## Lifecycle

```
ai_draft_shifts  →  (iterate until satisfied)  →  schedule_shifts (draft)  →  publish (manual, in-app only)
```

The calling agent works in `ai_draft_shifts`. Promotion to `schedule_shifts` copies the draft. Publishing is always a manual action in the PawsVIP app — never automate it.
