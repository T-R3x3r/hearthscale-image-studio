# Developing Image studio

`README.md` is the text the Marketplace shows for Image studio, so it is
written for the people who install it. This file is for the people who work
on it.

## Build and link

```sh
npm install
npm run build        # views/studio.js from src/
npm run typecheck
hearthscale dev .    # links the folder to a daemon started with --dev
```

The view is one ES module, `views/studio.js`, built with esbuild from
`src/main.tsx`. It is committed with every change to `src/`. The MCP Apps
library stays external, because Hearthscale gives every view its own copy.
`backend.ts` is bundled by `hearthscale dev` and `hearthscale pack`.

`@hearthscale/app` and `@hearthscale/app-ui` come from npm.

## What runs where

| Part        | What it does                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------------- |
| The view    | All of the interface: the library, the stage, the prompt and Compare. Hearthscale draws the model picker in a model slot of the prompt. |
| The backend | Seven tools only the view calls: `make`, `hold`, `release`, `keep`, `name`, `remove` and `tidy`, and a folder trigger on `pictures/`. |

The backend exists because only it can save a job's pictures into the app's
data folder (`save` of `ctx.jobs.submit`) and read a picture of that folder
as an asset a job takes (`ctx.assets.import`). A change of marked areas is
the one action whose jobs the view submits itself (`hearthscale/jobs/submit`),
because the view lays each job's picture into the picture between the jobs;
see [Marked areas](#marked-areas).

- `make` submits an `image` or `upscale` job on the model the view names: the
  app's model of that kind, which the view follows through
  `hearthscale/models/chosen`, or a run's own model for Make more and
  Compare. Its outputs are saved into `pictures/<run id>/` of the data
  folder. A job a view's call starts is interactive, so it runs before batch
  work.
- `hold` makes a library picture an asset for a job or for a chat model, and
  `release` drops those assets once the job has ended.
- `keep` writes a picture the person opened into the library.
- `name` moves the pictures of a finished run out of its folder to
  `pictures/<date> <time> <name>.png`. The name is the prompt when it is at
  most 40 characters; a longer prompt gets a short name from the app's chat
  model, or else its first words. With the `metadata` setting on (the
  default), each file carries plain words only: `Title`, `Description` (the
  prompt), `Comment` (one line per setting: prompt, style, model, size,
  steps, guidance, seed, strength, LoRAs, the picture it came from, the
  action), `Software`, `Creation Time`, the runtime's `parameters` line
  without its JSON, and an XMP packet with the same title, prompt and lines,
  which Windows shows as Title, Comments, Program name and Date taken. With
  it off, the file carries no text at all (`png.ts`).
- `remove` deletes picture files. It is the one mutating tool.
- `tidy` forgets the pictures whose files are gone, such as files deleted
  outside the app. The view calls it when it opens, and the `pictures` folder
  trigger calls it when a file of `pictures/` is removed. It sends the ids it
  forgot to the views as the event `gone`.

## Where things live

| What                                  | Where                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------- |
| Pictures                              | PNG files in the data folder, `pictures/2026-11-03 14.32 Red fox at dawn.png` |
| Runs and pictures                     | The app's SQLite database, tables `runs` and `pictures` (`src/records.ts`) |
| The person's choices                  | The store, key `prefs`                                                  |
| Masks, uploads, pictures a job reads  | Assets of the app, released when the job ends                           |
| Marks while the person paints         | One canvas per colour in the view (`src/marks.ts`), never stored        |

A run is one job: what was asked, on which model, from which picture, and
how it ended. Its pictures are rows of `pictures`. A run still `making` when
the view opens is followed again: by its job while Hearthscale holds it,
else by the files its folder holds.

The view shows a picture from the data folder's streamed address
(`hearthscale/dataBytes`), and a preview from the asset's address
(`hearthscale/assetBytes`).

## What a model can do

Image studio names no model. It reads the input schema each model card
states (`jobs.image.input`) and offers only what that schema takes:

| Field in the schema | What the person gets                                                                 |
| ------------------- | ------------------------------------------------------------------------------------ |
| `image`             | Change the picture, drawn again from it with a Small, Medium or Big change; Vary    |
| `mask`              | The tool row: Brush, Box, Eraser, the four colours, Invert, Soft edge, and Extend   |
| `references`        | Change the picture by words, pictures in the prompt and in each area, quick changes |
| `count`             | 1, 2 or 4 pictures a run                                                             |
| `negativePrompt`, `steps`, `guidance`, `seed` | The fields of More settings                                |

Where the schema has `references`, a change of the whole picture is an edit:
the model reads the picture and the words and changes what the words name.
Without it, the picture is drawn again from itself, as far as the change size
says. Hearthscale states `references` also for a text-to-image model of an
edit model's family, which reads the pictures without following them; such a
model edits badly, and the person picks another model.

## The prompt follows the stage

The picture on the stage is the picture the prompt changes. With no picture
on the stage, the prompt makes a new one (**Make**). **New picture**, in the
library or beside the folded library's press, empties the stage. The prompt
keeps two sets of words: the words of a new picture, which stay after Make,
and the words of a change, which clear when the change starts. The main
button names its result:

| On the stage                  | The prompt                         | The main button                        |
| ----------------------------- | ---------------------------------- | -------------------------------------- |
| Nothing                       | Words of a new picture             | Make                                   |
| A picture, no marks           | Words of a change; quick changes   | Change the picture                     |
| A picture with marks          | One row per colour                 | Remove 1 area, Change 2 areas, and on  |
| A picture, the Extend tool    | Words of the new room              | Extend the picture                     |

## Marked areas {#marked-areas}

A pixel belongs to one colour at most: painting in one colour takes the
pixel from the others, the eraser takes it from every colour, and Invert
gives a colour every pixel no colour holds. An area with words changes into
them; an area with no words and no pictures is removed (`REMOVE_WORDS`).

One press is one run of action `mark`, with one job per area, in the order
the colours were first used (`changeAreas` in `src/Studio.tsx`, `runSteps` in
`src/runs.ts`):

1. The job takes the current picture as `image`, the area's marks as `mask`
   (white where it draws anew), `strength` 1, and, where the schema has
   `references`, the current picture and the area's pictures as
   `references`.
2. The view reads the job's picture and lays it into the current picture by
   the area's blend (`blendOf`): nothing outside the marks, all of it deeper
   inside the marks than the soft edge, and a smooth rise in between, from a
   distance transform of the marks. The pixels are read and written exactly
   (`pixelsOf`, `pngOf`), so a pixel outside the marks keeps its value.
3. The result is uploaded and is the next job's `image`.

The last picture goes to the run's folder through `keep`, and is named as
every run's pictures are. The run's `job` holds the job of the area in
progress. The view drives the run, so a run whose view closed fails when the
view next opens, unless its job still runs.

The schema states no size of its own, so a picture's size comes from the
shape and the size the person picks (`src/recipes.ts`), multiples of 64.

## Traps

- A view frame is sandboxed without form submission: a `<form>` never fires
  `submit`. Handle Enter on the field itself.
- After `hearthscale dev` links the folder again, an open view answers "this
  window hosts no such view" to every request. Close its tab and open it
  again.
- A job's `mask` must be the size of its `image`, and both multiples of 64. A
  picture the person opens is cut to multiples of 64 when it comes in
  (`src/pictures.ts`).
- A canvas changes a picture's pixels unless the picture is decoded with
  `colorSpaceConversion: 'none'` and blended in script, not with the
  canvas's own compositing: see `pixelsOf` and `blendInto`.
