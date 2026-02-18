import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Header } from './components/Header';
import { QuickLearn } from './components/QuickLearn';
import { Overview } from './pages/Overview';
import { Feed } from './pages/Feed';
import { DocDetail } from './pages/DocDetail';
import { Search } from './pages/Search';
import { Consult } from './pages/Consult';
import { Graph } from './pages/Graph';
import { Handoff } from './pages/Handoff';
import { Activity } from './pages/Activity';
import { Forum } from './pages/Forum';
import { Decisions } from './pages/Decisions';
import { Evolution } from './pages/Evolution';
import { Traces } from './pages/Traces';
import { Superseded } from './pages/Superseded';

// Lazy-loaded admin pages (not needed on every page load)
const Admin = lazy(() => import('./pages/Admin').then(m => ({ default: m.Admin })));
const AdminMemory = lazy(() => import('./pages/AdminMemory').then(m => ({ default: m.AdminMemory })));
const AdminLogs = lazy(() => import('./pages/AdminLogs').then(m => ({ default: m.AdminLogs })));

function App() {
  return (
    <BrowserRouter>
      <Header />
      <Suspense fallback={<div style={{ textAlign: 'center', padding: '2rem', color: '#888' }}>Loading...</div>}>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/feed" element={<Feed />} />
          <Route path="/doc/:id" element={<DocDetail />} />
          <Route path="/search" element={<Search />} />
          <Route path="/consult" element={<Consult />} />
          <Route path="/graph" element={<Graph />} />
          <Route path="/graph3d" element={<Navigate to="/graph" replace />} />
          <Route path="/handoff" element={<Handoff />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/forum" element={<Forum />} />
          <Route path="/decisions" element={<Decisions />} />
          <Route path="/evolution" element={<Evolution />} />
          <Route path="/traces" element={<Traces />} />
          <Route path="/traces/:id" element={<Traces />} />
          <Route path="/superseded" element={<Superseded />} />
          {/* Admin dashboard — lazy loaded */}
          <Route path="/admin" element={<Admin />} />
          <Route path="/admin/memory" element={<AdminMemory />} />
          <Route path="/admin/logs" element={<AdminLogs />} />
        </Routes>
      </Suspense>
      <QuickLearn />
    </BrowserRouter>
  );
}

export default App;
