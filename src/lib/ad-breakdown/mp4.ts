/**
 * Duration straight from the MP4 container (moov > mvhd). There is no
 * ffprobe on Vercel, and the retention milestones need the real length
 * before the browser has decoded anything. Returns null on any surprise
 * so the caller can fall back to Gemini's read of the duration.
 */

function boxes(buf: Buffer, start: number, end: number): Array<{ type: string; start: number; size: number; header: number }> {
  const out: Array<{ type: string; start: number; size: number; header: number }> = [];
  let p = start;
  while (p + 8 <= end) {
    let size = buf.readUInt32BE(p);
    const type = buf.toString("latin1", p + 4, p + 8);
    let header = 8;
    if (size === 1) {
      if (p + 16 > end) return out;
      size = buf.readUInt32BE(p + 8) * 0x1_0000_0000 + buf.readUInt32BE(p + 12);
      header = 16;
    } else if (size === 0) {
      size = end - p;
    }
    if (size < header || p + size > end) return out;
    out.push({ type, start: p, size, header });
    p += size;
  }
  return out;
}

export function mp4Duration(bytes: Uint8Array): number | null {
  try {
    const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const moov = boxes(buf, 0, buf.length).find((b) => b.type === "moov");
    if (!moov) return null;
    const mvhd = boxes(buf, moov.start + moov.header, moov.start + moov.size).find((b) => b.type === "mvhd");
    if (!mvhd) return null;
    const p = mvhd.start + mvhd.header;
    const version = buf.readUInt8(p);
    if (version === 1) {
      const timescale = buf.readUInt32BE(p + 20);
      const duration = buf.readUInt32BE(p + 24) * 0x1_0000_0000 + buf.readUInt32BE(p + 28);
      return timescale ? duration / timescale : null;
    }
    const timescale = buf.readUInt32BE(p + 12);
    const duration = buf.readUInt32BE(p + 16);
    return timescale ? duration / timescale : null;
  } catch {
    return null;
  }
}
