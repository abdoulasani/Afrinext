"use client";

import { useActionState } from "react";
import { Badge, buttonClass, inputClass } from "@afrinext/ui";
import type { ActionState } from "@/lib/catalog-actions";

export type VersionSummary = {
  id: string;
  versionNo: number;
  status: "draft" | "published";
  assetCount: number;
};

/**
 * Everything a seller decides about how their file is delivered.
 *
 * Versions, licence and download limit sit together because they are one
 * question in the seller's head — "what exactly am I selling, and on what
 * terms?" — even though they are three tables underneath.
 *
 * All three forms post a product id and let the server resolve the owning store
 * from it. Nothing here decides what is allowed; the domain re-checks every
 * time, and a product id belonging to somebody else is refused identically to
 * one that does not exist.
 */
export default function ProductDelivery({
  locale, storeSlug, productId, versions, licence, downloadLimit, labels,
  setLicence, setLimit, publishVersion,
}: {
  locale: string;
  storeSlug: string;
  productId: string;
  versions: readonly VersionSummary[];
  licence: string;
  downloadLimit: number | null;
  labels: Readonly<Record<string, string>>;
  setLicence: (state: ActionState, form: FormData) => Promise<ActionState>;
  setLimit: (state: ActionState, form: FormData) => Promise<ActionState>;
  publishVersion: (state: ActionState, form: FormData) => Promise<ActionState>;
}) {
  const [licenceState, licenceAction, licenceBusy] =
    useActionState<ActionState, FormData>(setLicence, {});
  const [limitState, limitAction, limitBusy] =
    useActionState<ActionState, FormData>(setLimit, {});
  const [publishState, publishAction, publishBusy] =
    useActionState<ActionState, FormData>(publishVersion, {});

  const draft = versions.find((v) => v.status === "draft");
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="storeSlug" value={storeSlug} />
      <input type="hidden" name="productId" value={productId} />
    </>
  );

  const problem = licenceState.error ?? limitState.error ?? publishState.error;

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      <span className="text-label font-semibold uppercase tracking-[0.14em] text-muted">
        {labels["versions"]}
      </span>

      <ul data-testid={`versions-${productId}`} className="flex flex-wrap gap-1.5">
        {versions.map((v) => (
          <li key={v.id}>
            <Badge tone={v.status === "published" ? "accent" : "neutral"}>
              v{v.versionNo} ·{" "}
              {v.status === "published" ? labels["published"] : labels["draft"]} ·{" "}
              {(labels["files"] ?? "").replace("{count}", String(v.assetCount))}
            </Badge>
          </li>
        ))}
      </ul>

      {/*
        * Publishing a draft is offered only when there is a draft with files in
        * it — a version with none would sell a buyer nothing.
        */}
      {draft !== undefined && draft.assetCount > 0 && (
        <form action={publishAction}>
          {hidden}
          <button
            type="submit"
            disabled={publishBusy}
            data-testid={`publish-version-${productId}`}
            className={buttonClass("outline", "sm")}
          >
            {labels["publishVersion"]}
          </button>
        </form>
      )}

      <form action={licenceAction} className="flex flex-col gap-1.5">
        {hidden}
        <label htmlFor={`licence-${productId}`} className="text-small font-medium">
          {labels["licence"]}
        </label>
        <p className="text-caption text-muted">{labels["licenceHint"]}</p>
        <textarea
          id={`licence-${productId}`}
          name="licence"
          rows={3}
          maxLength={20000}
          defaultValue={licence}
          data-testid={`licence-${productId}`}
          className={inputClass}
        />
        <button type="submit" disabled={licenceBusy} className={buttonClass("outline", "sm")}
          data-testid={`save-licence-${productId}`}>
          {labels["saveLicence"]}
        </button>
      </form>

      <form action={limitAction} className="flex flex-col gap-1.5">
        {hidden}
        <label htmlFor={`limit-${productId}`} className="text-small font-medium">
          {labels["downloadLimit"]}
        </label>
        <p className="text-caption text-muted">{labels["downloadLimitHint"]}</p>
        <input
          id={`limit-${productId}`}
          name="limit"
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          defaultValue={downloadLimit === null ? "" : String(downloadLimit)}
          data-testid={`limit-${productId}`}
          className={inputClass}
        />
        <button type="submit" disabled={limitBusy} className={buttonClass("outline", "sm")}
          data-testid={`save-limit-${productId}`}>
          {labels["saveLimit"]}
        </button>
      </form>

      {problem !== undefined && (
        <p role="alert" data-testid={`delivery-error-${productId}`}
          className="rounded-[var(--radius-md)] border border-[var(--danger)]/25 bg-[var(--danger-soft)] px-3.5 py-2.5 text-small font-medium text-[var(--danger)]">
          {problem}
        </p>
      )}
    </div>
  );
}
