import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout.js';
import Suites from './screens/Suites.js';
import Comparison from './screens/Comparison.js';
import CaseDiff from './screens/CaseDiff.js';
import Calibration from './screens/Calibration.js';
import Dataset from './screens/Dataset.js';
import Simulations from './screens/Simulations.js';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/suites" replace />} />
        <Route path="/suites" element={<Suites />} />
        <Route path="/suites/:suiteId/comparisons" element={<Comparison />} />
        <Route path="/suites/:suiteId/comparisons/:comparisonId" element={<Comparison />} />
        <Route path="/suites/:suiteId/comparisons/:comparisonId/cases" element={<CaseDiff />} />
        <Route path="/suites/:suiteId/comparisons/:comparisonId/cases/:externalId" element={<CaseDiff />} />
        <Route path="/suites/:suiteId/dataset" element={<Dataset />} />
        <Route path="/suites/:suiteId/calibrations" element={<Calibration />} />
        <Route path="/simulations" element={<Simulations />} />
        <Route path="*" element={<p className="font-mono text-sm text-muted">Not found.</p>} />
      </Routes>
    </Layout>
  );
}
