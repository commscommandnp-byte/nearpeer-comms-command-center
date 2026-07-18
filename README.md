# Nearpeer Comms Command Center

WATI-first live operations dashboard for Nearpeer Communication.

## First target

The first build focuses only on WATI:

- Unassigned chats
- Admin-held chats
- Last assigned chat time
- Oldest assigned chat time
- Oldest unassigned chat
- Delayed replies
- About-to-expire WhatsApp sessions
- Agent/counselor workload
- CSS, MDCAT, CA, Access, Support, Payment, and Refund issue buckets

## Accounts

- `comms.commandnp@gmail.com`: owner of Netlify, GitHub, Supabase, dashboard deployment.
- `nearpeercomms@gmail.com`: current WATI source account with API token, teams, operators, tags, custom fields, and webhook access.

## Local setup

1. Copy `.env.example` to `.env`.
2. Add the WATI API token and base URL from the `nearpeercomms@gmail.com` WATI account.
3. Run:

```bash
npm start
```

Then open:

```text
http://localhost:5058
```

## WATI discovery

Run:

```bash
npm run discover:wati
```

This tests common WATI endpoints and reports which ones are available for your account. It does not print the API token.

## Production direction

Frontend can be hosted on Netlify. WATI webhooks should write into Supabase through Netlify Functions or a dedicated backend worker. The dashboard should read from Supabase for fast, second-by-second UI refresh, while WATI webhooks and backup polling keep the database current.
