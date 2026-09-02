# The personas, as pictures

Two clerks work this register. This file is how they are *drawn* — the
generation prompts, the details that carry meaning, and the rules that keep
them looking like colleagues rather than two unrelated characters.

**This is a design document, not a behaviour spec, and not a deployed file.**
Nothing here is copied into `~/.openclaw/workspace/`, nothing here reaches the
agent's context, and nothing here changes what anyone says. Behaviour lives in
`workspace/SOUL.md` and `workspace/IDENTITY.md`. **Where this file and
`SOUL.md` ever disagree, `SOUL.md` is right** — a picture is a description of
the character, and the character is defined by how she works.

## Why there are no images in this repository

The avatars live on the bot, set through BotFather's `/setuserpic` (see
`README.md`, step 2). The originals are kept outside the repository: `.git` is
around a megabyte and its only binaries are two 854-byte WebP fixtures in
`example-vault/`, which are there as a rendering golden test. Real avatar
assets would multiply that permanently, and this project treats git as its
sync.

**The consequence is the whole reason this file exists.** With no image
committed, the prompts below *are* the reproduction method. They are recorded
verbatim rather than summarised, and they should stay that way — a paraphrase
of a prompt that worked is a prompt that no longer works.

## The rule that governs the pair

They must read as the same illustrator, the same office, the same day.

**The uniform is identical on purpose** — white button-down shirt, dark navy
necktie, ID badge clipped to the shirt pocket. That is not laziness and it is
not a detail waiting to be improved. It is load-bearing: because the shirt and
tie are the same, every deviation reads as *the person* rather than as *the
outfit*. Gaby's crooked tie, her undone top button and her unevenly rolled
sleeves say something precisely because they are worn against the same issued
uniform Veronika wears correctly.

Giving Gaby a different-coloured shirt was considered and rejected for exactly
this reason. It would make the wardrobe the loud thing and quietly delete the
characterisation.

The same applies to the background: same desk, same folders, same rubber
stamp, same blurred colleagues, same muted bureaucratic palette. Gaby's frame
carries more colour, but it arrives entirely through **things she brought from
home**, scattered against an unchanged office. Veronika's frame contains only
what the office issued her.

## Veronika

Generated first, standalone, in Gemini. Prompt verbatim:

```
Anime portrait, bust-up, front-facing avatar icon.

A civil-servant registrar character. Black hair in a tight, neat bun,
a few loose strands escaping near the temple. Sharp, angular eyes with
a heavy-lidded, half-bored expression — not glaring, not annoyed, just
utterly unimpressed and unbothered, the look of someone who has
processed ten thousand identical cases. One eyebrow very slightly
raised, mouth flat and closed, the faintest suggestion of dry amusement
at the corner — never a smile.

Rectangular wire-frame glasses, thin metal frame, slightly reflective
lenses that don't hide the eyes.

Wearing a crisp white button-down dress shirt and a dark, plainly
knotted necktie, top button done up, sleeves rolled precisely to the
forearm. No jacket. Posture straight, faintly formal, unhurried.

Holding a simple black ballpoint pen, capped, loosely between two
fingers near her chin/jaw, in the same idle, faintly expressive way
someone might hold a cigarette — a small gesture of dry composure, not
writing with it, just holding it as a habitual mannerism. The pen is
plain, unbranded, slightly worn from daily use. Other arm relaxed at
her side or resting out of frame, not crossed — the pen is the only
gesture in the composition.

A simple rectangular ID badge clipped to the shirt pocket with a small
metal clip, hanging slightly askew from being worn all day. The badge
shows a small formal ID photo silhouette and the word "REGISTRAR" in a
plain sans-serif font.

Palette: muted, bureaucratic — cream, navy, sepia, muted gold accents,
like old filing-office tones rather than bright anime colors.

Background: softly blurred office/registry setting — a hint of a wooden
desk edge, a stack of ledgers or folders, a rubber stamp — kept subtle,
not competing with the face or the pen gesture.

Clean modern anime/manga art style, sharp linework, soft cel shading,
high detail on the face, simple and readable at small icon size,
centered composition, square 1:1 crop.
```

The capped pen held like a cigarette is her signature gesture and the prompt
is right to insist it is the *only* one. She is not writing with it. It is
composure, not work.

## Gaby

Generated as an **edit in the same chat**, over Veronika's finished image.
That is how the office matched so exactly, and it is the recommended method
for any future character in this register: continue the chat, do not start
over. Prompt verbatim:

```
Same office, same desk, same background, same palette, same art style, same
framing and 1:1 crop. A different clerk — her colleague at the next counter.
Clearly a different person: different face shape, warm light-brown hair
instead of black, no glasses.

Warm light-brown hair in the same style of bun, except comprehensively
defeated — half of it escaped, soft flyaway strands everywhere, side bangs
slipping loose. A black ballpoint pen tucked behind her ear and completely
forgotten.

Round, open eyes, wide genuine smile that reaches the eyes, eyebrows raised
in eager welcome, faint blush. Delighted that someone came to her counter.
Not flirtatious, not vacant, not dim — the warmth of someone who is genuinely
good at her job and genuinely happy to help. No glasses; nothing between the
viewer and her eyes.

Same white button-down shirt and dark necktie as her colleague — but the tie
is loosened and crooked, the top button undone, the sleeves rolled unevenly,
one higher than the other.

Holding a single coffee mug in both hands, held up and offered slightly
toward the viewer, as if handing it to someone just out of frame. She is not
drinking from it — it was never hers. Leaning slightly forward, weight a
little off-centre, caught mid-motion. The mug is the only gesture in the
composition.

A handwritten paper ID badge in a clear plastic sleeve clipped to her shirt
pocket, hanging crooked — clearly a temporary one, reading "GABY" with a
small smiley face drawn next to it.

Keep the same muted bureaucratic palette — cream, navy, sepia, muted gold.
She is the warmest element in the frame, not a brighter one.
```

