'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { api } from '@/lib/api';
import type { ApiError } from '@/lib/api';

// ── Permission Definitions ──────────────────────────────────────────────────

interface PermissionCategory {
  label: string;
  permissions: { code: string; label: string }[];
}

const PERMISSION_CATEGORIES: PermissionCategory[] = [
  {
    label: 'Administration',
    permissions: [
      { code: 'company:read', label: 'View Company' },
      { code: 'company:write', label: 'Edit Company' },
      { code: 'users:read', label: 'View Users' },
      { code: 'users:write', label: 'Manage Users' },
      { code: 'users:invite', label: 'Invite Users' },
      { code: 'roles:read', label: 'View Roles' },
      { code: 'roles:write', label: 'Manage Roles' },
      { code: 'billing:read', label: 'View Billing' },
      { code: 'billing:write', label: 'Manage Billing' },
    ],
  },
  {
    label: 'Station',
    permissions: [
      { code: 'station:read', label: 'View Stations' },
      { code: 'station:write', label: 'Edit Stations' },
      { code: 'station:create', label: 'Create Stations' },
      { code: 'station:delete', label: 'Delete Stations' },
      { code: 'settings:read', label: 'View Settings' },
      { code: 'settings:write', label: 'Edit Settings' },
    ],
  },
  {
    label: 'Library',
    permissions: [
      { code: 'library:read', label: 'View Library' },
      { code: 'library:write', label: 'Edit Library' },
      { code: 'library:delete', label: 'Delete Songs' },
    ],
  },
  {
    label: 'Programming',
    permissions: [
      { code: 'template:read', label: 'View Templates' },
      { code: 'template:write', label: 'Edit Templates' },
      { code: 'rules:read', label: 'View Rules' },
      { code: 'rules:write', label: 'Edit Rules' },
    ],
  },
  {
    label: 'Playlists',
    permissions: [
      { code: 'playlist:read', label: 'View Playlists' },
      { code: 'playlist:write', label: 'Edit Playlists' },
      { code: 'playlist:approve', label: 'Approve Playlists' },
      { code: 'playlist:export', label: 'Export Playlists' },
    ],
  },
  {
    label: 'Analytics',
    permissions: [
      { code: 'analytics:read', label: 'View Analytics' },
      { code: 'analytics:export', label: 'Export Analytics' },
    ],
  },
  {
    label: 'DJ',
    permissions: [
      { code: 'dj:read', label: 'View DJ' },
      { code: 'dj:write', label: 'Edit DJ' },
      { code: 'dj:approve', label: 'Approve DJ Scripts' },
      { code: 'dj:config', label: 'Configure DJ' },
    ],
  },
];

const ALL_PERMISSIONS = PERMISSION_CATEGORIES.flatMap((c) => c.permissions.map((p) => p.code));

// ── Types ────────────────────────────────────────────────────────────────────

interface Role {
  id: string;
  code: string;
  label: string;
  description?: string;
  permissions: string[];
  is_system: boolean;
  is_template: boolean;
}

type RoleType = 'system' | 'template' | 'custom';

function roleType(role: Role): RoleType {
  if (role.is_system) return 'system';
  if (role.is_template) return 'template';
  return 'custom';
}

const ROLE_BADGE: Record<RoleType, string> = {
  system: 'bg-red-900/40 text-red-300 border border-red-700/40',
  template: 'bg-blue-900/40 text-blue-300 border border-blue-700/40',
  custom: 'bg-green-900/40 text-green-300 border border-green-700/40',
};

