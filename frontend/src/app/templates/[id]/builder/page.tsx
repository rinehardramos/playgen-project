'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { api } from '@/lib/api';
import type { ApiError } from '@/lib/api';

type TemplateType = '1_day' | '3_hour' | '4_hour';

interface Template {
  id: string;
  name: string;
  type: TemplateType;
  station_id: string;
  is_default: boolean;
}

interface Category {
  id: string;
  label: string;
  color_tag?: string;
}

interface TemplateSlot {
  hour: number;
  position: number;
  required_category_id: string | null;
}

interface TemplateWithSlots extends Template {
  slots: TemplateSlot[];
}

const DAYS_OF_WEEK = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
] as const;
type DayKey = typeof DAYS_OF_WEEK[number];
type DayOverrides = Record<DayKey, string | null>;

const EMPTY_OVERRIDES: DayOverrides = {
  monday: null, tuesday: null, wednesday: null, thursday: null,
  friday: null, saturday: null, sunday: null,
};

const CATEGORY_COLORS = [
  'bg-violet-900/40 text-violet-300 border-violet-500/30',
  'bg-blue-900/40 text-blue-300 border-blue-500/30',
  'bg-green-900/40 text-green-300 border-green-500/30',
  'bg-yellow-900/40 text-yellow-300 border-yellow-500/30',
  'bg-pink-900/40 text-pink-300 border-pink-500/30',
  'bg-orange-900/40 text-orange-300 border-orange-500/30',
  'bg-teal-900/40 text-teal-300 border-teal-500/30',
  'bg-red-900/40 text-red-300 border-red-500/30',
];

const POSITIONS = [1, 2, 3, 4];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

function formatHour(h: number): string {
  if (h === 0) return '12 AM';
  if (h < 12) return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
}

function slotKey(hour: number, position: number) {
  return `${hour}-${position}`;
}

