"use client";

import { useState } from "react";

type Asset = {
  id: string;
  title: string;
  contentType: string;
  byteSize: number;
};

/**
 * The buyer's files.
 *
 * There is no href here until the person asks for one. Clicking mints a
 * short-lived grant through the API and then follows it — so nothing on this
 * page is a durable link that could be copied into a message, and a grant that
 * does leak is bound to the session it was issued to and expires in two
 * minutes.
 *
 * The button being disabled, hidden or edited changes nothing: both the grant
 * endpoint and the content route resolve the actor and re-check the entitlement
 * server-side. This component decides what is shown, never what is allowed.
 */
export default function AssetList({
  storeSlug, productSlug, deliveryMode, assets, labels,
}: {
  storeSlug: string;
  productSlug: string;
  deliveryMode: "download" | "view_only";
  assets: readonly Asset[];
  labels: { download: string; view: string; failed: string };
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const disposition = deliveryMode === "view_only" ? "inline" : "attachment";

  async function open(assetId: string): Promise<void> {
    setBusy(assetId);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/library/${storeSlug}/${productSlug}/access`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ assetId, disposition }),
        },
      );
      if (!response.ok) {
        setError(labels.failed);
        return;
      }
      const body = (await response.json()) as { data: { url: string } };
      window.location.assign(body.data.url);
    } catch {
      setError(labels.failed);
    } finally {
      setBusy(null);
    }
  }

  return (
    <ul data-testid="assets" className="flex flex-col gap-2">
      {error !== null && (
        <li role="alert" className="rounded-xl bg-primary-soft px-3 py-2 text-sm font-medium text-primary">
          {error}
        </li>
      )}
      {assets.map((asset) => (
        <li
          key={asset.id}
          className="flex items-center justify-between gap-3 rounded-xl bg-surface-muted px-3 py-2"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{asset.title}</span>
            <span className="block font-mono text-xs text-muted">
              {asset.contentType} · {Math.max(1, Math.round(asset.byteSize / 1024))} KB
            </span>
          </span>
          <button
            type="button"
            data-testid={`asset-open-${asset.id}`}
            disabled={busy === asset.id}
            onClick={() => void open(asset.id)}
            className="shrink-0 rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-contrast disabled:opacity-60"
          >
            {deliveryMode === "view_only" ? labels.view : labels.download}
          </button>
        </li>
      ))}
    </ul>
  );
}
