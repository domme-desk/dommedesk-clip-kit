// Database row types — hand-written for now, can be auto-generated later
// via `npx supabase gen types typescript`

export type Workspace = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

export type Model = {
  id: string;
  workspace_id: string;
  display_name: string;
  avatar_url: string | null;
  brand_colors: {
    primary?: string;
    secondary?: string;
    accent?: string;
  };
  font_preferences: {
    heading?: string;
    body?: string;
    notes?: string;
  };
  tone_notes: string | null;
  logo_url: string | null;
  watermark_url: string | null;
  watermark_position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
  banned_words: string[];
  banned_themes: string[];
  default_style_prompt: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type StyleLibraryItem = {
  id: string;
  model_id: string;
  asset_url: string;
  asset_type: 'thumbnail' | 'preview' | 'caption';
  caption_text: string | null;
  auto_tags: Record<string, unknown>;
  manual_tags: string[];
  embedding: number[] | null;
  paired_group_id: string | null;
  notes: string | null;
  created_at: string;
};

export type Clip = {
  id: string;
  workspace_id: string;
  model_id: string;
  source_url: string;
  proxy_url: string | null;
  original_filename: string | null;
  duration_seconds: number | null;
  file_size_bytes: number | null;
  status: 'uploaded' | 'processing' | 'ready' | 'failed';
  status_message: string | null;
  title: string | null;
  description: string | null;
  tags: string[];
  auto_description: string | null;
  created_at: string;
  updated_at: string;
};

export type ThumbnailOutput = {
  id: string;
  clip_id: string;
  image_url: string;
  source_frame_url: string | null;
  source_frame_timestamp: number | null;
  composition_brief: Record<string, unknown> | null;
  variant_index: number;
  generation_metadata: Record<string, unknown>;
  created_at: string;
};

export type PreviewOutput = {
  id: string;
  clip_id: string;
  video_url: string;
  duration_seconds: number;
  segments: Array<{ start: number; end: number; reason: string }>;
  description: string | null;
  generation_metadata: Record<string, unknown>;
  created_at: string;
};