import type { LoginRequest, LoginResponse, Principal } from '@health-capital/contracts';
import type { Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { verifyAgainstDummy, verifyPassword } from './password.js';
import type { TokenSigner } from './tokens.js';

/**
 * Login. Every failure returns the same error, so a caller cannot tell a missing account from a
 * wrong password. There is no registration or password-reset path: accounts come from the seed.
 */
export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly tokens: TokenSigner,
  ) {}

  async login(request: LoginRequest): Promise<{ response: LoginResponse; principal: Principal }> {
    const user = await this.db.user.findUnique({
      where: { email: request.email },
      select: { id: true, passwordHash: true, role: true, memberId: true, employerId: true },
    });

    if (user === null) {
      await verifyAgainstDummy(request.password);
      throw invalidCredentials();
    }

    const ok = await verifyPassword(user.passwordHash, request.password);
    if (!ok) throw invalidCredentials();

    const principal: Principal = {
      userId: user.id,
      role: user.role,
      memberId: user.memberId,
      employerId: user.employerId,
    };

    const { token, expiresInSeconds } = await this.tokens.sign(principal);
    return {
      response: { accessToken: token, tokenType: 'Bearer', expiresInSeconds, role: principal.role },
      principal,
    };
  }
}

function invalidCredentials(): AppError {
  return new AppError('UNAUTHENTICATED', 'Invalid email or password');
}
