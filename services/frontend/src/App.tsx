import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { MissionControlLayout } from './components/mission-control/layout';
import { FeatureFlags } from './config/features';
import { ToastProvider } from './contexts/ToastContext';
import { ToastContainer } from './components/ui/Toast';
import './index.css';

// Lazy-load legacy StreamingPage so the bundle only includes it when the flag is on.
const StreamingPage = React.lazy(() => import('./components/StreamingPage'));

function App() {
  return (
    <ToastProvider>
      <Router>
        <Routes>
          <Route path="/" element={<MissionControlLayout />} />
          {FeatureFlags.LEGACY_STREAMING_PAGE ? (
            <Route
              path="/streaming"
              element={
                <React.Suspense fallback={<div className="p-4 text-muted-foreground">Loading...</div>}>
                  <StreamingPage />
                </React.Suspense>
              }
            />
          ) : (
            <Route path="/streaming" element={<Navigate to="/" replace />} />
          )}
        </Routes>
      </Router>
      <ToastContainer />
    </ToastProvider>
  );
}

export default App;
