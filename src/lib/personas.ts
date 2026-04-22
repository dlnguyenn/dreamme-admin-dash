export type PersonaId =
  | "andrea"
  | "emma"
  | "olivia"
  | "mia"
  | "abby"
  | "diane"
  | "sydney"
  | "maddy";

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
];

export const isPersonaId = (v: unknown): v is PersonaId =>
  typeof v === "string" && (PERSONA_IDS as string[]).includes(v);
