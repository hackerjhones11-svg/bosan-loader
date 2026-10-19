import { AdminPanel } from './admin/AdminPanel';
import { Header } from './components/Header';
import { HelpDialog } from './components/HelpDialog';
import { HistoryPanel } from './components/HistoryPanel';
import { LiveAnnouncer } from './components/LiveAnnouncer';
import { ResultMat } from './components/ResultMat';
import { RollPanel } from './components/RollPanel';
import { Stage } from './components/Stage';
import { TestModeBanner } from './components/TestModeBanner';
import { useRollShortcut } from './hooks/useRollShortcut';

export function App({ admin }: { admin: boolean }) {
  useRollShortcut();
  return (
    <div className={`app${admin ? ' is-admin' : ''}`}>
      <Header admin={admin} />
      <main className="layout">
        <div className="play-column">
          <Stage />
          <TestModeBanner />
          <ResultMat />
        </div>
        <aside className="side-column">
          <RollPanel />
          {admin && <AdminPanel />}
          <HistoryPanel />
        </aside>
      </main>
      <HelpDialog />
      <LiveAnnouncer />
    </div>
  );
}
