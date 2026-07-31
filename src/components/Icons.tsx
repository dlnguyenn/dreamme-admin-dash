"use client";

import * as React from "react";

export interface IconProps extends React.SVGAttributes<SVGSVGElement> {
  size?: number;
  stroke?: string;
  strokeWidth?: number;
}

const Icon = ({
  size = 20,
  stroke = "currentColor",
  strokeWidth = 1.7,
  fill = "none",
  viewBox = "0 0 24 24",
  style,
  children,
  ...rest
}: IconProps & { children: React.ReactNode }) => (
  <svg
    width={size}
    height={size}
    viewBox={viewBox}
    fill={fill}
    stroke={stroke}
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ flexShrink: 0, ...style }}
    {...rest}
  >
    {children}
  </svg>
);

export const Icons = {
  Image: (p: IconProps) => (
    <Icon {...p}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </Icon>
  ),
  Sparkles: (p: IconProps) => (
    <Icon {...p}>
      <path d="M12 3v3m0 12v3m-9-9H0m24 0h-3M5.6 5.6 3.5 3.5m17 17-2.1-2.1M5.6 18.4 3.5 20.5m17-17-2.1 2.1" />
      <path d="M12 8l1.5 3L16 12.5 13.5 14 12 17l-1.5-3L8 12.5 10.5 11z" />
    </Icon>
  ),
  Chart: (p: IconProps) => (
    <Icon {...p}>
      <path d="M3 3v18h18M7 14l4-4 4 4 5-6" />
    </Icon>
  ),
  Message: (p: IconProps) => (
    <Icon {...p}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </Icon>
  ),
  Hook: (p: IconProps) => (
    <Icon {...p}>
      <path d="M12 2v14m0 0a4 4 0 1 1-4-4" />
      <circle cx="12" cy="3" r="1.5" fill="currentColor" />
    </Icon>
  ),
  Send: (p: IconProps) => (
    <Icon {...p}>
      <path d="m22 2-7 20-4-9-9-4z" />
      <path d="M22 2 11 13" />
    </Icon>
  ),
  Settings: (p: IconProps) => (
    <Icon {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </Icon>
  ),
  Star: (p: IconProps) => (
    <Icon {...p}>
      <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" />
    </Icon>
  ),
  StarFilled: (p: IconProps) => (
    <Icon {...p} fill="currentColor" stroke="none">
      <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" />
    </Icon>
  ),
  Copy: (p: IconProps) => (
    <Icon {...p}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </Icon>
  ),
  Check: (p: IconProps) => (
    <Icon {...p}>
      <path d="M20 6 9 17l-5-5" />
    </Icon>
  ),
  Close: (p: IconProps) => (
    <Icon {...p}>
      <path d="M18 6 6 18M6 6l12 12" />
    </Icon>
  ),
  Download: (p: IconProps) => (
    <Icon {...p}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
    </Icon>
  ),
  Edit: (p: IconProps) => (
    <Icon {...p}>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4z" />
    </Icon>
  ),
  Search: (p: IconProps) => (
    <Icon {...p}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </Icon>
  ),
  Lock: (p: IconProps) => (
    <Icon {...p}>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </Icon>
  ),
  Webhook: (p: IconProps) => (
    <Icon {...p}>
      <path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2M6 17l3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06M12 6l3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8" />
    </Icon>
  ),
  Plus: (p: IconProps) => (
    <Icon {...p}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  ),
  Bookmark: (p: IconProps) => (
    <Icon {...p}>
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </Icon>
  ),
  BookmarkFilled: (p: IconProps) => (
    <Icon {...p} fill="currentColor" stroke="none">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </Icon>
  ),
  Grid: (p: IconProps) => (
    <Icon {...p}>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </Icon>
  ),
  Sun: (p: IconProps) => (
    <Icon {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32 1.41-1.41" />
    </Icon>
  ),
  Moon: (p: IconProps) => (
    <Icon {...p}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </Icon>
  ),
  Clock: (p: IconProps) => (
    <Icon {...p}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </Icon>
  ),
  Logout: (p: IconProps) => (
    <Icon {...p}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </Icon>
  ),
  MoreVertical: (p: IconProps) => (
    <Icon {...p}>
      <circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none" />
    </Icon>
  ),
  Link: (p: IconProps) => (
    <Icon {...p}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.72" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.72" />
    </Icon>
  ),
  Trash: (p: IconProps) => (
    <Icon {...p}>
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14zM10 11v6M14 11v6" />
    </Icon>
  ),
  Swap: (p: IconProps) => (
    <Icon {...p}>
      <path d="M7 4l-4 4 4 4M3 8h14M17 20l4-4-4-4M21 16H7" />
    </Icon>
  ),
  Upload: (p: IconProps) => (
    <Icon {...p}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
    </Icon>
  ),
  Menu: (p: IconProps) => (
    <Icon {...p}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </Icon>
  ),
  // ---- Porcelain nav/section glyphs (design-handoff path set) ----
  Chat: (p: IconProps) => (
    <Icon {...p}>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H9.5L4 20Z" />
    </Icon>
  ),
  ChatLines: (p: IconProps) => (
    <Icon {...p}>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H9.5L4 20ZM8.5 9h7M8.5 12h4" />
    </Icon>
  ),
  Film: (p: IconProps) => (
    <Icon {...p}>
      <path d="M5 4.5h14A1.5 1.5 0 0 1 20.5 6v12a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18V6A1.5 1.5 0 0 1 5 4.5ZM10 9.2l4.8 2.8-4.8 2.8Z" />
    </Icon>
  ),
  Layers: (p: IconProps) => (
    <Icon {...p}>
      <path d="M12 3.5 21 8.5l-9 5-9-5ZM4.5 13 12 17l7.5-4" />
    </Icon>
  ),
  Music: (p: IconProps) => (
    <Icon {...p}>
      <path d="M9 17.5a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0ZM19.5 15.5a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0ZM9 17.5V6l10.5-2v11.5" />
    </Icon>
  ),
  Dollar: (p: IconProps) => (
    <Icon {...p}>
      <path d="M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM12 7v10M14.6 9c-.5-.7-1.5-1.2-2.6-1.2-1.5 0-2.7.8-2.7 2 0 2.5 5.4 1.3 5.4 3.8 0 1.2-1.2 2-2.7 2-1.1 0-2.1-.5-2.6-1.2" />
    </Icon>
  ),
  Spark: (p: IconProps) => (
    <Icon {...p}>
      <path d="M12 3.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5Z" />
    </Icon>
  ),
  Trend: (p: IconProps) => (
    <Icon {...p}>
      <path d="M4 17.5l5.5-5.5 3.5 3.4L19.5 9M14.2 8.5H20v5.8" />
    </Icon>
  ),
  Flag: (p: IconProps) => (
    <Icon {...p}>
      <path d="M6 21V4.5c4-2 8 2 12 .2V14c-4 1.8-8-2.2-12-.2" />
    </Icon>
  ),
  Flask: (p: IconProps) => (
    <Icon {...p}>
      <path d="M10 3.5h4M10.5 3.5v5L5.2 17.6A1.8 1.8 0 0 0 6.8 20.5h10.4a1.8 1.8 0 0 0 1.6-2.9L13.5 8.5v-5M7.5 14.5h9" />
    </Icon>
  ),
  Aperture: (p: IconProps) => (
    <Icon {...p}>
      <path d="M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM12 8.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4Z" />
    </Icon>
  ),
  Scissors: (p: IconProps) => (
    <Icon {...p}>
      <path d="M6 4.2a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8ZM6 15a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8ZM8.2 8.2 20 19.6M8.2 15.8 20 4.4" />
    </Icon>
  ),
  Inbox: (p: IconProps) => (
    <Icon {...p}>
      <path d="M4.5 13.5 7 5.5h10l2.5 8M4.5 13.5V18a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-4.5M4.5 13.5H9l1.6 2.6h2.8l1.6-2.6h4.5" />
    </Icon>
  ),
  Octagon: (p: IconProps) => (
    <Icon {...p}>
      <path d="M8.6 3.5h6.8L20.5 8.6v6.8l-5.1 5.1H8.6L3.5 15.4V8.6ZM12 8v4.6M12 15.8v.2" />
    </Icon>
  ),
  TriAlert: (p: IconProps) => (
    <Icon {...p}>
      <path d="M12 4 2.8 19.5h18.4ZM12 10v3.6M12 16.4v.2" />
    </Icon>
  ),
  InfoCircle: (p: IconProps) => (
    <Icon {...p}>
      <path d="M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM12 11v5M12 7.8v.2" />
    </Icon>
  ),
  Refresh: (p: IconProps) => (
    <Icon {...p}>
      <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4.5h-4.5" />
    </Icon>
  ),
  UserOutline: (p: IconProps) => (
    <Icon {...p}>
      <path d="M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4.5 20c.8-3.5 3.8-5.5 7.5-5.5s6.7 2 7.5 5.5" />
    </Icon>
  ),
  CardOutline: (p: IconProps) => (
    <Icon {...p}>
      <path d="M4 6h16v12H4ZM4 10h16" />
    </Icon>
  ),
  ChevronDown: (p: IconProps) => (
    <Icon {...p}>
      <path d="M6 9l6 6 6-6" />
    </Icon>
  ),
  ChevronLeft: (p: IconProps) => (
    <Icon {...p}>
      <path d="M15 6l-6 6 6 6" />
    </Icon>
  ),
  ChevronRight: (p: IconProps) => (
    <Icon {...p}>
      <path d="M9 6l6 6-6 6" />
    </Icon>
  ),
  SignOut: (p: IconProps) => (
    <Icon {...p}>
      <path d="M14 4.5H6.5A1.5 1.5 0 0 0 5 6v12a1.5 1.5 0 0 0 1.5 1.5H14M10.5 12H20M20 12l-3.2-3.2M20 12l-3.2 3.2" />
    </Icon>
  ),
} satisfies Record<string, React.FC<IconProps>>;

export type IconName = keyof typeof Icons;
