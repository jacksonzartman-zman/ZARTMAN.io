import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";

const ADMIN_COOKIE_NAME = "admin-auth";

type UploadRow = {
  id: string;
  file_name: string;
  file_path: string;
  file_size: number | null;
  content_type: string | null;
  notes: string | null;
  email: string | null;
  created_at: string | null;
};

// Server action: handle password submit
export async function authenticate(formData: FormData) {
  "use server";

  const password = (formData.get("password") ?? "").toString();
  const expected = process.env.ADMIN_DASH_PASSWORD;

  if (expected && password === expected) {
    cookies().set(ADMIN_COOKIE_NAME, "ok", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 8, // 8 hours
      path: "/",
    });
  }

  // Always bounce back to /admin (either logged in or still on the form)
  redirect("/admin");
}

async function getUploads(): Promise<UploadRow[]> {
  const { data, error } = await supabaseServer
    .from("uploads")
    .select(
      "id, file_name, file_path, file_size, content_type, notes, email, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("Error fetching uploads:", error);
    return [];
  }

  return (data ?? []) as UploadRow[];
}

export default async function AdminPage() {
  const cookieStore = cookies();
  const isAuthed = cookieStore.get(ADMIN_COOKIE_NAME)?.value === "ok";

  // Not authenticated → show password form
  if (!isAuthed) {
    return (
      <main className="min-h-screen bg-neutral-950 text-neutral-50 flex items-center justify-center px-4">
        <form
          action={authenticate}
          className="w-full max-w-sm space-y-4 rounded-2xl border border-neutral-800 bg-neutral-900 p-6"
        >
          <h1 className="text-lg font-semibold">Admin – Zartman.io</h1>
          <p className="text-xs text-neutral-400">
            Private area. Enter the admin password to view uploads.
          </p>
          <input
            type="password"
            name="password"
            placeholder="Admin password"
            className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
            autoComplete="current-password"
          />
          <button
            type="submit"
            className="w-full rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-black hover:bg-emerald-400"
          >
            Enter
          </button>
        </form>
      </main>
    );
  }

  // Authenticated → show dashboard
  const uploads = await getUploads();

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50 px-4 py-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">Uploads dashboard</h1>
            <p className="text-xs text-neutral-400">
              Latest CAD uploads hitting Supabase.
            </p>
          </div>
        </header>

        <div className="overflow-x-auto rounded-2xl border border-neutral-800 bg-neutral-900">
          <table className="min-w-full text-left text-xs">
            <thead className="border-b border-neutral-800 bg-neutral-900/60">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">File</th>
                <th className="px-4 py-3">Size</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Notes</th>
              </tr>
            </thead>
            <tbody>
              {uploads.map((u) => (
                <tr key={u.id} className="border-t border-neutral-800/60">
                  <td className="px-4 py-3 text-neutral-400 whitespace-nowrap">
                    {u.created_at
                      ? new Date(u.created_at).toLocaleString()
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {u.file_name || u.file_path || "—"}
                  </td>
                  <td className="px-4 py-3 text-neutral-400">
                    {u.file_size
                      ? `${(u.file_size / 1024).toFixed(1)} KB`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-neutral-400">
                    {u.content_type ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-neutral-400 max-w-xs truncate">
                    {u.notes ?? "—"}
                  </td>
                </tr>
              ))}

              {uploads.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-neutral-500"
                  >
                    No uploads logged yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
