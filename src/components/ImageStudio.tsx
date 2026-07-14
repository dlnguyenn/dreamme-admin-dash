"use client";

import * as React from "react";
import { Button, useToast } from "./ui";
import { PageHeader } from "./Shell";
import { Icons } from "./Icons";
import { downscaleImageToBase64 } from "@/lib/supabase";
import { AVATAR_IDS, type AvatarId } from "@/lib/avatars";
import {
  POSE_IDS,
  WOMEN_POSE_IDS,
  MEN_POSE_IDS,
  type PoseId,
} from "@/lib/poses";
import type { Avatar, Pose } from "@/lib/types";

const ASPECT_OPTIONS = ["9:16", "16:9", "4:3", "3:4", "1:1"] as const;
type AspectRatio = (typeof ASPECT_OPTIONS)[number];

// Output resolution. Mirrors IMAGE_SIZES in src/lib/image-generation.ts
// (the lib also supports "0.5K", omitted here — rarely useful for our
// social-video work). 2K is the default: sharper sources survive TikTok's
// recompression better than the model's 1K default.
const IMAGE_SIZE_OPTIONS = ["1K", "2K", "4K"] as const;
type ImageSizeOpt = (typeof IMAGE_SIZE_OPTIONS)[number];
const IMAGE_SIZE_LABELS: Record<ImageSizeOpt, string> = {
  "1K": "1K · ~768px",
  "2K": "2K · ~1536px",
  "4K": "4K · ~3072px",
};

// Mirror of MAX_REFERENCE_IMAGES in src/lib/image-generation.ts. Kept as a
// local literal so this client component doesn't import the server-only lib.
const MAX_REFERENCE_IMAGES = 4;

// One reference image to send to the API: URL (avatar / pasted) or base64
// (uploaded file), with an optional semantic role so the server labels it
// for Gemini (identity = face, pose = composition). Matches the RefInput
// shape the routes accept.
type RefInput = {
  url?: string;
  base64?: string;
  mimeType?: string;
  role?: "identity" | "pose" | "plain";
};

interface ImageGenerationRow {
  id: string;
  prompt: string;
  aspect_ratio: string | null;
  image_url: string;
  gemini_model: string | null;
  source: string | null;
  created_at: string;
  reference_urls: string[] | null;
  avatar?: string | null;
  pose?: string | null;
}

type BatchStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED";

interface BatchItemInputClient {
  prompt: string;
  aspectRatio?: string;
  imageSize?: string;
  referenceImageUrl?: string;
  referenceImageBase64?: string;
  referenceImageMimeType?: string;
}

interface ImageBatchSummary {
  batchId: string;
  geminiBatchName: string;
  status: BatchStatus;
  itemCount: number;
  geminiModel: string;
  submittedAt: string;
  completedAt: string | null;
  // The original input items, preserved by the server so the gallery
  // can rebuild a payload for "Retry failed" without a separate fetch.
  // Indices line up 1:1 with `results` (the server pushes one result
  // per item in order).
  items?: BatchItemInputClient[];
  results:
    | Array<{ prompt: string; imageUrl?: string; error?: string }>
    | null;
  error: string | null;
}

const PAGE_SIZE = 24;

/** Display label for a pose slug: drop the `men-` section prefix and turn
 *  hyphens into spaces (e.g. "men-mirror-ootd" -> "mirror ootd"). */
function poseLabel(id: string): string {
  return id.replace(/^men-/, "").replace(/-/g, " ");
}

/** A single reference-image thumbnail with a remove (×) button. Used in the
 *  composer's attached-references row. */
