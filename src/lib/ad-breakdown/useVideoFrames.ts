"use client";

/**
 * Frames without ffmpeg: seek a hidden <video> to each timestamp and draw it
 * to a canvas. Works because the video is re-hosted in our Storage bucket,
 * which serves CORS headers; if the canvas is ever tainted anyway the hook
 * falls back to "native" mode and the caller renders <video src="…#t=…">
 * elements instead (the browser shows the frame at that time as the poster).
 */
import * as React from "react";

export interface FrameCapture {
  /** dataURL per timestamp key (t.toFixed(2)). */
  frames: Record<string, string>;
  done: boolean;
  mode: "canvas" | "native";
  error: string | null;
}

export function frameKey(t: number): string {
  return t.toFixed(2);
}

export function useVideoFrames(videoUrl: string | null, times: number[], width = 320): FrameCapture {
  const [state, setState] = React.useState<FrameCapture>({ frames: {}, done: false, mode: "canvas", error: null });
  const timesKey = times.map(frameKey).join(",");

  React.useEffect(() => {
    if (!videoUrl || times.length === 0) {
      setState({ frames: {}, done: true, mode: "canvas", error: null });
      return;
    }
    let alive = true;
    const frames: Record<string, string> = {};
    setState({ frames: {}, done: false, mode: "canvas", error: null });

    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = videoUrl;

    const seekTo = (t: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 4000);
        const onSeeked = () => {
          clearTimeout(timer);
          resolve();
        };
        video.addEventListener("seeked", onSeeked, { once: true });
        video.currentTime = Math.min(t, Math.max(0, video.duration - 0.05));
      });

    const run = async () => {
      await new Promise<void>((resolve, reject) => {
        video.addEventListener("loadedmetadata", () => resolve(), { once: true });
        video.addEventListener("error", () => reject(new Error("video failed to load")), { once: true });
      });
      const canvas = document.createElement("canvas");
      const ratio = video.videoHeight / Math.max(1, video.videoWidth);
      canvas.width = width;
      canvas.height = Math.round(width * ratio);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no canvas context");
      for (const t of [...times].sort((a, b) => a - b)) {
        if (!alive) return;
        await seekTo(t);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        try {
          frames[frameKey(t)] = canvas.toDataURL("image/jpeg", 0.82);
        } catch {
          // tainted canvas (no CORS): fall back to native <video> posters
          if (alive) setState({ frames: {}, done: true, mode: "native", error: null });
          return;
        }
        if (alive) setState({ frames: { ...frames }, done: false, mode: "canvas", error: null });
      }
      if (alive) setState({ frames: { ...frames }, done: true, mode: "canvas", error: null });
    };

    run().catch((e: Error) => {
      if (alive) setState({ frames: {}, done: true, mode: "native", error: e.message });
    });

    return () => {
      alive = false;
      video.removeAttribute("src");
      video.load();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl, timesKey, width]);

  return state;
}
