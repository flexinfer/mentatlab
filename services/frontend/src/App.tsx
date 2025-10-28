import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import StreamingPage from './components/StreamingPage';
import { ReactFlowProvider } from 'reactflow';
import MissionControlLayout from './components/mission-control/layout/MissionControlLayout';
import './index.css';
import { Button } from './components/ui/button';
function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<MissionControlLayout />} />
        <Route path="/streaming" element={<StreamingPage />} />
      </Routes>
    </Router>
  );
}

export default App;
