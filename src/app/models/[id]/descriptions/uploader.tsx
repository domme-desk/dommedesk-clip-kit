'use client';

import { useState, useTransition } from 'react';
import { bulkAddDescriptionExamples } from '@/lib/actions/description-examples';
import { Plus, Trash2, Loader2 } from 'lucide-react';

type Pair = {
  title: string;
  description: string;
  tags: string;
};

const emptyPair: Pair = { title: '', description: '', tags: '' };

export function DescriptionUploader({ modelId }: { modelId: string }) {
  const [pairs, setPairs] = useState<Pair[]>([{ ...emptyPair }]);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ added: number; errors: string[] } | null>(null);

  function updatePair(idx: number, field: keyof Pair, value: string) {
    setPairs((prev) => prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p)));
  }

  function addRow() {
    setPairs((prev) => [...prev, { ...emptyPair }]);
  }

  function removeRow(idx: number) {
    setPairs((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleSubmit() {
    setResult(null);
    const cleaned = pairs
      .filter((p) => p.title.trim() && p.description.trim())
      .map((p) => ({
        title: p.title.trim(),
        description: p.description.trim(),
        tags: p.tags.split(',').map((t) => t.trim()).filter(Boolean),
      }));

    if (cleaned.length === 0) {
      setResult({ added: 0, errors: ['No valid pairs (need both title and description)'] });
      return;
    }

    startTransition(async () => {
      const res = await bulkAddDescriptionExamples(modelId, cleaned);
      setResult(res);
      if (res.added > 0 && res.errors.length === 0) {
        setPairs([{ ...emptyPair }]);
      }
    });
  }

  return (
    <div className="space-y-4">
      {pairs.map((pair, i) => (
        <div key={i} className="rounded-lg border border-neutral-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-neutral-500">Example {i + 1}</span>
            {pairs.length > 1 && (
              <button
                type="button"
                onClick={() => removeRow(i)}
                className="text-neutral-400 hover:text-red-600"
                disabled={isPending}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>

          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Clip Title</label>
              <input
                type="text"
                value={pair.title}
                onChange={(e) => updatePair(i, 'title', e.target.value)}
                placeholder="e.g. Ruined by the Goddess"
                disabled={isPending}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium">Published Description</label>
              <textarea
                value={pair.description}
                onChange={(e) => updatePair(i, 'description', e.target.value)}
                rows={3}
                placeholder="Paste the exact description you published with this clip."
                disabled={isPending}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium">
                Tags <span className="text-neutral-400">(optional, comma-separated)</span>
              </label>
              <input
                type="text"
                value={pair.tags}
                onChange={(e) => updatePair(i, 'tags', e.target.value)}
                placeholder="chastity, tease, findom"
                disabled={isPending}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              />
            </div>
          </div>
        </div>
      ))}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={addRow}
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-50"
        >
          <Plus size={14} />
          Add another
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {isPending && <Loader2 size={14} className="animate-spin" />}
          {isPending ? 'Saving...' : 'Save Examples'}
        </button>
      </div>

      {result && (
        <div className="text-sm">
          {result.added > 0 && (
            <p className="text-green-600">Added {result.added} example{result.added === 1 ? '' : 's'}.</p>
          )}
          {result.errors.length > 0 && (
            <ul className="mt-1 text-xs text-red-600">
              {result.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
