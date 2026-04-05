import type { FastifyInstance } from 'fastify';
import { authenticate, requirePermission } from '@playgen/middleware';
import { getPool } from '../db';

interface RoleRow {
  id: string;
  company_id: string | null;
  code: string;
  label: string;
  permissions: string[];
  is_system: boolean;
  is_template: boolean;
  description: string | null;
}

export async function roleRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate);

  /**
   * GET /companies/:id/roles
   * List all roles visible to this company:
   *   - system roles (company_id IS NULL, is_system = TRUE)
   *   - template roles (company_id IS NULL, is_template = TRUE)
   *   - custom roles scoped to this company
   */
  app.get('/companies/:id/roles', { onRequest: [requirePermission('roles:read')] }, async (req, reply) => {
    const { id: companyId } = req.params as { id: string };

    // Tenant isolation: non-system users can only view roles for their own company
    if (!req.user.sys && req.user.cid !== companyId) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Company access denied' } });
    }

    const { rows } = await getPool().query<RoleRow>(
      `SELECT id, company_id, code, label, permissions, is_system, is_template, description
       FROM roles
       WHERE company_id = $1
          OR company_id IS NULL
       ORDER BY is_system DESC, is_template DESC, label ASC`,
      [companyId],
    );

    return rows;
  });

  /**
   * POST /companies/:id/roles
   * Create a custom role for a company.
   * Requires roles:write. Cannot include permissions the caller doesn't hold
   * (privilege escalation guard).
   */
  app.post('/companies/:id/roles', { onRequest: [requirePermission('roles:write')] }, async (req, reply) => {
    const { id: companyId } = req.params as { id: string };
    const body = req.body as {
      code: string;
      label: string;
      permissions: string[];
      description?: string;
    };

    // Tenant isolation: non-system users can only create roles for their own company
    if (!req.user.sys && req.user.cid !== companyId) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Company access denied' } });
    }

    if (!body.code || !body.label || !Array.isArray(body.permissions)) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'code, label, and permissions array are required' },
      });
    }

    // Privilege escalation guard: caller must hold each permission they're granting
    // (unless sys flag is set)
    const callerUser = req.user;
    if (!callerUser.sys) {
      const { ROLE_PERMISSIONS } = await import('@playgen/types');
      const callerPerms = ROLE_PERMISSIONS[callerUser.rc] ?? [];
      const unauthorized = body.permissions.filter((p) => !callerPerms.includes(p));
      if (unauthorized.length > 0) {
        return reply.code(403).send({
          error: {
            code: 'PRIVILEGE_ESCALATION',
            message: `Cannot grant permissions you do not hold: ${unauthorized.join(', ')}`,
          },
        });
      }
    }

    // Check subscription allows custom roles
    const { rows: tierRows } = await getPool().query<{ feature_custom_roles: boolean }>(
      `SELECT COALESCE(tl.feature_custom_roles, FALSE) AS feature_custom_roles
       FROM companies c
       LEFT JOIN subscriptions s ON s.company_id = c.id
         AND s.status IN ('active', 'trialing', 'past_due')
       LEFT JOIN subscription_tier_limits tl ON tl.tier = COALESCE(s.tier, 'free')
       WHERE c.id = $1
       LIMIT 1`,
      [companyId],
    );

    if (!tierRows[0]?.feature_custom_roles) {
      return reply.code(403).send({
        error: {
          code: 'FEATURE_NOT_AVAILABLE',
          message: 'Custom roles require a Professional or Enterprise subscription.',
          upgrade_required: true,
        },
      });
    }

    // Prevent duplicate code within the company
    const { rows: existing } = await getPool().query(
      `SELECT id FROM roles WHERE company_id = $1 AND code = $2`,
      [companyId, body.code],
    );
    if (existing.length > 0) {
      return reply.code(409).send({
        error: { code: 'CONFLICT', message: `A role with code '${body.code}' already exists in this company` },
      });
    }

    const { rows } = await getPool().query<RoleRow>(
      `INSERT INTO roles (company_id, code, label, permissions, description, is_system, is_template)
       VALUES ($1, $2, $3, $4, $5, FALSE, FALSE)
       RETURNING id, company_id, code, label, permissions, is_system, is_template, description`,
      [companyId, body.code, body.label, body.permissions, body.description ?? null],
    );

    return reply.code(201).send(rows[0]);
  });

  /**
   * PUT /roles/:id
   * Update a custom role's label, permissions, or description.
   * Cannot modify is_system or is_template roles.
   */
  app.put('/roles/:id', { onRequest: [requirePermission('roles:write')] }, async (req, reply) => {
    const { id: roleId } = req.params as { id: string };
    const body = req.body as {
      label?: string;
      permissions?: string[];
      description?: string;
    };

    // Fetch current role
    const { rows: current } = await getPool().query<RoleRow>(
      `SELECT id, company_id, code, label, permissions, is_system, is_template, description
       FROM roles WHERE id = $1`,
      [roleId],
    );

    if (current.length === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Role not found' } });
    }

    const role = current[0];

    // Cannot modify system or template roles
    if (role.is_system || role.is_template) {
      return reply.code(403).send({
        error: { code: 'FORBIDDEN', message: 'Cannot modify system or template roles' },
      });
    }

    // Company isolation: non-sys callers can only edit their own company's roles
    const caller = req.user;
    if (!caller.sys && role.company_id !== caller.cid) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Company access denied' } });
    }

    // Privilege escalation guard on permissions update
    if (body.permissions && !caller.sys) {
      const { ROLE_PERMISSIONS } = await import('@playgen/types');
      const callerPerms = ROLE_PERMISSIONS[caller.rc] ?? [];
      const unauthorized = body.permissions.filter((p) => !callerPerms.includes(p));
      if (unauthorized.length > 0) {
        return reply.code(403).send({
          error: {
            code: 'PRIVILEGE_ESCALATION',
            message: `Cannot grant permissions you do not hold: ${unauthorized.join(', ')}`,
          },
        });
      }
    }

    const { rows } = await getPool().query<RoleRow>(
      `UPDATE roles
       SET label       = COALESCE($1, label),
           permissions = COALESCE($2, permissions),
           description = COALESCE($3, description)
       WHERE id = $4
       RETURNING id, company_id, code, label, permissions, is_system, is_template, description`,
      [body.label ?? null, body.permissions ?? null, body.description ?? null, roleId],
    );

    return rows[0];
  });

  /**
   * DELETE /roles/:id
   * Delete a custom role. Returns 409 if any users are currently assigned to it.
   * Cannot delete system or template roles.
   */
  app.delete('/roles/:id', { onRequest: [requirePermission('roles:write')] }, async (req, reply) => {
    const { id: roleId } = req.params as { id: string };

    const { rows: current } = await getPool().query<RoleRow>(
      `SELECT id, company_id, code, is_system, is_template FROM roles WHERE id = $1`,
      [roleId],
    );

    if (current.length === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Role not found' } });
    }

    const role = current[0];

    if (role.is_system || role.is_template) {
      return reply.code(403).send({
        error: { code: 'FORBIDDEN', message: 'Cannot delete system or template roles' },
      });
    }

    // Company isolation
    const caller = req.user;
    if (!caller.sys && role.company_id !== caller.cid) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Company access denied' } });
    }

    // Check if any users are assigned to this role
    const { rows: assignedUsers } = await getPool().query(
      `SELECT id FROM users WHERE role_id = $1 AND is_active = TRUE LIMIT 1`,
      [roleId],
    );

    if (assignedUsers.length > 0) {
      return reply.code(409).send({
        error: {
          code: 'ROLE_IN_USE',
          message: 'Cannot delete a role that is currently assigned to active users. Reassign users first.',
        },
      });
    }

    await getPool().query(`DELETE FROM roles WHERE id = $1`, [roleId]);

    return reply.code(204).send();
  });

  /**
   * POST /companies/:id/roles/clone
   * Clone a template role into a company-scoped custom role.
   * Requires roles:write and Custom Roles feature gate.
   */
  app.post('/companies/:id/roles/clone', { onRequest: [requirePermission('roles:write')] }, async (req, reply) => {
    const { id: companyId } = req.params as { id: string };
    const body = req.body as {
      source_role_id: string;
      code: string;
      label?: string;
    };

    // Tenant isolation: non-system users can only clone roles into their own company
    if (!req.user.sys && req.user.cid !== companyId) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Company access denied' } });
    }

    if (!body.source_role_id || !body.code) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'source_role_id and code are required' },
      });
    }

    // Check custom roles feature gate
    const { rows: tierRows } = await getPool().query<{ feature_custom_roles: boolean }>(
      `SELECT COALESCE(tl.feature_custom_roles, FALSE) AS feature_custom_roles
       FROM companies c
       LEFT JOIN subscriptions s ON s.company_id = c.id
         AND s.status IN ('active', 'trialing', 'past_due')
       LEFT JOIN subscription_tier_limits tl ON tl.tier = COALESCE(s.tier, 'free')
       WHERE c.id = $1
       LIMIT 1`,
      [companyId],
    );

    if (!tierRows[0]?.feature_custom_roles) {
      return reply.code(403).send({
        error: {
          code: 'FEATURE_NOT_AVAILABLE',
          message: 'Custom roles require a Professional or Enterprise subscription.',
          upgrade_required: true,
        },
      });
    }

    // Fetch source role (must be a template or system role)
    const { rows: sourceRows } = await getPool().query<RoleRow>(
      `SELECT id, code, label, permissions, description, is_system, is_template
       FROM roles WHERE id = $1`,
      [body.source_role_id],
    );

    if (sourceRows.length === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Source role not found' } });
    }

    const source = sourceRows[0];

    if (!source.is_template && !source.is_system) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Can only clone template or system roles' },
      });
    }

    // Check for duplicate code within the company
    const { rows: existing } = await getPool().query(
      `SELECT id FROM roles WHERE company_id = $1 AND code = $2`,
      [companyId, body.code],
    );
    if (existing.length > 0) {
      return reply.code(409).send({
        error: { code: 'CONFLICT', message: `A role with code '${body.code}' already exists in this company` },
      });
    }

    const { rows } = await getPool().query<RoleRow>(
      `INSERT INTO roles (company_id, code, label, permissions, description, is_system, is_template)
       VALUES ($1, $2, $3, $4, $5, FALSE, FALSE)
       RETURNING id, company_id, code, label, permissions, is_system, is_template, description`,
      [
        companyId,
        body.code,
        body.label ?? source.label,
        source.permissions,
        source.description,
      ],
    );

    return reply.code(201).send(rows[0]);
  });
}
