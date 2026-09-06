import { z } from 'zod';

/** Roles a principal can hold. Mirrors the UserRole enum in the database. */
export const RoleSchema = z.enum(['MEMBER', 'EMPLOYER_ADMIN', 'SUPPORT']);
export type Role = z.infer<typeof RoleSchema>;

export const LoginRequestSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(320),
    password: z.string().min(1).max(512),
  })
  .strict();
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/**
 * The access token is short-lived and held in memory by the client, never in local storage.
 * No refresh token is issued: re-authenticating is the only way to extend a session.
 */
export const LoginResponseSchema = z
  .object({
    accessToken: z.string(),
    tokenType: z.literal('Bearer'),
    expiresInSeconds: z.number().int().positive(),
    role: RoleSchema,
  })
  .strict();
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

/** The authenticated caller, derived from a verified token and never from request input. */
export const PrincipalSchema = z
  .object({
    userId: z.string().uuid(),
    role: RoleSchema,
    memberId: z.string().uuid().nullable(),
    employerId: z.string().uuid().nullable(),
  })
  .strict();
export type Principal = z.infer<typeof PrincipalSchema>;
