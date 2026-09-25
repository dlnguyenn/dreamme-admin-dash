/**
 * Motion ad rubric, verbatim from the local skill
 * (~/.claude/skills/ad-breakdown/references/motion-rubric.md). Regenerate
 * from that file rather than editing here so the CLI and the dashboards
 * grade against the same text. Sources and dates are inside the text.
 */
export const MOTION_RUBRIC = `# Motion ad rubric

Sources, pulled 2026-09-25: Motion "Creative Benchmarks 2026" (578,750 creatives, 6,015 accounts, $1.29B Meta spend, Sep 2025 to Jan 2026, a BFCM-heavy window), "Key metrics for creative performance", "Lesson 5: the formula for winning ads", "Creative Strategy Engine", "The complete guide to making UGC ads", "How to stop a scroll in 3 seconds".

## Benchmarks (Meta)

| Metric | Formula | Needs work | Solid | Strong |
|---|---|---|---|---|
| Hook / thumbstop | 3-second plays / impressions | under 25% | 25 to 35% | over 35% (target 30 to 40%) |
| Hold | 15-second plays (ThruPlay) / 3-second plays | under 30% | 40 to 50% is average | over 60% |
| Average watch time | | | | at least 50% of duration |
| Completion | 100% views / impressions | | | 30 to 40% |
| CTR | clicks / impressions | under 0.9% | 0.9 to 1.5% | over 1.5% |

Diagnosis rules:
- Hook low: it is a creative problem, not a media-buying problem. Fix the first three seconds with a stronger pattern interrupt.
- Hook strong, hold weak: the body does not deliver what the hook promised. Fix the story arc and proof points.
- Attention and engagement fine, conversion poor: the offer, CTA or landing is misaligned. Test the same hook and body with different CTAs.
- CTR high, conversion poor: clickbait or the wrong audience.
- Judge only after 3 days and at least 2,000 impressions, 50 to 100 clicks or 3 to 5 conversions. Kill at 48 to 72 h if CTR is under 50% of control or CPA over 25% worse than target.

Winner definition: an ad that spends at least 10x the account's median ad (and at least $500). About 5% of ads. Half of all ads get almost no spend; 6% take most of it. Motion's stated conclusion: strategists read patterns, they do not predict winners. Volume of good-enough tests beats perfecting one ad.

## Anatomy of a winning ad (12-point formula)

Structure: Hook (problem) > Story (solution) > CTA.
1. Attention-grabbing hook: an unexpected visual, a thought-provoking question, or a relatable scenario.
2. High-quality visuals, even when lo-fi: opening frames and resolution matter most.
3. Authenticity: real people in real situations.
4. Product clearly visible within the first 2 seconds.
5. Clear problem to solution narrative.
6. Demonstration: uses, features and benefits, so the viewer can picture themselves using it.
7. Fast-paced edits: change frames at least every 2 seconds or so.
8. Testimonials and social proof.
9. Features woven into the narrative, not listed.
10. Emotional appeal: relief, excitement, aspiration.
11. One strong, clear call to action.
12. X factor: humor, a skit, a surprise.

## The first 3 seconds (thumbstop guide and strategy engine)

Three thumbstop types: (a) human connection, a person who matches the target viewer visibly expressing an emotion; (b) a bold problem statement as prominent on-screen text; (c) a shocking or satisfying visual (problem shock, product satisfaction, result satisfaction).
Design for sound off: the hook has to read muted, through text and visuals. Frame 1 establishes the human and the emotion.
A hook earns attention when it expresses a messaging angle (a specific persona x pain), matches the awareness stage's job, uses conversational human language, and is specific to the persona's life. Broad lifestyle statements and vague benefit claims surface less among winners; messages that delay clarity struggle.

Awareness stage sets the hook's job: Unaware, make the problem visible. Problem-aware, agitate and validate. Solution-aware, compare categories. Product-aware, prove and guarantee. Most-aware, urgency and CTA. Formats that reveal fit early stages; formats that prove or drive action fit late stages.

## Hook tactics by hit rate (percent of uses that became winners; BFCM window inflates deal tactics)

Newness 11.4, Sale announcement 11.4, Price anchor 10.9, Urgency 9.7, Offer only 9.3, FOMO 9.2, Confession 8.7, Exclusivity 8.4, Curiosity 7.8, Bold claim 7.2, Shocking statement 7.1, If-then 7.1, Warning 7.1, Contrarian 7.0, Relatability 6.9, Contrast 6.8, Direct address 6.7, Authority 6.4, Storytelling 6.2, Question 5.5, How-to 5.5, Listicle 5.5, Explainer 5.2.
Reading: immediacy, clarity and a concrete reason to act win most; attention tactics (curiosity, confession, bold claim, shock) next; explainer-shaped hooks (question, how-to, listicle, explainer) sit at the bottom on paid Meta. Note for DreamMe: listicles dominate our organic TikTok, but paid Meta is a different game.

## Visual formats by hit rate

All verticals: Unboxing 9.8, Offer-first banner 8.7, Behind the scenes 8.6, Founder 8.6, POV 8.3, Demo 8.1, Grid swap 8.0, Influencer endorsement 7.7, Montage 7.0, Cinematic b-roll 6.9, How-to 6.6, Testimonial 6.6, Us vs them 6.5, Headline 6.3, Before and after 6.1, Problem agitation 6.0, Expert explainer 6.0, Statistic 5.8, Split screen 5.6, Feature benefit pointout 5.6, Screen recording 5.5, Listicle 5.3, Review 4.9, Greenscreen 4.9.
Health and wellness view: Stitch 12.5, Reaction video 11.2, Unboxing 10.9, Celebrity 10.4, Founder 10.2, Letter 9.8, Stop motion 9.0, Influencer endorsement 8.8, POV 8.7, Transformation 8.4.
Asset types: Text only 11.6, Product image with text 8.8, UGC 7.6, High production 7.0, GIF 6.8, Illustration 6.8, UGC mashup 6.3, Lifestyle image with text 6.1, Hybrid 5.7, Animation 4.6.
Scale formats (high hit rate and high spend share): offer-first banner, demo. Volatile high-hit formats: unboxing, POV, behind the scenes, founder.

## UGC execution rules

Formats: Lo-fi Yapper (single take, raw, no ring light or tripod), Problem/Solution (scripted, said naturally, not read), Hi-Fi UGC. Cut every few seconds except in Yapper, using angle, location, person or b-roll changes. Product enters mid-conversation and is shown in use, which is the visual proof. CTA tone must match the format; a salesy CTA ruins a lo-fi ad. Captions inside platform safe zones. Shoot 9:16. No visible third-party logos. Ship variations: several hooks on one body turns one ad into several. "Good enough" beats "perfect".

## Band rule (ours; tune with \`calibrate\`)

Predicted bands are computed from the rubric sub-scores, not guessed:
- Hook points = hook_pattern_interrupt + hook_sound_off + hook_persona_specific (0 to 6). 4 or more = strong, 2 to 3 = solid, under 2 = needs work.
- Body points = problem_solution_arc + demonstration + social_proof + emotional_appeal + product_by_2s + measured pacing (0 to 12). 10 or more = strong, 5 to 9 = average, under 5 = weak. (Set 2026-09-25 after Danielle Kent scored 9 with an actual 50% hold, the account's best; "strong" means over 60%.)
Gemini's own band guess is stored alongside as a second opinion. When \`calibrate\` shows the rule missing in one direction, move the thresholds here and rescore.

## DreamMe overlay (ours, not Motion's)

"Product" means the DreamMe app UI, the fish Sushi, or the DreamMe name. House rules: no medication names in hashtags or captions, weight-loss result claims need care.

Account priors (9 aired video ads, Sep 2026): hook rates 32 to 55%, median 42%, and 7 of 9 land in Motion's "strong" band, so for a DreamMe ad with a person on camera in the first second, "strong" is the base case and "solid" or "needs work" needs a visible reason (no face, no text, slow open). Hold rates 7 to 50%, median 29%: 6 of 9 are "weak" and none are "strong", so hold is where this account loses; predict "average" only when the body clearly pays off the hook by 15 s, and never "strong" without a reason. CPT $6.65 to $49; Danielle Kent (Android) is the scaling control at hook 39%, hold 50%, CPT $13.
`;
