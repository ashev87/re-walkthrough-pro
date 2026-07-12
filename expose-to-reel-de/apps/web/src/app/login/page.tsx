import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/session";
import { LoginForm } from "@/components/LoginForm";

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/");
  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>
          Exposé-to-Reel <span style={{ color: "var(--accent)" }}>DE</span>
        </h1>
        <p className="muted small">
          Kinoreife Walkthrough-Videos aus autorisierten Exposés.
        </p>
        <LoginForm />
        <p className="muted small" style={{ marginTop: "1rem" }}>
          Demo-Zugang (Seed-Daten): <code>demo@example.com</code> /{" "}
          <code>demo1234</code>
        </p>
      </div>
    </div>
  );
}
