-- Relay chat schema: conversations + messages, no authentication (anon key only,
-- single-user take-home project). Message ids are generated on the CLIENT so
-- retries/offline-queue flushes can upsert idempotently instead of creating
-- duplicate rows on reconnect.

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key, -- client-generated, no server default (see lib/chat.ts)
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  status text not null default 'complete' check (status in ('pending', 'streaming', 'complete', 'error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists messages_conversation_created_at_idx
  on public.messages (conversation_id, created_at);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;

create policy "Conversations are readable by anyone"
  on public.conversations for select
  to anon
  using (true);

create policy "Anyone can create a conversation"
  on public.conversations for insert
  to anon
  with check (true);

create policy "Messages are readable by anyone"
  on public.messages for select
  to anon
  using (true);

create policy "Anyone can insert a message"
  on public.messages for insert
  to anon
  with check (char_length(content) <= 20000);

-- Needed so the same upsert() call can also apply streaming token updates
-- to an assistant message that already exists.
create policy "Anyone can update a message"
  on public.messages for update
  to anon
  using (true)
  with check (char_length(content) <= 20000);

-- Enable realtime so the phone and web dashboard both receive postgres_changes
-- events (INSERT for new messages, UPDATE for in-progress streaming content).
alter publication supabase_realtime add table public.conversations;
alter publication supabase_realtime add table public.messages;
