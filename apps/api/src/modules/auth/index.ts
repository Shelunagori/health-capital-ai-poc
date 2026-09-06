/**
 * Authentication: proving who the caller is. It never decides what the caller may do; that is the
 * authorization module's job.
 */
export { AuthService } from './service.js';
export { registerAuthRoutes, type AuthRouteOptions } from './routes.js';
export { registerAuthentication, requirePrincipal } from './plugin.js';
export {
  createTokenSigner,
  bearerToken,
  TokenError,
  TOKEN_TTL_SECONDS,
  TOKEN_ISSUER,
  TOKEN_AUDIENCE,
  type TokenSigner,
} from './tokens.js';
export { hashPassword, verifyPassword, isArgon2idHash, ARGON2_OPTIONS } from './password.js';
