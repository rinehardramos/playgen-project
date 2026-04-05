'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { api } from '@/lib/api';

interface Station {
  id: string;
  name: string;
}

interface Shoutout {
  id: string;
  station_id: string;
  listener_name: string | null;
  message: string;
  platform: string | null;
  status: 'pending' | 'used' | 'dismissed';
  submitted_by_email: string;
  created_at: string;
}

export default function ShoutoutsPage() {
  const router = useRouter();
  const [stations, setStations] = useState<Station[]>([]);
  const [selectedStation, setSelectedStation] = useState('');
  const [shoutouts, setShoutouts] = useState<Shoutout[]>([]);
  const [formData, setFormData] = useState({ listener_name: '', message: '', platform: 'manual' });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    const user = getCurrentUser();
    if (!user) { router.push('/login'); return; }

    api.get<Station[]>('/api/v1/stations').then((data) => {
      setStations(data);
      if (data.length > 0) setSelectedStation(data[0].id);
    }).catch(() => setError('Failed to load stations')).finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    if (!selectedStation) return;
    api.get<Shoutout[]>(`/api/v1/dj/shoutouts?station_id=${selectedStation}`)
      .then(setShoutouts)
      .catch(() => {/* non-fatal */});
  }, [selectedStation]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formData.message.trim()) { setError('Message is required'); return; }
    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      await api.post('/api/v1/dj/shoutouts', {
        station_id: selectedStation,
        listener_name: formData.listener_name.trim() || undefined,
        message: formData.message.trim(),
        platform: formData.platform,
      });
      setSuccess('Shoutout queued! It will be included in the next DJ script generation.');
      setFormData({ listener_name: '', message: '', platform: 'manual' });
      // Refresh list
      const updated = await api.get<Shoutout[]>(`/api/v1/dj/shoutouts?station_id=${selectedStation}`);
      setShoutouts(updated);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to submit shoutout';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDismiss(id: string) {
    try {
      await api.patch(`/api/v1/dj/shoutouts/${id}`, { status: 'dismissed' });
      setShoutouts((prev) => prev.filter((s) => s.id !== id));
    } catch {
      setError('Failed to dismiss shoutout');
    }
  }

  if (loading) return <div className="p-8 text-gray-400">Loading…</div>;

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Listener Shoutouts</h1>
        <p className="text-gray-400 mt-1">
          Submit listener messages for the AI DJ to reference in the next script generation.
        </p>
      </div>

      {/* Station selector */}
      {stations.length > 1 && (
        <div>
          <label className="block text-sm text-gray-300 mb-1">Station</label>
          <select
            value={selectedStation}
            onChange={(e) => setSelectedStation(e.target.value)}
            className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white"
          >
            {stations.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Submission form */}
      <form onSubmit={handleSubmit} className="bg-gray-800 rounded-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold text-white">Add Shoutout</h2>

        {error && <p className="text-red-400 text-sm">{error}</p>}
        {success && <p className="text-green-400 text-sm">{success}</p>}

        <div>
          <label className="block text-sm text-gray-300 mb-1">Listener Name <span className="text-gray-500">(optional)</span></label>
          <input
            type="text"
            value={formData.listener_name}
            onChange={(e) => setFormData((f) => ({ ...f, listener_name: e.target.value }))}
            placeholder="e.g. Maria from Quezon City"
            className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white placeholder-gray-500"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-300 mb-1">Message <span className="text-red-400">*</span></label>
          <textarea
            value={formData.message}
            onChange={(e) => setFormData((f) => ({ ...f, message: e.target.value }))}
            rows={3}
            placeholder="e.g. Love the morning show! Keep up the great music!"
            className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white placeholder-gray-500 resize-none"
            required
          />
        </div>

        <div>
          <label className="block text-sm text-gray-300 mb-1">Platform</label>
          <select
            value={formData.platform}
            onChange={(e) => setFormData((f) => ({ ...f, platform: e.target.value }))}
            className="bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
          >
            <option value="manual">Manual entry</option>
            <option value="facebook">Facebook</option>
            <option value="twitter">X / Twitter</option>
            <option value="instagram">Instagram</option>
          </select>
        </div>

        <button
          type="submit"
          disabled={submitting || !selectedStation}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded font-medium transition-colors"
        >
          {submitting ? 'Submitting…' : 'Queue Shoutout'}
        </button>
      </form>

      {/* Pending shoutouts list */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-3">
          Pending Shoutouts <span className="text-gray-400 text-sm font-normal">({shoutouts.length})</span>
        </h2>
        {shoutouts.length === 0 ? (
          <p className="text-gray-500 text-sm">No pending shoutouts. Add one above!</p>
        ) : (
          <ul className="space-y-3">
            {shoutouts.map((s) => (
              <li key={s.id} className="bg-gray-800 rounded-lg p-4 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {s.listener_name && (
                      <span className="text-white font-medium text-sm">{s.listener_name}</span>
                    )}
                    {s.platform && s.platform !== 'manual' && (
                      <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded capitalize">{s.platform}</span>
                    )}
                  </div>
                  <p className="text-gray-300 text-sm">{s.message}</p>
                  <p className="text-gray-500 text-xs mt-1">by {s.submitted_by_email} · {new Date(s.created_at).toLocaleDateString()}</p>
                </div>
                <button
                  onClick={() => handleDismiss(s.id)}
                  className="text-gray-500 hover:text-red-400 text-xs transition-colors shrink-0"
                >
                  Dismiss
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
