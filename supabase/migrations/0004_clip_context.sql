-- Add context fields to clips so the pipeline has more to work with.

alter table clips
  add column title text,
  add column description text,
  add column tags text[] not null default '{}',
  add column auto_description text;

-- Backfill title from filename for existing rows so they're not blank.
update clips
set title = coalesce(original_filename, 'Untitled clip')
where title is null;

-- Index on tags for future filtering
create index idx_clips_tags on clips using gin(tags);
