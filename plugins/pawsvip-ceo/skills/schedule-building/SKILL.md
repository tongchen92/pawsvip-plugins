---
name: pawsvip-schedule-building
description: Schedule data model, staffing rules, and constraints for PawsVIP weekly staff schedules. Use this skill whenever the conversation involves shifts, schedule drafts, staffing levels, schedule building, staff hours, coverage gaps, overtime, lead coverage, shift assignments, or any mention of ai_draft_shifts. Also triggers when discussing occupancy-based staffing decisions or staff preferences/constraints.
user-invocable: false
---

# Schedule Building Reference

Context for agents building or modifying PawsVIP staff schedules.

## Data Model

### `ai_draft_shifts` — The only writable table

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
| notes | text | Optional (e.g. "airport bridge") |

### Read-only tables

**`pawsvip_staff`**: `staff_id` (int PK), `name` (text), `role` (text: staff/lead/manager/admin), `active` (bool)

**`forecast_predictions`**: `forecast_date` (date), `location_id` (int), `service_category` (text: boarding/daycare/grooming), `predicted_count` (numeric)

**`availability_time_range`**: `staff_id` (int), `weekday` (smallint, 0=Mon..6=Sun), `is_available` (bool), `start_time` (time, null if unavailable), `end_time` (time, null if unavailable), `note` (text). The modern availability system — use this over `availability_weekly`.

**`availability_exceptions`**: `staff_id` (int), `local_date` (date), `note` (text). One-off absences — PTO, sick days, vacation. If a staff member has an exception for a date, they cannot work that day.

**`airport_layover_tasks`**: `id` (uuid), `scheduled_time` (timestamptz), `status` (text — filter out 'cancelled'). Airport tasks only affect Tukwila (location_id = 1).

## Shift Types

| Type | Start Range | Template |
|------|-------------|----------|
| OPEN | 05:00-12:59 | 05:00-13:00 |
| MID | 09:00-12:59 | 09:00-17:00 |
| CLOSE | 13:00-20:59 | 13:00-21:00 |
| OVERNIGHT | 21:00-04:59 | 21:00-05:00 |

## Hard Constraints

Violations make a schedule invalid — these are non-negotiable.

| Constraint | Value |
|-----------|-------|
| Minimum shift duration | 4 hours |
| Max shifts per staff per week | 5 |
| Max hours per staff per week | 42 |
| Lead shifts require role | 'lead' or 'manager' |
| Required daily coverage per location | Open (lead) + Close (lead) + Overnight |

## References (load on demand)

- **SQL patterns**: `references/sql-patterns.md` — tested queries for all CRUD operations
- **Staffing guidelines**: `references/staffing-guidelines.md` — dogs-per-FTE ratios, location-specific patterns, slow hours
- **Staff context**: `${CLAUDE_PLUGIN_DATA}/staff-context.md` — staff preferences, constraints, temporary overrides (template at `staff-context.md` in this skill directory)
