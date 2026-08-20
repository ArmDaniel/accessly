import { Route, Routes } from 'react-router-dom';
import { NavigationProvider } from './a11y/NavigationContext.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { Layout } from './components/Layout.js';
import { HomePage } from './pages/HomePage.js';
import { ScanPage } from './pages/ScanPage.js';
import { PlatformPage } from './pages/PlatformPage.js';
import { MonitoringPage } from './pages/MonitoringPage.js';
import { CoveragePage } from './pages/CoveragePage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { MonitoringDashboardPage } from './pages/MonitoringDashboardPage.js';
import { JourneysPage } from './pages/JourneysPage.js';
import { AuditDetailPage } from './pages/AuditDetailPage.js';
import { StandardsPage } from './pages/StandardsPage.js';
import { AccessibilityStatementPage } from './pages/AccessibilityStatementPage.js';
import {
  AboutPage,
  ContactPage,
  EaaPage,
  NotFoundPage,
  PricingPage,
} from './pages/ContentPages.js';

export function App(): React.JSX.Element {
  return (
    // NavigationProvider sits above the routes on purpose — it has to survive
    // the remounts that every navigation causes.
    <NavigationProvider>
      <Layout>
        {/* Inside the layout on purpose: a broken page must not take the
            navigation with it, and the fallback keeps its landmarks. */}
        <ErrorBoundary>
          <Routes>
            {/* Marketing and reference. */}
            <Route path="/" element={<HomePage />} />
            <Route path="/scan" element={<ScanPage />} />
            <Route path="/platform" element={<PlatformPage />} />
            <Route path="/monitoring" element={<MonitoringPage />} />
            <Route path="/coverage" element={<CoveragePage />} />
            <Route path="/standards" element={<StandardsPage />} />
            <Route path="/standards/eaa" element={<EaaPage />} />
            <Route path="/pricing" element={<PricingPage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/contact" element={<ContactPage />} />
            <Route path="/accessibility" element={<AccessibilityStatementPage />} />

            {/* The client-facing application. */}
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/dashboard/monitoring" element={<MonitoringDashboardPage />} />
            <Route path="/dashboard/journeys" element={<JourneysPage />} />
            <Route path="/dashboard/audits/:id" element={<AuditDetailPage />} />

            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </ErrorBoundary>
      </Layout>
    </NavigationProvider>
  );
}
