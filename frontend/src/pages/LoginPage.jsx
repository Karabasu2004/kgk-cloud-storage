import { useState } from 'react';
import { loginUser } from '../services/api';

function LoginPage({ onLogin, onSwitchToRegister, session }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrorMessage('');
    setIsSubmitting(true);

    try {
      const result = await loginUser(email, password);
      onLogin(result);
    } catch (error) {
      setErrorMessage(error.message || 'Login failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-panel">
        <div className="brand-block">
          <div className="brand-mark">K</div>
          <div>
            <p className="eyebrow">Secure cloud workspace</p>
            <h1>KGK Cloud Storage</h1>
          </div>
        </div>

        <div className="auth-card">
          <h2>Welcome back</h2>
          <p className="subtitle">Sign in to access your files and folders.</p>

          <form onSubmit={handleSubmit} className="auth-form">
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
              />
            </label>

            <label>
              Password
              <div className="password-wrap">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter your password"
                  required
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((currentValue) => !currentValue)}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </label>

            <div className="form-meta">
              <label className="remember-me">
                <input type="checkbox" />
                Remember me
              </label>
              <a href="#">Forgot password?</a>
            </div>

            {errorMessage ? <p className="error-banner">{errorMessage}</p> : null}

            <button type="submit" className="primary-button" disabled={isSubmitting}>
              {isSubmitting ? 'Signing in...' : 'Log in'}
            </button>
          </form>

          <p className="switch-auth">
            Don’t have an account? <button type="button" className="inline-link" onClick={onSwitchToRegister}>Create account</button>
          </p>
        </div>
      </div>

      <aside className="feature-panel">
        <div className="feature-box">
          <h3>Secure storage</h3>
          <p>Private file access with protected cloud workflows and signed download links.</p>
        </div>
        <div className="feature-box">
          <h3>Smart dashboard</h3>
          <p>Track storage, activity, and recent files in a Google Drive-inspired interface.</p>
        </div>
        <div className="feature-box">
          <h3>Built for AWS</h3>
          <p>Designed around S3 storage and backend validation for production-ready security.</p>
        </div>
      </aside>

      {session ? (
        <div className="session-banner">
          <strong>Logged in:</strong> {session.user?.email}
        </div>
      ) : null}
    </div>
  );
}

export default LoginPage;
