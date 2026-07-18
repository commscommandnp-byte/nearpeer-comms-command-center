create table if not exists wati_teams (
  id text primary key,
  name text not null,
  is_admin_queue boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists wati_agents (
  id text primary key,
  name text not null,
  email text,
  team_id text references wati_teams(id),
  program text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists wati_conversations (
  id text primary key,
  ticket_id text,
  wa_id text,
  student_name text,
  team_id text references wati_teams(id),
  assigned_agent_id text references wati_agents(id),
  program text,
  status text,
  tags text[] not null default '{}',
  custom_attributes jsonb not null default '{}',
  first_seen_at timestamptz,
  assigned_at timestamptz,
  last_customer_message_at timestamptz,
  last_agent_reply_at timestamptz,
  session_expires_at timestamptz,
  raw jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists wati_messages (
  id text primary key,
  conversation_id text references wati_conversations(id),
  ticket_id text,
  wa_id text,
  sender_name text,
  operator_name text,
  operator_email text,
  direction text not null,
  message_type text,
  text text,
  message_created_at timestamptz,
  raw jsonb not null default '{}',
  inserted_at timestamptz not null default now()
);

create table if not exists sla_events (
  id bigserial primary key,
  conversation_id text references wati_conversations(id),
  event_type text not null,
  severity text not null,
  age_minutes integer,
  details jsonb not null default '{}',
  opened_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists idx_wati_conversations_status on wati_conversations(status);
create index if not exists idx_wati_conversations_team on wati_conversations(team_id);
create index if not exists idx_wati_conversations_agent on wati_conversations(assigned_agent_id);
create index if not exists idx_wati_conversations_last_customer on wati_conversations(last_customer_message_at);
create index if not exists idx_wati_messages_conversation on wati_messages(conversation_id);
