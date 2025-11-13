import CadUpload from "@/components/CadUpload";

export default function Page() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "2.5rem",
        padding: "6rem 1.5rem",
        background: "radial-gradient(circle at top, rgba(39, 75, 211, 0.35), rgba(9, 10, 13, 0.95))",
        color: "#f5f6f8",
        textAlign: "center",
      }}
    >
      <header style={{ maxWidth: "640px", display: "grid", gap: "1rem" }}>
        <h1 style={{ fontSize: "3rem", margin: 0 }}>Zartman.io powers the modern manufacturing OS</h1>
        <p style={{ fontSize: "1.15rem", margin: 0, color: "#b2b5be" }}>
          Upload your CAD files to share quotes, collaborate with suppliers, and deliver parts faster. Drag
          and drop is optional—just tap the picker below on iPad or desktop and we&apos;ll take it from there.
        </p>
      </header>

      <CadUpload />
    </main>
  );
}
