import type { PersonaId } from "./personas";

export interface Delivery {
  id: string;
  personaId: PersonaId;
  imageUrl: string;
  caption: string;
  posted: boolean;
  starred: boolean;
  inLibrary: boolean;
  createdAt: string;
}

export interface SavedCaption {
  id: string;
  sourceItemId: string | null;
  personaId: PersonaId;
  caption: string;
  posted: boolean;
  starred: boolean;
  createdAt: string;
}

export interface DashState {
  items: Delivery[];
  savedCaptions: SavedCaption[];
}

export interface DeliveryRow {
  id: string;
  persona: PersonaId;
  image_url: string;
  caption: string;
  posted: boolean | null;
  starred: boolean | null;
  in_library: boolean | null;
  created_at: string;
}

export interface SavedCaptionRow {
  id: string;
  source_delivery_id: string | null;
  persona: PersonaId;
  caption: string;
  posted: boolean | null;
  starred: boolean | null;
  created_at: string;
}
