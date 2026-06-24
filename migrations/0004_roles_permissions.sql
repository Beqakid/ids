-- ══════════════════════════════════════════════════════════════
-- Migration 0004: Roles + Permissions Foundation (Phase 4)
-- ══════════════════════════════════════════════════════════════

-- ── A. ids_roles ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ids_roles (
  id              TEXT PRIMARY KEY,
  role_key        TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  scope           TEXT NOT NULL DEFAULT 'app',
  app_id          TEXT,
  tenant_id       TEXT,
  status          TEXT NOT NULL DEFAULT 'active',
  is_system_role  INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ids_roles_role_key ON ids_roles (role_key);
CREATE INDEX IF NOT EXISTS idx_ids_roles_scope ON ids_roles (scope);
CREATE INDEX IF NOT EXISTS idx_ids_roles_app_id ON ids_roles (app_id);
CREATE INDEX IF NOT EXISTS idx_ids_roles_tenant_id ON ids_roles (tenant_id);
CREATE INDEX IF NOT EXISTS idx_ids_roles_status ON ids_roles (status);

-- Unique constraint: role_key + scope + app_id + tenant_id
-- D1/SQLite treats NULLs as distinct in UNIQUE, so we use a partial approach:
-- We create a unique index with COALESCE to handle NULLs uniformly.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ids_roles_unique_key
  ON ids_roles (role_key, scope, COALESCE(app_id, '__null__'), COALESCE(tenant_id, '__null__'));

-- ── B. ids_permissions ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS ids_permissions (
  id              TEXT PRIMARY KEY,
  permission_key  TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  category        TEXT,
  app_id          TEXT,
  risk_level      TEXT NOT NULL DEFAULT 'low',
  status          TEXT NOT NULL DEFAULT 'active',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ids_permissions_permission_key ON ids_permissions (permission_key);
CREATE INDEX IF NOT EXISTS idx_ids_permissions_app_id ON ids_permissions (app_id);
CREATE INDEX IF NOT EXISTS idx_ids_permissions_category ON ids_permissions (category);
CREATE INDEX IF NOT EXISTS idx_ids_permissions_risk_level ON ids_permissions (risk_level);
CREATE INDEX IF NOT EXISTS idx_ids_permissions_status ON ids_permissions (status);

-- ── C. ids_role_permissions ──────────────────────────────────

CREATE TABLE IF NOT EXISTS ids_role_permissions (
  id                TEXT PRIMARY KEY,
  role_id           TEXT NOT NULL,
  permission_id     TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  created_by_user_id TEXT,
  FOREIGN KEY (role_id) REFERENCES ids_roles(id),
  FOREIGN KEY (permission_id) REFERENCES ids_permissions(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ids_role_permissions_unique
  ON ids_role_permissions (role_id, permission_id);
CREATE INDEX IF NOT EXISTS idx_ids_role_permissions_role_id ON ids_role_permissions (role_id);
CREATE INDEX IF NOT EXISTS idx_ids_role_permissions_permission_id ON ids_role_permissions (permission_id);

-- ── D. ids_permission_checks ─────────────────────────────────

CREATE TABLE IF NOT EXISTS ids_permission_checks (
  id              TEXT PRIMARY KEY,
  user_id         TEXT,
  app_id          TEXT NOT NULL,
  tenant_id       TEXT,
  membership_id   TEXT,
  permission_key  TEXT NOT NULL,
  allowed         INTEGER NOT NULL DEFAULT 0,
  reason          TEXT,
  risk_level      TEXT,
  source          TEXT,
  metadata        TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ids_permission_checks_user_id ON ids_permission_checks (user_id);
CREATE INDEX IF NOT EXISTS idx_ids_permission_checks_app_id ON ids_permission_checks (app_id);
CREATE INDEX IF NOT EXISTS idx_ids_permission_checks_tenant_id ON ids_permission_checks (tenant_id);
CREATE INDEX IF NOT EXISTS idx_ids_permission_checks_permission_key ON ids_permission_checks (permission_key);
CREATE INDEX IF NOT EXISTS idx_ids_permission_checks_allowed ON ids_permission_checks (allowed);
CREATE INDEX IF NOT EXISTS idx_ids_permission_checks_created_at ON ids_permission_checks (created_at);

-- ── E. ids_user_permission_overrides ─────────────────────────

CREATE TABLE IF NOT EXISTS ids_user_permission_overrides (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  app_id            TEXT,
  tenant_id         TEXT,
  permission_id     TEXT NOT NULL,
  effect            TEXT NOT NULL,
  reason            TEXT,
  status            TEXT NOT NULL DEFAULT 'active',
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  created_by_user_id TEXT,
  FOREIGN KEY (user_id) REFERENCES ids_users(id),
  FOREIGN KEY (permission_id) REFERENCES ids_permissions(id)
);

CREATE INDEX IF NOT EXISTS idx_ids_user_permission_overrides_user_id ON ids_user_permission_overrides (user_id);
CREATE INDEX IF NOT EXISTS idx_ids_user_permission_overrides_app_id ON ids_user_permission_overrides (app_id);
CREATE INDEX IF NOT EXISTS idx_ids_user_permission_overrides_tenant_id ON ids_user_permission_overrides (tenant_id);
CREATE INDEX IF NOT EXISTS idx_ids_user_permission_overrides_permission_id ON ids_user_permission_overrides (permission_id);
CREATE INDEX IF NOT EXISTS idx_ids_user_permission_overrides_status ON ids_user_permission_overrides (status);

-- ══════════════════════════════════════════════════════════════
-- Seed: System Roles (Global)
-- ══════════════════════════════════════════════════════════════

INSERT OR IGNORE INTO ids_roles (id, role_key, name, description, scope, app_id, tenant_id, status, is_system_role, created_at, updated_at)
VALUES
  ('role_super_admin',    'super_admin',    'Super Admin',    'Full platform access.',                     'global', NULL, NULL, 'active', 1, datetime('now'), datetime('now')),
  ('role_platform_admin', 'platform_admin', 'Platform Admin', 'Platform-level administration.',            'global', NULL, NULL, 'active', 1, datetime('now'), datetime('now')),
  ('role_support_admin',  'support_admin',  'Support Admin',  'Support and read-level administration.',    'global', NULL, NULL, 'active', 1, datetime('now'), datetime('now')),
  ('role_developer',      'developer',      'Developer',      'Developer access for debugging and tools.', 'global', NULL, NULL, 'active', 1, datetime('now'), datetime('now')),
  ('role_reviewer',       'reviewer',       'Reviewer',       'Cross-app review capabilities.',            'global', NULL, NULL, 'active', 1, datetime('now'), datetime('now')),
  ('role_user',           'user',           'User',           'Standard user with minimal permissions.',   'global', NULL, NULL, 'active', 1, datetime('now'), datetime('now'));

-- ══════════════════════════════════════════════════════════════
-- Seed: App-Level Role Templates
-- ══════════════════════════════════════════════════════════════

-- Command Center
INSERT OR IGNORE INTO ids_roles (id, role_key, name, description, scope, app_id, tenant_id, status, is_system_role, created_at, updated_at)
VALUES
  ('role_cc_owner',  'command_center_owner',  'Command Center Owner',  'Full Command Center access.',          'app', 'command_center', NULL, 'active', 1, datetime('now'), datetime('now')),
  ('role_cc_admin',  'command_center_admin',  'Command Center Admin',  'Admin-level Command Center access.',   'app', 'command_center', NULL, 'active', 1, datetime('now'), datetime('now')),
  ('role_cc_viewer', 'command_center_viewer', 'Command Center Viewer', 'Read-only Command Center access.',     'app', 'command_center', NULL, 'active', 1, datetime('now'), datetime('now'));

-- Kai
INSERT OR IGNORE INTO ids_roles (id, role_key, name, description, scope, app_id, tenant_id, status, is_system_role, created_at, updated_at)
VALUES
  ('role_kai_admin',    'kai_admin',    'Kai Admin',    'Full Kai administration.',      'app', 'kai', NULL, 'active', 1, datetime('now'), datetime('now')),
  ('role_kai_operator', 'kai_operator', 'Kai Operator', 'Kai operational access.',       'app', 'kai', NULL, 'active', 1, datetime('now'), datetime('now')),
  ('role_kai_user',     'kai_user',     'Kai User',     'Standard Kai user access.',     'app', 'kai', NULL, 'active', 1, datetime('now'), datetime('now'));

-- SMS
INSERT OR IGNORE INTO ids_roles (id, role_key, name, description, scope, app_id, tenant_id, status, is_system_role, created_at, updated_at)
VALUES
  ('role_media_admin',    'media_admin',    'Media Admin',    'Full media management.',        'app', 'sms', NULL, 'active', 1, datetime('now'), datetime('now')),
  ('role_media_reviewer', 'media_reviewer', 'Media Reviewer', 'Media review and moderation.',  'app', 'sms', NULL, 'active', 1, datetime('now'), datetime('now')),
  ('role_media_uploader', 'media_uploader', 'Media Uploader', 'Media upload access.',          'app', 'sms', NULL, 'active', 1, datetime('now'), datetime('now'));

-- Carehia
INSERT OR IGNORE INTO ids_roles (id, role_key, name, description, scope, app_id, tenant_id, status, is_system_role, created_at, updated_at)
VALUES
  ('role_carehia_admin',      'carehia_admin',        'Carehia Admin',        'Full Carehia administration.',    'app', 'carehia', NULL, 'active', 1, datetime('now'), datetime('now')),
  ('role_caregiver',          'caregiver',            'Caregiver',            'Caregiver role.',                 'app', 'carehia', NULL, 'active', 1, datetime('now'), datetime('now')),
  ('role_client',             'client',               'Client',               'Client role.',                    'app', 'carehia', NULL, 'active', 1, datetime('now'), datetime('now')),
  ('role_verification_rev',   'verification_reviewer','Verification Reviewer','Verification review access.',     'app', 'carehia', NULL, 'active', 1, datetime('now'), datetime('now'));

-- Viliniu
INSERT OR IGNORE INTO ids_roles (id, role_key, name, description, scope, app_id, tenant_id, status, is_system_role, created_at, updated_at)
VALUES
  ('role_viliniu_admin',  'viliniu_admin',  'Viliniu Admin',  'Full Viliniu administration.',    'app', 'viliniu', NULL, 'active', 1, datetime('now'), datetime('now')),
  ('role_vendor_owner',   'vendor_owner',   'Vendor Owner',   'Vendor store owner.',             'app', 'viliniu', NULL, 'active', 1, datetime('now'), datetime('now')),
  ('role_vendor_staff',   'vendor_staff',   'Vendor Staff',   'Vendor staff member.',            'app', 'viliniu', NULL, 'active', 1, datetime('now'), datetime('now')),
  ('role_driver',         'driver',         'Driver',         'Delivery driver.',                'app', 'viliniu', NULL, 'active', 1, datetime('now'), datetime('now')),
  ('role_customer',       'customer',       'Customer',       'Marketplace customer.',           'app', 'viliniu', NULL, 'active', 1, datetime('now'), datetime('now'));

-- Volau
INSERT OR IGNORE INTO ids_roles (id, role_key, name, description, scope, app_id, tenant_id, status, is_system_role, created_at, updated_at)
VALUES
  ('role_volau_admin',     'volau_admin',     'Volau Admin',     'Full Volau administration.',      'app', 'volau', NULL, 'active', 1, datetime('now'), datetime('now')),
  ('role_expert_reviewer', 'expert_reviewer', 'Expert Reviewer', 'Knowledge review and approval.',  'app', 'volau', NULL, 'active', 1, datetime('now'), datetime('now')),
  ('role_contributor',     'contributor',     'Contributor',     'Knowledge contributor.',           'app', 'volau', NULL, 'active', 1, datetime('now'), datetime('now')),
  ('role_public_user',     'public_user',     'Public User',     'Public read-only access.',        'app', 'volau', NULL, 'active', 1, datetime('now'), datetime('now'));

-- ══════════════════════════════════════════════════════════════
-- Seed: System Permissions
-- ══════════════════════════════════════════════════════════════

-- IDS Core
INSERT OR IGNORE INTO ids_permissions (id, permission_key, name, description, category, app_id, risk_level, status, created_at, updated_at)
VALUES
  ('perm_ids_users_read',            'ids.users.read',            'Read Users',              'View user profiles.',                    'users',        'ids', 'low',    'active', datetime('now'), datetime('now')),
  ('perm_ids_users_create',          'ids.users.create',          'Create Users',            'Create new user accounts.',              'users',        'ids', 'medium', 'active', datetime('now'), datetime('now')),
  ('perm_ids_users_update',          'ids.users.update',          'Update Users',            'Update user profiles.',                  'users',        'ids', 'medium', 'active', datetime('now'), datetime('now')),
  ('perm_ids_users_status_update',   'ids.users.status.update',   'Update User Status',      'Change user account status.',            'users',        'ids', 'high',   'active', datetime('now'), datetime('now')),
  ('perm_ids_sessions_create',       'ids.sessions.create',       'Create Sessions',         'Create login sessions.',                 'sessions',     'ids', 'medium', 'active', datetime('now'), datetime('now')),
  ('perm_ids_sessions_read',         'ids.sessions.read',         'Read Sessions',           'View session info.',                     'sessions',     'ids', 'low',    'active', datetime('now'), datetime('now')),
  ('perm_ids_sessions_revoke',       'ids.sessions.revoke',       'Revoke Sessions',         'Revoke active sessions.',                'sessions',     'ids', 'high',   'active', datetime('now'), datetime('now')),
  ('perm_ids_apps_read',             'ids.apps.read',             'Read Apps',               'View registered apps.',                  'apps',         'ids', 'low',    'active', datetime('now'), datetime('now')),
  ('perm_ids_apps_create',           'ids.apps.create',           'Create Apps',             'Register new apps.',                     'apps',         'ids', 'high',   'active', datetime('now'), datetime('now')),
  ('perm_ids_apps_update',           'ids.apps.update',           'Update Apps',             'Update app configuration.',              'apps',         'ids', 'medium', 'active', datetime('now'), datetime('now')),
  ('perm_ids_apps_status_update',    'ids.apps.status.update',    'Update App Status',       'Change app status.',                     'apps',         'ids', 'high',   'active', datetime('now'), datetime('now')),
  ('perm_ids_tenants_read',          'ids.tenants.read',          'Read Tenants',            'View tenant information.',               'tenants',      'ids', 'low',    'active', datetime('now'), datetime('now')),
  ('perm_ids_tenants_create',        'ids.tenants.create',        'Create Tenants',          'Create new tenants.',                    'tenants',      'ids', 'medium', 'active', datetime('now'), datetime('now')),
  ('perm_ids_tenants_update',        'ids.tenants.update',        'Update Tenants',          'Update tenant configuration.',           'tenants',      'ids', 'medium', 'active', datetime('now'), datetime('now')),
  ('perm_ids_tenants_status_update', 'ids.tenants.status.update', 'Update Tenant Status',    'Change tenant status.',                  'tenants',      'ids', 'high',   'active', datetime('now'), datetime('now')),
  ('perm_ids_memberships_read',      'ids.memberships.read',      'Read Memberships',        'View membership details.',               'memberships',  'ids', 'low',    'active', datetime('now'), datetime('now')),
  ('perm_ids_memberships_create',    'ids.memberships.create',    'Create Memberships',      'Create new memberships.',                'memberships',  'ids', 'medium', 'active', datetime('now'), datetime('now')),
  ('perm_ids_memberships_update',    'ids.memberships.update',    'Update Memberships',      'Update membership details.',             'memberships',  'ids', 'medium', 'active', datetime('now'), datetime('now')),
  ('perm_ids_memberships_remove',    'ids.memberships.remove',    'Remove Memberships',      'Remove memberships.',                    'memberships',  'ids', 'high',   'active', datetime('now'), datetime('now')),
  ('perm_ids_roles_read',            'ids.roles.read',            'Read Roles',              'View role definitions.',                 'roles',        'ids', 'low',    'active', datetime('now'), datetime('now')),
  ('perm_ids_roles_create',          'ids.roles.create',          'Create Roles',            'Create new roles.',                      'roles',        'ids', 'medium', 'active', datetime('now'), datetime('now')),
  ('perm_ids_roles_update',          'ids.roles.update',          'Update Roles',            'Update role definitions.',               'roles',        'ids', 'medium', 'active', datetime('now'), datetime('now')),
  ('perm_ids_roles_assign',          'ids.roles.assign_permissions', 'Assign Permissions to Roles', 'Manage role-permission mappings.','roles',        'ids', 'high',   'active', datetime('now'), datetime('now')),
  ('perm_ids_perms_read',            'ids.permissions.read',      'Read Permissions',        'View permission definitions.',           'permissions',  'ids', 'low',    'active', datetime('now'), datetime('now')),
  ('perm_ids_perms_create',          'ids.permissions.create',    'Create Permissions',      'Create new permissions.',                'permissions',  'ids', 'medium', 'active', datetime('now'), datetime('now')),
  ('perm_ids_perms_update',          'ids.permissions.update',    'Update Permissions',      'Update permission definitions.',         'permissions',  'ids', 'medium', 'active', datetime('now'), datetime('now')),
  ('perm_ids_perm_checks_run',       'ids.permission_checks.run', 'Run Permission Checks',   'Execute permission check queries.',      'permissions',  'ids', 'low',    'active', datetime('now'), datetime('now')),
  ('perm_ids_audit_read',            'ids.audit.read',            'Read Audit Logs',         'View audit log entries.',                'audit',        'ids', 'low',    'active', datetime('now'), datetime('now'));

-- Kai future permissions
INSERT OR IGNORE INTO ids_permissions (id, permission_key, name, description, category, app_id, risk_level, status, created_at, updated_at)
VALUES
  ('perm_kai_actions_prepare',     'kai.actions.prepare',              'Prepare Kai Actions',     'Prepare actions for Kai execution.', 'actions', 'kai', 'low',    'active', datetime('now'), datetime('now')),
  ('perm_kai_actions_confirm',     'kai.actions.confirm',              'Confirm Kai Actions',     'Confirm prepared Kai actions.',      'actions', 'kai', 'medium', 'active', datetime('now'), datetime('now')),
  ('perm_kai_actions_exec_low',    'kai.actions.execute.low',          'Execute Low-Risk Actions','Execute low-risk Kai actions.',      'actions', 'kai', 'low',    'active', datetime('now'), datetime('now')),
  ('perm_kai_actions_exec_med',    'kai.actions.execute.medium',       'Execute Medium-Risk Actions','Execute medium-risk Kai actions.','actions', 'kai', 'medium', 'active', datetime('now'), datetime('now')),
  ('perm_kai_actions_req_admin',   'kai.actions.request_admin_approval','Request Admin Approval', 'Request admin approval for actions.','actions', 'kai', 'high',   'active', datetime('now'), datetime('now')),
  ('perm_kai_receipts_read',       'kai.receipts.read',                'Read Kai Receipts',       'View Kai action receipts.',          'receipts','kai', 'low',    'active', datetime('now'), datetime('now'));

-- SMS future permissions
INSERT OR IGNORE INTO ids_permissions (id, permission_key, name, description, category, app_id, risk_level, status, created_at, updated_at)
VALUES
  ('perm_sms_media_upload',  'sms.media.upload',  'Upload Media',     'Upload media files.',           'media', 'sms', 'low',    'active', datetime('now'), datetime('now')),
  ('perm_sms_media_read',    'sms.media.read',    'Read Media',       'View media files.',             'media', 'sms', 'low',    'active', datetime('now'), datetime('now')),
  ('perm_sms_media_review',  'sms.media.review',  'Review Media',     'Review media for moderation.',  'media', 'sms', 'medium', 'active', datetime('now'), datetime('now')),
  ('perm_sms_media_approve', 'sms.media.approve', 'Approve Media',    'Approve reviewed media.',       'media', 'sms', 'medium', 'active', datetime('now'), datetime('now')),
  ('perm_sms_media_reject',  'sms.media.reject',  'Reject Media',     'Reject reviewed media.',        'media', 'sms', 'medium', 'active', datetime('now'), datetime('now')),
  ('perm_sms_media_flag',    'sms.media.flag',    'Flag Media',       'Flag media for review.',        'media', 'sms', 'low',    'active', datetime('now'), datetime('now')),
  ('perm_sms_audit_read',    'sms.audit.read',    'Read SMS Audit',   'View SMS audit logs.',          'audit', 'sms', 'low',    'active', datetime('now'), datetime('now'));

-- Viliniu future permissions
INSERT OR IGNORE INTO ids_permissions (id, permission_key, name, description, category, app_id, risk_level, status, created_at, updated_at)
VALUES
  ('perm_vil_store_read',     'viliniu.store.read',      'Read Store',        'View store info.',              'store',    'viliniu', 'low',    'active', datetime('now'), datetime('now')),
  ('perm_vil_store_update',   'viliniu.store.update',    'Update Store',      'Update store settings.',        'store',    'viliniu', 'medium', 'active', datetime('now'), datetime('now')),
  ('perm_vil_products_create','viliniu.products.create', 'Create Products',   'Add new products.',             'products', 'viliniu', 'low',    'active', datetime('now'), datetime('now')),
  ('perm_vil_products_read',  'viliniu.products.read',   'Read Products',     'View products.',                'products', 'viliniu', 'low',    'active', datetime('now'), datetime('now')),
  ('perm_vil_products_update','viliniu.products.update', 'Update Products',   'Update product details.',       'products', 'viliniu', 'low',    'active', datetime('now'), datetime('now')),
  ('perm_vil_products_delete','viliniu.products.delete', 'Delete Products',   'Delete products.',              'products', 'viliniu', 'high',   'active', datetime('now'), datetime('now')),
  ('perm_vil_orders_read',    'viliniu.orders.read',     'Read Orders',       'View orders.',                  'orders',   'viliniu', 'low',    'active', datetime('now'), datetime('now')),
  ('perm_vil_orders_update',  'viliniu.orders.update',   'Update Orders',     'Update order status.',          'orders',   'viliniu', 'medium', 'active', datetime('now'), datetime('now')),
  ('perm_vil_staff_invite',   'viliniu.staff.invite',    'Invite Staff',      'Invite vendor staff.',          'staff',    'viliniu', 'medium', 'active', datetime('now'), datetime('now')),
  ('perm_vil_payouts_read',   'viliniu.payouts.read',    'Read Payouts',      'View payout information.',      'payouts',  'viliniu', 'low',    'active', datetime('now'), datetime('now')),
  ('perm_vil_payouts_update', 'viliniu.payouts.update',  'Update Payouts',    'Manage payout settings.',       'payouts',  'viliniu', 'high',   'active', datetime('now'), datetime('now'));

-- Carehia future permissions
INSERT OR IGNORE INTO ids_permissions (id, permission_key, name, description, category, app_id, risk_level, status, created_at, updated_at)
VALUES
  ('perm_car_profile_read',    'carehia.profile.read',          'Read Profile',         'View caregiver/client profile.',   'profile',       'carehia', 'low',    'active', datetime('now'), datetime('now')),
  ('perm_car_profile_update',  'carehia.profile.update',        'Update Profile',       'Update profile information.',      'profile',       'carehia', 'low',    'active', datetime('now'), datetime('now')),
  ('perm_car_clients_read',    'carehia.clients.read',          'Read Clients',         'View client information.',         'clients',       'carehia', 'low',    'active', datetime('now'), datetime('now')),
  ('perm_car_clients_update',  'carehia.clients.update',        'Update Clients',       'Update client records.',           'clients',       'carehia', 'medium', 'active', datetime('now'), datetime('now')),
  ('perm_car_invoices_create', 'carehia.invoices.create',       'Create Invoices',      'Create new invoices.',             'invoices',      'carehia', 'medium', 'active', datetime('now'), datetime('now')),
  ('perm_car_invoices_read',   'carehia.invoices.read',         'Read Invoices',        'View invoice details.',            'invoices',      'carehia', 'low',    'active', datetime('now'), datetime('now')),
  ('perm_car_invoices_update', 'carehia.invoices.update',       'Update Invoices',      'Update invoice records.',          'invoices',      'carehia', 'medium', 'active', datetime('now'), datetime('now')),
  ('perm_car_verif_review',    'carehia.verifications.review',  'Review Verifications', 'Review verification submissions.', 'verifications', 'carehia', 'high',   'active', datetime('now'), datetime('now')),
  ('perm_car_incidents_review','carehia.incidents.review',      'Review Incidents',     'Review incident reports.',         'incidents',     'carehia', 'high',   'active', datetime('now'), datetime('now')),
  ('perm_car_admin_read',      'carehia.admin.read',            'Read Carehia Admin',   'Admin-level read access.',         'admin',         'carehia', 'low',    'active', datetime('now'), datetime('now'));

-- Volau future permissions
INSERT OR IGNORE INTO ids_permissions (id, permission_key, name, description, category, app_id, risk_level, status, created_at, updated_at)
VALUES
  ('perm_vol_knowledge_read',   'volau.knowledge.read',      'Read Knowledge',       'View knowledge entries.',         'knowledge',    'volau', 'low',    'active', datetime('now'), datetime('now')),
  ('perm_vol_knowledge_submit', 'volau.knowledge.submit',    'Submit Knowledge',     'Submit knowledge entries.',       'knowledge',    'volau', 'low',    'active', datetime('now'), datetime('now')),
  ('perm_vol_knowledge_review', 'volau.knowledge.review',    'Review Knowledge',     'Review knowledge submissions.',   'knowledge',    'volau', 'medium', 'active', datetime('now'), datetime('now')),
  ('perm_vol_knowledge_approve','volau.knowledge.approve',   'Approve Knowledge',    'Approve knowledge entries.',      'knowledge',    'volau', 'medium', 'active', datetime('now'), datetime('now')),
  ('perm_vol_safety_manage',    'volau.safety_rules.manage', 'Manage Safety Rules',  'Manage safety rule definitions.', 'safety_rules', 'volau', 'high',   'active', datetime('now'), datetime('now')),
  ('perm_vol_admin_read',       'volau.admin.read',          'Read Volau Admin',     'Admin-level read access.',        'admin',        'volau', 'low',    'active', datetime('now'), datetime('now'));

-- ══════════════════════════════════════════════════════════════
-- Seed: Role → Permission Mappings
-- ══════════════════════════════════════════════════════════════

-- super_admin: ALL permissions
INSERT OR IGNORE INTO ids_role_permissions (id, role_id, permission_id, created_at)
SELECT 'rp_sa_' || p.id, 'role_super_admin', p.id, datetime('now')
FROM ids_permissions p;

-- platform_admin: most IDS admin permissions (exclude destructive future)
INSERT OR IGNORE INTO ids_role_permissions (id, role_id, permission_id, created_at)
VALUES
  ('rp_pa_users_read',       'role_platform_admin', 'perm_ids_users_read',          datetime('now')),
  ('rp_pa_users_create',     'role_platform_admin', 'perm_ids_users_create',        datetime('now')),
  ('rp_pa_users_update',     'role_platform_admin', 'perm_ids_users_update',        datetime('now')),
  ('rp_pa_users_status',     'role_platform_admin', 'perm_ids_users_status_update', datetime('now')),
  ('rp_pa_sessions_create',  'role_platform_admin', 'perm_ids_sessions_create',     datetime('now')),
  ('rp_pa_sessions_read',    'role_platform_admin', 'perm_ids_sessions_read',       datetime('now')),
  ('rp_pa_sessions_revoke',  'role_platform_admin', 'perm_ids_sessions_revoke',     datetime('now')),
  ('rp_pa_apps_read',        'role_platform_admin', 'perm_ids_apps_read',           datetime('now')),
  ('rp_pa_apps_create',      'role_platform_admin', 'perm_ids_apps_create',         datetime('now')),
  ('rp_pa_apps_update',      'role_platform_admin', 'perm_ids_apps_update',         datetime('now')),
  ('rp_pa_apps_status',      'role_platform_admin', 'perm_ids_apps_status_update',  datetime('now')),
  ('rp_pa_tenants_read',     'role_platform_admin', 'perm_ids_tenants_read',        datetime('now')),
  ('rp_pa_tenants_create',   'role_platform_admin', 'perm_ids_tenants_create',      datetime('now')),
  ('rp_pa_tenants_update',   'role_platform_admin', 'perm_ids_tenants_update',      datetime('now')),
  ('rp_pa_tenants_status',   'role_platform_admin', 'perm_ids_tenants_status_update',datetime('now')),
  ('rp_pa_mem_read',         'role_platform_admin', 'perm_ids_memberships_read',    datetime('now')),
  ('rp_pa_mem_create',       'role_platform_admin', 'perm_ids_memberships_create',  datetime('now')),
  ('rp_pa_mem_update',       'role_platform_admin', 'perm_ids_memberships_update',  datetime('now')),
  ('rp_pa_mem_remove',       'role_platform_admin', 'perm_ids_memberships_remove',  datetime('now')),
  ('rp_pa_roles_read',       'role_platform_admin', 'perm_ids_roles_read',          datetime('now')),
  ('rp_pa_roles_create',     'role_platform_admin', 'perm_ids_roles_create',        datetime('now')),
  ('rp_pa_roles_update',     'role_platform_admin', 'perm_ids_roles_update',        datetime('now')),
  ('rp_pa_roles_assign',     'role_platform_admin', 'perm_ids_roles_assign',        datetime('now')),
  ('rp_pa_perms_read',       'role_platform_admin', 'perm_ids_perms_read',          datetime('now')),
  ('rp_pa_perms_create',     'role_platform_admin', 'perm_ids_perms_create',        datetime('now')),
  ('rp_pa_perms_update',     'role_platform_admin', 'perm_ids_perms_update',        datetime('now')),
  ('rp_pa_perm_checks',      'role_platform_admin', 'perm_ids_perm_checks_run',     datetime('now')),
  ('rp_pa_audit_read',       'role_platform_admin', 'perm_ids_audit_read',          datetime('now'));

-- support_admin
INSERT OR IGNORE INTO ids_role_permissions (id, role_id, permission_id, created_at)
VALUES
  ('rp_sup_users_read',    'role_support_admin', 'perm_ids_users_read',       datetime('now')),
  ('rp_sup_sessions_read', 'role_support_admin', 'perm_ids_sessions_read',    datetime('now')),
  ('rp_sup_sessions_rev',  'role_support_admin', 'perm_ids_sessions_revoke',  datetime('now')),
  ('rp_sup_tenants_read',  'role_support_admin', 'perm_ids_tenants_read',     datetime('now')),
  ('rp_sup_mem_read',      'role_support_admin', 'perm_ids_memberships_read', datetime('now')),
  ('rp_sup_audit_read',    'role_support_admin', 'perm_ids_audit_read',       datetime('now'));

-- developer
INSERT OR IGNORE INTO ids_role_permissions (id, role_id, permission_id, created_at)
VALUES
  ('rp_dev_apps_read',     'role_developer', 'perm_ids_apps_read',       datetime('now')),
  ('rp_dev_tenants_read',  'role_developer', 'perm_ids_tenants_read',    datetime('now')),
  ('rp_dev_mem_read',      'role_developer', 'perm_ids_memberships_read',datetime('now')),
  ('rp_dev_perm_checks',   'role_developer', 'perm_ids_perm_checks_run', datetime('now')),
  ('rp_dev_audit_read',    'role_developer', 'perm_ids_audit_read',      datetime('now'));

-- reviewer
INSERT OR IGNORE INTO ids_role_permissions (id, role_id, permission_id, created_at)
VALUES
  ('rp_rev_sms_review',    'role_reviewer', 'perm_sms_media_review',        datetime('now')),
  ('rp_rev_sms_approve',   'role_reviewer', 'perm_sms_media_approve',       datetime('now')),
  ('rp_rev_sms_reject',    'role_reviewer', 'perm_sms_media_reject',        datetime('now')),
  ('rp_rev_car_verif',     'role_reviewer', 'perm_car_verif_review',        datetime('now')),
  ('rp_rev_vol_review',    'role_reviewer', 'perm_vol_knowledge_review',    datetime('now'));

-- user (minimal)
INSERT OR IGNORE INTO ids_role_permissions (id, role_id, permission_id, created_at)
VALUES
  ('rp_user_users_read',  'role_user', 'perm_ids_users_read', datetime('now')),
  ('rp_user_apps_read',   'role_user', 'perm_ids_apps_read',  datetime('now'));

-- ── Kai roles ────────────────────────────────────────────────

INSERT OR IGNORE INTO ids_role_permissions (id, role_id, permission_id, created_at)
VALUES
  ('rp_kai_adm_prepare',     'role_kai_admin', 'perm_kai_actions_prepare',   datetime('now')),
  ('rp_kai_adm_confirm',     'role_kai_admin', 'perm_kai_actions_confirm',   datetime('now')),
  ('rp_kai_adm_exec_low',    'role_kai_admin', 'perm_kai_actions_exec_low',  datetime('now')),
  ('rp_kai_adm_exec_med',    'role_kai_admin', 'perm_kai_actions_exec_med',  datetime('now')),
  ('rp_kai_adm_req_admin',   'role_kai_admin', 'perm_kai_actions_req_admin', datetime('now')),
  ('rp_kai_adm_receipts',    'role_kai_admin', 'perm_kai_receipts_read',     datetime('now'));

INSERT OR IGNORE INTO ids_role_permissions (id, role_id, permission_id, created_at)
VALUES
  ('rp_kai_op_prepare',   'role_kai_operator', 'perm_kai_actions_prepare',  datetime('now')),
  ('rp_kai_op_confirm',   'role_kai_operator', 'perm_kai_actions_confirm',  datetime('now')),
  ('rp_kai_op_exec_low',  'role_kai_operator', 'perm_kai_actions_exec_low', datetime('now')),
  ('rp_kai_op_receipts',  'role_kai_operator', 'perm_kai_receipts_read',    datetime('now'));

INSERT OR IGNORE INTO ids_role_permissions (id, role_id, permission_id, created_at)
VALUES
  ('rp_kai_usr_prepare',  'role_kai_user', 'perm_kai_actions_prepare', datetime('now')),
  ('rp_kai_usr_receipts', 'role_kai_user', 'perm_kai_receipts_read',  datetime('now'));

-- ── SMS roles ────────────────────────────────────────────────

INSERT OR IGNORE INTO ids_role_permissions (id, role_id, permission_id, created_at)
VALUES
  ('rp_ma_upload',  'role_media_admin', 'perm_sms_media_upload',  datetime('now')),
  ('rp_ma_read',    'role_media_admin', 'perm_sms_media_read',    datetime('now')),
  ('rp_ma_review',  'role_media_admin', 'perm_sms_media_review',  datetime('now')),
  ('rp_ma_approve', 'role_media_admin', 'perm_sms_media_approve', datetime('now')),
  ('rp_ma_reject',  'role_media_admin', 'perm_sms_media_reject',  datetime('now')),
  ('rp_ma_flag',    'role_media_admin', 'perm_sms_media_flag',    datetime('now')),
  ('rp_ma_audit',   'role_media_admin', 'perm_sms_audit_read',    datetime('now'));

INSERT OR IGNORE INTO ids_role_permissions (id, role_id, permission_id, created_at)
VALUES
  ('rp_mr_read',    'role_media_reviewer', 'perm_sms_media_read',    datetime('now')),
  ('rp_mr_review',  'role_media_reviewer', 'perm_sms_media_review',  datetime('now')),
  ('rp_mr_approve', 'role_media_reviewer', 'perm_sms_media_approve', datetime('now')),
  ('rp_mr_reject',  'role_media_reviewer', 'perm_sms_media_reject',  datetime('now')),
  ('rp_mr_flag',    'role_media_reviewer', 'perm_sms_media_flag',    datetime('now'));

INSERT OR IGNORE INTO ids_role_permissions (id, role_id, permission_id, created_at)
VALUES
  ('rp_mu_upload', 'role_media_uploader', 'perm_sms_media_upload', datetime('now')),
  ('rp_mu_read',   'role_media_uploader', 'perm_sms_media_read',   datetime('now'));

-- ── Viliniu roles ────────────────────────────────────────────

INSERT OR IGNORE INTO ids_role_permissions (id, role_id, permission_id, created_at)
VALUES
  ('rp_va_store_r',  'role_viliniu_admin', 'perm_vil_store_read',      datetime('now')),
  ('rp_va_store_u',  'role_viliniu_admin', 'perm_vil_store_update',    datetime('now')),
  ('rp_va_prod_c',   'role_viliniu_admin', 'perm_vil_products_create', datetime('now')),
  ('rp_va_prod_r',   'role_viliniu_admin', 'perm_vil_products_read',   datetime('now')),
  ('rp_va_prod_u',   'role_viliniu_admin', 'perm_vil_products_update', datetime('now')),
  ('rp_va_prod_d',   'role_viliniu_admin', 'perm_vil_products_delete', datetime('now')),
  ('rp_va_orders_r', 'role_viliniu_admin', 'perm_vil_orders_read',     datetime('now')),
  ('rp_va_orders_u', 'role_viliniu_admin', 'perm_vil_orders_update',   datetime('now')),
  ('rp_va_staff',    'role_viliniu_admin', 'perm_vil_staff_invite',    datetime('now')),
  ('rp_va_pay_r',    'role_viliniu_admin', 'perm_vil_payouts_read',    datetime('now')),
  ('rp_va_pay_u',    'role_viliniu_admin', 'perm_vil_payouts_update',  datetime('now'));

INSERT OR IGNORE INTO ids_role_permissions (id, role_id, permission_id, created_at)
VALUES
  ('rp_vo_store_r',  'role_vendor_owner', 'perm_vil_store_read',      datetime('now')),
  ('rp_vo_store_u',  'role_vendor_owner', 'perm_vil_store_update',    datetime('now')),
  ('rp_vo_prod_c',   'role_vendor_owner', 'perm_vil_products_create', datetime('now')),
  ('rp_vo_prod_r',   'role_vendor_owner', 'perm_vil_products_read',   datetime('now')),
  ('rp_vo_prod_u',   'role_vendor_owner', 'perm_vil_products_update', datetime('now')),
  ('rp_vo_prod_d',   'role_vendor_owner', 'perm_vil_products_delete', datetime('now')),
  ('rp_vo_orders_r', 'role_vendor_owner', 'perm_vil_orders_read',     datetime('now')),
  ('rp_vo_orders_u', 'role_vendor_owner', 'perm_vil_orders_update',   datetime('now')),
  ('rp_vo_staff',    'role_vendor_owner', 'perm_vil_staff_invite',    datetime('now')),
  ('rp_vo_pay_r',    'role_vendor_owner', 'perm_vil_payouts_read',    datetime('now'));

INSERT OR IGNORE INTO ids_role_permissions (id, role_id, permission_id, created_at)
VALUES
  ('rp_vs_prod_r',   'role_vendor_staff', 'perm_vil_products_read',   datetime('now')),
  ('rp_vs_prod_u',   'role_vendor_staff', 'perm_vil_products_update', datetime('now')),
  ('rp_vs_orders_r', 'role_vendor_staff', 'perm_vil_orders_read',     datetime('now')),
  ('rp_vs_orders_u', 'role_vendor_staff', 'perm_vil_orders_update',   datetime('now'));

INSERT OR IGNORE INTO ids_role_permissions (id, role_id, permission_id, created_at)
VALUES
  ('rp_dr_orders_r', 'role_driver', 'perm_vil_orders_read',   datetime('now')),
  ('rp_dr_orders_u', 'role_driver', 'perm_vil_orders_update', datetime('now'));

INSERT OR IGNORE INTO ids_role_permissions (id, role_id, permission_id, created_at)
VALUES
  ('rp_cust_store_r', 'role_customer', 'perm_vil_store_read',    datetime('now')),
  ('rp_cust_prod_r',  'role_customer', 'perm_vil_products_read', datetime('now')),
  ('rp_cust_orders_r','role_customer', 'perm_vil_orders_read',   datetime('now'));

-- ── Carehia roles ────────────────────────────────────────────

INSERT OR IGNORE INTO ids_role_permissions (id, role_id, permission_id, created_at)
VALUES
  ('rp_ca_prof_r',   'role_carehia_admin', 'perm_car_profile_read',     datetime('now')),
  ('rp_ca_prof_u',   'role_carehia_admin', 'perm_car_profile_update',   datetime('now')),
  ('rp_ca_cli_r',    'role_carehia_admin', 'perm_car_clients_read',     datetime('now')),
  ('rp_ca_cli_u',    'role_carehia_admin', 'perm_car_clients_update',   datetime('now')),
  ('rp_ca_inv_r',    'role_carehia_admin', 'perm_car_invoices_read',    datetime('now')),
  ('rp_ca_verif',    'role_carehia_admin', 'perm_car_verif_review',     datetime('now')),
  ('rp_ca_incidents','role_carehia_admin', 'perm_car_incidents_review', datetime('now')),
  ('rp_ca_admin_r',  'role_carehia_admin', 'perm_car_admin_read',       datetime('now'));

INSERT OR IGNORE INTO ids_role_permissions (id, role_id, permission_id, created_at)
VALUES
  ('rp_cg_prof_r', 'role_caregiver', 'perm_car_profile_read',    datetime('now')),
  ('rp_cg_prof_u', 'role_caregiver', 'perm_car_profile_update',  datetime('now')),
  ('rp_cg_cli_r',  'role_caregiver', 'perm_car_clients_read',    datetime('now')),
  ('rp_cg_cli_u',  'role_caregiver', 'perm_car_clients_update',  datetime('now')),
  ('rp_cg_inv_c',  'role_caregiver', 'perm_car_invoices_create', datetime('now')),
  ('rp_cg_inv_r',  'role_caregiver', 'perm_car_invoices_read',   datetime('now')),
  ('rp_cg_inv_u',  'role_caregiver', 'perm_car_invoices_update', datetime('now'));

INSERT OR IGNORE INTO ids_role_permissions (id, role_id, permission_id, created_at)
VALUES
  ('rp_cl_prof_r', 'role_client', 'perm_car_profile_read',   datetime('now')),
  ('rp_cl_prof_u', 'role_client', 'perm_car_profile_update', datetime('now')),
  ('rp_cl_cli_r',  'role_client', 'perm_car_clients_read',   datetime('now')),
  ('rp_cl_inv_r',  'role_client', 'perm_car_invoices_read',  datetime('now'));

INSERT OR IGNORE INTO ids_role_permissions (id, role_id, permission_id, created_at)
VALUES
  ('rp_vr_verif',   'role_verification_rev', 'perm_car_verif_review', datetime('now')),
  ('rp_vr_admin_r', 'role_verification_rev', 'perm_car_admin_read',   datetime('now'));

-- ── Volau roles ──────────────────────────────────────────────

INSERT OR IGNORE INTO ids_role_permissions (id, role_id, permission_id, created_at)
VALUES
  ('rp_voa_know_r',  'role_volau_admin', 'perm_vol_knowledge_read',    datetime('now')),
  ('rp_voa_know_s',  'role_volau_admin', 'perm_vol_knowledge_submit',  datetime('now')),
  ('rp_voa_know_rv', 'role_volau_admin', 'perm_vol_knowledge_review',  datetime('now')),
  ('rp_voa_know_a',  'role_volau_admin', 'perm_vol_knowledge_approve', datetime('now')),
  ('rp_voa_safety',  'role_volau_admin', 'perm_vol_safety_manage',     datetime('now')),
  ('rp_voa_admin_r', 'role_volau_admin', 'perm_vol_admin_read',        datetime('now'));

INSERT OR IGNORE INTO ids_role_permissions (id, role_id, permission_id, created_at)
VALUES
  ('rp_er_know_r',  'role_expert_reviewer', 'perm_vol_knowledge_read',    datetime('now')),
  ('rp_er_know_rv', 'role_expert_reviewer', 'perm_vol_knowledge_review',  datetime('now')),
  ('rp_er_know_a',  'role_expert_reviewer', 'perm_vol_knowledge_approve', datetime('now'));

INSERT OR IGNORE INTO ids_role_permissions (id, role_id, permission_id, created_at)
VALUES
  ('rp_con_know_r', 'role_contributor', 'perm_vol_knowledge_read',   datetime('now')),
  ('rp_con_know_s', 'role_contributor', 'perm_vol_knowledge_submit', datetime('now'));

INSERT OR IGNORE INTO ids_role_permissions (id, role_id, permission_id, created_at)
VALUES
  ('rp_pu_know_r', 'role_public_user', 'perm_vol_knowledge_read', datetime('now'));

-- ══════════════════════════════════════════════════════════════
-- Update service metadata
-- ══════════════════════════════════════════════════════════════

UPDATE ids_service_metadata SET value = 'phase_4_roles_permissions', updated_at = datetime('now') WHERE key = 'phase';
