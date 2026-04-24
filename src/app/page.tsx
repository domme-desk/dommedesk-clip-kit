import Link from 'next/link';

export default function Home() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-24">
      <h1 className="text-4xl font-bold">DommeDesk Clip Kit</h1>
      <p className="mt-2 text-neutral-500">
        AI-powered thumbnail, preview, and caption generation for creator clips.
      </p>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <Link
          href="/models"
          className="rounded-lg border border-neutral-200 p-6 hover:border-black"
        >
          <h2 className="font-semibold">Models &rarr;</h2>
          <p className="mt-1 text-sm text-neutral-500">
            Set up creator profiles and brand kits
          </p>
        </Link>

        <div className="rounded-lg border border-dashed border-neutral-300 p-6 opacity-50">
          <h2 className="font-semibold">Clips</h2>
          <p className="mt-1 text-sm text-neutral-500">Coming next</p>
        </div>
      </div>
    </main>
  );
}
