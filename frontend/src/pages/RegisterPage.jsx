import { useState } from 'react';
import { registerUser } from '../services/api';
import MascotCloud from '../components/MascotCloud';
import '../styles/auth-pages.css';

function RegisterPage({ onRegister, onSwitchToLogin }) {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  });

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

  function handleChange(event) {
    setFormData((previous) => ({
      ...previous,
      [event.target.name]: event.target.value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');

    if (formData.password.length < 8) {
      setError('Password must contain at least 8 characters.');
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);

    try {
      const result = await registerUser(
        formData.name,
        formData.email,
        formData.password
      );

      onRegister(result);
    } catch (err) {
      setError(err.message || 'Unable to create your account.');
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
          <section className="kgk-original-form-section">
            <div
              className="kgk-original-intro rise"
              style={{ animationDelay: '.15s' }}
            >
              <h1>Create your Cloud</h1>
              <p>
                Create your personal space and access your files
                from anywhere, on any device.
              </p>
            </div>

            <form onSubmit={handleSubmit}>
              <label
                className="field rise"
                style={{ animationDelay: '.3s' }}
                htmlFor="register-name"
              >
                Full name
                <input
                  id="register-name"
                  name="name"
                  type="text"
                  placeholder="Your full name"
                  value={formData.name}
                  onChange={handleChange}
                  autoComplete="name"
                  required
                />
              </label>

              <label
                className="field rise"
                style={{ animationDelay: '.36s', marginTop: '16px' }}
                htmlFor="register-email"
              >
                Email
                <input
                  id="register-email"
                  name="email"
                  type="email"
                  placeholder="you@example.com"
                  value={formData.email}
                  onChange={handleChange}
                  autoComplete="email"
                  required
                />
              </label>

              <label
                className="field rise"
                style={{ animationDelay: '.42s', marginTop: '16px' }}
                htmlFor="register-password"
              >
                Password
                <input
                  id="register-password"
                  name="password"
                  type="password"
                  placeholder="Minimum 8 characters"
                  value={formData.password}
                  onChange={handleChange}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </label>

              <label
                className="field rise"
                style={{ animationDelay: '.48s', marginTop: '16px' }}
                htmlFor="register-confirm-password"
              >
                Confirm password
                <input
                  id="register-confirm-password"
                  name="confirmPassword"
                  type="password"
                  placeholder="Re-enter your password"
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  autoComplete="new-password"
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
                  {submitting ? 'Creating account...' : 'Create account'}
                </button>

                <button
                  className="pill dark"
                  type="button"
                  onClick={onSwitchToLogin}
                  style={{
                    minHeight: '50px',
                    padding: '0 26px',
                    fontSize: '15px',
                  }}
                >
                  Sign in
                </button>
              </div>
            </form>
          </section>

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

export default RegisterPage;
