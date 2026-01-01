import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import StreamingPage from './components/StreamingPage';
import { ReactFlowProvider } from 'reactflow';
import MissionControlLayout from './components/mission-control/layout/MissionControlLayout';
import { ToastProvider } from './contexts/ToastContext';
import { ToastContainer } from './components/ui/Toast';
import './index.css';
import { Button } from './components/ui/button';

function App() {
  return (
    <ToastProvider>
      <Router>
        <Routes>
          <Route path="/" element={<MissionControlLayout />} />
          <Route path="/streaming" element={<StreamingPage />} />
        </Routes>
      </Router>
      <ToastContainer />
    </ToastProvider>
  );
}

export default App;