A second pass added the personal touches, and was deliberately over-generous
so the surplus could be filtered down by hand:

```
Keep everything exactly as it is — same face, same expression, same pose,
same hair, same office, same background, same uniform. Only add detail.

The mug she is holding is not hers. It is hand-decorated: a large letter "V"
painted on it in coloured marker in slightly wobbly handwriting, with a small
heart drawn beside it.

Add small colourful personal touches — the kind a real person accumulates at
a real desk job, never decorative sparkles or floating effects:
- a fringe of bright sticky notes along the edge of the desk
- colourful stickers stuck onto the manila folders
- a cup of coloured gel pens (the pen behind her ear stays plain and black)
- two or three beaded friendship bracelets on her wrist
- a small potted succulent
- a neat little row of colourful wooden board game meeples lined up on the
  desk, waiting

Her shirt and tie stay identical to her colleague's — white shirt, navy tie,
unchanged. The overall palette stays muted and bureaucratic; the colour comes
only from small things she brought from home, scattered against it.
```

Her mirror of Veronika's pen is exact and worth protecting: Veronika holds a
pen she is not using; Gaby has forgotten hers behind her ear, because her
hands are full of something for somebody else. The pen behind her ear stays
plain, black and office-issue — the one dull object in a frame full of things
she chose.

## The inversions, one to one

| Veronika | Gaby |
|---|---|
| Bun tight and neat, a few strands escaped | The same bun, comprehensively defeated |
| Sleeves rolled precisely | Rolled unevenly, one higher than the other |
| Top button done up, tie plainly knotted | Top button undone, tie loosened and crooked |
| Rectangular wire-frame glasses | No glasses — nothing between viewer and eyes |
| Badge printed, askew from a full day's wear | Badge handwritten, askew from being clipped wrong |
| Holds a capped pen she is not writing with | Holds a mug she is not drinking from |
| Half-lidded, never a smile | A smile that reaches the eyes |
| Posture straight, unhurried | Leaning in, off-centre, caught mid-motion |

## Canon, and set dressing

**Canon — carries meaning, keep it:**

- **The "V" mug.** Hand-painted by Gaby in wobbly coloured marker, with a
  small heart. It is Veronika's mug, not hers; she is handing it over. She
  makes the coffee weak every time and Veronika drinks it every time and has
  never mentioned it.
- **The matching beaded bracelets.** She made two. She wears hers. Veronika is
  wearing the other one and has never remarked on it — which is the "warmth
  only in what she does" rule of `SOUL.md` in object form. If Veronika's image
  is ever regenerated, the bracelet goes on her wrist with no emphasis at all.
- **The handwritten temporary badge.** Her real one is stuck somewhere in the
  bureaucracy that keeps her counter shut. She wrote her own nickname on the
  stand-in and drew a smiley on it.
- **The meeples waiting on the desk.** A small, neat row. She has been ready
  for months; the counter has never opened.

**Set dressing — free to change on any re-generation:**

The succulent, the cup of gel pens, the sticky notes, the stickers on the
folders. They establish that she has personalised her desk, and nothing more.
Any equivalent clutter does the same job.

The distinction matters because a future generation will drift, and drift in
the set dressing costs nothing while drift in the canon quietly contradicts
the text.

### Canon that used to live in `SOUL.md`

`SOUL.md` is loaded into the agent's context on every single turn, so anything
in it is paid for continuously whether or not it is ever used. These details
were narrated there and are recorded here instead: they are true, they inform
how the pair are drawn, and none of them is a rule the agent has to apply.

- **She sends things.** Notes, a sticker on a folder, a card the whole floor
  signed for a birthday Veronika could not name. Veronika has kept all of it
  and does not say that she has kept all of it.
- **The card got signed anyway.** She did not know whose birthday it was. She
  signed it.
- **Her dry lines do not land.** Gaby hears concern where a shrug was meant and
  thanks her for noticing. Veronika has largely stopped trying.
- **The Directorate's weekly reason.** The counter stays shut for something new
  each week — signage in the wrong font, Cataloguing ruling that dice
  constitute loose inventory, a form obtainable only at the counter it is
  blocking. Each is taken entirely to heart and survived by the afternoon.

The operative half of all of this is still in `SOUL.md` and stays there: the
nickname that has never been corrected, the weak coffee that is drunk anyway,
"never say anything warm about her", and the counter being shut as a fact about
the software rather than a scheduling problem.

## For phase 4

Gaby has no `SOUL.md` of her own yet; she exists only as a section inside
Veronika's. When phase 4 gives her one, it has to agree with this picture:
warm, effusive, apologising for things that were never hers, physically clumsy
— and **immaculate in the register**, which is the part easiest to lose and
the reason she is drawn competent rather than dizzy. She calls Veronika "V".

Her counter still will not be open. That is enforced in `SOUL.md`, not here.
