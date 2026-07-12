import { prisma, PROJECT_STATUS_LABELS } from "@e2r/shared";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/session";

export const dynamic = "force-dynamic";

const SOURCE_LABELS: Record<string, string> = {
  MANUAL_UPLOAD: "Manueller Upload",
  IMMOSCOUT24_API: "API-Verbindung",
  PROPSTACK: "Propstack-Import",
};

/** Dashboard: alle Projekte der Organisation mit Status & Freigabe. */
export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const projects = await prisma.propertyProject.findMany({
    where: { organizationId: user.organizationId },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: {
        select: {
          mediaAssets: { where: { kind: "SOURCE_IMAGE" } },
          approvalRecords: true,
          videoVersions: true,
        },
      },
    },
  });

  return (
    <main className="container">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1rem",
        }}
      >
        <h1>Projekte</h1>
        <Link href="/projekte/neu" className="btn primary">
          + Neues Projekt
        </Link>
      </div>

      {projects.length === 0 ? (
        <div className="card empty-state">
          <p>Noch keine Projekte.</p>
          <p>
            Legen Sie Ihr erstes Projekt an und laden Sie autorisierte
            Objektfotos hoch.
          </p>
          <Link href="/projekte/neu" className="btn primary">
            Erstes Projekt anlegen
          </Link>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Titel</th>
                <th>Status</th>
                <th>Quelle</th>
                <th>Fotos</th>
                <th>Videos</th>
                <th>Freigabe</th>
                <th>Aktualisiert</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id}>
                  <td>
                    <Link href={`/projekte/${project.id}`}>
                      <strong>{project.title}</strong>
                    </Link>
                  </td>
                  <td>
                    <span className={`badge ${project.status}`}>
                      {PROJECT_STATUS_LABELS[project.status]}
                    </span>
                  </td>
                  <td className="muted">{SOURCE_LABELS[project.sourceType]}</td>
                  <td>{project._count.mediaAssets}</td>
                  <td>{project._count.videoVersions}</td>
                  <td>
                    {project._count.approvalRecords > 0 ? (
                      <span className="badge APPROVED">freigegeben</span>
                    ) : (
                      <span className="muted small">ausstehend</span>
                    )}
                  </td>
                  <td className="muted small">
                    {project.updatedAt.toLocaleString("de-DE")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
