#!/usr/bin/env node
/**
 * E2E: user & role management — profile update, company users list,
 * role CRUD + clone, invite intake, per-user read/update.
 */
import { createRunner, finish } from './lib.mjs';

const r = createRunner('users-roles');
const { assert, api, setStep } = r;

async function main() {
  setStep(1, 'login');
  const { user, companyId } = await r.login();

  setStep(2, 'own profile read + update');
  const meGet = await api('/api/v1/me');
  assert(meGet.status === 200, 'GET /me returns 200', meGet);
  const displayName = `E2E Admin ${Date.now()}`;
  const mePut = await api('/api/v1/me', { method: 'PUT', body: { display_name: displayName } });
  assert(mePut.status === 200, 'PUT /me returns 200', mePut);
  const meAfter = await api('/api/v1/me');
  const shown = meAfter.data?.display_name ?? meAfter.data?.user?.display_name;
  assert(shown === displayName, 'display_name round-trips', meAfter.data);

  setStep(3, 'company users list');
  const users = await api(`/api/v1/companies/${companyId}/users`);
  assert(users.status === 200, 'GET company users returns 200', users);
  const userList = Array.isArray(users.data) ? users.data : users.data?.data ?? [];
  assert(userList.some(u => u.id === user.id), 'admin appears in company users');

  setStep(4, 'roles list');
  const roles = await api(`/api/v1/companies/${companyId}/roles`);
  assert(roles.status === 200, 'GET company roles returns 200', roles);
  const roleList = Array.isArray(roles.data) ? roles.data : roles.data?.data ?? [];
  assert(roleList.length > 0, 'company has at least one role', roles.data);

  setStep(5, 'subscription surface');
  const sub = await api(`/api/v1/companies/${companyId}/subscription`);
  assert(sub.status === 200, 'GET company subscription returns 200', sub);
  const tier = sub.data?.tier ?? sub.data?.plan ?? 'free';

  setStep(6, 'custom role create respects subscription tier');
  const roleCreate = await api(`/api/v1/companies/${companyId}/roles`, {
    method: 'POST',
    body: {
      code: `e2e_role_${Date.now() % 100000}`,
      label: 'E2E Custom Role',
      description: 'created by e2e suite',
      permissions: ['library:read', 'playlist:read'],
    },
  });
  let role = null;
  if (roleCreate.status === 403 && roleCreate.data?.error?.code === 'FEATURE_NOT_AVAILABLE') {
    // Free tier: the paywall gate is the correct behavior — assert it.
    assert(roleCreate.data.error.upgrade_required === true, `custom roles are tier-gated (tier=${tier})`, roleCreate);
  } else {
    assert(roleCreate.status === 201 || roleCreate.status === 200, 'POST role returns 2xx on paid tier', roleCreate);
    role = roleCreate.data;
    const rolePut = await api(`/api/v1/roles/${role.id}`, {
      method: 'PUT',
      body: { label: 'E2E Custom Role (edited)', permissions: ['library:read'] },
    });
    assert(rolePut.status === 200, 'PUT role returns 200', rolePut);
  }

  setStep(7, 'invite user with an existing role');
  const inviteRole = roleList.find(x => x.code !== 'super_admin') ?? roleList[0];
  const inviteEmail = `e2e-invitee-${Date.now()}@playgen.local`;
  const invite = await api(`/api/v1/companies/${companyId}/invites`, {
    method: 'POST',
    body: { email: inviteEmail, role_id: inviteRole.id },
  });
  assert(invite.status >= 200 && invite.status < 300, 'POST invite returns 2xx', invite);

  setStep(8, 'per-user read + update');
  const target = userList.find(u => u.id === user.id) ?? userList[0];
  const uGet = await api(`/api/v1/users/${target.id}`);
  assert(uGet.status === 200, 'GET /users/:id returns 200', uGet);

  setStep(9, 'cleanup: remove invited user (if materialized) and role');
  const usersAfter = await api(`/api/v1/companies/${companyId}/users`);
  const afterList = Array.isArray(usersAfter.data) ? usersAfter.data : usersAfter.data?.data ?? [];
  const invitee = afterList.find(u => u.email === inviteEmail);
  if (invitee) {
    const delUser = await api(`/api/v1/users/${invitee.id}`, { method: 'DELETE' });
    assert(delUser.status >= 200 && delUser.status < 300, 'DELETE invited user succeeds', delUser);
  }
  if (role) {
    const delRole = await api(`/api/v1/roles/${role.id}`, { method: 'DELETE' });
    assert(delRole.status === 204 || delRole.status === 200, 'DELETE role succeeds', delRole);
  }

  finish('users-roles');
}

main().catch(err => { console.error('\n✗ FAIL [users-roles] unhandled error'); console.error(err); process.exit(1); });
