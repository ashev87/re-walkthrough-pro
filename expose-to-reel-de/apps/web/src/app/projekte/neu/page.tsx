import { ImmoScout24ListingProvider } from "@e2r/shared";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/session";
import { isPropstackConfigured } from "@/server/services/propstackImport";
import { NewProjectForm } from "@/components/NewProjectForm";

export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const is24Enabled = new ImmoScout24ListingProvider().isEnabled();

  return (
    <main className="container" style={{ maxWidth: 640 }}>
      <h1>Neues Projekt</h1>
      <div className="card">
        <NewProjectForm
          is24Enabled={is24Enabled}
          propstackEnabled={isPropstackConfigured()}
        />
      </div>
    </main>
  );
}
