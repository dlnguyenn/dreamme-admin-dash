export type PersonaId = "andrea" | "emma" | "olivia";

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
};

export const PERSONA_IDS: PersonaId[] = ["andrea", "emma", "olivia"];

export const isPersonaId = (v: unknown): v is PersonaId =>
  v === "andrea" || v === "emma" || v === "olivia";
