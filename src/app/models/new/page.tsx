import { createModel } from '@/lib/actions/models';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function NewModelPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link
        href="/models"
        className="mb-6 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-black"
      >
        <ArrowLeft size={14} />
        Back to models
      </Link>

      <h1 className="text-3xl font-bold">New Model</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Create a creator profile. You can add brand assets and style examples after.
      </p>

      <form action={createModel} className="mt-8 space-y-6">
        <div>
          <label htmlFor="display_name" className="mb-1 block text-sm font-medium">
            Display Name
          </label>
          <input
            id="display_name"
            name="display_name"
            type="text"
            required
            maxLength={100}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
            placeholder="e.g. Triple D Goddess"
          />
        </div>

        <div>
          <label htmlFor="tone_notes" className="mb-1 block text-sm font-medium">
            Tone &amp; Voice Notes
          </label>
          <textarea
            id="tone_notes"
            name="tone_notes"
            rows={4}
            maxLength={2000}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
            placeholder="Describe the creator's voice, attitude, aesthetic direction..."
          />
          <p className="mt-1 text-xs text-neutral-500">
            Used by the AI to match tone across thumbnails, captions, and previews.
          </p>
        </div>

        <div>
          <label
            htmlFor="default_style_prompt"
            className="mb-1 block text-sm font-medium"
          >
            Default Style Prompt
          </label>
          <textarea
            id="default_style_prompt"
            name="default_style_prompt"
            rows={4}
            maxLength={2000}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
            placeholder="Fallback style description for when the style library is empty..."
          />
          <p className="mt-1 text-xs text-neutral-500">
            Used as a fallback before you upload 5+ style examples.
          </p>
        </div>

        <div>
          <label
            htmlFor="watermark_position"
            className="mb-1 block text-sm font-medium"
          >
            Watermark Position
          </label>
          <select
            id="watermark_position"
            name="watermark_position"
            defaultValue="bottom-right"
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
          >
            <option value="bottom-right">Bottom Right</option>
            <option value="bottom-left">Bottom Left</option>
            <option value="top-right">Top Right</option>
            <option value="top-left">Top Left</option>
            <option value="center">Center</option>
          </select>
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Create Model
          </button>
          <Link
            href="/models"
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50"
          >
            Cancel
          </Link>
        </div>
      </form>
    </main>
  );
}
