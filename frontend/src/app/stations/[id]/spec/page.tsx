'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';

export default function StationSpecPage() {
  const params = useParams<{ id: string }>();
  const stationId = params.id;

  const [specYaml, setSpecYaml] = useState<string>('');
  const [draft, setDraft] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const fetchSpec = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? ''}/api/v1/stations/${stationId}/spec`,
        {
          headers: {
            Authorization: `Bearer ${
              typeof window !== 'undefined'
                ? sessionStorage.getItem('playgen_token') ?? ''
                : ''
            }`,
          },
        },
      );
      if (!res.ok) throw new Error(`Failed to load spec (${res.status})`);
      const text = await res.text();
      setSpecYaml(text);
      setDraft(text);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [stationId]);

  useEffect(() => {
    fetchSpec();
  }, [fetchSpec]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);
    setValidationError(null);
    try {
      await apiFetch(`/api/v1/stations/${stationId}/spec`, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/plain' },
        body: draft,
      });
      setSpecYaml(draft);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('VALIDATION_ERROR') || msg.includes('Invalid spec')) {
        setValidationError(msg);
      } else {
        setError(msg);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleExportJson = async () => {
    try {
      const data = await apiFetch<object>(`/api/v1/stations/${stationId}/spec?format=json`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `station-${stationId}-spec.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleExportYaml = () => {
    const blob = new Blob([specYaml], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `station-${stationId}-spec.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isDirty = draft !== specYaml;

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-zinc-100">Station Spec</h2>
        <p className="text-sm text-zinc-400 mt-1">
          Declarative blueprint for this station — like CLAUDE.md but for stations. Edit the YAML
          to change DJ personalities, script rules, and music guidelines. Changes take effect on
          the next pipeline run.
        </p>
      </div>

      {loading ? (
        <div className="text-sm text-zinc-500">Loading spec…</div>
      ) : error ? (
        <div className="rounded-md bg-red-900/30 border border-red-700/50 p-4 text-sm text-red-300">
          {error}
        </div>
      ) : (
        <>
          {/* Toolbar */}
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={handleSave}
              disabled={saving || !isDirty}
              className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-md transition-colors"
            >
              {saving ? 'Applying…' : 'Apply Spec'}
            </button>
            <button
              onClick={() => setDraft(specYaml)}
              disabled={!isDirty}
              className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-200 text-sm rounded-md transition-colors"
            >
              Discard
            </button>
            <div className="flex-1" />
            <button
              onClick={handleExportYaml}
              className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs rounded-md transition-colors"
            >
              Export YAML
            </button>
            <button
              onClick={handleExportJson}
              className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs rounded-md transition-colors"
            >
              Export JSON
            </button>
          </div>

          {/* Feedback banners */}
          {success && (
            <div className="mb-3 rounded-md bg-emerald-900/30 border border-emerald-700/50 p-3 text-sm text-emerald-300">
              Spec applied successfully. Changes will take effect on the next pipeline run.
            </div>
          )}
          {validationError && (
            <div className="mb-3 rounded-md bg-amber-900/30 border border-amber-700/50 p-3 text-sm text-amber-300 font-mono">
              {validationError}
            </div>
          )}

          {/* Editor */}
          <div className="relative">
            <textarea
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setValidationError(null);
              }}
              spellCheck={false}
              className="w-full h-[600px] rounded-md border border-zinc-700 bg-zinc-900 text-zinc-100 text-xs font-mono p-4 resize-y focus:outline-none focus:ring-1 focus:ring-violet-500 leading-relaxed"
              placeholder="# Station Spec v1&#10;name: My Station&#10;callsign: MYFC&#10;..."
            />
            {isDirty && (
              <span className="absolute top-3 right-3 text-[10px] text-amber-400 font-medium">
                unsaved changes
              </span>
            )}
          </div>

          <p className="mt-3 text-xs text-zinc-500">
            Accepts YAML or JSON. Only fields present in the spec are updated — omitted fields are
            left unchanged. DJ personas and programs are upserted by name.
          </p>
        </>
      )}
    </div>
  );
}
