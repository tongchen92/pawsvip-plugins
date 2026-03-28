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

- **For SQL patterns**: read `${CLAUDE_PLUGIN_ROOT}/skills/schedule-building/references/sql-patterns.md`
- **For staffing guidelines** (dogs-per-FTE, location patterns): read `${CLAUDE_PLUGIN_ROOT}/skills/schedule-building/references/staffing-guidelines.md`
- **For staff preferences**: read `${CLAUDE_PLUGIN_DATA}/staff-context.md` (if it doesn't exist, copy template from `${CLAUDE_PLUGIN_ROOT}/skills/schedule-building/staff-context.md` first)

Only load what you need. Simple CRUD (assign staff, delete a shift) doesn't need guidelines or staff context.

## Availability check

Before building or modifying a schedule, always check staff availability for the target week:
1. Query `availability_time_range` for recurring weekly availability (who can work which days/times)
2. Query `availability_exceptions` for the date range to catch PTO, sick days, or vacation
3. Never assign a staff member to a shift on a date they have an exception, or outside their available time range

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

- Location IDs: 1 = Tukwila, 2 = Ballard, 3 = West Seattle
- Times are local PST, no timezone conversion needed
- Week starts on Monday
- `staff_id = NULL` means unassigned shift
