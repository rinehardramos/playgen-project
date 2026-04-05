'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { api } from '@/lib/api';

interface Station {
  id: string;
  name: string;
}

interface Template {
  id: string;
  name: string;
}

const ALL_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_LABELS: Record<string, string> = {
  monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu',
  friday: 'Fri', saturday: 'Sat', sunday: 'Sun',
};

const PROGRAM_COLORS = [
  '#7c3aed', '#2563eb', '#059669', '#d97706',
  '#dc2626', '#db2777', '#0891b2', '#65a30d',
];

function formatHour(h: number): string {
  if (h === 0) return '12:00 AM (midnight)';
  if (h === 24) return '12:00 AM (next day)';
  if (h === 12) return '12:00 PM (noon)';
  return h < 12 ? `${h}:00 AM` : `${h - 12}:00 PM`;
}

const HOURS = Array.from({ length: 25 }, (_, i) => i);

export default function NewProgramPage() {
  const router = useRouter();
  const [stations, setStations] = useState<Station[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedStation, setSelectedStation] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [activeDays, setActiveDays] = useState<string[]>(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']);
  const [startHour, setStartHour] = useState(6);
  const [endHour, setEndHour] = useState(10);
  const [templateId, setTemplateId] = useState('');
  const [colorTag, setColorTag] = useState(PROGRAM_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const user = getCurrentUser();
    if (!user) { router.push('/login'); return; }
    api.get<unknown>(`/api/v1/companies/${user.company_id}/stations`)
      .then((data: unknown) => {
        const list = data as Station[];
        setStations(list);
        if (list.length > 0) setSelectedStation(list[0].id);
      })
      .catch(() => {});
  }, [router]);

  useEffect(() => {
    if (!selectedStation) return;
    api.get<unknown>(`/api/v1/stations/${selectedStation}/templates`)
      .then((data: unknown) => setTemplates(data as Template[]))
      .catch(() => setTemplates([]));
  }, [selectedStation]);

  function toggleDay(day: string) {
    setActiveDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('Program name is required'); return; }
    if (!selectedStation) { setError('Please select a station'); return; }
    if (startHour >= endHour) { setError('End time must be after start time'); return; }
    setSaving(true);
    setError('');
    try {
      const program = await api.post<unknown>(`/api/v1/stations/${selectedStation}/programs`, {
        name: name.trim(),
        description: description.trim() || null,
        active_days: activeDays,
        start_hour: startHour,
        end_hour: endHour,
        template_id: templateId || null,
        color_tag: colorTag,
      }) as { id: string };
      router.push(`/programs/${program.id}/clock`);
    } catch (err: unknown) {
      const apiErr = err as { message?: string };
      setError(apiErr?.message ?? 'Failed to create program');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/programs" className="text-gray-500 hover:text-gray-300 transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/>
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-white">New Program</h1>
          <p className="text-gray-500 text-sm mt-0.5">Define a recurring show and its broadcast schedule</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Station */}
        {stations.length > 1 && (
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Station</label>
            <select
              value={selectedStation}
              onChange={e => setSelectedStation(e.target.value)}
              className="w-full bg-[#1a1a2e] border border-[#2a2a40] text-gray-300 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500"
            >
              {stations.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Name + Color */}
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1.5">Program Name</label>
          <div className="flex gap-3">
            <div className="flex gap-1.5 items-center">
              {PROGRAM_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColorTag(c)}
                  className={`w-6 h-6 rounded-full border-2 transition-all ${colorTag === c ? 'border-white scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Morning Rush, Afternoon Drive"
              className="flex-1 bg-[#1a1a2e] border border-[#2a2a40] text-gray-300 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500 placeholder-gray-700"
            />
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1.5">
            Description <span className="text-gray-600 font-normal">(optional)</span>
          </label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={2}
            placeholder="Briefly describe the show's format or audience"
            className="w-full bg-[#1a1a2e] border border-[#2a2a40] text-gray-300 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500 placeholder-gray-700 resize-none"
          />
        </div>

        {/* Active Days */}
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1.5">Airs On</label>
          <div className="flex gap-2">
            {ALL_DAYS.map(day => (
              <button
                key={day}
                type="button"
                onClick={() => toggleDay(day)}
                className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-colors ${
                  activeDays.includes(day)
                    ? 'border-violet-500/40 bg-violet-600/20 text-violet-300'
                    : 'border-[#2a2a40] text-gray-600 hover:text-gray-400'
                }`}
              >
                {DAY_LABELS[day]}
              </button>
            ))}
          </div>
        </div>

        {/* Time Slot */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Start Time</label>
            <select
              value={startHour}
              onChange={e => setStartHour(Number(e.target.value))}
              className="w-full bg-[#1a1a2e] border border-[#2a2a40] text-gray-300 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500"
            >
              {HOURS.slice(0, 24).map(h => (
                <option key={h} value={h}>{formatHour(h)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">End Time</label>
            <select
              value={endHour}
              onChange={e => setEndHour(Number(e.target.value))}
              className="w-full bg-[#1a1a2e] border border-[#2a2a40] text-gray-300 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500"
            >
              {HOURS.slice(1).map(h => (
                <option key={h} value={h}>{formatHour(h)}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Music Template */}
        {templates.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">
              Music Template <span className="text-gray-600 font-normal">(optional)</span>
            </label>
            <select
              value={templateId}
              onChange={e => setTemplateId(e.target.value)}
              className="w-full bg-[#1a1a2e] border border-[#2a2a40] text-gray-300 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500"
            >
              <option value="">Use station default template</option>
              {templates.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <p className="text-gray-600 text-xs mt-1">The music rotation template used to schedule songs for episodes of this program.</p>
          </div>
        )}

        {error && (
          <p className="text-red-400 text-sm">{error}</p>
        )}

        <div className="flex gap-3 pt-2">
          <Link
            href="/programs"
            className="flex-1 text-center bg-[#1a1a2e] hover:bg-[#252540] border border-[#2a2a40] text-gray-300 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
          >
            {saving ? 'Creating…' : 'Create & Set Up Clock'}
          </button>
        </div>
      </form>
    </div>
  );
}