export default function TemplateBuilderPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const templateId = params.id;
  const currentUser = getCurrentUser();

  const [template, setTemplate] = useState<Template | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  // Map of "hour-position" → category_id | null
  const [slots, setSlots] = useState<Map<string, string | null>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [openCell, setOpenCell] = useState<string | null>(null);

  // Day-of-week overrides state
  const [dayOverrides, setDayOverrides] = useState<DayOverrides>(EMPTY_OVERRIDES);
  const [stationTemplates, setStationTemplates] = useState<Template[]>([]);
  const [overridesSaving, setOverridesSaving] = useState(false);
  const [overridesSaved, setOverridesSaved] = useState(false);

  const categoryColorMap = new Map<string, string>();
  categories.forEach((c, idx) => {
    categoryColorMap.set(c.id, CATEGORY_COLORS[idx % CATEGORY_COLORS.length]);
  });

  useEffect(() => {
    if (!currentUser) {
      router.replace('/login');
      return;
    }
    fetchData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      // GET /templates/:id returns { ...template, slots: [...] }
      const tplWithSlots = await api.get<TemplateWithSlots>(`/api/v1/templates/${templateId}`);
      const { slots: rawSlots, ...tpl } = tplWithSlots;
      setTemplate(tpl);

      const [cats, allTpls, overridesRes] = await Promise.all([
        api.get<Category[]>(`/api/v1/stations/${tpl.station_id}/categories`),
        api.get<Template[]>(`/api/v1/stations/${tpl.station_id}/templates`),
        api.get<{ overrides: DayOverrides }>(`/api/v1/templates/${templateId}/day-overrides`),
      ]);
      setCategories(cats);
      setStationTemplates(allTpls.filter((t) => t.id !== templateId));
      setDayOverrides({ ...EMPTY_OVERRIDES, ...overridesRes.overrides });

      const map = new Map<string, string | null>();
      rawSlots.forEach((slot) => {
        map.set(slotKey(slot.hour, slot.position), slot.required_category_id);
      });
      setSlots(map);
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Failed to load template');
    } finally {
      setLoading(false);
    }
  }

  function setSlotCategory(hour: number, position: number, categoryId: string | null) {
    setSlots((prev) => {
      const next = new Map(prev);
      next.set(slotKey(hour, position), categoryId);
      return next;
    });
    setOpenCell(null);
  }

  async function handleSave() {
    setSaving(true);
    setSaveSuccess(false);
    setError(null);
    try {
      // Only send slots that have a category assigned
      const slotsPayload: Array<{ hour: number; position: number; required_category_id: string }> = [];
      HOURS.forEach((hour) => {
        POSITIONS.forEach((position) => {
          const categoryId = slots.get(slotKey(hour, position)) ?? null;
          if (categoryId) {
            slotsPayload.push({ hour, position, required_category_id: categoryId });
          }
        });
      });
      await api.put<void>(`/api/v1/templates/${templateId}/slots`, { slots: slotsPayload });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Failed to save template');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveOverrides() {
    setOverridesSaving(true);
    setOverridesSaved(false);
    setError(null);
    try {
      await api.put<{ overrides: DayOverrides }>(`/api/v1/templates/${templateId}/day-overrides`, dayOverrides);
      setOverridesSaved(true);
      setTimeout(() => setOverridesSaved(false), 3000);
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Failed to save day overrides');
    } finally {
      setOverridesSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-[#0b0b10]">
        <div className="w-10 h-10 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link href="/templates" className="text-sm text-gray-500 hover:text-gray-300 transition-colors">
            ← Templates
          </Link>
          <div>
            <h1 className="text-xl font-bold text-white">
              {template?.name ?? 'Template Builder'}
            </h1>
            {template && (
              <p className="text-xs text-gray-500 capitalize mt-0.5">
                {template.type.replace('_', ' ')} template
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {saveSuccess && (
            <span className="text-sm text-green-400 font-medium">Saved!</span>
          )}
          {error && (
            <span className="text-sm text-red-400">{error}</span>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Category legend */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-5">
          {categories.map((c) => (
            <span
              key={c.id}
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${categoryColorMap.get(c.id)}`}
            >
              {c.label}
            </span>
          ))}
        </div>
      )}

      {/* Day-of-week overrides section */}
      <div className="mb-6 bg-[#16161f] border border-[#2a2a40] rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-white">Day-of-Week Overrides</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Assign a different template to use on specific days. Leave blank to use this template.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {overridesSaved && <span className="text-xs text-green-400">Saved!</span>}
            <button
              onClick={handleSaveOverrides}
              disabled={overridesSaving}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50 transition-colors"
            >
              {overridesSaving ? 'Saving…' : 'Save Overrides'}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-2">
          {DAYS_OF_WEEK.map((day) => (
            <div key={day} className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-400 capitalize">{day.slice(0, 3)}</label>
              <select
                value={dayOverrides[day] ?? ''}
                onChange={(e) =>
                  setDayOverrides((prev) => ({
                    ...prev,
                    [day]: e.target.value === '' ? null : e.target.value,
                  }))
                }
                className="w-full rounded-lg bg-[#1c1c28] border border-[#2a2a40] text-gray-300 text-xs px-2 py-1.5 focus:outline-none focus:border-violet-500"
              >
                <option value="">— this template —</option>
                {stationTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>

      {/* Slot grid */}
      <div className="overflow-x-auto rounded-xl border border-[#2a2a40]">
        <table className="w-full text-sm text-left">
          <thead>
            <tr className="border-b border-[#2a2a40] bg-[#16161f]">
              <th className="px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase border-b border-[#2a2a40]">
                Hour
              </th>
              {POSITIONS.map((p) => (
                <th
                  key={p}
                  className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase border-b border-[#2a2a40]"
                >
                  Slot {p}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {HOURS.map((hour) => (
              <tr key={hour} className="border-b border-[#2a2a40] hover:bg-[#24243a]">
                <td className="px-3 py-2 text-xs text-gray-500 font-medium whitespace-nowrap">
                  {formatHour(hour)}
                </td>
                {POSITIONS.map((position) => {
                  const key = slotKey(hour, position);
                  const catId = slots.get(key) ?? null;
                  const cat = categories.find((c) => c.id === catId);
                  const colorClass = catId ? (categoryColorMap.get(catId) ?? '') : '';
                  const isOpen = openCell === key;

                  return (
                    <td key={position} className="px-2 py-1.5 text-center relative">
                      <button
                        onClick={() => setOpenCell(isOpen ? null : key)}
                        className={`inline-flex items-center justify-center min-w-[90px] px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                          cat
                            ? colorClass
                            : 'bg-[#1c1c28] text-gray-600 border-dashed border-[#2a2a40] hover:border-violet-500/50 hover:text-violet-400'
                        }`}
                      >
                        {cat ? cat.label : '+ Assign'}
                      </button>

                      {/* Dropdown */}
                      {isOpen && (
                        <div className="absolute z-20 top-full left-1/2 -translate-x-1/2 mt-1 w-48 bg-[#16161f] border border-[#2a2a40] rounded-xl shadow-2xl py-1">
                          <button
                            onClick={() => setSlotCategory(hour, position, null)}
                            className="w-full text-left px-3 py-1.5 text-xs text-gray-500 hover:bg-[#24243a] italic"
                          >
                            Clear
                          </button>
                          {categories.map((c) => (
                            <button
                              key={c.id}
                              onClick={() => setSlotCategory(hour, position, c.id)}
                              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[#24243a] ${
                                catId === c.id ? 'font-semibold' : ''
                              }`}
                            >
                              <span
                                className={`inline-block px-1.5 py-0.5 rounded border text-xs ${categoryColorMap.get(c.id)}`}
                              >
                                {c.label}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {openCell && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => setOpenCell(null)}
        />
      )}
    </div>
  );
}
