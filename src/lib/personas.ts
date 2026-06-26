export type PersonaId =
  | "andrea"
  | "emma"
  | "olivia"
  | "mia"
  | "abby"
  | "diane"
  | "sydney"
  | "maddy"
  | "hannah"
  | "hailey"
  | "taylor"
  | "max"
  | "ava"
  | "rachel"
  | "sarah"
  | "jessica"
  | "alex"
  | "maya"
  | "jess";

export interface Persona {
  id: PersonaId;
  name: string;
  color: string;
  soft: string;
  tagline: string;
  avatar: string;
}

export const PERSONAS: Record<PersonaId, Persona> = {
  andrea: {
    id: "andrea",
    name: "Andrea",
    color: "var(--p-andrea)",
    soft: "var(--p-andrea-soft)",
    tagline: "soft-girl, dreamcore pastels",
    avatar: "🌸",
  },
  emma: {
    id: "emma",
    name: "Emma",
    color: "var(--p-emma)",
    soft: "var(--p-emma-soft)",
    tagline: "cosmic romantic, moonlit",
    avatar: "🌙",
  },
  olivia: {
    id: "olivia",
    name: "Olivia",
    color: "var(--p-olivia)",
    soft: "var(--p-olivia-soft)",
    tagline: "earthy coastal, sun-washed",
    avatar: "🌿",
  },
  mia: {
    id: "mia",
    name: "Mia",
    color: "var(--p-mia)",
    soft: "var(--p-mia-soft)",
    tagline: "golden wheat, sunlit warmth",
    avatar: "🌾",
  },
  abby: {
    id: "abby",
    name: "Abby",
    color: "var(--p-abby)",
    soft: "var(--p-abby-soft)",
    tagline: "coastal haze, morning tide",
    avatar: "🐚",
  },
  diane: {
    id: "diane",
    name: "Diane",
    color: "var(--p-diane)",
    soft: "var(--p-diane-soft)",
    tagline: "mauve florals, vintage soft",
    avatar: "🌷",
  },
  sydney: {
    id: "sydney",
    name: "Sydney",
    color: "var(--p-sydney)",
    soft: "var(--p-sydney-soft)",
    tagline: "honeyed dusk, amber glow",
    avatar: "🍯",
  },
  maddy: {
    id: "maddy",
    name: "Maddy",
    color: "var(--p-maddy)",
    soft: "var(--p-maddy-soft)",
    tagline: "misty slate, quiet chic",
    avatar: "🪶",
  },
  hannah: {
    id: "hannah",
    name: "Hannah",
    color: "var(--p-hannah)",
    soft: "var(--p-hannah-soft)",
    tagline: "sun-bleached, clean-girl glow",
    avatar: "🌊",
  },
  hailey: {
    id: "hailey",
    name: "Hailey",
    color: "var(--p-hailey)",
    soft: "var(--p-hailey-soft)",
    tagline: "sunflower fields, golden hour",
    avatar: "🌻",
  },
  taylor: {
    id: "taylor",
    name: "Taylor",
    color: "var(--p-taylor)",
    soft: "var(--p-taylor-soft)",
    tagline: "champagne shimmer, soft glam",
    avatar: "✨",
  },
  max: {
    id: "max",
    name: "Max",
    color: "var(--p-max)",
    soft: "var(--p-max-soft)",
    tagline: "weekend casual, easy denim",
    avatar: "🧢",
  },
  ava: {
    id: "ava",
    name: "Ava",
    color: "var(--p-ava)",
    soft: "var(--p-ava-soft)",
    tagline: "fresh greens, garden light",
    avatar: "🍃",
  },
  rachel: {
    id: "rachel",
    name: "Rachel",
    color: "var(--p-rachel)",
    soft: "var(--p-rachel-soft)",
    tagline: "autumn russet, cozy warmth",
    avatar: "🦊",
  },
  sarah: {
    id: "sarah",
    name: "Sarah",
    color: "var(--p-sarah)",
    soft: "var(--p-sarah-soft)",
    tagline: "bright sun, citrus warmth",
    avatar: "☀️",
  },
  jessica: {
    id: "jessica",
    name: "Jessica",
    color: "var(--p-jessica)",
    soft: "var(--p-jessica-soft)",
    tagline: "starlit violet, dreamy haze",
    avatar: "💫",
  },
  alex: {
    id: "alex",
    name: "Alex",
    color: "var(--p-alex)",
    soft: "var(--p-alex-soft)",
    tagline: "alpine stone, cool calm",
    avatar: "🏔️",
  },
  maya: {
    id: "maya",
    name: "Maya",
    color: "var(--p-maya)",
    soft: "var(--p-maya-soft)",
    tagline: "hibiscus bloom, coral warmth",
    avatar: "🌺",
  },
  jess: {
    id: "jess",
    name: "Jess",
    color: "var(--p-jess)",
    soft: "var(--p-jess-soft)",
    tagline: "teal tide, serene aqua",
    avatar: "🪷",
  },
};

export const PERSONA_IDS: PersonaId[] = [
  "andrea",
  "emma",
  "olivia",
  "mia",
  "abby",
  "diane",
  "sydney",
  "maddy",
  "hannah",
  "hailey",
  "taylor",
  "max",
  "ava",
  "rachel",
  "sarah",
  "jessica",
  "alex",
  "maya",
  "jess",
];

export const isPersonaId = (v: unknown): v is PersonaId =>
  typeof v === "string" && (PERSONA_IDS as string[]).includes(v);