const ROLE_BADGE_LABELS: Record<RoleType, string> = {
  system: 'System',
  template: 'Template',
  custom: 'Custom',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function deriveCode(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

// ── Sub-components ───────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex justify-center py-16">
      <div className="w-7 h-7 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-lg bg-[#16161f] border border-[#2a2a40] rounded-xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a40]">
          <h2 className="text-white font-semibold text-base">{title}</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

// ── New Role Modal ────────────────────────────────────────────────────────────

interface NewRoleModalProps {
  companyId: string;
  onCreated: (role: Role) => void;
  onClose: () => void;
}

function NewRoleModal({ companyId, onCreated, onClose }: NewRoleModalProps) {
  const [label, setLabel] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [selectedPerms, setSelectedPerms] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codeManual, setCodeManual] = useState(false);

  function handleLabelChange(val: string) {
    setLabel(val);
    if (!codeManual) setCode(deriveCode(val));
  }

  function togglePerm(perm: string) {
    setSelectedPerms((prev) => {
      const next = new Set(prev);
      if (next.has(perm)) next.delete(perm);
      else next.add(perm);
      return next;
    });
  }

  function toggleCategory(cat: PermissionCategory) {
    const allSelected = cat.permissions.every((p) => selectedPerms.has(p.code));
    setSelectedPerms((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        cat.permissions.forEach((p) => next.delete(p.code));
      } else {
        cat.permissions.forEach((p) => next.add(p.code));
      }
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const created = await api.post<Role>(`/api/v1/companies/${companyId}/roles`, {
        code,
        label,
        description: description || undefined,
        permissions: Array.from(selectedPerms),
      });
      onCreated(created);
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Failed to create role');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Create New Role" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Role Name</label>
          <input
            type="text"
            required
            value={label}
            onChange={(e) => handleLabelChange(e.target.value)}
            className="input w-full"
            placeholder="e.g. Content Editor"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Role Code
            <span className="ml-1 text-xs text-gray-500">(used internally)</span>
          </label>
          <input
            type="text"
            required
            value={code}
            onChange={(e) => { setCode(e.target.value); setCodeManual(true); }}
            className="input w-full font-mono text-xs"
            placeholder="content_editor"
            pattern="[a-z0-9_]+"
            title="Lowercase letters, digits, and underscores only"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Description
            <span className="ml-1 text-xs text-gray-500">(optional)</span>
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="input w-full resize-none"
            rows={2}
            placeholder="Brief description of this role's purpose"
          />
        </div>

        {/* Permission picker */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-300">Permissions</label>
            <button
              type="button"
              onClick={() =>
                setSelectedPerms(
                  selectedPerms.size === ALL_PERMISSIONS.length
                    ? new Set()
                    : new Set(ALL_PERMISSIONS)
                )
              }
              className="text-xs text-violet-400 hover:text-violet-300"
            >
              {selectedPerms.size === ALL_PERMISSIONS.length ? 'Deselect all' : 'Select all'}
            </button>
          </div>
          <div className="border border-[#2a2a40] rounded-lg divide-y divide-[#2a2a40] max-h-64 overflow-y-auto">
            {PERMISSION_CATEGORIES.map((cat) => {
              const allSelected = cat.permissions.every((p) => selectedPerms.has(p.code));
              const someSelected = cat.permissions.some((p) => selectedPerms.has(p.code));
              return (
                <div key={cat.label}>
                  <button
                    type="button"
                    onClick={() => toggleCategory(cat)}
                    className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-[#1e1e2e] transition-colors"
                  >
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                      {cat.label}
                    </span>
                    <span
                      className={`text-xs ${
                        allSelected
                          ? 'text-violet-400'
                          : someSelected
                          ? 'text-violet-500/60'
                          : 'text-gray-600'
                      }`}
                    >
                      {allSelected ? 'All' : someSelected ? 'Some' : 'None'}
                    </span>
                  </button>
                  <div className="px-3 pb-2 grid grid-cols-2 gap-1">
                    {cat.permissions.map((perm) => (
                      <label
                        key={perm.code}
                        className="flex items-center gap-2 cursor-pointer group"
                      >
                        <input
                          type="checkbox"
                          checked={selectedPerms.has(perm.code)}
                          onChange={() => togglePerm(perm.code)}
                          className="accent-violet-500 w-3.5 h-3.5 rounded"
                        />
                        <span className="text-xs text-gray-400 group-hover:text-gray-200 transition-colors">
                          {perm.label}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-gray-600 mt-1.5">
            {selectedPerms.size} / {ALL_PERMISSIONS.length} permissions selected
          </p>
        </div>

        {error && (
          <div className="rounded-md bg-red-900/30 border border-red-700/50 px-3 py-2">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="btn-primary flex-1 disabled:opacity-50">
            {saving ? 'Creating…' : 'Create Role'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Clone Template Modal ─────────────────────────────────────────────────────

interface CloneModalProps {
  companyId: string;
  templates: Role[];
  onCreated: (role: Role) => void;
  onClose: () => void;
}

function CloneTemplateModal({ companyId, templates, onCreated, onClose }: CloneModalProps) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!templateId) return;
    setSaving(true);
    setError(null);
    try {
      const created = await api.post<Role>(`/api/v1/companies/${companyId}/roles/clone`, {
        template_role_id: templateId,
        label,
        modifications: { add: [], remove: [] },
      });
      onCreated(created);
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Failed to clone template');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Clone Template Role" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Template Role</label>
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="input w-full"
            required
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">New Role Name</label>
          <input
            type="text"
            required
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="input w-full"
            placeholder="e.g. Senior Programmer"
          />
        </div>
        <p className="text-xs text-gray-500">
          The new role will inherit all permissions from the selected template. You can edit
          permissions after creation.
        </p>

        {error && (
          <div className="rounded-md bg-red-900/30 border border-red-700/50 px-3 py-2">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">
            Cancel
          </button>
          <button type="submit" disabled={saving || !templateId} className="btn-primary flex-1 disabled:opacity-50">
            {saving ? 'Cloning…' : 'Clone Template'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Delete Confirm Modal ─────────────────────────────────────────────────────

interface DeleteModalProps {
  role: Role;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

function DeleteModal({ role, onConfirm, onClose }: DeleteModalProps) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err: unknown) {
      const msg = (err as ApiError).message ?? 'Failed to delete role';
      setError(msg);
      setDeleting(false);
    }
  }

  return (
    <Modal title="Delete Role" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-gray-300">
          Are you sure you want to delete the role{' '}
          <strong className="text-white">{role.label}</strong>? This action cannot be undone.
        </p>
        <p className="text-xs text-gray-500">
          Note: Deletion will fail if any users are currently assigned this role.
        </p>
        {error && (
          <div className="rounded-md bg-red-900/30 border border-red-700/50 px-3 py-2">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}
        <div className="flex gap-3">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-500 text-white transition-colors disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : 'Delete Role'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function RolesPage() {
  const router = useRouter();
  const currentUser = getCurrentUser();
  const companyId = currentUser?.company_id ?? '';
  const canWrite = true; // will be narrowed via roles:write check below

  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [showNewRole, setShowNewRole] = useState(false);
  const [showClone, setShowClone] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null);

  // Saving state per role (maps roleId -> boolean)
  const [savingMap, setSavingMap] = useState<Record<string, boolean>>({});
  // Error state per role
  const [errorMap, setErrorMap] = useState<Record<string, string>>({});

  // Debounce timers for auto-save
  const debounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Check if current user has roles:write
  // getCurrentUser returns role_code but not the permission set, so we rely on
  // the fetched roles list to find the current user's permissions.
  // For now we check if their role_code starts with 'super_admin' or 'company_admin' as a fallback,
  // but also check against the loaded roles.
  const [hasWritePermission, setHasWritePermission] = useState(false);

  useEffect(() => {
    if (!currentUser) {
      router.replace('/login');
      return;
    }
    fetchRoles();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchRoles() {
    setLoading(true);
    setFetchError(null);
    try {
      const result = await api.get<Role[]>(`/api/v1/companies/${companyId}/roles`);
      // Sort: system first, then templates, then custom
      const sorted = [...result].sort((a, b) => {
        const order = (r: Role) => (r.is_system ? 0 : r.is_template ? 1 : 2);
        return order(a) - order(b);
      });
      setRoles(sorted);

      // Check write permission: find the current user's role in the fetched list
      const myRole = sorted.find(
        (r) => r.code === currentUser?.role_code
      );
      setHasWritePermission(
        myRole?.permissions.includes('roles:write') ?? false
      );
    } catch (err: unknown) {
      setFetchError((err as ApiError).message ?? 'Failed to load roles');
    } finally {
      setLoading(false);
    }
  }

  const handlePermissionToggle = useCallback(
    (role: Role, permCode: string) => {
      if (!canWrite) return;
      if (role.is_system || role.is_template) return;

      const hasPermission = role.permissions.includes(permCode);
      const newPermissions = hasPermission
        ? role.permissions.filter((p) => p !== permCode)
        : [...role.permissions, permCode];

      // Optimistic update
      setRoles((prev) =>
        prev.map((r) =>
          r.id === role.id ? { ...r, permissions: newPermissions } : r
        )
      );

      // Clear existing debounce for this role
      if (debounceRef.current[role.id]) {
        clearTimeout(debounceRef.current[role.id]);
      }

      // Debounce the save by 800ms
      debounceRef.current[role.id] = setTimeout(async () => {
        setSavingMap((prev) => ({ ...prev, [role.id]: true }));
        setErrorMap((prev) => ({ ...prev, [role.id]: '' }));
        try {
          await api.put(`/api/v1/roles/${role.id}`, { permissions: newPermissions });
        } catch (err: unknown) {
          const msg = (err as ApiError).message ?? 'Failed to save';
          setErrorMap((prev) => ({ ...prev, [role.id]: msg }));
          // Revert optimistic update on failure
          setRoles((prev) =>
            prev.map((r) => (r.id === role.id ? role : r))
          );
        } finally {
          setSavingMap((prev) => ({ ...prev, [role.id]: false }));
        }
      }, 800);
    },
    [canWrite]
  );

  async function handleDeleteRole(role: Role) {
    await api.delete(`/api/v1/roles/${role.id}`);
    setRoles((prev) => prev.filter((r) => r.id !== role.id));
    setDeleteTarget(null);
  }

  function handleRoleCreated(role: Role) {
    setRoles((prev) => {
      const next = [...prev, role];
      return next.sort((a, b) => {
        const order = (r: Role) => (r.is_system ? 0 : r.is_template ? 1 : 2);
        return order(a) - order(b);
      });
    });
    setShowNewRole(false);
    setShowClone(false);
  }

  const templateRoles = roles.filter((r) => r.is_template);
  const customRoles = roles.filter((r) => !r.is_system && !r.is_template);

  // The matrix columns are all roles in order
  const matrixRoles = roles;

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-white">Roles &amp; Permissions</h1>
          <p className="mt-1 text-sm text-gray-500">
            View and manage permission sets for your organization
          </p>
        </div>

        {hasWritePermission && (
          <div className="flex gap-2 flex-shrink-0">
            {templateRoles.length > 0 && (
              <button
                onClick={() => setShowClone(true)}
                className="btn-secondary flex items-center gap-2 text-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Clone Template
              </button>
            )}
            <button
              onClick={() => setShowNewRole(true)}
              className="btn-primary flex items-center gap-2 text-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Role
            </button>
          </div>
        )}
      </div>

      {fetchError && (
        <div className="mb-4 rounded-md bg-red-900/30 border border-red-700/50 px-4 py-3">
          <p className="text-sm text-red-400">{fetchError}</p>
          <button
            onClick={fetchRoles}
            className="mt-1 text-xs text-red-300 underline hover:text-red-200"
          >
            Try again
          </button>
        </div>
      )}

      {loading ? (
        <Spinner />
      ) : roles.length === 0 ? (
        <div className="py-16 text-center text-gray-600 text-sm">
          No roles found for this company.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#2a2a40]">
          <table className="w-full text-sm" style={{ minWidth: `${220 + matrixRoles.length * 80}px` }}>
            <thead>
              <tr className="bg-[#13131a] border-b border-[#2a2a40]">
                {/* First column: permission name */}
                <th className="sticky left-0 z-10 bg-[#13131a] px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-52">
                  Permission
                </th>
                {matrixRoles.map((role) => {
                  const rType = roleType(role);
                  const isEditable = !role.is_system && !role.is_template;
                  return (
                    <th key={role.id} className="px-2 py-3 text-center min-w-[80px]">
                      <div className="flex flex-col items-center gap-1.5">
                        <span className="text-white text-xs font-medium leading-tight max-w-[72px] truncate" title={role.label}>
                          {role.label}
                        </span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${ROLE_BADGE[rType]}`}>
                          {ROLE_BADGE_LABELS[rType]}
                        </span>
                        {hasWritePermission && isEditable && (
                          <div className="flex items-center gap-1 mt-0.5">
                            {savingMap[role.id] && (
                              <div className="w-3 h-3 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                            )}
                            <button
                              onClick={() => setDeleteTarget(role)}
                              title="Delete role"
                              className="text-gray-600 hover:text-red-400 transition-colors"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        )}
                        {errorMap[role.id] && (
                          <span className="text-[10px] text-red-400 max-w-[72px] text-center leading-tight">
                            Save failed
                          </span>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_CATEGORIES.map((cat) => (
                <>
                  {/* Category header row */}
                  <tr key={`cat-${cat.label}`} className="bg-[#0f0f18] border-t border-[#2a2a40]">
                    <td
                      colSpan={matrixRoles.length + 1}
                      className="sticky left-0 px-4 py-2 text-[11px] font-semibold text-gray-500 uppercase tracking-widest bg-[#0f0f18]"
                    >
                      {cat.label}
                    </td>
                  </tr>
                  {/* Permission rows */}
                  {cat.permissions.map((perm, idx) => (
                    <tr
                      key={perm.code}
                      className={`border-t border-[#1e1e2e] ${
                        idx % 2 === 0 ? 'bg-[#16161f]' : 'bg-[#13131a]'
                      } hover:bg-[#1a1a28] transition-colors`}
                    >
                      <td className="sticky left-0 z-10 px-4 py-2.5 bg-inherit">
                        <div>
                          <span className="text-gray-300 text-xs font-medium">{perm.label}</span>
                          <span className="ml-2 text-gray-600 text-[10px] font-mono">{perm.code}</span>
                        </div>
                      </td>
                      {matrixRoles.map((role) => {
                        const hasPerm = role.permissions.includes(perm.code);
                        const isEditable = !role.is_system && !role.is_template && hasWritePermission;
                        return (
                          <td key={role.id} className="px-2 py-2.5 text-center">
                            {isEditable ? (
                              <button
                                type="button"
                                onClick={() => handlePermissionToggle(role, perm.code)}
                                title={hasPerm ? 'Remove permission' : 'Grant permission'}
                                className={`w-5 h-5 rounded flex items-center justify-center mx-auto transition-all ${
                                  hasPerm
                                    ? 'bg-violet-600 hover:bg-violet-500'
                                    : 'bg-[#24243a] hover:bg-[#2e2e50] border border-[#2a2a40]'
                                }`}
                              >
                                {hasPerm && (
                                  <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                              </button>
                            ) : (
                              <div
                                className={`w-5 h-5 rounded flex items-center justify-center mx-auto ${
                                  hasPerm ? 'bg-violet-600/40' : 'bg-transparent'
                                }`}
                              >
                                {hasPerm && (
                                  <svg className="w-3 h-3 text-violet-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      {!loading && roles.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1.5">
            <span className="w-3.5 h-3.5 rounded bg-violet-600 inline-block" />
            Permission granted
          </span>
          {hasWritePermission && (
            <span>Click checkboxes on custom roles to toggle permissions (auto-saves)</span>
          )}
          {!hasWritePermission && (
            <span>You need <code className="text-gray-400 font-mono">roles:write</code> to edit permissions</span>
          )}
        </div>
      )}

      {/* Custom roles summary panel */}
      {!loading && customRoles.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider mb-4">
            Custom Roles
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {customRoles.map((role) => (
              <div
                key={role.id}
                className="card p-4 flex items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-white text-sm font-medium truncate">{role.label}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold flex-shrink-0 ${ROLE_BADGE.custom}`}>
                      Custom
                    </span>
                  </div>
                  <p className="text-xs font-mono text-gray-600">{role.code}</p>
                  {role.description && (
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">{role.description}</p>
                  )}
                  <p className="text-xs text-gray-600 mt-1.5">
                    {role.permissions.length} permission{role.permissions.length !== 1 ? 's' : ''}
                  </p>
                </div>
                {hasWritePermission && (
                  <button
                    onClick={() => setDeleteTarget(role)}
                    className="flex-shrink-0 text-gray-600 hover:text-red-400 transition-colors mt-0.5"
                    title="Delete role"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modals */}
      {showNewRole && (
        <NewRoleModal
          companyId={companyId}
          onCreated={handleRoleCreated}
          onClose={() => setShowNewRole(false)}
        />
      )}
      {showClone && templateRoles.length > 0 && (
        <CloneTemplateModal
          companyId={companyId}
          templates={templateRoles}
          onCreated={handleRoleCreated}
          onClose={() => setShowClone(false)}
        />
      )}
      {deleteTarget && (
        <DeleteModal
          role={deleteTarget}
          onConfirm={() => handleDeleteRole(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
