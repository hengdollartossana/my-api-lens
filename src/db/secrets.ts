import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { decrypt, encrypt, last4 } from "../lib/crypto";
import { db } from "./client";
import { secretKindEnum, secrets } from "./schema";

/**
 * Secret storage.
 *
 * SERVER ONLY: `readSecret` returns the decrypted plaintext and must never be
 * called from a client component or returned in an API response. The UI only
 * ever sees `SecretMeta` (masked, no ciphertext material).
 */

/** One of the `secret_kind` enum values. */
export type SecretKind = (typeof secrets.$inferInsert)["kind"];

/** What is safe to return to the UI: masked, no ciphertext/iv/authTag. */
export interface SecretMeta {
  id: string;
  projectId: string | null;
  kind: SecretKind;
  last4: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SaveSecretInput {
  kind: SecretKind;
  value: string;
  /** null = not tied to a specific project. */
  projectId?: string | null;
}

/** Runtime validation for saveSecret (Zod everywhere). */
const saveSecretInput = z.object({
  kind: z.enum(secretKindEnum.enumValues),
  value: z.string().min(1),
  projectId: z.uuid().nullable().optional(),
});

const metaColumns = {
  id: secrets.id,
  projectId: secrets.projectId,
  kind: secrets.kind,
  last4: secrets.last4,
  createdAt: secrets.createdAt,
  updatedAt: secrets.updatedAt,
};

/** Encrypts the value (AES-256-GCM) and stores it. Returns only masked metadata. */
export async function saveSecret(input: SaveSecretInput): Promise<SecretMeta> {
  const { projectId, kind, value } = saveSecretInput.parse(input);
  const payload = encrypt(value);
  const [row] = await db
    .insert(secrets)
    .values({
      projectId: projectId ?? null,
      kind,
      ciphertext: payload.ciphertext,
      iv: payload.iv,
      authTag: payload.authTag,
      last4: last4(value),
    })
    .returning(metaColumns);
  return row;
}

/**
 * SERVER ONLY: decrypts and returns the stored secret value, or null when the
 * id is unknown. Never expose the result to the client.
 */
export async function readSecret(id: string): Promise<string | null> {
  const [row] = await db
    .select({ ciphertext: secrets.ciphertext, iv: secrets.iv, authTag: secrets.authTag })
    .from(secrets)
    .where(eq(secrets.id, id))
    .limit(1);
  if (!row) return null;
  return decrypt(row);
}

/** Lists secrets as masked metadata — never any ciphertext material. */
export async function listSecretsMasked(projectId?: string): Promise<SecretMeta[]> {
  if (projectId === undefined) {
    return db.select(metaColumns).from(secrets).orderBy(desc(secrets.createdAt));
  }
  return db
    .select(metaColumns)
    .from(secrets)
    .where(eq(secrets.projectId, projectId))
    .orderBy(desc(secrets.createdAt));
}
