export interface Paper4ExportEnvelope {
  filename: string;
  contentType: string;
  contentBase64: string;
}

export function paper4ExportFilename(filename: string, extension: "json" | "zip" = "json"): string {
  const stem = filename.replace(/\.(?:json|zip)$/i, "").replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, "-").replace(/^\.+/, "").trim().slice(0, 120);
  return `${stem || "paper4-export"}.${extension}`;
}

export function paper4ExportBytes(contentBase64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function downloadPaper4Export(envelope: Paper4ExportEnvelope): void {
  if (!["application/json", "application/zip"].includes(envelope.contentType)) throw new Error("Unexpected Paper 4 export format.");
  const extension = envelope.contentType === "application/zip" ? "zip" : "json";
  const blob = new Blob([paper4ExportBytes(envelope.contentBase64)], { type: envelope.contentType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = paper4ExportFilename(envelope.filename, extension);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
