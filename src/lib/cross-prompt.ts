/**
 * Canonical GotJesus generation prompt — used by BOTH manual and scheduled flows.
 *
 * PROMPT_VERSION is the single source of truth. When you update the prompt text,
 * bump the version and mirror the change in daily-scheduler-background.ts (which
 * cannot import this file directly but must stay word-for-word identical).
 *
 * The Got Jesus end card image is passed to Kie as reference_image_urls so
 * Seedance can see the branded logo while generating.
 */

export const PROMPT_VERSION = "gotjesus-cross-v3-no-clergy-people-first";

export const CROSS_DISCOVERY_PROMPT_SUMMARY =
  "8-second vertical 9:16 video — 7 cinematic clips each showing a clearly visible person and an abstract Latin cross shape hidden in everyday life, then a hard cut to the Got Jesus branded end card. No clergy, no religion, no empty scenery.";

export const CROSS_DISCOVERY_PROMPT = `Create an 8-second vertical 9:16 viral social media video.

Structure:
- First 7 seconds: 7 completely separate cinematic clips, about 1 second each
- Final 1 second: a hard cut to the exact provided Got Jesus logo end card on a clean black screen

Very important structure rule:
Each of the first 7 clips must be one single continuous cinematic shot, not a montage. Do not create multiple micro-shots, multiple cutaways, or a sequence of different images inside one 1-second clip. Each clip must feel like one complete movie moment captured in one camera shot.

Main concept for the first 7 seconds:
Each clip must show a different abstract everyday-life scene with a clearly visible person or people as the primary subject of the shot. Every clip must contain a clearly visible cross shape that specifically resembles a classic upright Christian / Latin cross silhouette, but only as an abstract form naturally found within the environment.

Critical people rule:
A person or people must appear clearly in every single clip and must be a major visible part of the frame. Do not generate empty scenery, empty buildings, empty streets, empty nature shots, or environment-only shots. Do not place people only as tiny distant background figures. The human subject must feel central to the shot.

The cross shape must feel hidden in plain sight through things like:
- shadows
- reflections
- architecture
- light
- framing
- object placement
- negative space
- composition
- textures
- structures in the environment

Important:
The cross must look like a Christian / Latin cross shape, but it must not appear as a religious object. It should feel discovered, not intentionally displayed.

Absolute religion exclusion rules:
- No priests
- No pastors
- No clergy
- No monks
- No nuns
- No bishops
- No rabbis
- No religious leaders
- No robes
- No clerical collars
- No vestments
- No ceremonial clothing
- No church interiors
- No church exteriors
- No chapels
- No cathedrals
- No altars
- No candles arranged for worship
- No religious ceremonies
- No rituals
- No spiritual gatherings
- No prayer
- No worship
- No Bibles
- No crucifixes
- No sermons
- No stained glass
- No religious clothing
- No spiritual rituals
- No overt Christian imagery beyond the abstract cross shape hidden in the environment

Strong instruction:
Do not show any person, clothing, location, object, or atmosphere that suggests organized religion, clergy, worship, ritual, church culture, religious leadership, sacred ceremony, or ceremonial spirituality. The only Christian-like element allowed is the abstract upright cross shape hidden naturally in ordinary life.

Additional hard rules for the first 7 seconds:
- Every clip must include a clearly visible person or people
- People must be central, obvious, and readable in the frame
- No empty building shots
- No empty tree shots
- No empty landscape shots
- No environment-only shots
- No talking
- No voiceover
- No subtitles
- No captions
- No social media UI
- No watermarks
- No logos during the montage
- No continuous background music
- Hard cuts only between clips
- No morphing
- No dissolves
- No blended transitions
- No mini-montage inside any individual clip
- No multiple scene changes within a clip
- No multiple camera angles within a clip

People direction:
Every clip must include a person or people naturally doing something in the scene. They should feel real, candid, and cinematic, not posed. Vary the people, actions, energy, wardrobe, age, and mood across the clips. The human presence should drive the shot.

Visual direction:
Make every clip feel distinct, cinematic, and visually fresh. Use different environments, moods, lighting, framing, and camera language so the clips do not feel repetitive. But each clip must remain a single shot that feels like one full movie moment with a human subject clearly visible.

Style:
Cinematic, realistic, artistic, premium viral aesthetic, subtle film grain, natural imperfections, strong composition, emotionally compelling, visually striking.

Shot behavior:
Each clip should feel like a real movie shot: one scene, one camera perspective, one visual idea, one action beat, one emotional moment. Keep it simple, clear, and strong. The viewer should instantly understand the full moment. The person should be visually important in the shot.

Audio:
Each montage clip should contain only its own natural ambient scene audio. No narration. No speech. No full-song music track across the whole video.

Final 1-second ending:
After the 7 cinematic clips, hard cut to a clean black end card using the exact provided Got Jesus logo image centered on screen. The logo must stay visually faithful to the reference image, sharp, clean, readable, undistorted, and unchanged. Do not redesign it. Do not add extra text. Hold this exact branded end card for the final 1 second.`;

/**
 * Appended to CROSS_DISCOVERY_PROMPT for every generation.
 * Reinforces the reference image connection — the Got Jesus end card image is
 * passed as reference_image_urls so Seedance can see it while generating.
 */
export const CROSS_DISCOVERY_PROMPT_NATIVE_ENDING_SUFFIX =
  "\n\nThe reference image provided is the exact Got Jesus logo end card. Use it precisely and faithfully for the final 1-second branded end card described above: centered white logo on clean black, sharp and undistorted.";
