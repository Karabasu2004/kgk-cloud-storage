import { useState } from 'react';
import { loginUser } from '../services/api';
import MascotCloud from '../components/MascotCloud';
import '../styles/auth-pages.css';

function LoginPage({ onLogin, onSwitchToRegister }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [look, setLook] = useState({ nx: 0, ny: 0 });

  function updateLook(clientX, clientY) {
    const width = window.innerWidth || 1;
    const height = window.innerHeight || 1;

    setLook({
      nx: Math.max(-1, Math.min(1, clientX / width * 2 - 1)),
      ny: Math.max(-1, Math.min(1, clientY / height * 2 - 1)),
    });
  }

  function handlePointerMove(event) {
    updateLook(event.clientX, event.clientY);
  }

  function handleTouchMove(event) {
    const touch = event.touches && event.touches[0];

    if (touch) {
      updateLook(touch.clientX, touch.clientY);
    }
  }

  function handlePointerLeave() {
    setLook({ nx: 0, ny: 0 });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const result = await loginUser(email, password);
      onLogin(result);
    } catch (err) {
      setError(err.message || 'Unable to sign in. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main
      className="kgk-original-auth-page"
      onPointerMove={handlePointerMove}
      onTouchMove={handleTouchMove}
      onPointerLeave={handlePointerLeave}
    >
      {/* Original landscape background */}
      <svg
        className="dune"
        viewBox="0 0 1440 300"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          d="M0 180 C240 80 480 260 760 170 C1040 80 1240 220 1440 140 L1440 300 L0 300Z"
          fill="#8a5a1f"
          opacity="0.8"
        />

        <path
          d="M0 240 C300 170 560 290 860 230 C1100 190 1280 270 1440 220 L1440 300 L0 300Z"
          fill="#1f130a"
        />
      </svg>

      <div className="spark" style={{ left: '3%', top: '14%' }} />
      <div
        className="spark"
        style={{
          left: '7%',
          top: '30%',
          animationDelay: '1.2s',
          width: '9px',
          height: '9px',
        }}
      />

      <div className="frame">
        <div className="sphere" aria-hidden="true" />

        {/* Original navigation, with irrelevant links removed */}
        <nav className="kgk-original-nav rise">
          <div className="kgk-original-brand">
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#fff"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M7 18a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 8.5a4.5 4.5 0 0 1 .5 9.5z" />
            </svg>
            KGK.cloud
          </div>
        </nav>

        <div className="kgk-original-content">
          {/* Original left-side login content */}
          <section className="kgk-original-form-section">
            <div
              className="kgk-original-intro rise"
              style={{ animationDelay: '.15s' }}
            >
              <h1>Welcome back to your Cloud</h1>
              <p>
                Sign in to reach your files from anywhere, on any device.
              </p>
            </div>

            <form onSubmit={handleSubmit}>
              <label
                className="field rise"
                style={{ animationDelay: '.3s' }}
                htmlFor="login-email"
              >
                Email
                <input
                  id="login-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                />
              </label>

              <label
                className="field rise"
                style={{ animationDelay: '.42s', marginTop: '22px' }}
                htmlFor="login-password"
              >
                Password
                <input
                  id="login-password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>

              {error && (
                <div
                  className="kgk-original-error"
                  role="alert"
                  aria-live="polite"
                >
                  {error}
                </div>
              )}

              <div
  className="kgk-original-actions rise"
  style={{
    animationDelay: '.62s',
    marginTop: '22px',
  }}
>
  <button
    className="pill dark"
    type="submit"
    disabled={submitting}
    style={{
      minHeight: '50px',
      padding: '0 30px',
      fontSize: '15px',
    }}
  >
    {submitting ? 'Signing in...' : 'Sign in'}
  </button>

  <button
    className="pill dark"
    type="button"
    onClick={onSwitchToRegister}
    style={{
      minHeight: '50px',
      padding: '0 26px',
      fontSize: '15px',
    }}
  >
    Create account
  </button>
</div>
            </form>
          </section>

          {/* Original right-side mascot stage */}
          <section
            className="kgk-original-mascot-section rise"
            style={{ animationDelay: '.3s' }}
          >
            <MascotCloud nx={look.nx} ny={look.ny} />
          </section>
        </div>
      </div>
    </main>
  );
}

export default LoginPage;
