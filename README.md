# PawsVIP CEO Plugin

CEO assistant for PawsVIP pet hotel. Query any business data instantly across 3 locations (Tukwila, Ballard, West Seattle) via Supabase. Build and manage weekly staff schedules.

## Skills

**User-invocable:**
- `/schedule-building` — Build, modify, and evaluate weekly staff schedules

**Auto-triggered:**
- **data-model** — Database schema, business context, Gingr API patterns, and tested SQL queries. Loaded automatically on any business question — the agent can answer occupancy, revenue, staffing, gallery, leads, and more without a dedicated skill for each.

## How it works

The plugin is intentionally minimal: one complex workflow skill (schedule-building) and one comprehensive data layer (data-model). The data-model skill gives the agent everything it needs — table schemas, disambiguation rules, tested query templates, and business context — so it can answer any ad-hoc question directly via `execute_sql` without needing separate skills for morning briefings, weekly reviews, or investigations.

## Setup

Requires **Supabase MCP** with access to project `jkwizuoumbsoznlnsykw`.
