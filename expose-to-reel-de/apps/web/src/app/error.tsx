"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="container">
      <div className="card empty-state">
        <h1>Unerwarteter Fehler</h1>
        <p className="muted">
          Etwas ist schiefgelaufen. Bitte versuchen Sie es erneut.
          {error.digest && (
            <>
              <br />
              <span className="small">Referenz: {error.digest}</span>
            </>
          )}
        </p>
        <button type="button" className="btn primary" onClick={reset}>
          Erneut versuchen
        </button>
      </div>
    </main>
  );
}
