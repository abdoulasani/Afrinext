import AppHeader from "@/components/AppHeader";

export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <>
      <AppHeader title="You are offline" />
      <div className="px-4 py-16 text-center">
        <p className="text-4xl" aria-hidden="true">
          📡
        </p>
        <h2 className="mt-4 text-lg font-semibold">No connection</h2>
        <p className="mx-auto mt-2 max-w-xs text-sm text-muted">
          Afrinext needs a connection to load new listings. Pages you already
          opened stay available, and saved listings are stored on this device.
        </p>
      </div>
    </>
  );
}
