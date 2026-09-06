'use client';

import { useEffect, useState } from 'react';
import { LoginForm } from '@/components/login-form';
import { MemberView } from '@/components/member-view';
import { EmployerView } from '@/components/employer-view';
import { SupportView } from '@/components/support-view';
import { api } from '@/lib/api-client';
import { useSession } from '@/lib/session';

/**
 * One page, two states. The session lives in memory, so a reload returns here.
 * Which view a role gets is decided by the API, not by this page: everything below still asks the
 * server, and the server refuses what the role may not have.
 */
export default function HomePage(): JSX.Element {
  const { session } = useSession();
  if (session === null) {
    return (
      <div className="auth">
        <header className="auth__head">
          <h1>Health Capital</h1>
          <p className="subtitle">Check whether your health capital covers a healthcare expense.</p>
        </header>
        <section className="panel panel--auth">
          <LoginForm />
        </section>
      </div>
    );
  }

  return <RoleView />;
}

/**
 * Which view a role gets. The server decides what each role may actually read, so this only picks
 * the right page rather than acting as a control.
 */
function RoleView(): JSX.Element {
  const { session } = useSession();
  const [employerId, setEmployerId] = useState<string | null>(null);
  const token = session?.token ?? null;

  useEffect(() => {
    if (token === null || session?.role !== 'EMPLOYER_ADMIN') return;
    void api
      .context(token)
      .then((context) => setEmployerId(context.employerId))
      .catch(() => setEmployerId(null));
  }, [token, session?.role]);

  if (session === null) return <p className="empty">You are signed out.</p>;
  if (session.role === 'MEMBER') return <MemberView />;
  if (session.role === 'SUPPORT') return <SupportView />;
  if (employerId === null)
    return (
      <p className="empty" role="status">
        Loading your employer details…
      </p>
    );
  return <EmployerView employerId={employerId} />;
}
