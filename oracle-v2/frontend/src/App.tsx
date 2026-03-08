import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AdminTokenGate } from './components/AdminTokenGate';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Header } from './components/Header';
import { KeyboardShortcutOverlay } from './components/KeyboardShortcutOverlay';
import { QuickLearn } from './components/QuickLearn';
import { Card, Skeleton } from './components/ui';
import { Activity } from './pages/Activity';
import { Chat } from './pages/Chat';
import { Consult } from './pages/Consult';
import { Decisions } from './pages/Decisions';
import { DocDetail } from './pages/DocDetail';
import { Evolution } from './pages/Evolution';
import { Feed } from './pages/Feed';
import { Forum } from './pages/Forum';
import { Handoff } from './pages/Handoff';
import { HeartbeatConfigPage } from './pages/HeartbeatConfigPage';
import { JobDetailPage } from './pages/JobDetailPage';
import { LiveOps } from './pages/LiveOps';
import { Overview } from './pages/Overview';
import { SchedulerPage } from './pages/SchedulerPage';
import { Search } from './pages/Search';
import { Superseded } from './pages/Superseded';
import { SystemHealth } from './pages/SystemHealth';
import { Traces } from './pages/Traces';

const Admin = lazy(() => import('./pages/Admin').then((m) => ({ default: m.Admin })));
const AdminMemory = lazy(() => import('./pages/AdminMemory').then((m) => ({ default: m.AdminMemory })));
const AdminLogs = lazy(() => import('./pages/AdminLogs').then((m) => ({ default: m.AdminLogs })));
const GraphPage = lazy(() => import('./pages/Graph').then((m) => ({ default: m.Graph })));

function AppSuspenseFallback() {
  return (
    <div style={{ padding: 'max(24px, 4vw)' }}>
      <Card title="Loading page" subtitle="Preparing dashboard modules.">
        <Skeleton height={16} style={{ marginBottom: 10 }} />
        <Skeleton height={16} style={{ marginBottom: 10 }} />
        <Skeleton height={16} width="65%" />
      </Card>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Header />
      <Suspense fallback={<AppSuspenseFallback />}>
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/live" element={<AdminTokenGate><LiveOps /></AdminTokenGate>} />
            <Route path="/feed" element={<Feed />} />
            <Route path="/chat" element={<AdminTokenGate><Chat /></AdminTokenGate>} />
            <Route path="/doc/:id" element={<DocDetail />} />
            <Route path="/search" element={<Search />} />
            <Route path="/consult" element={<Consult />} />
            <Route path="/graph" element={<GraphPage />} />
            <Route path="/graph3d" element={<Navigate to="/graph" replace />} />
            <Route path="/handoff" element={<Handoff />} />
            <Route path="/activity" element={<Activity />} />
            <Route path="/forum" element={<Forum />} />
            <Route path="/decisions" element={<Decisions />} />
            <Route path="/evolution" element={<Evolution />} />
            <Route path="/traces" element={<Traces />} />
            <Route path="/traces/:id" element={<Traces />} />
            <Route path="/superseded" element={<Superseded />} />
            <Route path="/scheduler" element={<AdminTokenGate><SchedulerPage /></AdminTokenGate>} />
            <Route path="/scheduler/:id" element={<AdminTokenGate><JobDetailPage /></AdminTokenGate>} />
            <Route path="/health" element={<AdminTokenGate><SystemHealth /></AdminTokenGate>} />
            <Route path="/heartbeat" element={<AdminTokenGate><HeartbeatConfigPage /></AdminTokenGate>} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/admin/memory" element={<AdminMemory />} />
            <Route path="/admin/logs" element={<AdminLogs />} />
          </Routes>
        </ErrorBoundary>
      </Suspense>
      <QuickLearn />
      <KeyboardShortcutOverlay />
    </BrowserRouter>
  );
}

export default App;
