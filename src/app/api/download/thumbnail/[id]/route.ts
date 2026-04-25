import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = createAdminClient();

  // Fetch the thumbnail row
  const { data: thumb, error } = await supabase
    .from('thumbnail_outputs')
    .select('*, clips(title)')
    .eq('id', id)
    .single();

  if (error || !thumb) {
    return new NextResponse('Thumbnail not found', { status: 404 });
  }

  // Fetch the image bytes from the public URL
  const imageRes = await fetch(thumb.image_url);
  if (!imageRes.ok) {
    return new NextResponse('Failed to fetch image', { status: 500 });
  }

  const imageBuffer = await imageRes.arrayBuffer();

  // Build a friendly filename from clip title + variant
  const clipTitle = (thumb.clips as { title: string } | null)?.title || 'thumbnail';
  const safeName = clipTitle.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_').toLowerCase();
  const filename = `${safeName}_v${thumb.variant_index}.png`;

  return new NextResponse(imageBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-cache',
    },
  });
}
