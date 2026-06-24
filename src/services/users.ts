import type { Env } from "../types/env";
import type {
  IdsUser,
  IdsUserRow,
  UserStatus,
} from "../types/identity";
import { getDB } from "../lib/db";
import { writeAuditLog } from "./audit";

// ── Helpers ──────────────────────────────────────────────────

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-\(\)\+]/g, "").trim();
}

function rowToUser(row: IdsUserRow): IdsUser {
  return {
    id: row.id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    status: row.status as UserStatus,
    primaryEmail: row.primary_email,
    primaryPhone: row.primary_phone,
    emailVerified: row.email_verified === 1,
    phoneVerified: row.phone_verified === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  };
}

// ── Create ───────────────────────────────────────────────────

export interface CreateUserInput {
  displayName?: string;
  email?: string;
  phone?: string;
}

export async function createUser(
  env: Env,
  input: CreateUserInput
): Promise<IdsUser> {
  const db = getDB(env);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const normEmail = input.email ? normalizeEmail(input.email) : null;
  const normPhone = input.phone ? normalizePhone(input.phone) : null;

  // Check duplicate normalised email
  if (normEmail) {
    const existing = await db
      .prepare(
        "SELECT id FROM ids_user_emails WHERE normalized_email = ?"
      )
      .bind(normEmail)
      .first();
    if (existing) {
      throw new DuplicateEmailError(
        "A user with this email already exists."
      );
    }
  }

  // Insert user
  await db
    .prepare(
      `INSERT INTO ids_users
         (id, display_name, status, primary_email, primary_phone,
          email_verified, phone_verified, created_at, updated_at)
       VALUES (?, ?, 'active', ?, ?, 0, 0, ?, ?)`
    )
    .bind(id, input.displayName ?? null, input.email ?? null, input.phone ?? null, now, now)
    .run();

  // Insert email record
  if (input.email && normEmail) {
    await db
      .prepare(
        `INSERT INTO ids_user_emails
           (id, user_id, email, normalized_email, verified, is_primary,
            verification_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, 1, 'unverified', ?, ?)`
      )
      .bind(crypto.randomUUID(), id, input.email, normEmail, now, now)
      .run();
  }

  // Insert phone record
  if (input.phone && normPhone) {
    await db
      .prepare(
        `INSERT INTO ids_user_phones
           (id, user_id, phone, normalized_phone, verified, is_primary,
            verification_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, 1, 'unverified', ?, ?)`
      )
      .bind(crypto.randomUUID(), id, input.phone, normPhone, now, now)
      .run();
  }

  // Audit
  await writeAuditLog(env, {
    eventType: "user_created",
    userId: id,
    metadata: { displayName: input.displayName, email: input.email },
  });

  return {
    id,
    displayName: input.displayName ?? null,
    avatarUrl: null,
    status: "active",
    primaryEmail: input.email ?? null,
    primaryPhone: input.phone ?? null,
    emailVerified: false,
    phoneVerified: false,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
  };
}

// ── Read ─────────────────────────────────────────────────────

export async function getUserById(
  env: Env,
  userId: string
): Promise<IdsUser | null> {
  const db = getDB(env);
  const row = await db
    .prepare("SELECT * FROM ids_users WHERE id = ?")
    .bind(userId)
    .first<IdsUserRow>();
  return row ? rowToUser(row) : null;
}

export async function getUserByEmail(
  env: Env,
  email: string
): Promise<IdsUser | null> {
  const db = getDB(env);
  const normEmail = normalizeEmail(email);
  const emailRow = await db
    .prepare(
      "SELECT user_id FROM ids_user_emails WHERE normalized_email = ? LIMIT 1"
    )
    .bind(normEmail)
    .first<{ user_id: string }>();

  if (!emailRow) return null;
  return getUserById(env, emailRow.user_id);
}

export interface ListUsersOptions {
  limit: number;
  offset: number;
  status?: string;
  email?: string;
}

export async function listUsers(
  env: Env,
  opts: ListUsersOptions
): Promise<{ users: IdsUser[]; total: number }> {
  const db = getDB(env);
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.status) {
    conditions.push("u.status = ?");
    params.push(opts.status);
  }
  if (opts.email) {
    conditions.push(
      "u.id IN (SELECT user_id FROM ids_user_emails WHERE normalized_email = ?)"
    );
    params.push(normalizeEmail(opts.email));
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Count
  const countRow = await db
    .prepare(`SELECT COUNT(*) as cnt FROM ids_users u ${where}`)
    .bind(...params)
    .first<{ cnt: number }>();
  const total = countRow?.cnt ?? 0;

  // Rows
  const rows = await db
    .prepare(
      `SELECT u.* FROM ids_users u ${where} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...params, opts.limit, opts.offset)
    .all<IdsUserRow>();

  return {
    users: (rows.results ?? []).map(rowToUser),
    total,
  };
}

// ── Update Status ────────────────────────────────────────────

export async function updateUserStatus(
  env: Env,
  userId: string,
  status: UserStatus
): Promise<IdsUser | null> {
  const db = getDB(env);
  const now = new Date().toISOString();

  const existing = await getUserById(env, userId);
  if (!existing) return null;

  await db
    .prepare(
      "UPDATE ids_users SET status = ?, updated_at = ? WHERE id = ?"
    )
    .bind(status, now, userId)
    .run();

  await writeAuditLog(env, {
    eventType: "user_status_updated",
    userId,
    metadata: { previousStatus: existing.status, newStatus: status },
  });

  return { ...existing, status, updatedAt: now };
}

// ── Errors ───────────────────────────────────────────────────

export class DuplicateEmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateEmailError";
  }
}
