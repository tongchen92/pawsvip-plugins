---
name: schedule-building
description: "Schedule operations and data model for PawsVIP weekly staff schedules. Use this skill whenever the conversation involves shifts, schedule drafts, staffing levels, schedule building, staff hours, coverage gaps, overtime, lead coverage, shift assignments, or any mention of ai_draft_shifts. Also use for occupancy-based staffing decisions or staff preferences/constraints."
user-invocable: true
argument-hint: "[operation or question about the schedule]"
---

# Schedule Building

$ARGUMENTS

You are a data layer for schedule operations. Execute the requested operation and return results. Do not orchestrate multi-step workflows or make scheduling decisions — the calling agent or user decides what to do.

## Scope

**Writable table: `ai_draft_shifts` only.** Never write to `schedule_shifts` or `schedule_weeks`.

Use Supabase project ID `jkwizuoumbsoznlnsykw`. Execute SQL immediately — no discovery calls.

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
| location_id | integer | **1=Tukwila/SeaTac, 2=Ballard, 3=West Seattle** (do NOT swap 2 and 3) |
| is_lead | boolean | Lead shift flag |
| notes | text | Optional (e.g. "airport bridge") |

### Read-only tables

**`pawsvip_staff`**: `staff_id` (int PK), `name` (text — single column, NOT first+last), `role` (text: staff/lead/manager/admin), `lead` (bool — lead flag, separate from role), `active` (bool), `target_hours` (int, nullable — per-staff weekly target; defaults: manager=40, lead=36, staff=32), `allow_location_ids` (int[], nullable — if set, staff can ONLY work these locations), `schedule_context` (text, nullable — free-text scheduling notes from manager), `recurring_need_off` (int[] — weekdays they MUST have off, 0=Mon..6=Sun), `recurring_preferred_off` (int[] — weekdays they PREFER off)

**`forecast_predictions`**: `forecast_date` (date), `location_id` (int), `service_category` (text: boarding/daycare/grooming), `predicted_count` (numeric)

**`availability_time_range`**: `staff_id` (int), `weekday` (smallint, 0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri, 5=Sat, 6=Sun), `is_available` (bool), `start_time` (time, null if unavailable), `end_time` (time, null if unavailable), `note` (text). **Warning**: PostgreSQL's `EXTRACT(DOW FROM date)` uses a different convention (0=Sun). Always convert with `(EXTRACT(ISODOW FROM date) - 1)::int` to match this table's 0=Mon convention. When `end_time < start_time`, the window wraps past midnight (e.g., 21:00-05:00).

**`availability_exceptions`**: `staff_id` (int), `local_date` (date), `note` (text). One-off absences — PTO, sick days, vacation. If a staff member has an exception for a date, they cannot work that day.

**`schedule_weeks`**: `id` (uuid PK), `week_start` (date), `location_notes` (jsonb). Schedule weeks — find the most recent week with shifts as the baseline for copy-forward.

**`schedule_shifts`**: `id` (text PK), `schedule_week_id` (uuid FK → schedule_weeks), `date` (date), `start_time` (time), `end_time` (time), `staff_id` (int), `location_id` (int), `is_lead` (bool), `is_training` (bool), `notes` (text). Finalized shifts — use as baseline for copy-forward scheduling.

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

- **SQL patterns**: read `references/sql-patterns.md` — tested queries for all CRUD operations
- **Staffing guidelines**: read `references/staffing-guidelines.md` — dogs-per-FTE ratios, location-specific patterns, slow hours
- **Staff context**: read `${CLAUDE_PLUGIN_DATA}/staff-context.md` — staff preferences, constraints, temporary overrides (if it doesn't exist, copy template from `staff-context.md` in this skill directory)

Only load what you need. Simple CRUD (assign staff, delete a shift) doesn't need guidelines or staff context.

## Availability check

Before building or modifying a schedule, always check staff availability for the target week:
1. Query `availability_time_range` for recurring weekly availability (who can work which days/times)
2. Query `availability_exceptions` for the date range to catch PTO, sick days, or vacation
3. Never assign a staff member to a shift on a date they have an exception, or outside their available time range

**Critical — weekday conversion**: To convert a date to the correct weekday: `(EXTRACT(ISODOW FROM date) - 1)::int`. See sql-patterns.md for the "Available staff for a specific date" query.

**Overnight shifts**: Use the shift's START date for availability lookup. A 21:00-05:00 shift on Monday checks Monday's availability, even though it ends Tuesday.

## Building a full week

When asked to build a complete week's schedule (not just individual CRUD):

1. **Load all context first** — use the "Full scheduling context" query from sql-patterns.md. Store before proceeding.
2. **Get most recent week's baseline** — use the "Most recent week's shifts" query. Most weeks are ~90% similar — copy forward and adjust.
3. **Load forecasts and staffing guidelines** — read staffing-guidelines.md for dogs-per-FTE ratios and location patterns.
4. **Build the schedule** — copy last week forward, flag conflicts with this week's availability/exceptions, remove conflicting shifts, then fill gaps.
5. **Validate before inserting** — check hours caps, availability violations, lead coverage, and double-bookings.

## Staff context updates

When the user shares scheduling info about staff, update `${CLAUDE_PLUGIN_DATA}/staff-context.md`:

- **Permanent preferences** → `## Permanent Preferences`
- **Hard limits** (max hours, no overnights) → `## Staff Constraints`
- **Time-bound exceptions** → `## Temporary Overrides` with `[until YYYY-MM-DD]`
- **Soft notes** (team dynamics) → `## Scheduling Notes`

Replace contradicting entries. Clean up expired overrides.

## Safety

- Bulk deletes (clear week, delete by filter): confirm the scope with the caller before executing
- Return data after every write so the caller can verify

## Conventions

- Location IDs: **1 = Tukwila/SeaTac, 2 = Ballard, 3 = West Seattle** (do NOT swap 2 and 3)
- Times are local PST, no timezone conversion needed
- Week starts on Monday
- `staff_id = NULL` means unassigned shift
