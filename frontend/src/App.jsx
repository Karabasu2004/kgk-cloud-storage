import { useEffect, useState } from 'react';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';

const SESSION_STORAGE_KEY = 'kgk-session';

function App() {
  const [session, setSession] = useState(() => {
    const savedSession = localStorage.getItem(SESSION_STORAGE_KEY);
    return savedSession ? JSON.parse(savedSession) : null;
  });
  const [currentView, setCurrentView] = useState(session ? 'dashboard' : 'login');

  useEffect(() => {
    if (session) {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
      return;
    }

    localStorage.removeItem(SESSION_STORAGE_KEY);
  }, [session]);

  const handleAuthSuccess = (result) => {
    setSession(result);
    setCurrentView('dashboard');
  };

  const handleLogout = () => {
    setSession(null);
    setCurrentView('login');
  };

  if (currentView === 'dashboard' && session) {
    return <DashboardPage session={session} onLogout={handleLogout} />;
  }

  if (currentView === 'register') {
    return <RegisterPage onRegister={handleAuthSuccess} onSwitchToLogin={() => setCurrentView('login')} />;
  }

  return (
    <div className="app-shell">
      <LoginPage
        onLogin={handleAuthSuccess}
        onSwitchToRegister={() => setCurrentView('register')}
        session={session}
      />
    </div>
  );
}

export default App;
