import { useState } from 'react';
import { registerUser } from '../services/api';

function RegisterPage({ onRegister, onSwitchToLogin }) {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormData((currentValue) => ({
      ...currentValue,
      [name]: value,
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrorMessage('');

    if (formData.password !== formData.confirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    if (formData.password.length < 8) {
      setErrorMessage('Password must be at least 8 characters long.');
      return;
    }

    try {
      setIsSubmitting(true);
      const result = await registerUser(formData.name, formData.email, formData.password);
      onRegister(result);
    } catch (error) {
      setErrorMessage(error.message || 'Registration failed. Please try again.');
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
            <p className="eyebrow">Create your account</p>
            <h1>KGK Cloud Storage</h1>
          </div>
        </div>

        <div className="auth-card">
          <h2>Get started</h2>
          <p className="subtitle">Set up your secure cloud workspace in a few steps.</p>

          <form onSubmit={handleSubmit} className="auth-form">
            <label>
              Full name
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                placeholder="Your full name"
                required
              />
            </label>

            <label>
              Email
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="you@example.com"
                required
              />
            </label>

            <label>
              Password
              <div className="password-wrap">
                <input
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  placeholder="Create a strong password"
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

            <label>
              Confirm password
              <input
                type={showPassword ? 'text' : 'password'}
                name="confirmPassword"
                value={formData.confirmPassword}
                onChange={handleChange}
                placeholder="Type your password again"
                required
              />
            </label>

            {errorMessage ? <p className="error-banner">{errorMessage}</p> : null}

            <button type="submit" className="primary-button" disabled={isSubmitting}>
              {isSubmitting ? 'Creating account...' : 'Create account'}
            </button>
          </form>

          <p className="switch-auth">
            Already have an account? <button type="button" className="inline-link" onClick={onSwitchToLogin}>Log in</button>
          </p>
        </div>
      </div>

      <aside className="feature-panel">
        <div className="feature-box">
          <h3>Private by design</h3>
          <p>Every file workflow is protected by validation and secure cloud access patterns.</p>
        </div>
        <div className="feature-box">
          <h3>Scalable storage</h3>
          <p>Organize folders, manage files, and plan for future cloud storage growth.</p>
        </div>
        <div className="feature-box">
          <h3>Portfolio-grade UI</h3>
          <p>Built with a professional dashboard layout inspired by Google Drive and Dropbox.</p>
        </div>
      </aside>
    </div>
  );
}

export default RegisterPage;
