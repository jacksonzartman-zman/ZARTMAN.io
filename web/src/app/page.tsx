import AuthGate from "@/components/AuthGate";
import CadUpload from "@/components/CadUpload";

export default function Page() {
  return (
    <main>
      {/* your hero/marketing copy */}
      <section>
        <AuthGate>
          <CadUpload />
        </AuthGate>
      </section>
    </main>
  );
}
 
