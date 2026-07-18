# Nearpeer Comms Command Center Plan

This project is the Nearpeer Comms Command Center. It is separate from Sindh Officers Academy and should stay focused on Nearpeer communication operations, starting with WATI as phase 1.

## Product Goal

Build a live operations dashboard that gives the Nearpeer communication team a clear view of customer conversations, assignment bottlenecks, response delays, expiring WhatsApp sessions, and counselor workload.

The command center should answer the daily operational questions quickly:

- How many chats are open right now?
- Which chats are unassigned?
- Which chats are stuck with Admin and need to be moved?
- Which students are waiting beyond the reply SLA?
- Which WhatsApp sessions are about to expire?
- Which agent or counselor is overloaded?
- Which programs or issue types are creating the most pressure?

## Phase 1: WATI

Phase 1 focuses only on WATI. No Sindh Officers Academy logic, data model, workflows, or branding should be mixed into this project.

### Source Account

- `nearpeercomms@gmail.com`: current WATI source account with API token, teams, operators, tags, custom fields, and webhook access.
- `comms.commandnp@gmail.com`: owner account for Netlify, GitHub, Supabase, and dashboard deployment.

### Required WATI Inputs

- API base URL
- API token
- Tenant or account ID, if visible
- Exact names of the 5 WATI teams
- Operator or agent name, email, and team mapping
- Current tags
- Current custom fields
- Webhook event list available in WATI

### Phase 1 Metrics

- Open chats
- Unassigned chats
- Admin-held chats
- Last assigned chat time
- Oldest assigned chat time
- Oldest unassigned chat time
- Delayed replies
- About-to-expire WhatsApp sessions
- Critical expiry WhatsApp sessions
- Agent and counselor workload
- Program and issue buckets: CSS, MDCAT, CA, Access, Support, Payment, Refund

### Phase 1 Views

- Critical metrics strip for immediate status.
- Immediate Action Required table for chats that need intervention.
- Team workload panel.
- Agent and counselor workload panel.
- Program bucket panel.
- Empty setup/sync state when real data is not available.
- Supabase sync mode after WATI data has been imported.
- Live discovery mode for inspecting real WATI endpoint payloads.

### WATI Discovery

The first integration step is endpoint discovery. The dashboard should test common WATI list endpoints and report:

- Endpoint name
- URL attempted
- Status
- Payload shape
- Sanitized real response excerpt
- Failure details without exposing tokens

This lets the team confirm the real account payload before locking the production data mapping.

### WATI Webhooks

After the API payload is confirmed, enable webhook ingestion for:

- Message received
- Message sent
- Message status updates

These events should maintain:

- Last customer message time
- Last agent reply time
- Active WhatsApp session state
- Reply-delay calculations
- Assignment and team state, once the correct WATI fields are confirmed

## Architecture

### Frontend

- Static dashboard hosted from `public/`.
- Fetches summary data from `/api/wati/summary`.
- Refreshes frequently for live operations use.
- Shows only real Supabase/WATI data. If no real data is available, it shows an empty sync/setup state.

### Local Backend

- `server.js` serves local static assets and API endpoints.
- Local `.env` provides WATI credentials.
- Useful for development, demos, and endpoint discovery.

### Netlify Backend

- Netlify hosts the static frontend.
- Netlify Functions expose production API routes.
- WATI secrets live in Netlify environment variables.
- Netlify redirects map `/api/*` routes to functions.

### Supabase Direction

Supabase should become the fast operational datastore after WATI webhooks are enabled.

Recommended flow:

- WATI webhooks write conversation events into Supabase.
- A backup polling job reconciles missed WATI updates.
- Dashboard reads from Supabase for fast refreshes.
- WATI API remains the source for discovery, backfill, and reconciliation.

## Data Model Direction

The Supabase schema should support:

- Conversations
- Contacts or students
- Teams
- Operators and agents
- Counselor mapping
- Tags
- Custom fields
- Message events
- Assignment events
- Session expiry state
- Daily metric snapshots

The schema should preserve raw WATI payloads alongside normalized fields so mapping can be corrected safely as WATI payloads are confirmed.

## Operational Rules

### Assignment

- Unassigned means no operator or assigned email is present.
- Admin-held means the chat is in an Admin team or assigned to an Admin account.
- Oldest unassigned should use the last customer message time unless WATI exposes a better queue timestamp.
- Last assigned should use the most recent confirmed assignment timestamp.

### Reply Delay

- Default reply SLA: 15 minutes.
- Delayed reply means the latest customer message has waited beyond SLA.
- Critical reply delay means the wait is at least twice the SLA.

### WhatsApp Session Expiry

- WhatsApp session window: 24 hours from the last customer message.
- About-to-expire threshold: 120 minutes remaining by default.
- Critical expiry threshold: 30 minutes remaining by default.

### Program Buckets

Use tags, custom fields, team names, and message text to infer:

- CSS
- MDCAT
- CA
- Access
- Support
- Payment
- Refund

Explicit WATI custom fields should take priority over inferred tags or text.

## Deployment Plan

1. Keep phase 1 running locally with WATI discovery and real-data sync only.
2. Confirm WATI base URL and API token.
3. Run WATI discovery and inspect payload shapes.
4. Map real WATI fields to normalized conversation fields.
5. Deploy frontend and Netlify Functions.
6. Add WATI environment variables in Netlify.
7. Enable WATI webhooks into a backend endpoint.
8. Store webhook data in Supabase.
9. Switch dashboard summary reads from discovery polling to Supabase.
10. Keep polling as backup reconciliation.

## Near-Term Checklist

- Confirm the exact 5 WATI team names.
- Confirm operator and counselor mapping.
- Confirm which WATI endpoint gives the best active conversation list.
- Confirm where assignment timestamps appear.
- Confirm where team and operator fields appear.
- Confirm whether tags and custom fields are included in the list endpoint or require detail calls.
- Add Supabase tables for conversations and message events.
- Add webhook endpoint for incoming WATI events.
- Add a reconciliation script or scheduled function.

## Not In Scope For Phase 1

- Sindh Officers Academy features or data.
- Non-WATI channels.
- CRM replacement workflows.
- Marketing landing pages.
- Manual campaign sending.
- Complex reporting beyond live operational visibility.

## Success Criteria

Phase 1 is successful when the Nearpeer communication lead can open one dashboard and immediately know:

- What needs assignment now.
- Which students are waiting too long.
- Which sessions may expire before a reply.
- Which team or counselor needs load balancing.
- Which program or issue bucket is causing pressure today.
