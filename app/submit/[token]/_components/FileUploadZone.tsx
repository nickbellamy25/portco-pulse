"use client";

import { useRef, useState, useEffect, forwardRef, useImperativeHandle } from "react";
import { Paperclip, X, Loader2 } from "lucide-react";
import type { UploadResult } from "@/app/api/upload/route";

interface Props {
  token: string;
  onUploadComplete: (results: UploadResult[]) => void;
  disabled?: boolean;
  pendingUploads: UploadResult[];
  onRemoveUpload: (index: number) => void;
  /** When true, hides the drop zone — only pending chips are rendered. */
  compact?: boolean;
}

export interface FileUploadZoneHandle {
  handleFiles: (files: FileList | File[]) => Promise<void>;
  triggerOpen: () => void;
}

const ACCEPTED = ".pdf,.xlsx,.xls,.csv,.docx,.doc,.png,.jpg,.jpeg,.tiff";
const MAX_FILES = 5;

const MIME_BY_EXT: Record<string, string> = {
  pdf:  "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls:  "application/vnd.ms-excel",
  csv:  "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc:  "application/msword",
  png:  "image/png",
  jpg:  "image/jpeg",
  jpeg: "image/jpeg",
  tiff: "image/tiff",
};

function guessMimeFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

export const FileUploadZone = forwardRef<FileUploadZoneHandle, Props>(function FileUploadZone(
  { token, onUploadComplete, disabled, pendingUploads, onRemoveUpload, compact = false },
  ref
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  useImperativeHandle(ref, () => ({
    handleFiles,
    triggerOpen: () => inputRef.current?.click(),
  }));

  // Prevent browser from navigating to dropped files
  useEffect(() => {
    const prevent = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    window.addEventListener("dragenter", prevent, { capture: true });
    window.addEventListener("dragover", prevent, { capture: true });
    window.addEventListener("drop", prevent, { capture: true });
    return () => {
      window.removeEventListener("dragenter", prevent, { capture: true });
      window.removeEventListener("dragover", prevent, { capture: true });
      window.removeEventListener("drop", prevent, { capture: true });
    };
  }, []);

  async function handleFiles(files: FileList | File[]) {
    const fileArray = Array.from(files);
    if (pendingUploads.length + fileArray.length > MAX_FILES) {
      setError(`Maximum ${MAX_FILES} files per submission.`);
      return;
    }
    setError(null);
    setUploading(true);

    const results: UploadResult[] = [];
    for (const file of fileArray) {
      try {
        const buffer = await file.arrayBuffer();
        const mimeType = file.type || guessMimeFromName(file.name);
        const blob = new Blob([buffer], { type: mimeType });
        const fd = new FormData();
        fd.append("file", blob, file.name);
        fd.append("token", token);

        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const text = await res.text();
        let data: any;
        try {
          data = JSON.parse(text);
        } catch {
          setError(`Upload failed (${res.status}): ${text.slice(0, 200)}`);
          continue;
        }
        if (!res.ok) {
          setError(data.message ?? `Upload failed (${res.status}).`);
          continue;
        }
        results.push(data as UploadResult);
      } catch (err: any) {
        setError(`Upload failed — ${err?.message ?? "please try again."}`);
      }
    }

    setUploading(false);
    if (results.length > 0) onUploadComplete(results);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    if (disabled || uploading) return;
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) handleFiles(files);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    if (!disabled && !uploading) setDragging(true);
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  function handleDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragging(false);
    }
  }

  return (
    <div>
      {/* Pending upload chips */}
      {pendingUploads.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {pendingUploads.map((u, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 bg-muted border border-border rounded-full px-3 py-1 text-xs"
            >
              <Paperclip className="h-3 w-3 text-muted-foreground" />
              <span className="max-w-[140px] truncate">{u.fileName}</span>
              <button
                type="button"
                onClick={() => onRemoveUpload(i)}
                className="text-muted-foreground hover:text-foreground ml-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-destructive mb-1">{error}</p>}

      {/* Hidden file input — always present, drop zone only shown when not compact */}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        multiple
        className="hidden"
        onChange={(e) => e.target.files && handleFiles(e.target.files)}
      />

      {!compact && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onClick={() => !disabled && !uploading && inputRef.current?.click()}
          className={`flex items-center justify-center gap-2 w-full rounded-lg border border-dashed px-4 py-3 text-xs transition-colors cursor-pointer ${
            dragging
              ? "border-primary bg-primary/5 text-primary"
              : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
          } ${disabled || uploading ? "opacity-50 cursor-default" : ""}`}
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          ) : (
            <Paperclip className="h-4 w-4 shrink-0" />
          )}
          <span>
            {uploading
              ? "Uploading…"
              : dragging
              ? "Drop to attach"
              : <><span className="font-medium">Attach file</span> or drag and drop</>}
          </span>
        </div>
      )}
    </div>
  );
});
