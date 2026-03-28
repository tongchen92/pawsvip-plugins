# PawsVIP CEO Plugin

CEO assistant for PawsVIP pet hotel. Provides business intelligence across 3 locations (Tukwila, Ballard, West Seattle) using Supabase data, staff schedules, gallery metrics, and financial reconciliation.

## Skills

**User-invocable** (type `/name` to run):
- `/schedule-building` — Build, modify, and evaluate weekly staff schedules (includes data model, SQL patterns, and staffing rules)
- `/morning-briefing` — Daily snapshot of occupancy, staffing, tasks, and alerts
- `/weekly-review` — Week-over-week performance analysis across all locations
- `/investigate` — Deep dive investigation on any business topic

**Auto-triggered** (loaded automatically when relevant):
- **data-model** — PawsVIP database schema and tested query patterns
- **business-context** — Location details, capacity, services, and team structure
- **gingr-patterns** — Gingr API usage patterns and known pitfalls

## Setup (Claude Cowork)

This plugin requires the **Supabase MCP server** to be configured in the host environment. The plugin does not bundle its own MCP servers — it expects the host to provide Supabase access.

**Required**: Supabase MCP with access to project `jkwizuoumbsoznlnsykw`
**Optional**: QuickBooks MCP connection for financial data

### Staff context persistence

Staff scheduling preferences are stored in `${CLAUDE_PLUGIN_DATA}/staff-context.md`. On first use, the template from the plugin is copied there automatically. This file persists across sessions and plugin updates.
