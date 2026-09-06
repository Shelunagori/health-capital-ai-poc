'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Role } from '@health-capital/contracts';

/**
 * The signed-in session, held in memory only.
 *
 * Not local storage, not a cookie. Closing the tab ends the session and a refresh requires signing
 * in again. That is a deliberate cost: a token that is never written down cannot be read from
 * storage by anything that finds its way onto the page.
 */
export interface Session {
  token: string;
  role: Role;
  expiresAt: number;
}

interface SessionContextValue {
  session: Session | null;
  signIn: (token: string, role: Role, expiresInSeconds: number) => void;
  signOut: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }): JSX.Element {
  const [session, setSession] = useState<Session | null>(null);

  const signIn = useCallback((token: string, role: Role, expiresInSeconds: number) => {
    setSession({ token, role, expiresAt: Date.now() + expiresInSeconds * 1_000 });
  }, []);

  const signOut = useCallback(() => setSession(null), []);

  const value = useMemo(() => ({ session, signIn, signOut }), [session, signIn, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (value === null) throw new Error('useSession must be used inside a SessionProvider');
  return value;
}
