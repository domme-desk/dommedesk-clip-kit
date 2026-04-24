import { createClient } from '@supabase/supabase-js';

/**
 * Admin client with service-role key. Bypasses RLS.
 * ONLY use server-side in trusted contexts (Inngest jobs, API routes with their own auth).
 * NEVER expose this client or its key to the browser.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}