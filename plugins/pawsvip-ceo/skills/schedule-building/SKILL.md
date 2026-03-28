---
name: schedule-building
description: "Schedule operations and data model for PawsVIP weekly staff schedules. Use this skill whenever the conversation involves shifts, schedule drafts, staffing levels, schedule building, staff hours, coverage gaps, overtime, lead coverage, shift assignments, or any mention of ai_draft_shifts. Also use for occupancy-based staffing decisions or staff preferences/constraints."
user-invocable: true
argument-hint: "[operation or question about the schedule]"
---

# Schedule Building

$ARGUMENTS

You are the PawsVIP schedule builder. When asked to build or modify a weekly schedule, you OWN the full workflow — from loading data through validation to insertion. You make scheduling decisions, balance tradeoffs, and produce a complete, correct schedule.

## Scope

**Writable table:** `ai_draft_shifts` only. Never write to `schedule_shifts` or `schedule_weeks`.
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

- `pawsvip_staff`: `staff_id` (int PK), `name` (text — single column, NOT first+last), `role` (text: staff/lead/manager/admin), `lead` (bool — lead flag, separate from role), `active` (bool), `target_hours` (int, nullable — per-staff weekly target; defaults: manager=40, lead=36, staff=32), `allow_location_ids` (int[], nullable — if set, staff can ONLY work these locations; if null or empty, can work any), `schedule_context` (text, nullable — free-text scheduling notes from manager), `recurring_need_off` (int[] — weekdays they MUST have off, 0=Mon..6=Sun), `recurring_preferred_off` (int[] — weekdays they PREFER off)
- `locations`: `id` (int PK), `name` (text), `active` (bool). Source of truth for location IDs.
- `forecast_predictions`: `forecast_date` (date), `location_id` (int), `service_category` (text: boarding/daycare/grooming), `predicted_count` (numeric)
- `availability_time_range`: `staff_id` (int), `weekday` (smallint, 0=Mon..6=Sun), `is_available` (bool), `start_time` (time), `end_time` (time), `note` (text). When `end_time < start_time`, window wraps past midnight.
- `availability_weekly`: `staff_id` (int), `weekday` (smallint), `kind` (text: OPEN/CLOSE/OVERNIGHT), `status` (text: YES/NO). Shift-type preferences per weekday.
- `availability_exceptions`: `staff_id` (int), `local_date` (date), `note` (text). One-off absences — PTO, sick, vacation. Staff CANNOT work on exception dates.
- `schedule_weeks`: `id` (uuid PK), `week_start` (date), `location_notes` (jsonb).
- `schedule_shifts`: `id` (text PK), `schedule_week_id` (uuid FK), `date` (date), `start_time` (time), `end_time` (time), `staff_id` (int), `location_id` (int), `is_lead` (bool), `is_training` (bool), `notes` (text). Finalized shifts — use as baseline for copy-forward.
- `airport_layover_tasks`: `id` (uuid), `scheduled_time` (timestamptz), `status` (text). Airport tasks only affect Tukwila (location_id = 1). Filter out 'cancelled'.

## Critical — Weekday Conversion

The app uses **0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri, 5=Sat, 6=Sun**. PostgreSQL `EXTRACT(DOW ...)` uses 0=Sun, 1=Mon..6=Sat. **Always convert with:**
```sql
(EXTRACT(ISODOW FROM date) - 1)::int
```

## Hard Constraints

Violations make a schedule **invalid** — non-negotiable.

| Constraint | Value |
|-----------|-------|
| Max hours per staff per week | 40 (hard cap, never exceed) |
| Max shifts per staff per week | 5 |
| Minimum shift duration | 4 hours |
| Lead shifts require | `lead = true` OR `role` in ('manager', 'admin') |
| Required per location per day | 1 lead AM + 1 lead PM + (overnight for Tukwila & West Seattle only) |
| No double-booking | Same person cannot have overlapping shifts |
| Availability respected | Never schedule on unavailable day, outside time window, or on exception date |
| Location lock respected | If `allow_location_ids` is set and non-empty, staff can ONLY work those locations |

## Shift Windows

| Shift | Start | End | Notes |
|-------|-------|-----|-------|
| AM (Open) | 05:00 | 13:00 | 8 hours |
| PM (Close) | 13:00 | 21:00 | 8 hours |
| Overnight | 21:00 | 05:00 | 8 hours, use START date for availability lookup |

## Target Hours Defaults

| Role | Default Target | Goal |
|------|---------------|------|
| Manager / Admin | 40 | Fill to 40 |
| Lead (`lead = true`) | 36 | Fill to 36-40 |
| Staff | 32 | Fill to 32 |

Use `pawsvip_staff.target_hours` if set; otherwise use defaults above.

---

## FULL WEEK BUILD — The Algorithm

When asked to build a complete week, follow these 5 phases **in order**. Do NOT skip or combine phases.

### Phase 1: Load All Context (one query)

Run the full scheduling context query from `references/sql-patterns.md`. This returns every active staff member with their constraints pre-joined: recurring availability, shift preferences, exceptions for target week, location locks, target hours, and last week's shifts.

**Store the entire result in memory before proceeding.** Do NOT query piecemeal.

### Phase 2: Copy Last Week Forward

Most weeks are ~90% similar to the previous week. Start from the most recent finalized week in `schedule_shifts`:

1. **Find baseline week**: Query the most recent `schedule_weeks` entry that has shifts in `schedule_shifts`.
2. **Copy shifts forward**: For each shift, add 7 days to the date.
3. **Flag conflicts**: Check each copied shift against THIS week's constraints:
   - Is the staff member unavailable on the new weekday? (check `availability_time_range` for `is_available = false`)
   - Does the new date have an exception? (check `availability_exceptions`)
   - Does the shift time fall outside their available window?
   - Would total hours exceed 40?
   - Does `availability_weekly` show `status = 'NO'` for this shift kind on this weekday?
4. **Remove conflicting shifts** — don't force them, just remove.
5. **Track gaps** — record which slots (day x location x shift_type x role) are now unfilled.

### Phase 3: Fill Gaps — Person-Centric Algorithm

**CRITICAL: Use person-centric assignment, NOT slot-centric.** Do NOT iterate over empty slots finding people. Instead:

1. **List all people who need more shifts** — current hours < target hours after Phase 2.
2. **Sort by most constrained first**:
   - Fewest available days this week (after removing exception days and unavailable days)
   - Then fewest allowed locations
   - Then leads before staff (leads are harder to place since exactly 1 per shift/location)
3. **For each person**, pick their additional days:
   - From their available days, select the day with the **lowest current headcount**
   - This naturally produces even distribution across all 7 days (the key insight)
   - Repeat until they reach target hours or run out of available days
4. **Within each day**, assign location and shift type:
   - **Lead slots first**: Each location needs exactly 1 lead AM and 1 lead PM. Assign location-locked leads first, then flexible leads.
   - **Staff slots next**: Assign location-locked staff first, then flexible staff.
   - **Honor shift preferences**: Use `availability_weekly` (kind + status) to prefer matching shifts. If someone has `OPEN=YES, CLOSE=NO`, prefer AM over PM.
   - **Never exceed**: 1 lead per shift per location, 40 hours per person.

### Phase 4: Validate Before Inserting

Run ALL checks programmatically and print results. **Do NOT insert if any check fails.**

| # | Check | Rule | Fix |
|---|-------|------|-----|
| 1 | Hours cap | No one > 40 hours | Remove their lowest-priority shift |
| 2 | Availability | No one on unavailable day or outside time window | Remove shift, re-run Phase 3 for that slot |
| 3 | Exceptions | No one on PTO/exception date | Remove shift, re-run Phase 3 for that slot |
| 4 | Lead count | Exactly 1 lead per (day x location x AM/PM) | Swap lead/staff assignments |
| 5 | Double-book | No overlapping shifts for same person | Remove duplicate |
| 6 | Distribution | Daily shift count within +/-3 of average | Move shifts from over-staffed to under-staffed days |
| 7 | Location lock | No one at a location not in their `allow_location_ids` | Reassign to allowed location |
| 8 | Coverage | All locations have AM lead + PM lead + overnight (Tukwila & WS only) | Flag as unfillable, explain why |

Print a summary: total shifts, shifts per day, hours per person, violations found. **Only proceed to insert after 0 violations.**

### Phase 5: Insert

1. Delete existing draft shifts for the target week: `DELETE FROM ai_draft_shifts WHERE week_start = :week_start`
2. Insert in batches of 25 (Supabase query length limits).
3. After all inserts, run a verification query: count by day, count leads per location per shift, check max hours.
4. **Show the user where to review**: After successful insertion, provide links to the draft viewer for each location:
   ```
   https://app.pawsvip.com/tools/ai-draft?week=<WEEK_START>&location=<LOCATION_ID>
   ```
   Example for week of 2026-03-30: link all 3 locations (location=1, location=2, location=3).

---

## Individual Operations (non-full-week)

For single shift CRUD (assign, swap, delete, add), execute immediately using patterns from `references/sql-patterns.md`. Always return the affected rows so the caller can verify.

## Availability Check (always required before any write)

1. Query `availability_time_range` for recurring weekly availability
2. Query `availability_exceptions` for the date range
3. Check `availability_weekly` for shift-type preferences
4. **Overnight shifts**: Use the shift's START date for availability lookup. A 21:00-05:00 shift on Monday checks Monday's availability.

## Staff Context Updates

When the user shares scheduling info about staff, update `${CLAUDE_PLUGIN_DATA}/staff-context.md`:
- Permanent preferences → `## Permanent Preferences`
- Hard limits → `## Staff Constraints`
- Time-bound exceptions → `## Temporary Overrides` with `[until YYYY-MM-DD]`
- Soft notes → `## Scheduling Notes`

Replace contradicting entries. Clean up expired overrides.

## Safety

- **Bulk deletes** (clear week, delete by filter): confirm scope before executing.
- **Return data after every write** so the caller can verify.
- **Location IDs**: 1 = Tukwila/SeaTac, 2 = Ballard, 3 = West Seattle. **Do NOT swap 2 and 3.**
- Times are local PST, no timezone conversion needed.
- Week starts on Monday.

## References (load on demand)

- **SQL patterns**: read `references/sql-patterns.md` — tested queries including the full scheduling context query
- **Staffing guidelines**: read `references/staffing-guidelines.md` — dogs-per-FTE ratios, location-specific patterns
- **Staff context**: read `${CLAUDE_PLUGIN_DATA}/staff-context.md` — staff preferences, constraints, temporary overrides
