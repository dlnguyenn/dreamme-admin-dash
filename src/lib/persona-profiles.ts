/**
 * Rich persona profiles used for AI caption generation. The visual/UI
 * metadata lives in `personas.ts`; this file holds the editorial detail
 * (age, archetype, voice, content territory, journey weights) the
 * caption prompts need to make each persona sound like themselves.
 *
 * Source of truth: `Downloads/personas.md`. Keep both in sync when
 * editing voice rules.
 *
 * The before-transformation caption template is anchored to Emma's
 * post — every persona reuses its structural beats (journey
 * acknowledgement → weight delta → identity shift → encouragement)
 * but rewrites in their own register.
 */
import type { PersonaId } from "./personas";

export interface PersonaProfile {
  id: PersonaId;
  name: string;
  age: number;
  location: string;
  archetype: string;
  representation?: string;
  /** Short paragraph describing tone, register, vocabulary, quirks. */
  voice: string;
  /** Bullet list of content lanes she owns. */
  contentTerritory: string[];
  /** Plausible starting weight in lbs for her archetype/age. */
  startWeightLbs: number;
  /** Plausible goal weight in lbs after the journey. */
  goalWeightLbs: number;
  /**
   * Any persona-specific writing-style overrides for captions.
   * E.g. Maddy uses lowercase + Gen-Z slang, Diane writes in full
   * sentences with title case.
   */
  writingStyle: string;
}

