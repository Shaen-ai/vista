const DEFAULT_MAX_EDGE = 1200;
const DEFAULT_QUALITY = 0.75;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = src;
  });
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Failed to encode JPEG"))),
      "image/jpeg",
      quality,
    );
  });
}

async function compressFromImageElement(
  img: HTMLImageElement,
  maxEdge: number,
  quality: number,
): Promise<{ base64: string; mimeType: string }> {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) throw new Error("Invalid image dimensions");

  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(img, 0, 0, tw, th);

  const blob = await canvasToJpegBlob(canvas, quality);
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const parts = result.split(",");
      resolve(parts[1] ?? "");
    };
    reader.onerror = () => reject(new Error("Failed to read blob"));
    reader.readAsDataURL(blob);
  });

  return { base64, mimeType: "image/jpeg" };
}

export async function compressImageFile(
  file: File,
  options?: { maxEdge?: number; quality?: number },
): Promise<{ base64: string; mimeType: string }> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Not an image file");
  }
  const maxEdge = options?.maxEdge ?? DEFAULT_MAX_EDGE;
  const quality = options?.quality ?? DEFAULT_QUALITY;
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
  return compressDataUrl(dataUrl, { maxEdge, quality });
}

export async function compressDataUrl(
  dataUrl: string,
  options?: { maxEdge?: number; quality?: number },
): Promise<{ base64: string; mimeType: string }> {
  const maxEdge = options?.maxEdge ?? DEFAULT_MAX_EDGE;
  const quality = options?.quality ?? DEFAULT_QUALITY;
  const img = await loadImage(dataUrl);
  return compressFromImageElement(img, maxEdge, quality);
}
