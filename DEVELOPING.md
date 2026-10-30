# Developing Image Studio

`README.md` is the text the Marketplace shows for Image Studio, so it is
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
| The backend | Five tools only the view calls: `make`, `hold`, `release`, `keep` and `remove`.                     |

The backend exists because only it can save a job's pictures into the app's
data folder (`save` of `ctx.jobs.submit`) and read a picture of that folder
as an asset a job takes (`ctx.assets.import`).

- `make` submits an `image` or `upscale` job on the model the view names: the
  app's model of that kind, which the view follows through
  `hearthscale/models/chosen`, or a run's own model for Make more and
  Compare. Its outputs are saved into `pictures/<run id>/` of the data
  folder. A job a view's call starts is interactive, so it runs before batch
  work.
- `hold` makes a library picture an asset for a job or for a chat model, and
  `release` drops those assets once the job has ended.
- `keep` writes a picture the person opened into the library.
- `remove` deletes picture files. It is the one mutating tool.

## Where things live

| What                                  | Where                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------- |
| Pictures                              | PNG files in the data folder, `pictures/<run id>/image-<n>.png`         |
| Runs and pictures                     | The app's SQLite database, tables `runs` and `pictures` (`src/records.ts`) |
| The person's choices                  | The store, key `prefs`                                                  |
| Masks, uploads, pictures a job reads  | Assets of the app, released when the job ends                           |

A run is one job: what was asked, on which model, from which picture, and
how it ended. Its pictures are rows of `pictures`. A run still `making` when
the view opens is followed again: by its job while Hearthscale holds it,
else by the files its folder holds.

The view shows a picture from the data folder's streamed address
(`hearthscale/dataBytes`), and a preview from the asset's address
(`hearthscale/assetBytes`).

## What a model can do

Image Studio names no model. It reads the input schema each model card
states (`jobs.image.input`) and offers only what that schema takes:

| Field in the schema | What the person gets                                  |
| ------------------- | ----------------------------------------------------- |
| `image`             | Change, Vary a little, Vary a lot                     |
| `mask`              | Brush with Fill and Erase, Extend                     |
| `references`        | Edit, more pictures in the prompt, Remove background  |
| `count`             | 1, 2 or 4 pictures a run                              |
| `negativePrompt`, `steps`, `guidance`, `seed` | The fields of More settings      |

A text-to-image model can read reference pictures without following them, and
Hearthscale cannot tell the two apart, so the person chooses between
**Edit** and **Redraw**.

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
