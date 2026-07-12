import Link from "next/link";

export default function NotFound() {
  return (
    <main className="container">
      <div className="card empty-state">
        <h1>Seite nicht gefunden</h1>
        <p className="muted">
          Die angeforderte Seite oder das Projekt existiert nicht (mehr).
        </p>
        <Link href="/" className="btn primary">
          Zur Übersicht
        </Link>
      </div>
    </main>
  );
}
