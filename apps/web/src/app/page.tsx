'use client';

import { LoginForm } from '@/components/login-form';
import { MemberView } from '@/components/member-view';
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
      <div className="stack">
        <header className="page-header">
          <div>
            <h1>Health Capital</h1>
            <p className="subtitle">Benefits guidance</p>
          </div>
        </header>
        <section className="panel panel--narrow">
          <LoginForm />
        </section>
      </div>
    );
  }

  if (session.role === 'MEMBER') return <MemberView />;

  return (
    <div className="stack">
      <header className="page-header">
        <h1>Health Capital</h1>
      </header>
      <section className="panel">
        <p>Signed in as {session.role.toLowerCase().replace('_', ' ')}.</p>
      </section>
    </div>
  );
}
