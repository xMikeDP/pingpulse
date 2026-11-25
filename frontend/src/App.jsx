import { useEffect, useState } from 'react';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';

function readStoredUser() {
  const token = localStorage.getItem('pingpulse_token');
  const rawUser = localStorage.getItem('pingpulse_user');
  if (!token || !rawUser) return null;
  try {
    return JSON.parse(rawUser);
  } catch {
    return null;
  }
}

export default function App() {
  const [user, setUser] = useState(readStoredUser);

  useEffect(() => {
    const handleUnauthorized = () => setUser(null);
    window.addEventListener('pingpulse:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('pingpulse:unauthorized', handleUnauthorized);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('pingpulse_token');
    localStorage.removeItem('pingpulse_user');
    setUser(null);
  };

  if (!user) {
    return <Login onAuthSuccess={setUser} />;
  }

  return <Dashboard user={user} onLogout={handleLogout} />;
}
