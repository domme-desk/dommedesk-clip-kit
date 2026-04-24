-- =============================================================================
-- DommeDesk Clip Kit — Initial Schema
-- =============================================================================

-- Enable required extensions
create extension if not exists "uuid-ossp";
create extension if not exists "vector";

-- =============================================================================
-- WORKSPACES
-- =============================================================================
create table workspaces (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =============================================================================
-- MODELS (creators)
-- =============================================================================
create table models (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  display_name text not null,
  avatar_url text,
  
  -- Brand kit
  brand_colors jsonb default '{}'::jsonb,  -- {primary, secondary, accent}
  font_preferences jsonb default '{}'::jsonb,  -- {heading, body, notes}
  tone_notes text,
  logo_url text,
  watermark_url text,
  watermark_position text check (watermark_position in ('top-left','top-right','bottom-left','bottom-right','center')) default 'bottom-right',
  banned_words text[] default '{}',
  banned_themes text[] default '{}',
  default_style_prompt text,  -- fallback when style library is empty
  
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_models_workspace on models(workspace_id);

-- =============================================================================
-- STYLE LIBRARY ITEMS
-- =============================================================================
create table style_library_items (
  id uuid primary key default uuid_generate_v4(),
  model_id uuid not null references models(id) on delete cascade,
  
  asset_url text not null,
  asset_type text not null check (asset_type in ('thumbnail','preview','caption')),
  caption_text text,  -- only populated for caption-type items
  
  auto_tags jsonb default '{}'::jsonb,  -- Claude-generated tags
  manual_tags text[] default '{}',
  embedding vector(1024),  -- for similarity search
  
  paired_group_id uuid,  -- links thumbnail+preview+caption from same source clip
  notes text,
  
  created_at timestamptz not null default now()
);

create index idx_style_library_model on style_library_items(model_id);
create index idx_style_library_type on style_library_items(model_id, asset_type);
create index idx_style_library_embedding on style_library_items using ivfflat (embedding vector_cosine_ops);

-- =============================================================================
-- CLIPS (source videos)
-- =============================================================================
create table clips (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  model_id uuid not null references models(id) on delete restrict,
  
  source_url text not null,  -- Supabase Storage path
  proxy_url text,  -- low-res proxy for fast processing
  original_filename text,
  duration_seconds numeric,
  file_size_bytes bigint,
  
  status text not null default 'uploaded' check (status in (
    'uploaded','processing','ready','failed'
  )),
  status_message text,
  
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_clips_workspace on clips(workspace_id);
create index idx_clips_model on clips(model_id);
create index idx_clips_status on clips(status);

-- =============================================================================
-- THUMBNAIL OUTPUTS
-- =============================================================================
create table thumbnail_outputs (
  id uuid primary key default uuid_generate_v4(),
  clip_id uuid not null references clips(id) on delete cascade,
  
  image_url text not null,
  source_frame_url text,  -- the still before compositing
  source_frame_timestamp numeric,  -- seconds into clip
  
  composition_brief jsonb,  -- {text_content, placement, color_treatment, ...}
  variant_index int not null,  -- 1, 2, or 3
  
  generation_metadata jsonb default '{}'::jsonb,  -- model, cost, latency, prompt hash
  
  created_at timestamptz not null default now()
);

create index idx_thumbnails_clip on thumbnail_outputs(clip_id);

-- =============================================================================
-- PREVIEW OUTPUTS
-- =============================================================================
create table preview_outputs (
  id uuid primary key default uuid_generate_v4(),
  clip_id uuid not null references clips(id) on delete cascade,
  
  video_url text not null,
  duration_seconds numeric not null,
  segments jsonb not null,  -- [{start, end, reason}, ...]
  description text,  -- optional auto-generated description
  
  generation_metadata jsonb default '{}'::jsonb,
  
  created_at timestamptz not null default now()
);

create index idx_previews_clip on preview_outputs(clip_id);

-- =============================================================================
-- CAPTION OUTPUTS (schema stub — pipeline not built yet)
-- =============================================================================
create table caption_outputs (
  id uuid primary key default uuid_generate_v4(),
  clip_id uuid not null references clips(id) on delete cascade,
  
  caption_text text not null,
  variant_index int not null,
  
  generation_metadata jsonb default '{}'::jsonb,
  
  created_at timestamptz not null default now()
);

create index idx_captions_clip on caption_outputs(clip_id);

-- =============================================================================
-- JOBS (Inngest run tracking for observability)
-- =============================================================================
create table jobs (
  id uuid primary key default uuid_generate_v4(),
  clip_id uuid references clips(id) on delete cascade,
  
  inngest_run_id text,
  job_type text not null,  -- 'frame_extraction', 'thumbnail_generation', etc.
  status text not null default 'pending' check (status in (
    'pending','running','completed','failed'
  )),
  
  input jsonb default '{}'::jsonb,
  output jsonb default '{}'::jsonb,
  error text,
  
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_jobs_clip on jobs(clip_id);
create index idx_jobs_status on jobs(status);

-- =============================================================================
-- UPDATED_AT TRIGGERS
-- =============================================================================
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger workspaces_updated_at before update on workspaces
  for each row execute function set_updated_at();

create trigger models_updated_at before update on models
  for each row execute function set_updated_at();

create trigger clips_updated_at before update on clips
  for each row execute function set_updated_at();

-- =============================================================================
-- SEED: default workspace for internal use
-- =============================================================================
insert into workspaces (id, name) values (
  '00000000-0000-0000-0000-000000000001',
  'Silver Tongue Studios'
);