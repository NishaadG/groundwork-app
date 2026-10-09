"use client";

/**
 * Draws the report card as a 1080×1080 PNG for sharing. Uses the page's
 * loaded Anek fonts and the light palette, so the image matches the product.
 */
export async function reportCardImage(opts: {
  title: string;
  resource: string;
  grade: string;
  change: string;
  foot: string;
}): Promise<Blob> {
  await document.fonts.ready;
  const size = 1080;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unsupported");
  const family = getComputedStyle(document.body).fontFamily;
  const ink = "#18213d";
  const muted = "#4e5770";

  ctx.fillStyle = "#eef1ef";
  ctx.fillRect(0, 0, size, size);
  // parapet frame, as on the terrace
  ctx.strokeStyle = ink;
  ctx.lineWidth = 4;
  ctx.strokeRect(60, 60, size - 120, size - 120);
  ctx.lineWidth = 2;
  ctx.strokeRect(96, 96, size - 192, size - 192);
  // energy rule
  ctx.fillStyle = "#f3b21b";
  ctx.fillRect(150, 300, 120, 10);

  ctx.fillStyle = ink;
  ctx.font = `650 64px ${family}`;
  ctx.fillText(opts.title, 150, 230);
  ctx.fillStyle = muted;
  ctx.font = `500 40px ${family}`;
  ctx.fillText(opts.resource, 150, 380);
  ctx.fillStyle = ink;
  ctx.font = `700 360px ${family}`;
  ctx.fillText(opts.grade, 140, 720);
  ctx.fillStyle = muted;
  ctx.font = `400 40px ${family}`;
  ctx.fillText(opts.change, 150, 800);
  ctx.font = `400 30px ${family}`;
  ctx.fillText(opts.foot, 150, 930);

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"),
  );
}

export async function shareOrDownload(blob: Blob, filename: string, title: string) {
  const file = new File([blob], filename, { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title });
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
