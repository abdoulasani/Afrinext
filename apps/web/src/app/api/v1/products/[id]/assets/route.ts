import { NextResponse } from "next/server";
import { content } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { apiError } from "@/lib/api";
import { getContentStorage } from "@/lib/content";
import { requireActor } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * The seller attaches a file to their product.
 *
 * Multipart, because that is what a file upload is; the store scope is resolved
 * from the product row inside `attachAsset`, never from the request. The
 * content type is taken from the part and checked against an allow-list — these
 * bytes are served back from an Afrinext origin, so an accepted `text/html`
 * would be stored XSS against our own domain.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const actor = await requireActor();
    const { id } = await params;

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: { code: "request.invalid", message: "A file is required." } },
        { status: 400 },
      );
    }
    if (file.size > content.MAX_ASSET_BYTES) {
      // Refused before the bytes are read into memory.
      return NextResponse.json(
        { error: { code: "content.too_large", message: "That file is too large." } },
        { status: 400 },
      );
    }

    const title = String(form.get("title") ?? file.name).slice(0, 200);
    const asset = await content.attachAsset(getDb(), getContentStorage(), actor, {
      productId: id,
      title: title === "" ? file.name : title,
      contentType: file.type,
      bytes: Buffer.from(await file.arrayBuffer()),
    });

    return NextResponse.json(
      {
        data: {
          id: asset.id, title: asset.title, contentType: asset.contentType,
          byteSize: asset.byteSize,
        },
      },
      { status: 201 },
    );
  } catch (error: unknown) {
    return apiError(error);
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const assets = await content.listProductAssets(getDb(), actor, id);
    return NextResponse.json({
      data: assets.map((a) => ({
        id: a.id, title: a.title, contentType: a.contentType, byteSize: a.byteSize,
      })),
    });
  } catch (error: unknown) {
    return apiError(error);
  }
}