function RefThumb({
  src,
  label,
  onRemove,
}: {
  src: string;
  label: string;
  onRemove: () => void;
}) {
  return (
    <div
      title={label}
      style={{
        position: "relative",
        width: 64,
        height: 64,
        borderRadius: 8,
        overflow: "hidden",
        border: "1px solid var(--line)",
        background: "var(--surface-2)",
        flex: "0 0 auto",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={label}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove reference ${label}`}
        style={{
          position: "absolute",
          top: 2,
          right: 2,
          width: 18,
          height: 18,
          borderRadius: "50%",
          border: "none",
          background: "rgba(0,0,0,0.6)",
          color: "#fff",
          cursor: "pointer",
          fontSize: 12,
          lineHeight: "18px",
          padding: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        ×
      </button>
    </div>
  );
}

export function ImageStudio() {
  const toast = useToast();

  const [prompt, setPrompt] = React.useState("");
  const [aspectRatio, setAspectRatio] = React.useState<AspectRatio>("9:16");
  const [imageSize, setImageSizeState] = React.useState<ImageSizeOpt>("2K");
  const [refUrl, setRefUrl] = React.useState("");
  // Local file picker — up to MAX_REFERENCE_IMAGES uploads, sent as base64
  // to /api/image-studio/generate. Combinable with a selected avatar and an
  // optional pasted URL; the composer shows all active references as a
  // thumbnail row, capped at MAX_REFERENCE_IMAGES total.
  const [refFiles, setRefFiles] = React.useState<
    Array<{
      id: string;
      name: string;
      mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
      base64: string;
      previewUrl: string;
    }>
  >([]);
  const refFileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [count, setCount] = React.useState<number>(1);
  const [generating, setGenerating] = React.useState(false);
  const [latest, setLatest] = React.useState<ImageGenerationRow[]>([]);

  const [rows, setRows] = React.useState<ImageGenerationRow[]>([]);
  const [page, setPage] = React.useState(0);
  const [hasMore, setHasMore] = React.useState(false);
  const [loadingGallery, setLoadingGallery] = React.useState(false);
  const [galleryError, setGalleryError] = React.useState<string | null>(null);
  const [active, setActive] = React.useState<ImageGenerationRow | null>(null);

  const [batches, setBatches] = React.useState<ImageBatchSummary[]>([]);
  const [batchesError, setBatchesError] = React.useState<string | null>(null);
  const [expandedBatchId, setExpandedBatchId] = React.useState<string | null>(
    null,
  );
  const [retryBusyId, setRetryBusyId] = React.useState<string | null>(null);

  // Per-item failures from the most recent sync Generate. Cleared
  // when the next call starts. Banner above "Latest" surfaces them
  // so partial successes aren't silent like before.
  const [genErrors, setGenErrors] = React.useState<
    Array<{ index: number; error: string }>
  >([]);
  const [genTotal, setGenTotal] = React.useState(0);

  const [selectMode, setSelectMode] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [bulkBusy, setBulkBusy] = React.useState(false);

  const [avatars, setAvatars] = React.useState<Avatar[]>([]);
  const [selectedAvatar, setSelectedAvatarState] =
    React.useState<AvatarId | null>(null);
  const [avatarBusy, setAvatarBusy] = React.useState<AvatarId | null>(null);
  const avatarFileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [avatarUploadTarget, setAvatarUploadTarget] =
    React.useState<AvatarId | null>(null);

  // Pose references — same model as avatars, but the selected one is a
  // composition/pose cue (and appends POSE_HINT to the prompt at send time).
  const [poses, setPoses] = React.useState<Pose[]>([]);
  const [selectedPose, setSelectedPoseState] = React.useState<PoseId | null>(
    null,
  );
  const [poseBusy, setPoseBusy] = React.useState<PoseId | null>(null);
  const poseFileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [poseUploadTarget, setPoseUploadTarget] = React.useState<PoseId | null>(
    null,
  );

  const loadGallery = React.useCallback(async (nextPage: number) => {
    setLoadingGallery(true);
    setGalleryError(null);
    try {
      const res = await fetch(
        `/api/image-studio/list?limit=${PAGE_SIZE}&offset=${nextPage * PAGE_SIZE}`,
      );
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "failed");
      setRows(json.rows ?? []);
      setHasMore((json.rows?.length ?? 0) === PAGE_SIZE);
      setPage(nextPage);
    } catch (e) {
      setGalleryError((e as Error).message);
    } finally {
      setLoadingGallery(false);
    }
  }, []);

  React.useEffect(() => {
    loadGallery(0);
  }, [loadGallery]);

  const loadBatches = React.useCallback(async () => {
    try {
      const res = await fetch("/api/image-studio/batch/list?limit=20");
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "failed");
      setBatches(json.batches ?? []);
      setBatchesError(null);
    } catch (e) {
      setBatchesError((e as Error).message);
    }
  }, []);

  React.useEffect(() => {
    loadBatches();
  }, [loadBatches]);

  // Hydrate the persisted avatar choice from localStorage on first
  // render so it survives page reloads. Mirror the dreamme.* prefix
  // used by other dashboard prefs.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem("dreamme.imageStudio.avatar");
    if (raw && (AVATAR_IDS as readonly string[]).includes(raw)) {
      setSelectedAvatarState(raw as AvatarId);
    }
    const rawPose = window.localStorage.getItem("dreamme.imageStudio.pose");
    if (rawPose && (POSE_IDS as readonly string[]).includes(rawPose)) {
      setSelectedPoseState(rawPose as PoseId);
    }
    const rawSize = window.localStorage.getItem("dreamme.imageStudio.imageSize");
    if (rawSize && (IMAGE_SIZE_OPTIONS as readonly string[]).includes(rawSize)) {
      setImageSizeState(rawSize as ImageSizeOpt);
    }
  }, []);

  const setImageSize = React.useCallback((size: ImageSizeOpt) => {
    setImageSizeState(size);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("dreamme.imageStudio.imageSize", size);
    }
  }, []);

  const loadAvatars = React.useCallback(async () => {
    try {
      const res = await fetch("/api/avatars");
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "failed");
      setAvatars(json.avatars ?? []);
    } catch {
      // Non-fatal — avatar picker just renders empty if it fails.
    }
  }, []);

  const loadPoses = React.useCallback(async () => {
    try {
      const res = await fetch("/api/poses");
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "failed");
      setPoses(json.poses ?? []);
    } catch {
      // Non-fatal — pose picker just renders empty if it fails.
    }
  }, []);

  React.useEffect(() => {
    loadAvatars();
    loadPoses();
  }, [loadAvatars, loadPoses]);

  const setSelectedAvatar = React.useCallback((id: AvatarId | null) => {
    setSelectedAvatarState(id);
    if (typeof window === "undefined") return;
    if (id) {
      window.localStorage.setItem("dreamme.imageStudio.avatar", id);
    } else {
      window.localStorage.removeItem("dreamme.imageStudio.avatar");
    }
  }, []);

  const setSelectedPose = React.useCallback((id: PoseId | null) => {
    setSelectedPoseState(id);
    if (typeof window === "undefined") return;
    if (id) {
      window.localStorage.setItem("dreamme.imageStudio.pose", id);
    } else {
      window.localStorage.removeItem("dreamme.imageStudio.pose");
    }
  }, []);

  // Auto-poll non-terminal batches every 30s. For each pending/running
  // batch we hit /api/image-studio/batch/[id], which calls
  // getImageBatch() server-side — that lazily polls Gemini and inserts
  // image_generations rows on completion. When any batch flips to
  // SUCCEEDED we refresh the gallery so the new images appear.
  //
  // The effect must NOT re-run on every batch state change (it would
  // restart the interval on every tick → effective 0s polling). Track
  // pending IDs as a stable signature, and read the latest batches via
  // a ref inside tick().
  const batchesRef = React.useRef(batches);
  React.useEffect(() => {
    batchesRef.current = batches;
  }, [batches]);

  const pendingSignature = React.useMemo(
    () =>
      batches
        .filter((b) => b.status === "PENDING" || b.status === "RUNNING")
        .map((b) => b.batchId)
        .sort()
        .join(","),
    [batches],
  );

  React.useEffect(() => {
    if (!pendingSignature) return;

    const tick = async () => {
      const pendingNow = batchesRef.current.filter(
        (b) => b.status === "PENDING" || b.status === "RUNNING",
      );
      if (pendingNow.length === 0) return;
      const updated: ImageBatchSummary[] = [];
      let anyCompleted = false;
      for (const b of pendingNow) {
        try {
          const res = await fetch(
            `/api/image-studio/batch/${encodeURIComponent(b.batchId)}`,
          );
          const json = await res.json();
          if (!json.ok) continue;
          const next = json.batch as ImageBatchSummary;
          if (next.status === "SUCCEEDED") anyCompleted = true;
          updated.push(next);
        } catch {
          // Transient — keep retrying on next tick.
        }
      }
      if (updated.length > 0) {
        setBatches((prev) => {
          const byId = new Map(updated.map((u) => [u.batchId, u]));
          return prev.map((b) => byId.get(b.batchId) ?? b);
        });
      }
      if (anyCompleted) loadGallery(0);
    };

    const interval = window.setInterval(tick, 30_000);
    void tick();
    return () => window.clearInterval(interval);
  }, [pendingSignature, loadGallery]);

  // Resolve the active reference image URL when an avatar is highlighted.
  // Avatar takes precedence over the URL field and any uploaded file —
  // the picker UI keeps these mutex so only one is "active" at a time.
  const avatarRefUrl =
    (selectedAvatar &&
      avatars.find((a) => a.name === selectedAvatar)?.imageUrl) ||
    null;
  const poseRefUrl =
    (selectedPose && poses.find((p) => p.name === selectedPose)?.imageUrl) ||
    null;

  // All active references in send order: avatar (identity) → pose
  // (composition) → uploaded files → a pasted URL. Capped at
  // MAX_REFERENCE_IMAGES. All combinable.
  const trimmedRefUrl = refUrl.trim();
  const refUrlValid = /^https?:\/\//i.test(trimmedRefUrl);
  const activeRefCount =
    (avatarRefUrl ? 1 : 0) +
    (poseRefUrl ? 1 : 0) +
    refFiles.length +
    (trimmedRefUrl && refUrlValid ? 1 : 0);
  const buildReferenceImages = (): RefInput[] => {
    const refs: RefInput[] = [];
    // Roles let the server label each image for Gemini by adjacency:
    // avatar = identity (face), pose = composition. Uploads + pasted URL
    // are generic ("plain", unlabeled).
    if (avatarRefUrl) refs.push({ url: avatarRefUrl, role: "identity" });
    if (poseRefUrl) refs.push({ url: poseRefUrl, role: "pose" });
    for (const f of refFiles)
      refs.push({ base64: f.base64, mimeType: f.mimeType });
    if (trimmedRefUrl && refUrlValid) refs.push({ url: trimmedRefUrl });
    return refs.slice(0, MAX_REFERENCE_IMAGES);
  };

  const generate = async () => {
    if (!prompt.trim() || generating) return;
    if (trimmedRefUrl && !refUrlValid) {
      toast("Reference URL must start with http(s)://");
      return;
    }
    const referenceImages = buildReferenceImages();
    setGenerating(true);
    setGenErrors([]);
    setGenTotal(count);
    try {
      const res = await fetch("/api/image-studio/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          aspectRatio,
          imageSize,
          referenceImages: referenceImages.length ? referenceImages : undefined,
          avatar: selectedAvatar ?? undefined,
          pose: selectedPose ?? undefined,
          count: count > 1 ? count : undefined,
        }),
      });
      const json = await res.json();
      const errors = Array.isArray(json.errors)
        ? (json.errors as Array<{ index: number; error: string }>)
        : [];
      if (!json.ok) {
        // All-or-nothing failure (no successes). Surface the first
        // error in the toast and keep details in the persistent
        // banner so the user can still read the message after the
        // toast fades.
        if (errors.length > 0) {
          setGenErrors(errors);
        } else {
          setGenErrors([
            { index: 0, error: json.error ?? "unknown error" },
          ]);
        }
        if (res.status === 429) {
          toast(`Rate limited: ${json.error}`);
        } else {
          toast(`Failed: ${json.error ?? "unknown error"}`);
        }
        return;
      }
      const results = (json.results ?? [json.result]) as Array<{
        id: string;
        imageUrl: string;
        prompt: string;
        aspectRatio: string | null;
        geminiModel: string;
        createdAt: string;
        referenceImageUrl: string | null;
        referenceImageUrls?: string[];
        avatar?: string | null;
        pose?: string | null;
      }>;
      const rows: ImageGenerationRow[] = results.map((r) => ({
        id: r.id,
        prompt: r.prompt,
        aspect_ratio: r.aspectRatio,
        image_url: r.imageUrl,
        gemini_model: r.geminiModel,
        source: "dashboard",
        created_at: r.createdAt,
        reference_urls:
          r.referenceImageUrls && r.referenceImageUrls.length
            ? r.referenceImageUrls
            : r.referenceImageUrl
              ? [r.referenceImageUrl]
              : null,
        avatar: r.avatar ?? null,
        pose: r.pose ?? null,
      }));
      setLatest(rows);
      if (errors.length > 0) {
        setGenErrors(errors);
        toast(
          `Generated ${rows.length} of ${count}; ${errors.length} failed`,
        );
      }
      loadGallery(0);
    } catch (e) {
      const msg = (e as Error).message;
      setGenErrors([{ index: 0, error: msg }]);
      toast(`Failed: ${msg}`);
    } finally {
      setGenerating(false);
    }
  };

  // Submit the same form as a Gemini Batch job (50% off list, 2-6h
  // turnaround). Each requested variation becomes one batch item with
  // the same prompt + reference. Result lands in the Batches panel and
  // auto-polls until SUCCEEDED.
  const submitAsBatch = async () => {
    if (!prompt.trim() || generating) return;
    if (trimmedRefUrl && !refUrlValid) {
      toast("Reference URL must start with http(s)://");
      return;
    }
    // Don't duplicate base64 across items — that multiplies the payload by
    // `count` and pushes us past Vercel's ~4.5 MB serverless body limit.
    // Send the shared references once at the top level; the server fans
    // them out into each item.
    const referenceImages = buildReferenceImages();
    const trimmedPrompt = prompt.trim();
    const items = Array.from({ length: count }, () => ({
      prompt: trimmedPrompt,
      aspectRatio,
      imageSize,
    }));
    const body = {
      items,
      sharedReferenceImages: referenceImages.length
        ? referenceImages
        : undefined,
      avatar: selectedAvatar ?? undefined,
      pose: selectedPose ?? undefined,
    };
    setGenerating(true);
    try {
      const res = await fetch("/api/image-studio/batch/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let json: { ok?: boolean; error?: string; batch?: ImageBatchSummary };
      try {
        json = JSON.parse(text);
      } catch {
        const snippet = text.slice(0, 120).replace(/\s+/g, " ").trim();
        toast(
          `Batch submit failed: HTTP ${res.status}${snippet ? ` — ${snippet}` : ""}`,
        );
        return;
      }
      if (!json.ok) {
        if (res.status === 429) {
          toast(`Rate limited: ${json.error}`);
        } else {
          toast(`Batch submit failed: ${json.error ?? "unknown error"}`);
        }
        return;
      }
      const batch = json.batch as ImageBatchSummary;
      // Optimistically prepend so the Batches panel shows it
      // immediately; the auto-poller will pick up status updates.
      setBatches((prev) => [batch, ...prev]);
      toast(
        `Batch submitted (${batch.itemCount} items). Results in ~2-6 h.`,
      );
    } catch (e) {
      toast(`Batch submit failed: ${(e as Error).message}`);
    } finally {
      setGenerating(false);
    }
  };

  const copy = async (text: string, label = "Copied") => {
    try {
      await navigator.clipboard.writeText(text);
      toast(label);
    } catch {
      toast("Copy failed");
    }
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Build the download stem. When the generation recorded an avatar
  // reference, follow the `avatar_pose_###` convention (pose omitted for
  // avatar-only gens); the ### is the row's 1-based ordinal within its
  // (avatar, pose) group, fetched from /api/image-studio/seq. Falls back
  // to the legacy opaque `dreamme-{id}` stem for non-reference gens or if
  // the sequence lookup fails.
  const buildDownloadStem = async (
    row: ImageGenerationRow,
  ): Promise<string> => {
    if (!row.avatar) return `dreamme-${row.id.slice(0, 8)}`;
    let seq = 1;
    try {
      const params = new URLSearchParams({
        avatar: row.avatar,
        before: row.created_at,
      });
      if (row.pose) params.set("pose", row.pose);
      const res = await fetch(`/api/image-studio/seq?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        if (json?.ok && Number.isFinite(json.seq)) seq = json.seq;
      }
    } catch {
      // Non-fatal — fall back to seq 1 so the download still proceeds.
    }
    const seq3 = String(seq).padStart(3, "0");
    return row.pose
      ? `${row.avatar}_${row.pose}_${seq3}`
      : `${row.avatar}_${seq3}`;
  };

  const downloadOne = async (row: ImageGenerationRow) => {
    // Fetch as blob and trigger an anchor download. Going through a
    // blob URL means cross-origin Supabase Storage URLs respect the
    // `download` attribute even though the storage CDN sits on a
    // different origin.
    const res = await fetch(row.image_url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${row.image_url}`);
    }
    const blob = await res.blob();
    const ext = (row.image_url.split(".").pop() || "png").split("?")[0];
    const filename = `${await buildDownloadStem(row)}.${ext}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const downloadSelected = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const targets = rows.filter((r) => selected.has(r.id));
    setBulkBusy(true);
    try {
      let ok = 0;
      for (const row of targets) {
        try {
          await downloadOne(row);
          ok++;
          // Tiny gap so the browser's "allow multiple downloads"
          // dialog only fires once and doesn't merge requests.
          await new Promise((r) => setTimeout(r, 250));
        } catch (e) {
          console.warn("download failed", row.id, e);
        }
      }
      toast(
        ok === targets.length
          ? `Downloaded ${ok} image${ok === 1 ? "" : "s"}`
          : `Downloaded ${ok} of ${targets.length}`,
      );
    } finally {
      setBulkBusy(false);
    }
  };

  const deleteIds = async (ids: string[], label: string) => {
    if (ids.length === 0) return;
    if (
      !window.confirm(
        ids.length === 1
          ? "Delete this image? This cannot be undone."
          : `Delete ${ids.length} images? This cannot be undone.`,
      )
    ) {
      return;
    }
    setBulkBusy(true);
    try {
      const res = await fetch("/api/image-studio/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const text = await res.text();
      let json: { ok?: boolean; error?: string; deleted?: number };
      try {
        json = JSON.parse(text);
      } catch {
        const snippet = text.slice(0, 120).replace(/\s+/g, " ").trim();
        toast(
          `${label} failed: HTTP ${res.status}${snippet ? ` — ${snippet}` : ""}`,
        );
        return;
      }
      if (!json.ok) {
        toast(`${label} failed: ${json.error ?? "unknown error"}`);
        return;
      }
      const idSet = new Set(ids);
      setRows((prev) => prev.filter((r) => !idSet.has(r.id)));
      setLatest((prev) => prev.filter((r) => !idSet.has(r.id)));
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      toast(`${label}: ${json.deleted ?? ids.length}`);
    } catch (e) {
      toast(`${label} failed: ${(e as Error).message}`);
    } finally {
      setBulkBusy(false);
    }
  };

  const deleteSelected = () => {
    deleteIds(Array.from(selected), "Deleted");
  };

  const deleteOne = (row: ImageGenerationRow) => {
    deleteIds([row.id], "Deleted");
  };

  // "Deadline expired" and similar Gemini errors are usually
  // transient — the same prompt + reference often succeeds on a
  // second pass. Retry pulls the failed slots' original input from
  // the batch row and submits a new batch containing only those
  // items, so the admin doesn't have to re-pay for the slots that
  // already succeeded.
  const retryFailedBatch = async (batch: ImageBatchSummary) => {
    if (!batch.results || !batch.items) {
      toast("Retry needs the original batch items — try refreshing.");
      return;
    }
    const failedItems = batch.results
      .map((r, i) => ({ result: r, item: batch.items?.[i] }))
      .filter((p) => p.result.error && p.item)
      .map((p) => p.item as BatchItemInputClient);
    if (failedItems.length === 0) return;
    setRetryBusyId(batch.batchId);
    try {
      const res = await fetch("/api/image-studio/batch/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: failedItems,
          displayName: `Retry of ${batch.batchId.slice(0, 8)}`,
        }),
      });
      const text = await res.text();
      let json: { ok?: boolean; error?: string; batch?: ImageBatchSummary };
      try {
        json = JSON.parse(text);
      } catch {
        const snippet = text.slice(0, 120).replace(/\s+/g, " ").trim();
        toast(
          `Retry failed: HTTP ${res.status}${snippet ? ` — ${snippet}` : ""}`,
        );
        return;
      }
      if (!json.ok || !json.batch) {
        toast(`Retry failed: ${json.error ?? "unknown error"}`);
        return;
      }
      const newBatch = json.batch;
      setBatches((prev) => [newBatch, ...prev]);
      toast(
        `Retrying ${failedItems.length} failed item${failedItems.length === 1 ? "" : "s"} as a new batch.`,
      );
    } catch (e) {
      toast(`Retry failed: ${(e as Error).message}`);
    } finally {
      setRetryBusyId(null);
    }
  };

  // Click an avatar tile: highlight as the active reference, or toggle
  // off if it was already selected. Selecting an avatar is mutex with
  // the URL field and any uploaded file — the latter two get cleared.
  const toggleAvatar = (id: AvatarId) => {
    const avatar = avatars.find((a) => a.name === id);
    if (!avatar?.imageUrl) {
      // Empty slot — picking the file kicks off the upload flow.
      pickAvatarUpload(id);
      return;
    }
    if (selectedAvatar === id) {
      setSelectedAvatar(null);
      return;
    }
    // Avatar is combinable with uploads + a URL, but still counts toward
    // the cap. Selecting one swaps for the previously selected avatar, so
    // it only adds a slot when none was selected before.
    if (!selectedAvatar && activeRefCount >= MAX_REFERENCE_IMAGES) {
      toast(`Up to ${MAX_REFERENCE_IMAGES} reference images`);
      return;
    }
    setSelectedAvatar(id);
  };

  const pickAvatarUpload = (id: AvatarId) => {
    setAvatarUploadTarget(id);
    avatarFileInputRef.current?.click();
  };

  const onAvatarFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    const target = avatarUploadTarget;
    e.target.value = "";
    setAvatarUploadTarget(null);
    if (!file || !target) return;
    if (file.size > 8 * 1024 * 1024) {
      toast("File exceeds 8 MB");
      return;
    }
    const allowed: ReadonlyArray<string> = [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
    ];
    if (!allowed.includes(file.type)) {
      toast(`Unsupported type: ${file.type || "unknown"}`);
      return;
    }
    setAvatarBusy(target);
    try {
      const { base64, mime } = await downscaleImageToBase64(file);
      const res = await fetch(
        `/api/avatars/${encodeURIComponent(target)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image_base64: base64, image_mime: mime }),
        },
      );
      const text = await res.text();
      let json: { ok?: boolean; error?: string; avatar?: Avatar };
      try {
        json = JSON.parse(text);
      } catch {
        const snippet = text.slice(0, 120).replace(/\s+/g, " ").trim();
        toast(
          `Avatar upload failed: HTTP ${res.status}${snippet ? ` — ${snippet}` : ""}`,
        );
        return;
      }
      if (!json.ok || !json.avatar) {
        toast(`Avatar upload failed: ${json.error ?? "unknown error"}`);
        return;
      }
      const updated = json.avatar;
      setAvatars((prev) => {
        const next = prev.filter((a) => a.name !== updated.name);
        next.push(updated);
        next.sort((a, b) => a.name.localeCompare(b.name));
        return next;
      });
      toast(`${target} updated`);
    } catch (err) {
      toast(`Avatar upload failed: ${(err as Error).message}`);
    } finally {
      setAvatarBusy(null);
    }
  };

  const clearAvatar = async (id: AvatarId) => {
    if (!window.confirm(`Remove the reference image for ${id}?`)) return;
    setAvatarBusy(id);
    try {
      const res = await fetch(`/api/avatars/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        toast(`Clear failed: ${json?.error ?? `HTTP ${res.status}`}`);
        return;
      }
      const updated = json.avatar as Avatar;
      setAvatars((prev) =>
        prev.map((a) => (a.name === updated.name ? updated : a)),
      );
      if (selectedAvatar === id) setSelectedAvatar(null);
      toast(`${id} cleared`);
    } catch (err) {
      toast(`Clear failed: ${(err as Error).message}`);
    } finally {
      setAvatarBusy(null);
    }
  };

  // --- Pose references (mirror of the avatar handlers) ---
  const togglePose = (id: PoseId) => {
    const pose = poses.find((p) => p.name === id);
    if (!pose?.imageUrl) {
      pickPoseUpload(id);
      return;
    }
    if (selectedPose === id) {
      setSelectedPose(null);
      return;
    }
    if (!selectedPose && activeRefCount >= MAX_REFERENCE_IMAGES) {
      toast(`Up to ${MAX_REFERENCE_IMAGES} reference images`);
      return;
    }
    setSelectedPose(id);
  };

  const pickPoseUpload = (id: PoseId) => {
    setPoseUploadTarget(id);
    poseFileInputRef.current?.click();
  };

  const onPoseFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const target = poseUploadTarget;
    e.target.value = "";
    setPoseUploadTarget(null);
    if (!file || !target) return;
    if (file.size > 8 * 1024 * 1024) {
      toast("File exceeds 8 MB");
      return;
    }
    const allowed: ReadonlyArray<string> = [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
    ];
    if (!allowed.includes(file.type)) {
      toast(`Unsupported type: ${file.type || "unknown"}`);
      return;
    }
    setPoseBusy(target);
    try {
      const { base64, mime } = await downscaleImageToBase64(file);
      const res = await fetch(`/api/poses/${encodeURIComponent(target)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_base64: base64, image_mime: mime }),
      });
      const text = await res.text();
      let json: { ok?: boolean; error?: string; pose?: Pose };
      try {
        json = JSON.parse(text);
      } catch {
        const snippet = text.slice(0, 120).replace(/\s+/g, " ").trim();
        toast(
          `Pose upload failed: HTTP ${res.status}${snippet ? ` — ${snippet}` : ""}`,
        );
        return;
      }
      if (!json.ok || !json.pose) {
        toast(`Pose upload failed: ${json.error ?? "unknown error"}`);
        return;
      }
      const updated = json.pose;
      setPoses((prev) => {
        const next = prev.filter((p) => p.name !== updated.name);
        next.push(updated);
        next.sort((a, b) => a.name.localeCompare(b.name));
        return next;
      });
      toast(`${target} updated`);
    } catch (err) {
      toast(`Pose upload failed: ${(err as Error).message}`);
    } finally {
      setPoseBusy(null);
    }
  };

  const clearPose = async (id: PoseId) => {
    if (!window.confirm(`Remove the reference image for ${id}?`)) return;
    setPoseBusy(id);
    try {
      const res = await fetch(`/api/poses/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        toast(`Clear failed: ${json?.error ?? `HTTP ${res.status}`}`);
        return;
      }
      const updated = json.pose as Pose;
      setPoses((prev) =>
        prev.map((p) => (p.name === updated.name ? updated : p)),
      );
      if (selectedPose === id) setSelectedPose(null);
      toast(`${id} cleared`);
    } catch (err) {
      toast(`Clear failed: ${(err as Error).message}`);
    } finally {
      setPoseBusy(null);
    }
  };

  // One pose tile grid for a given set of slot ids. Used for the Women and
  // Men pose sections; selection is shared (one pose at a time across both).
  const renderPoseGrid = (ids: readonly PoseId[]) => (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      {ids.map((id) => {
        const pose = poses.find((p) => p.name === id);
        const hasImage = !!pose?.imageUrl;
        const isSelected = selectedPose === id;
        const busy = poseBusy === id;
        const label = poseLabel(id);
        return (
          <div
            key={id}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
            }}
          >
            <button
              type="button"
              onClick={() => !busy && togglePose(id)}
              disabled={busy}
              title={
                hasImage
                  ? isSelected
                    ? `${label} — selected (click to deselect)`
                    : `${label} — click to use as pose reference`
                  : `${label} — click to upload a pose image`
              }
              style={{
                width: 56,
                height: 56,
                padding: 0,
                borderRadius: 12,
                background: hasImage ? "var(--surface-2)" : "transparent",
                border: isSelected
                  ? "2px solid var(--accent-2)"
                  : hasImage
                    ? "1px solid var(--line)"
                    : "1px dashed var(--line)",
                cursor: busy ? "wait" : "pointer",
                overflow: "hidden",
                position: "relative",
                transform: isSelected ? "scale(1.04)" : "scale(1)",
                transition: "transform 120ms ease",
                opacity: busy ? 0.5 : 1,
              }}
            >
              {hasImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={pose!.imageUrl!}
                  alt={label}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    display: "block",
                  }}
                />
              ) : (
                <span style={{ fontSize: 18, color: "var(--ink-3)" }}>+</span>
              )}
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span
                style={{
                  fontSize: 11,
                  color: isSelected ? "var(--ink)" : "var(--ink-3)",
                  fontWeight: isSelected ? 600 : 400,
                  textTransform: "capitalize",
                }}
              >
                {label}
              </span>
              {hasImage && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!busy) pickPoseUpload(id);
                  }}
                  disabled={busy}
                  title="Replace this pose's image"
                  style={{
                    padding: 0,
                    border: "none",
                    background: "transparent",
                    color: "var(--ink-3)",
                    cursor: busy ? "wait" : "pointer",
                    fontSize: 10,
                    textDecoration: "underline",
                  }}
                >
                  edit
                </button>
              )}
              {hasImage && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!busy) clearPose(id);
                  }}
                  disabled={busy}
                  title="Clear this pose"
                  style={{
                    padding: 0,
                    border: "none",
                    background: "transparent",
                    color: "var(--ink-3)",
                    cursor: busy ? "wait" : "pointer",
                    fontSize: 10,
                    textDecoration: "underline",
                  }}
                >
                  clear
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div>
      <PageHeader
        eyebrow="Internal · Admin only"
        title="Image Studio"
        subtitle="Generate images with Gemini, plus a self-hosted MCP endpoint that Claude (claude.ai connectors and Claude Code) can call as a tool. All generations are recorded in the gallery below."
      />

      <div style={{ marginBottom: 24 }}>
        <Section title="1. Generate">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="A photorealistic golden retriever puppy reading a vintage hardcover book in a cozy library, soft window light"
              rows={4}
              style={{
                ...inputStyle,
                fontFamily: "inherit",
                resize: "vertical",
                minHeight: 96,
              }}
            />
            <div
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                marginTop: 12,
                flexWrap: "wrap",
              }}
            >
              <select
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
                style={{ ...inputStyle, width: "auto" }}
              >
                {ASPECT_OPTIONS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
              <select
                value={imageSize}
                onChange={(e) => setImageSize(e.target.value as ImageSizeOpt)}
                style={{ ...inputStyle, width: "auto" }}
                title="Output resolution. 2K (~1536px wide at 9:16) keeps detail through TikTok recompression; 1K is the model default; 4K is largest (slowest + priciest)."
              >
                {IMAGE_SIZE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {IMAGE_SIZE_LABELS[s]}
                  </option>
                ))}
              </select>
              <select
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                style={{ ...inputStyle, width: "auto" }}
                title="Number of variations (parallel generations sharing the same prompt + reference)"
              >
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={n}>
                    {n}× {n === 1 ? "image" : "images"}
                  </option>
                ))}
              </select>
              <Button
                variant="primary"
                onClick={generate}
                disabled={generating || !prompt.trim()}
              >
                {generating ? "Generating…" : "Generate"}
              </Button>
              <Button
                variant="secondary"
                onClick={submitAsBatch}
                disabled={generating || !prompt.trim()}
                title="Submit as a Gemini Batch job — 50% off list price, results arrive in 2-6 h. Tracked in the Batches panel below."
              >
                {generating ? "…" : "Submit as Batch (50% off)"}
              </Button>
            </div>
            <div style={{ marginTop: 16 }}>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--ink-3)",
                  marginBottom: 8,
                }}
              >
                Avatar (optional). Click a saved avatar to use it as an
                identity reference. Click an empty slot to upload one.
                Combines with a pose, uploads, and a URL — up to{" "}
                {MAX_REFERENCE_IMAGES} references total.
              </div>
              <input
                ref={avatarFileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                style={{ display: "none" }}
                onChange={onAvatarFileChange}
              />
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                {AVATAR_IDS.map((id) => {
                  const avatar = avatars.find((a) => a.name === id);
                  const hasImage = !!avatar?.imageUrl;
                  const isSelected = selectedAvatar === id;
                  const busy = avatarBusy === id;
                  return (
                    <div
                      key={id}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => !busy && toggleAvatar(id)}
                        disabled={busy}
                        title={
                          hasImage
                            ? isSelected
                              ? `${id} — selected (click to deselect)`
                              : `${id} — click to use as reference`
                            : `${id} — click to upload a reference image`
                        }
                        style={{
                          width: 56,
                          height: 56,
                          padding: 0,
                          borderRadius: 12,
                          background: hasImage
                            ? "var(--surface-2)"
                            : "transparent",
                          border: isSelected
                            ? "2px solid var(--ink)"
                            : hasImage
                              ? "1px solid var(--line)"
                              : "1px dashed var(--line)",
                          cursor: busy ? "wait" : "pointer",
                          overflow: "hidden",
                          position: "relative",
                          transform: isSelected ? "scale(1.04)" : "scale(1)",
                          transition: "transform 120ms ease",
                          opacity: busy ? 0.5 : 1,
                        }}
                      >
                        {hasImage ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={avatar!.imageUrl!}
                            alt={id}
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "cover",
                              display: "block",
                            }}
                          />
                        ) : (
                          <span
                            style={{
                              fontSize: 18,
                              color: "var(--ink-3)",
                            }}
                          >
                            +
                          </span>
                        )}
                      </button>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            color: isSelected ? "var(--ink)" : "var(--ink-3)",
                            fontWeight: isSelected ? 600 : 400,
                            textTransform: "capitalize",
                          }}
                        >
                          {id}
                        </span>
                        {hasImage && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!busy) pickAvatarUpload(id);
                            }}
                            disabled={busy}
                            title="Replace this avatar's image"
                            style={{
                              padding: 0,
                              border: "none",
                              background: "transparent",
                              color: "var(--ink-3)",
                              cursor: busy ? "wait" : "pointer",
                              fontSize: 10,
                              textDecoration: "underline",
                            }}
                          >
                            edit
                          </button>
                        )}
                        {hasImage && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!busy) clearAvatar(id);
                            }}
                            disabled={busy}
                            title="Clear this avatar"
                            style={{
                              padding: 0,
                              border: "none",
                              background: "transparent",
                              color: "var(--ink-3)",
                              cursor: busy ? "wait" : "pointer",
                              fontSize: 10,
                              textDecoration: "underline",
                            }}
                          >
                            clear
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{ marginTop: 16 }}>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--ink-3)",
                  marginBottom: 8,
                }}
              >
                Pose reference (optional). Click a pose to send it to Google
                as a composition cue — a pose hint is added to the prompt
                automatically so the face stays from your avatar/uploads.
                Click an empty slot to upload one.
              </div>
              <input
                ref={poseFileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                style={{ display: "none" }}
                onChange={onPoseFileChange}
              />
              <div
                style={{ display: "flex", flexDirection: "column", gap: 14 }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: "0.05em",
                      textTransform: "uppercase",
                      color: "var(--ink-3)",
                      marginBottom: 6,
                    }}
                  >
                    Women
                  </div>
                  {renderPoseGrid(WOMEN_POSE_IDS)}
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: "0.05em",
                      textTransform: "uppercase",
                      color: "var(--ink-3)",
                      marginBottom: 6,
                    }}
                  >
                    Men
                  </div>
                  {renderPoseGrid(MEN_POSE_IDS)}
                </div>
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--ink-3)",
                  marginBottom: 6,
                }}
              >
                Reference images (optional — image-to-image). Pick an avatar
                above and/or upload files, plus an optional URL — up to{" "}
                {MAX_REFERENCE_IMAGES} total ({activeRefCount}/
                {MAX_REFERENCE_IMAGES} used). Each file max 8 MB,
                png/jpeg/webp/gif.
              </div>
              {/* Thumbnail row of every active reference (mockup style). */}
              {activeRefCount > 0 && (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  {avatarRefUrl && (
                    <RefThumb
                      key="avatar"
                      src={avatarRefUrl}
                      label={selectedAvatar ?? "avatar"}
                      onRemove={() => setSelectedAvatar(null)}
                    />
                  )}
                  {poseRefUrl && (
                    <RefThumb
                      key="pose"
                      src={poseRefUrl}
                      label={`pose: ${selectedPose ? poseLabel(selectedPose) : ""}`}
                      onRemove={() => setSelectedPose(null)}
                    />
                  )}
                  {refFiles.map((f) => (
                    <RefThumb
                      key={f.id}
                      src={f.previewUrl}
                      label={f.name}
                      onRemove={() => {
                        URL.revokeObjectURL(f.previewUrl);
                        setRefFiles((prev) =>
                          prev.filter((x) => x.id !== f.id),
                        );
                      }}
                    />
                  ))}
                  {trimmedRefUrl && refUrlValid && (
                    <RefThumb
                      key="url"
                      src={trimmedRefUrl}
                      label="url"
                      onRemove={() => setRefUrl("")}
                    />
                  )}
                </div>
              )}
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  type="url"
                  placeholder="https://example.com/image.jpg"
                  value={refUrl}
                  onChange={(e) => setRefUrl(e.target.value)}
                  style={inputStyle}
                />
                <input
                  ref={refFileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  multiple
                  style={{ display: "none" }}
                  onChange={async (e) => {
                    const picked = Array.from(e.target.files ?? []);
                    e.target.value = "";
                    if (!picked.length) return;
                    let slots = MAX_REFERENCE_IMAGES - activeRefCount;
                    if (slots <= 0) {
                      toast(
                        `Up to ${MAX_REFERENCE_IMAGES} reference images`,
                      );
                      return;
                    }
                    const allowed = new Set([
                      "image/png",
                      "image/jpeg",
                      "image/webp",
                      "image/gif",
                    ]);
                    const additions: typeof refFiles = [];
                    let skippedForCap = false;
                    for (const file of picked) {
                      if (slots <= 0) {
                        skippedForCap = true;
                        break;
                      }
                      if (file.size > 8 * 1024 * 1024) {
                        toast(`${file.name}: exceeds 8 MB`);
                        continue;
                      }
                      if (!allowed.has(file.type)) {
                        toast(
                          `${file.name}: unsupported type ${file.type || "unknown"}`,
                        );
                        continue;
                      }
                      // Downscale before base64 — raw phone photos overflow
                      // Vercel's ~4.5 MB serverless body cap. Helper resizes
                      // to 1536px / JPEG q=0.9 (~300-600 KB), plenty for
                      // image-to-image.
                      const { base64, mime } =
                        await downscaleImageToBase64(file);
                      additions.push({
                        id: crypto.randomUUID(),
                        name: file.name,
                        mimeType: (mime === "image/jpeg" ||
                        mime === "image/png" ||
                        mime === "image/webp" ||
                        mime === "image/gif"
                          ? mime
                          : "image/jpeg") as
                          | "image/png"
                          | "image/jpeg"
                          | "image/webp"
                          | "image/gif",
                        base64,
                        previewUrl: URL.createObjectURL(file),
                      });
                      slots--;
                    }
                    if (additions.length) {
                      setRefFiles((prev) => [...prev, ...additions]);
                    }
                    if (skippedForCap) {
                      toast(
                        `Only ${MAX_REFERENCE_IMAGES} reference images allowed; extras skipped`,
                      );
                    }
                  }}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => refFileInputRef.current?.click()}
                  disabled={activeRefCount >= MAX_REFERENCE_IMAGES}
                >
                  Upload
                </Button>
              </div>
            </div>
          </Section>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            batches.length > 0
              ? "minmax(0,1fr) minmax(0,1fr)"
              : "minmax(0,1fr)",
          gap: 24,
          alignItems: "start",
          marginBottom: 32,
        }}
      >
        <Section title="2. Latest">
            {genErrors.length > 0 && (
              <div
                style={{
                  marginBottom: 12,
                  padding: "10px 12px",
                  border: "1px solid var(--accent)",
                  background:
                    "color-mix(in oklab, var(--accent) 8%, transparent)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    marginBottom: 6,
                  }}
                >
                  <strong style={{ color: "var(--accent)" }}>
                    {genErrors.length} of {genTotal} failed
                  </strong>
                  <button
                    type="button"
                    onClick={() => setGenErrors([])}
                    style={{
                      border: "none",
                      background: "transparent",
                      color: "var(--ink-3)",
                      cursor: "pointer",
                      fontSize: 11,
                      textDecoration: "underline",
                    }}
                  >
                    dismiss
                  </button>
                </div>
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: 18,
                    color: "var(--ink-2)",
                    lineHeight: 1.5,
                  }}
                >
                  {genErrors.map((e) => (
                    <li key={e.index}>
                      <span
                        style={{
                          fontFamily:
                            "var(--font-geist-mono), monospace",
                          color: "var(--ink-3)",
                          marginRight: 6,
                        }}
                      >
                        #{e.index + 1}
                      </span>
                      {e.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {latest.length === 0 ? (
              <div
                style={{
                  aspectRatio: aspectRatioToCss(aspectRatio),
                  background: "var(--surface-2)",
                  border: "1px solid var(--line)",
                  borderRadius: 10,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                  maxHeight: 520,
                }}
              >
                <span style={{ fontSize: 12, color: "var(--ink-4)" }}>—</span>
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    latest.length === 1
                      ? "1fr"
                      : `repeat(${Math.min(latest.length, 2)}, minmax(0, 1fr))`,
                  gap: 10,
                }}
              >
                {latest.map((row) => (
                  <div key={row.id}>
                    <div
                      style={{
                        aspectRatio: aspectRatioToCss(row.aspect_ratio),
                        background: "var(--surface-2)",
                        border: "1px solid var(--line)",
                        borderRadius: 10,
                        overflow: "hidden",
                        maxHeight: 520,
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={row.image_url}
                        alt={row.prompt}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "contain",
                        }}
                      />
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: 6,
                        marginTop: 6,
                        flexWrap: "wrap",
                      }}
                    >
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Icons.Copy />}
                        onClick={() => copy(row.image_url, "Image URL copied")}
                      >
                        Copy URL
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          window.open(row.image_url, "_blank", "noopener")
                        }
                      >
                        Open
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setRefUrl(row.image_url)}
                        title="Use this image as the reference for the next generation"
                      >
                        Edit
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

        {batches.length > 0 && (
        <Section title="Batches">
          {batchesError && (
            <div
              style={{
                fontSize: 12,
                color: "var(--accent)",
                marginBottom: 12,
              }}
            >
              {batchesError}
            </div>
          )}
          <div
            style={{
              fontSize: 11,
              color: "var(--ink-3)",
              marginBottom: 10,
            }}
          >
            Async Gemini Batch jobs (50% off list price; SLA 24 h, typical
            2-6 h). The dashboard auto-polls every 30 s and refreshes the
            gallery when a batch completes.
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr",
              gap: 8,
            }}
          >
            {batches.map((b) => {
              const succeeded = b.results?.filter((r) => r.imageUrl).length ?? 0;
              const failed = b.results?.filter((r) => r.error).length ?? 0;
              const expandable = !!b.results && b.results.length > 0;
              const isExpanded = expandedBatchId === b.batchId;
              return (
                <div
                  key={b.batchId}
                  style={{
                    background: "var(--surface-2)",
                    border: "1px solid var(--line)",
                    borderRadius: 10,
                    overflow: "hidden",
                  }}
                >
                  <button
                    type="button"
                    onClick={() =>
                      expandable &&
                      setExpandedBatchId(isExpanded ? null : b.batchId)
                    }
                    disabled={!expandable}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      width: "100%",
                      padding: "10px 12px",
                      background: "transparent",
                      border: "none",
                      cursor: expandable ? "pointer" : "default",
                      textAlign: "left",
                    }}
                    title={
                      expandable
                        ? isExpanded
                          ? "Hide per-item detail"
                          : "Show per-item detail"
                        : undefined
                    }
                  >
                    <span
                      style={{
                        padding: "2px 8px",
                        fontSize: 10,
                        fontFamily: "var(--font-geist-mono), monospace",
                        borderRadius: 6,
                        color: "white",
                        background:
                          b.status === "SUCCEEDED"
                            ? "var(--ok, #2c7)"
                            : b.status === "FAILED" ||
                                b.status === "CANCELLED"
                              ? "var(--accent)"
                              : "var(--ink-3)",
                      }}
                    >
                      {b.status}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        color: "var(--ink-2)",
                        fontFamily: "var(--font-geist-mono), monospace",
                      }}
                      title={b.batchId}
                    >
                      {b.batchId.slice(0, 8)}…
                    </span>
                    <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                      {b.itemCount} item{b.itemCount === 1 ? "" : "s"}
                      {b.results &&
                        ` · ${succeeded} ok${failed > 0 ? ` / ${failed} failed` : ""}`}
                    </span>
                    {expandable && (
                      <span
                        style={{
                          fontSize: 10,
                          color: "var(--ink-4)",
                          fontFamily: "var(--font-geist-mono), monospace",
                        }}
                      >
                        {isExpanded ? "▼" : "▶"}
                      </span>
                    )}
                    <span
                      style={{
                        fontSize: 11,
                        color: "var(--ink-4)",
                        marginLeft: "auto",
                      }}
                    >
                      {new Date(b.submittedAt).toLocaleString()}
                    </span>
                  </button>
                  {isExpanded && b.results && (
                    <div
                      style={{
                        borderTop: "1px solid var(--line)",
                        padding: "8px 12px 10px",
                        background:
                          "color-mix(in oklab, var(--surface) 60%, transparent)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 4,
                        }}
                      >
                        {b.results.map((r, idx) => {
                          const ok = !!r.imageUrl;
                          return (
                            <div
                              key={idx}
                              style={{
                                display: "grid",
                                gridTemplateColumns:
                                  "auto auto 1fr",
                                gap: 8,
                                alignItems: "baseline",
                                fontSize: 12,
                                lineHeight: 1.5,
                              }}
                            >
                              <span
                                style={{
                                  fontFamily:
                                    "var(--font-geist-mono), monospace",
                                  color: "var(--ink-4)",
                                  fontSize: 11,
                                }}
                              >
                                #{idx + 1}
                              </span>
                              <span
                                style={{
                                  padding: "1px 6px",
                                  fontSize: 10,
                                  fontFamily:
                                    "var(--font-geist-mono), monospace",
                                  borderRadius: 4,
                                  color: "white",
                                  background: ok
                                    ? "var(--ok, #2c7)"
                                    : "var(--accent)",
                                }}
                              >
                                {ok ? "ok" : "fail"}
                              </span>
                              <span
                                style={{
                                  color: ok
                                    ? "var(--ink-3)"
                                    : "var(--ink-2)",
                                }}
                                title={r.prompt}
                              >
                                {ok ? (
                                  <span style={{ color: "var(--ink-3)" }}>
                                    {r.prompt.length > 80
                                      ? `${r.prompt.slice(0, 80)}…`
                                      : r.prompt}
                                  </span>
                                ) : (
                                  <>
                                    <span
                                      style={{
                                        color: "var(--ink-3)",
                                        marginRight: 6,
                                      }}
                                    >
                                      {r.prompt.length > 60
                                        ? `${r.prompt.slice(0, 60)}…`
                                        : r.prompt}
                                    </span>
                                    <span
                                      style={{ color: "var(--accent)" }}
                                    >
                                      {r.error}
                                    </span>
                                  </>
                                )}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      {failed > 0 && (
                        <div
                          style={{
                            marginTop: 8,
                            display: "flex",
                            justifyContent: "flex-end",
                            gap: 6,
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => retryFailedBatch(b)}
                            disabled={
                              !b.items || retryBusyId === b.batchId
                            }
                            title={
                              !b.items
                                ? "Original items unavailable for this batch"
                                : `Re-submit the ${failed} failed item${failed === 1 ? "" : "s"} as a new batch`
                            }
                            style={{
                              padding: "4px 10px",
                              fontSize: 11,
                              border: "1px solid var(--ink)",
                              borderRadius: 6,
                              background: "var(--ink)",
                              color: "white",
                              cursor:
                                !b.items || retryBusyId === b.batchId
                                  ? "not-allowed"
                                  : "pointer",
                              opacity:
                                !b.items || retryBusyId === b.batchId
                                  ? 0.6
                                  : 1,
                            }}
                          >
                            {retryBusyId === b.batchId
                              ? "Retrying…"
                              : `Retry ${failed} failed`}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const lines = (b.results ?? [])
                                .filter((r) => r.error)
                                .map(
                                  (r, i) =>
                                    `#${i + 1} | ${r.prompt} | ${r.error}`,
                                );
                              copy(
                                lines.join("\n"),
                                "Errors copied",
                              );
                            }}
                            style={{
                              padding: "4px 8px",
                              fontSize: 11,
                              border: "1px solid var(--line)",
                              borderRadius: 6,
                              background: "var(--surface)",
                              color: "var(--ink-2)",
                              cursor: "pointer",
                            }}
                          >
                            Copy errors
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
        )}
      </div>

      <Section title="Gallery">
        {galleryError && (
          <div
            style={{
              fontSize: 12,
              color: "var(--accent)",
              marginBottom: 12,
            }}
          >
            {galleryError}
          </div>
        )}
        {rows.length > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
              marginBottom: 12,
            }}
          >
            {!selectMode ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectMode(true)}
              >
                Select
              </Button>
            ) : (
              <>
                <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                  {selected.size} selected
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setSelected(new Set(rows.map((r) => r.id)))
                  }
                  disabled={bulkBusy || selected.size === rows.length}
                >
                  Select all
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelected(new Set())}
                  disabled={bulkBusy || selected.size === 0}
                >
                  Clear
                </Button>
                <div style={{ flex: 1 }} />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={downloadSelected}
                  disabled={bulkBusy || selected.size === 0}
                >
                  Download {selected.size > 0 ? `(${selected.size})` : ""}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={deleteSelected}
                  disabled={bulkBusy || selected.size === 0}
                >
                  Delete {selected.size > 0 ? `(${selected.size})` : ""}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={exitSelectMode}
                  disabled={bulkBusy}
                >
                  Done
                </Button>
              </>
            )}
          </div>
        )}
        {rows.length === 0 && !loadingGallery && (
          <div
            style={{
              padding: 32,
              border: "1px dashed var(--line)",
              borderRadius: 10,
              textAlign: "center",
              color: "var(--ink-3)",
              fontStyle: "italic",
            }}
            className="serif"
          >
            No images generated yet.
          </div>
        )}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
            gap: 12,
          }}
        >
          {rows.map((row) => {
            const isSelected = selected.has(row.id);
            return (
              <button
                key={row.id}
                onClick={() =>
                  selectMode ? toggleSelected(row.id) : setActive(row)
                }
                style={{
                  padding: 0,
                  background: "var(--surface-2)",
                  border: `2px solid ${isSelected ? "var(--ink)" : "var(--line)"}`,
                  borderRadius: 10,
                  overflow: "hidden",
                  cursor: "pointer",
                  aspectRatio: "1 / 1",
                  display: "flex",
                  position: "relative",
                }}
                title={row.prompt}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={row.image_url}
                  alt={row.prompt}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    display: "block",
                    opacity: selectMode && !isSelected ? 0.7 : 1,
                  }}
                />
                {row.reference_urls && row.reference_urls.length > 0 && (
                  <span
                    style={{
                      position: "absolute",
                      top: 6,
                      right: 6,
                      padding: "2px 6px",
                      fontSize: 10,
                      fontFamily: "var(--font-geist-mono), monospace",
                      background: "color-mix(in oklab, black 65%, transparent)",
                      color: "white",
                      borderRadius: 6,
                    }}
                    title={
                      row.reference_urls.length > 1
                        ? `Generated from ${row.reference_urls.length} reference images`
                        : "Generated from a reference image"
                    }
                  >
                    {row.reference_urls.length > 1
                      ? `edit ×${row.reference_urls.length}`
                      : "edit"}
                  </span>
                )}
                {selectMode && (
                  <span
                    aria-hidden
                    style={{
                      position: "absolute",
                      top: 6,
                      left: 6,
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      background: isSelected
                        ? "var(--ink)"
                        : "color-mix(in oklab, white 70%, transparent)",
                      color: isSelected ? "white" : "var(--ink-3)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 13,
                      fontWeight: 700,
                      border: "1px solid var(--line)",
                    }}
                  >
                    {isSelected ? "✓" : ""}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 16,
          }}
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={() => loadGallery(Math.max(0, page - 1))}
            disabled={page === 0 || loadingGallery}
          >
            ← Prev
          </Button>
          <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
            Page {page + 1}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => loadGallery(page + 1)}
            disabled={!hasMore || loadingGallery}
          >
            Next →
          </Button>
        </div>
      </Section>

      {active && (
        <Modal onClose={() => setActive(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={active.image_url}
            alt={active.prompt}
            style={{
              maxWidth: "100%",
              maxHeight: "70vh",
              objectFit: "contain",
              borderRadius: 8,
              background: "var(--surface-2)",
            }}
          />
          <div
            style={{
              fontSize: 13,
              color: "var(--ink-2)",
              marginTop: 12,
              maxHeight: 120,
              overflowY: "auto",
            }}
          >
            {active.prompt}
          </div>
          {active.reference_urls && active.reference_urls.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 11, color: "var(--ink-3)" }}>
              {active.reference_urls.length > 1
                ? `References (${active.reference_urls.length}):`
                : "Reference:"}
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  marginTop: 4,
                }}
              >
                {active.reference_urls.map((u, i) => (
                  <a
                    key={`${u}-${i}`}
                    href={u}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={u}
                    style={{ color: "var(--ink-2)", display: "inline-block" }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={u}
                      alt={`reference ${i + 1}`}
                      style={{
                        width: 48,
                        height: 48,
                        objectFit: "cover",
                        borderRadius: 6,
                        border: "1px solid var(--line)",
                      }}
                    />
                  </a>
                ))}
              </div>
            </div>
          )}
          <div
            style={{
              fontSize: 11,
              color: "var(--ink-4)",
              fontFamily: "var(--font-geist-mono), monospace",
              marginTop: 8,
            }}
          >
            {active.aspect_ratio ?? "—"} ·{" "}
            {active.gemini_model ?? "?"} ·{" "}
            {new Date(active.created_at).toLocaleString()} ·{" "}
            {active.source ?? "?"}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <Button
              variant="secondary"
              size="sm"
              icon={<Icons.Copy />}
              onClick={() => copy(active.image_url, "URL copied")}
            >
              Copy URL
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.open(active.image_url, "_blank", "noopener")}
            >
              Open full-res
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => copy(active.prompt, "Prompt copied")}
            >
              Copy prompt
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setRefUrl(active.image_url);
                setActive(null);
              }}
            >
              Edit this image
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                try {
                  await downloadOne(active);
                  toast("Downloaded");
                } catch (e) {
                  toast(`Download failed: ${(e as Error).message}`);
                }
              }}
            >
              Download
            </Button>
            <div style={{ flex: 1 }} />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const target = active;
                setActive(null);
                deleteOne(target);
              }}
              disabled={bulkBusy}
            >
              Delete
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function aspectRatioToCss(a: string | null | undefined): string {
  if (!a) return "1 / 1";
  const m = /^(\d+):(\d+)$/.exec(a);
  if (!m) return "1 / 1";
  return `${m[1]} / ${m[2]}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div
        style={{
          fontSize: 11,
          fontFamily: "var(--font-geist-mono), monospace",
          textTransform: "uppercase",
          letterSpacing: "0.12em",
          color: "var(--ink-3)",
          marginBottom: 12,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  fontSize: 13,
  background: "var(--surface)",
  border: "1px solid var(--line-2)",
  borderRadius: 8,
  color: "var(--ink)",
};

function Modal({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "color-mix(in oklab, black 55%, transparent)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 14,
          padding: 20,
          maxWidth: 720,
          width: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        {children}
      </div>
    </div>
  );
}
