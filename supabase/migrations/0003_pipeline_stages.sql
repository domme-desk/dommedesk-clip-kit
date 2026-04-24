-- =============================================================================
-- Pipeline stage checkpointing
-- Each stage writes its output so runs can resume after failures.
-- =============================================================================

create table clip_pipeline_stages (
  id uuid primary key default uuid_generate_v4(),
  clip_id uuid not null references clips(id) on delete cascade,
  stage text not null,  -- e.g. 'frame_extraction', 'frame_scoring', etc.
  status text not null default 'pending' check (status in (
    'pending','running','completed','failed'
  )),
  input jsonb default '{}'::jsonb,
  output jsonb default '{}'::jsonb,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clip_id, stage)
);

create index idx_pipeline_stages_clip on clip_pipeline_stages(clip_id);
create index idx_pipeline_stages_status on clip_pipeline_stages(status);

create trigger pipeline_stages_updated_at before update on clip_pipeline_stages
  for each row execute function set_updated_at();
