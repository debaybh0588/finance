import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.jsx";

function LoginPage() {
  const { isAuthenticated, login } = useAuth();
  const [email, setEmail] = useState("reviewer@tenantdemo.local");
  const [password, setPassword] = useState("demo123");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  const onSubmit = async (event) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage("");

    try {
      await login({ email, password });
    } catch (error) {
      setErrorMessage(error.message || "Login failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="login-page">
      <div className="login-shell">
        <aside className="login-brand-panel">
          <p className="login-kicker">PostRight</p>
          <h1>Close books faster. Post with confidence.</h1>
          <p className="login-brand-copy">
            Intelligent invoice extraction, guided review, and reliable posting workflows for every branch.
          </p>
          <div className="login-brand-tags">
            <span>OCR + Validation</span>
            <span>Review Queue</span>
            <span>Tally Posting</span>
          </div>
        </aside>

        <article className="card login-card">
          <h2>Sign In</h2>
          <p className="login-support-text">Use your workspace credentials to continue.</p>

          <form onSubmit={onSubmit} className="login-form">
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@company.com"
                required
              />
            </label>

            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>

            {errorMessage ? <p className="login-error">{errorMessage}</p> : null}

            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Signing in..." : "Sign In"}
            </button>
          </form>
        </article>
      </div>
    </section>
  );
}

export default LoginPage;
