/**
 * Authorization: what a proven caller may do. It never proves identity; that is the auth module.
 */
export { Action, DenialReason } from './actions.js';
export {
  authorize,
  forbidden,
  type AccessContext,
  type AuthorizationDecision,
  type Resource,
} from './policy.js';
