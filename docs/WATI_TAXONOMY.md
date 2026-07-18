# WATI Taxonomy For CCC

This document captures the WATI operating structure currently known from screenshots and the tag export dated 18-Jul-2026.

## Teams And Users

Visible WATI users/teams:

- Access & Support
- Admin Team
- Bot
- AI Support Agent
- MDCAT Team
- Shahrukh Swati
- CSS Counseling Team

Dashboard treatment:

- Admin Team is an admin queue.
- Access & Support handles access/login/support issues.
- MDCAT Team and CSS Counseling Team are program/counseling lanes.
- Bot and AI Support Agent should not be counted as human counselor capacity.

## Chat Status Filters

Visible WATI chat filters:

- All chats
- Active chats
- Assigned to me
- Unassigned
- Last 24 Hours
- Favorite only
- Open
- Pending
- Solved
- Expired
- Blocked Chats
- Broadcasts
- Unread
- CTWA
- G-CTWA
- T-CTWA

Dashboard treatment:

- Open/Pending/Unread should be candidates for action.
- Solved/Blocked/Broadcasts should not appear as action-required.
- Expired should be tracked as a session risk, not as a normal reply-delay item.

## Tag Groups

The tag export contains 68 tags and 10,023 total tagged uses.

Major groups by volume:

- Counselor: 3,483
- Marketing/Program: 3,093
- Admissions: 2,887
- Access: 247
- Stage: 153
- Customer Support: 62
- Audit: 49
- Issue: 36

## Program Tags

Known program tags include:

- MKT: CSS
- MKT: MDCAT
- MKT: CA
- MKT: FSC
- MKT: MATRIC
- MKT: PMS
- MKT: AFNS
- MKT: ACCA
- MKT: ECAT
- MKT: ISSB
- MKT: Matric | 9th Class

Dashboard normalized programs:

- CSS
- MDCAT
- CA
- FSC
- MATRIC
- ECAT
- ISSB
- AFNS

## Ownership Tags

Known ownership prefixes:

- Counselor:
- AD:
- ACC:
- CSA:
- Audit:
- AU:

Dashboard treatment:

- Counselor tags identify counseling owner.
- AD tags identify admissions owner.
- ACC tags identify access owner.
- CSA tags identify support owner.
- Audit/AU tags identify audit ownership.

## Stage Tags

Known stage tags include:

- Stage: Paid | MDCAT
- Stage: Paid | CSS
- Stage: Paid | CA
- Stage:_Paid_|_MDCAT
- Stage:_Paid_|_CSS
- Stage:_Paid_|_CA

Dashboard treatment:

- Stage tags should populate the student stage.
- Program should be inferred from the stage only when no cleaner MKT/program tag exists.

## Issue Tags

Known issue tags include:

- CS course access issue
- CS login issue
- CS technical issue

Dashboard treatment:

- Course access maps to Access.
- Login maps to Login.
- Technical maps to Technical.

## Current Accuracy Rule

Temporary WATI sync is not the final source of truth for WATI inbox state. Until webhook forwarding is approved:

- A chat is action-required only when the latest known customer message is newer than the latest known Nearpeer/business reply.
- Contacts with only outgoing/business-side recent messages should not be counted as waiting students.
- Solved/Open state will become more accurate after webhook forwarding provides live conversation status events.

## Assigned To Me Control Model

The command center treats WATI work as the team-account "Assigned to me" lanes:

- Admin Team
- CSS Counseling Team
- MDCAT Team
- CA Team
- Access & Support

Admin Team answers:

- How many chats are in the Admin Team "Assigned to me" view?
- How many Admin Team chats are waiting and need dispatch?
- How many active Admin Team chats are about to expire?
- What is the oldest pending Admin wait?

Program lanes answer:

- How many leads are in that team account's "Assigned to me" view?
- How many are waiting for reply?
- How many have been catered/replied?
- What was the first and last lead time in that lane?
- Are assigned leads mapped to active counselors?

Access & Support answers:

- How many leads are in the Access & Support "Assigned to me" view?
- How many are waiting?
- How many have been catered?
- Which issue categories are present, such as Access, Login, Technical, Payment, or Refund?

Active counselor status is controlled by the `WATI_ACTIVE_COUNSELORS` environment variable. Add a comma-separated list of active counselor names exactly as they appear in WATI tags.

Team account names can be tuned with:

- `WATI_ADMIN_OWNER_NAMES`
- `WATI_CSS_ACCOUNT_NAMES`
- `WATI_MDCAT_ACCOUNT_NAMES`
- `WATI_CA_ACCOUNT_NAMES`
- `WATI_ACCESS_ACCOUNT_NAMES`

Temporary sync derives the "Assigned to me" lanes from WATI contact/team/tag data. Webhook forwarding will make this exact to WATI's live UI filter.
