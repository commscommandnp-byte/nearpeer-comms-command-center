# WATI First Step

## What we need from the WATI account

- API base URL
- API token
- Tenant/account ID if visible
- Exact names of the 5 WATI teams
- Operator/agent name, email, and team
- Current tags
- Current custom fields
- Webhook event list visible in WATI

## Metrics in version one

- Open chats
- Unassigned chats
- Admin-held chats
- Last assigned chat
- Oldest assigned chat
- Oldest unassigned chat
- Delayed replies
- About-to-expire chats
- Critical expiry chats
- Agent/counselor workload
- CSS, MDCAT, CA, Access, Support, Payment, and Refund buckets

## Webhook events to enable later

- Message received
- Message sent
- Message status updates

These events are enough to maintain last customer message time, last agent reply time, active session state, and reply-delay calculations. Assignment/team fields must be confirmed from the account's actual API payload.