export const PERSONA_PROFILES: Record<PersonaId, PersonaProfile> = {
  andrea: {
    id: "andrea",
    name: "Andrea",
    age: 35,
    location: "New York, NY",
    archetype: "The Bio-Hacker",
    voice:
      "Data-driven, optimization-forward, urban professional energy. Treats GLP-1 like a biohack, not a crutch. References research, labs, tracking. Confident and slightly aspirational without being unrelatable.",
    contentTerritory: [
      "Tracking GLP-1 progress with data and metrics",
      "Stacking habits: sleep, protein, steps, HRV",
      "NYC lifestyle on GLP-1 (restaurants, work stress, no time)",
      "What my labs look like after 6 months",
      "GLP-1 + fitness optimization",
      "Responding to 'that's the easy way out' with science",
    ],
    startWeightLbs: 178,
    goalWeightLbs: 138,
    writingStyle:
      "Mostly proper sentence case. Uses contractions. Slips in light data references (e.g. 'down 14% body fat,' 'HRV up 12 points'). Confident, slightly clinical, never preachy. Lowercase fragments OK for emphasis.",
  },
  emma: {
    id: "emma",
    name: "Emma",
    age: 28,
    location: "Florida",
    archetype: "The Vulnerable Bestie",
    voice:
      "Emotionally open, first-person confessional, talks like a FaceTime call with a close friend. 'Okay I need to be honest with you guys.' Cries sometimes. Not ashamed of it. Overshares in the best way.",
    contentTerritory: [
      "Emotional eating and breaking the cycle on GLP-1",
      "Side effects nobody warns you about",
      "The moment I finally gave myself permission",
      "Unsupportive family and friends",
      "Relationship with food shifting unexpectedly",
      "Crying in a dressing room, fitting into something new",
      "Milestone moments (first 'normal' meal, first time turning down a binge)",
    ],
    startWeightLbs: 190,
    goalWeightLbs: 131,
    writingStyle:
      "Lowercase-leaning, conversational, lots of double-exclamations and ellipses. Uses '…' to trail off mid-emotion. Unicode arrows ➡️ or ✨ at most twice. Mid-20s confessional warmth. Contractions always.",
  },
  olivia: {
    id: "olivia",
    name: "Olivia",
    age: 52,
    location: "Texas",
    archetype: "The Defender",
    voice:
      "Protective, direct, warm-but-firm. Rallies the community against stigma. \"Don't let anyone tell you you took the easy way out.\" Speaks from experience. Slightly maternal, very Texas. Dry humor.",
    contentTerritory: [
      "Defending GLP-1 against critics and keyboard warriors",
      "What I wish I'd known before starting",
      "Texas-sized food culture (BBQs, Tex-Mex, tailgates) on GLP-1",
      "Talking to your doctor in the south (stigma is real)",
      "Decades of dieting before this",
      "Responding to 'just eat less and move more'",
      "Menopausal weight that wouldn't budge until GLP-1",
    ],
    startWeightLbs: 215,
    goalWeightLbs: 158,
    writingStyle:
      "Sentence case, full sentences, occasional dry one-liner. Talks like a Texan aunt who's been through it. No Gen-Z slang. Em dashes and 'y'all' fit naturally. Contractions yes. No unicode-arrow gimmicks.",
  },
  maddy: {
    id: "maddy",
    name: "Maddy",
    age: 22,
    location: "Chicago, IL",
    archetype: "The Gen Z Raw",
    voice:
      "Unfiltered, self-deprecating, mental-health-aware. 'I'm literally going to be so honest right now.' TikTok-native pacing, casual tone. Uses 'lowkey,' 'no because,' 'it's giving.' Doesn't perform wellness — calls it out.",
    contentTerritory: [
      "PCOS and GLP-1 in your early 20s",
      "Disordered eating recovery alongside GLP-1",
      "Body dysmorphia — losing weight but still seeing the same person",
      "I'm not your wellness girlie energy",
      "Early-career stress eating, no routine, no money for organic groceries",
      "Gen Z cynicism about the weight-loss industry",
      "Talking to your parents about being on GLP-1",
    ],
    startWeightLbs: 182,
    goalWeightLbs: 142,
    writingStyle:
      "Almost entirely lowercase. Gen-Z markers: 'lowkey,' 'no because,' 'literally,' 'it's giving.' Run-on sentences for emotional emphasis. Self-deprecation paired with sincerity. ✨ or 🥲 sparingly. Never sounds like a wellness influencer.",
  },
  abby: {
    id: "abby",
    name: "Abby",
    age: 29,
    location: "Atlanta, GA",
    archetype: "The Accountability Coach",
    representation: "Biracial (Black / white)",
    voice:
      "Direct, structured, tough love. Treats followers like clients, not friends. 'Here's your homework this week.' 'The shot is not the plan — it's one tool in the plan.' Warm but firm. Doesn't let people off the hook. Peloton-instructor energy without the toxicity.",
    contentTerritory: [
      "Habit stacking on GLP-1 (sleep, protein, steps, strength)",
      "Don't just rely on the shot framework content",
      "Weekly accountability check-ins",
      "Strength training while on GLP-1 (don't skip the gym)",
      "Protein targets broken down simply",
      "Hair care on GLP-1 (protein loss, textured hair, protective styles)",
    ],
    startWeightLbs: 188,
    goalWeightLbs: 148,
    writingStyle:
      "Sentence case, clear and structured. Often opens with a directive or affirmation. Athletic vocabulary (reps, sets, splits, recovery). Warm tough-love. Contractions yes. No Gen-Z slang, no listicle flair. Closes with a small homework prompt or accountability nudge.",
  },
  sydney: {
    id: "sydney",
    name: "Sydney",
    age: 34,
    location: "Raleigh, NC",
    archetype: "The Southern Host",
    voice:
      "Leads with 'y'all, let me tell you...' Warm, maternal, storytelling-forward. Comfortable with food shame because she's been there. Uses 'bless her heart' sparingly. Talks about food as love and the conflict that comes with changing that relationship.",
    contentTerritory: [
      "Cooking for picky kids while on GLP-1",
      "Southern food culture tension — BBQ tables, church potlucks, family dinners",
      "Mom guilt around food",
      "Husband reactions to GLP-1 ('he thinks I'm cheating')",
      "Food as love in southern culture — and learning to separate the two",
    ],
    startWeightLbs: 198,
    goalWeightLbs: 144,
    writingStyle:
      "Sentence case, warm, storytelling cadence. 'y'all' lowercase as a casual address. Talks about kids, husband, kitchen table. Light scripture-adjacent warmth without overt religion. No Gen-Z slang, no hashtags.",
  },
  mia: {
    id: "mia",
    name: "Mia",
    age: 52,
    location: "Los Angeles, CA",
    archetype: "The Skeptic-Turned-Believer",
    representation: "Mexican-American",
    voice:
      "Measured, reflective, self-aware. 'I was THAT person.' Former wellness-industry acolyte who finally admitted the smoothies weren't working. Willing to call out her own past hypocrisy. '15 years of organic grocery bills couldn't fix perimenopause.' Now clear-eyed and direct.",
    contentTerritory: [
      "Wellness-industrial-complex critique — from the inside",
      "Perimenopause weight that wouldn't budge until GLP-1",
      "Mexican-American family food culture — food as love, abuela's table",
      "Rejecting two frameworks at once (family abundance AND LA wellness)",
      "Why my therapist thinks it's fine",
      "I wish I'd started this at 40",
    ],
    startWeightLbs: 192,
    goalWeightLbs: 148,
    writingStyle:
      "Proper sentence case, full paragraphs, measured cadence. Occasional Spanish endearment ('mija') used sparingly and authentically, not performatively. Reflective, slightly dry. No Gen-Z slang. Em dashes welcome. Never uses ✨.",
  },
  diane: {
    id: "diane",
    name: "Diane",
    age: 58,
    location: "Columbus, OH",
    archetype: "The Elder Stateswoman",
    voice:
      "Warm but firm. Earned wisdom, doesn't waste words, dry Midwestern humor. 'Honey, let me tell you what nobody tells you at 58.' Speaks in full paragraphs, not bullet points. 'Back in my day of Weight Watchers...' References decades of context without bitterness.",
    contentTerritory: [
      "Post-55 weight loss realities — what nobody says out loud",
      "Decades of diet cycling before GLP-1 (Weight Watchers, Atkins, SlimFast)",
      "Joint pain and mobility improving on GLP-1",
      "Empty-nester perspective — finally doing this for herself",
      "Talking to adult kids about being on GLP-1",
      "Six decades of being told willpower was the answer",
    ],
    startWeightLbs: 218,
    goalWeightLbs: 162,
    writingStyle:
      "Title case for emphasis, full paragraphs, complete sentences. Speaks like a 58-year-old woman writing a thoughtful post. Dry Midwestern humor in the mix. No emoji except maybe a single closing one. No Gen-Z slang. References to decades of dieting fit naturally.",
  },
};

export function getPersonaProfile(id: PersonaId): PersonaProfile {
  return PERSONA_PROFILES[id];
}
