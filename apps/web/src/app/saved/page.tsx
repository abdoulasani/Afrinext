import AppHeader from "@/components/AppHeader";
import SavedList from "@/components/SavedList";

export const metadata = { title: "Saved" };

export default function SavedPage() {
  return (
    <>
      <AppHeader title="Saved" subtitle="Stored on this device" />
      <SavedList />
    </>
  );
}
