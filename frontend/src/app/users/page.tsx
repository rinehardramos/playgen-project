'use client';

import { useEffect, useState, FormEvent, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { api } from '@/lib/api';
import type { ApiError } from '@/lib/api';

interface User {
  id: string;
  display_name: string;
  email: string;
  role_id: string;
  role_label?: string;
  station_ids: string[];
  is_active: boolean;
}

interface Role {
  id: string;
  label: string;
}

interface Station {
  id: string;
  name: string;
}

interface UserFormData {
  display_name: string;
  email: string;
  password: string;
  role_id: string;
  station_ids: string[];
}

const EMPTY_FORM: UserFormData = {
  display_name: '',
  email: '',
  password: '',
  role_id: '',
  station_ids: [],
};

export default function UsersPage() {
  const router = useRouter();
  const currentUser = getCurrentUser();

  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formData, setFormData] = useState<UserFormData>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const companyId = currentUser?.company_id ?? '';

  useEffect(() => {
    if (!currentUser) {
      router.replace('/login');
      return;
    }
    fetchAll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function fetchAll() {
    setLoading(true);
    setError(null);
    try {
      const [usersData, rolesData] = await Promise.all([
        api.get<User[]>(`/api/v1/companies/${companyId}/users`),
        api.get<Role[]>(`/api/v1/companies/${companyId}/roles`),
      ]);
      setUsers(usersData);
      setRoles(rolesData);

      // Collect unique station ids to build station name map
      const stationSet = new Set(usersData.flatMap((u) => u.station_ids));
      if (stationSet.size > 0) {
        try {
          const stationsData = await api.get<Station[]>(`/api/v1/companies/${companyId}/stations`);
          setStations(stationsData);
        } catch {
          // non-critical
        }
      }
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }

  function openCreateModal() {
    setEditingUser(null);
    setFormData(EMPTY_FORM);
    setFormError(null);
    setModalOpen(true);
  }

  function openEditModal(user: User) {
    setEditingUser(user);
    setFormData({
      display_name: user.display_name,
      email: user.email,
      password: '',
      role_id: user.role_id,
      station_ids: user.station_ids,
    });
    setFormError(null);
    setModalOpen(true);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);

    try {
      if (editingUser) {
        const payload: Partial<UserFormData> = {
          display_name: formData.display_name,
          email: formData.email,
          role_id: formData.role_id,
          station_ids: formData.station_ids,
        };
        await api.put<User>(`/api/v1/users/${editingUser.id}`, payload);
      } else {
        await api.post<User>(`/api/v1/companies/${companyId}/users`, formData);
      }
      setModalOpen(false);
      await fetchAll();
    } catch (err: unknown) {
      setFormError((err as ApiError).message ?? 'Failed to save user');
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActive(user: User) {
    try {
      await api.put<User>(`/api/v1/users/${user.id}`, { is_active: !user.is_active });
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, is_active: !u.is_active } : u))
      );
    } catch (err: unknown) {
      alert((err as ApiError).message ?? 'Failed to update user status');
    }
  }

  function toggleStation(stationId: string) {
    setFormData((prev) => ({
      ...prev,
      station_ids: prev.station_ids.includes(stationId)
        ? prev.station_ids.filter((id) => id !== stationId)
        : [...prev.station_ids, stationId],
    }));
  }

  const stationMap = new Map(stations.map((s) => [s.id, s.name]));

  return (
    <div className="p-6 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl md:text-2xl font-bold text-white">Users</h1>
        <button
          onClick={openCreateModal}
          className="btn-primary inline-flex items-center"
        >
          + Create User
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-900/30 border border-red-700/50 px-4 py-3">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="min-w-full divide-y divide-[#2a2a40] text-sm">
            <thead className="bg-[#13131a]">
              <tr>
                {['Name', 'Email', 'Role', 'Stations', 'Status', 'Actions'].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2a2a40]">
              {users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-gray-600">
                    No users found.
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id} className="hover:bg-[#24243a] border-b border-[#2a2a40]">
                    <td className="px-4 py-3 font-medium text-white">{user.display_name}</td>
                    <td className="px-4 py-3 text-gray-400">{user.email}</td>
                    <td className="px-4 py-3 text-gray-400 capitalize">
                      {user.role_label ?? user.role_id}
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {user.station_ids.map((id) => stationMap.get(id) ?? id).join(', ') || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          user.is_active
                            ? 'bg-green-900/30 text-green-400'
                            : 'bg-gray-800 text-gray-500'
                        }`}
                      >
                        {user.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEditModal(user)}
                          className="text-violet-400 hover:text-violet-300 text-xs font-medium"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => toggleActive(user)}
                          className={`text-xs font-medium ${
                            user.is_active
                              ? 'text-red-400 hover:text-red-300'
                              : 'text-green-400 hover:text-green-300'
                          }`}
                        >
                          {user.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* User Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md bg-[#16161f] border border-[#2a2a40] rounded-2xl shadow-2xl p-6">
            <h2 className="text-base font-semibold text-white mb-4">
              {editingUser ? 'Edit User' : 'Create User'}
            </h2>

            {formError && (
              <div className="mb-4 rounded-md bg-red-900/30 border border-red-700/50 px-4 py-3">
                <p className="text-sm text-red-400">{formError}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1.5">Display Name</label>
                <input
                  type="text"
                  required
                  value={formData.display_name}
                  onChange={(e) => setFormData((p) => ({ ...p, display_name: e.target.value }))}
                  className="input w-full"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1.5">Email</label>
                <input
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData((p) => ({ ...p, email: e.target.value }))}
                  className="input w-full"
                />
              </div>

              {!editingUser && (
                <div>
                  <label className="block text-sm text-gray-400 mb-1.5">Password</label>
                  <input
                    type="password"
                    required={!editingUser}
                    value={formData.password}
                    onChange={(e) => setFormData((p) => ({ ...p, password: e.target.value }))}
                    className="input w-full"
                  />
                </div>
              )}

              <div>
                <label className="block text-sm text-gray-400 mb-1.5">Role</label>
                <select
                  required
                  value={formData.role_id}
                  onChange={(e) => setFormData((p) => ({ ...p, role_id: e.target.value }))}
                  className="input w-full"
                >
                  <option value="">Select a role…</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>

              {stations.length > 0 && (
                <div>
                  <label className="block text-sm text-gray-400 mb-2">Stations</label>
                  <div className="space-y-1 max-h-36 overflow-y-auto border border-[#2a2a40] rounded-md p-2 bg-[#13131a]">
                    {stations.map((s) => (
                      <label key={s.id} className="flex items-center gap-2 cursor-pointer text-sm text-gray-300">
                        <input
                          type="checkbox"
                          checked={formData.station_ids.includes(s.id)}
                          onChange={() => toggleStation(s.id)}
                          className="rounded border-[#2a2a40] text-violet-600 focus:ring-violet-500 bg-[#24243a]"
                        />
                        {s.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn-primary disabled:opacity-50"
                >
                  {submitting ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
