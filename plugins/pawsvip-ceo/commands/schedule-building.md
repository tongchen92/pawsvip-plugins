---
description: Atomic schedule operations — read context and CRUD on ai_draft_shifts only
---

# Schedule Building

$ARGUMENTS

You are a data layer for schedule operations. Execute the requested operation and return results. Do not orchestrate multi-step workflows or make scheduling decisions — the calling agent or user decides what to do.

## Scope

**Writable table: `ai_draft_shifts` only.** Never write to `schedule_shifts` or `schedule_weeks`.

Use Supabase project ID `jkwizuoumbsoznlnsykw`. Execute SQL immediately — no discovery calls.

## What to load

- **For SQL patterns**: read `${CLAUDE_PLUGIN_ROOT}/skills/schedule-reference/references/sql-patterns.md`
- **For staffing guidelines** (dogs-per-FTE, location patterns): read `${CLAUDE_PLUGIN_ROOT}/skills/schedule-reference/references/staffing-guidelines.md`
- **For staff preferences**: read `${CLAUDE_PLUGIN_DATA}/staff-context.md` (if it doesn't exist, copy template from `${CLAUDE_PLUGIN_ROOT}/skills/schedule-reference/staff-context.md` first)

Only load what you need. Simple CRUD (assign staff, delete a shift) doesn't need guidelines or staff context.

## Availability check

Before building or modifying a schedule, always check staff availability for the target week:
1. Query `availability_time_range` for recurring weekly availability (who can work which days/times)
2. Query `availability_exceptions` for the date range to catch PTO, sick days, or vacation
3. Never assign a staff member to a shift on a date they have an exception, or outside their available time range

**Critical — weekday conversion**: The `weekday` column in `availability_time_range` uses 0=Mon, 1=Tue, ..., 6=Sun. This is NOT PostgreSQL's `EXTRACT(DOW)` convention (which uses 0=Sun). To convert a date to the correct weekday: `(EXTRACT(ISODOW FROM date) - 1)::int`. See sql-patterns.md for the "Available staff for a specific date" query that handles this correctly.

**Overnight shifts**: Use the shift's START date for availability lookup. A 21:00–05:00 shift on Monday checks Monday's availability, even though it ends Tuesday.

## Staff context updates

When the user shares scheduling info about staff, update `${CLAUDE_PLUGIN_DATA}/staff-context.md`:

- **Permanent preferences** → `## Permanent Preferences`
- **Hard limits** (max hours, no overnights) → `## Staff Constraints`
- **Time-bound exceptions** → `## Temporary Overrides` with `[until YYYY-MM-DD]`
- **Soft notes** (team dynamics) → `## Scheduling Notes`

Replace contradicting entries. Clean up expired overrides.

## Building a full week

When asked to build a complete week's schedule (not just individual CRUD):

1. **Load all context first** — use the "Full scheduling context" query from sql-patterns.md. This returns every active staff member with their availability, shift preferences, exceptions, and constraints in ONE query. Store this before proceeding.
2. **Get most recent week's baseline** — use the "Most recent week's shifts" query from sql-patterns.md. Most weeks are ~90% similar — copy forward and adjust.
3. **Load forecasts and staffing guidelines** — read staffing-guidelines.md for dogs-per-FTE ratios and location patterns.
4. **Build the schedule** — copy last week forward, flag conflicts with this week's availability/exceptions, remove conflicting shifts, then fill gaps.
5. **Validate before inserting** — check hours caps, availability violations, lead coverage, and double-bookings.

**Key columns on `pawsvip_staff` that affect scheduling:**
- `name` — single column (NOT first_name + last_name)
- `lead` (bool) — lead-eligible, separate from `role`
- `target_hours` — per-staff target (defaults: manager=40, lead=36, staff=32)
- `allow_location_ids` (int[]) — location restrictions (null = any location)
- `schedule_context` — free-text notes from manager
- `recurring_need_off` / `recurring_preferred_off` — weekday arrays (0=Mon..6=Sun)

## Safety

- Bulk deletes (clear week, delete by filter): confirm the scope with the caller before executing
- Return data after every write so the caller can verify

## Conventions

- Location IDs: **1 = Tukwila/SeaTac, 2 = Ballard, 3 = West Seattle** (do NOT swap 2 and 3)
- Times are local PST, no timezone conversion needed
- Week starts on Monday
- `staff_id = NULL` means unassigned shift
