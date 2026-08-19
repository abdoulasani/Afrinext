import AppHeader from "@/components/AppHeader";
import SubmitForm from "@/components/SubmitForm";

export const metadata = { title: "List your business" };

export default function SubmitPage() {
  return (
    <>
      <AppHeader
        title="List your business"
        subtitle="Free — reviewed before it is marked verified"
      />
      <SubmitForm />
    </>
  );
}
