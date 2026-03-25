# VoxBar for Obsidian

Desktop-only Obsidian plugin that sends the current selection, the active note, or a frontmatter source URL to local VoxBar for text-to-speech playback.

## What It Does

- Adds a ribbon button to read with VoxBar.
- Adds commands for:
  - selection or note
  - selection only
  - current note
  - source URL from frontmatter
  - opening VoxBar
- Prefers a selected URL when one is highlighted.
- Optionally prefers `source`, `url`, `canonical_url`, `source_url`, or `link` in frontmatter.
- Cleans Obsidian-specific markup before handing text to VoxBar:
  - YAML frontmatter
  - block comments
  - callout markers
  - wikilinks and embeds
  - block references

VoxBar still performs its own markdown cleanup after that, so the plugin stays thin.

## How It Works

The plugin writes a small request JSON file into VoxBar's local inbox:

```bash
~/Library/Application Support/VoxBar/Inbox/
```

Then it opens `VoxBar.app`. VoxBar consumes the request, runs generation inside the app, and the result lands in the normal VoxBar player/history flow.

## Install For Local Use

1. Build the plugin:

```bash
cd /path/to/voxbar-ob
npm install
npm run build
```

2. Install it into a vault with the helper:

```bash
./install-local.sh /absolute/path/to/your-vault
```

3. Or copy these files into your vault plugin folder manually:

- `manifest.json`
- `main.js`
- `versions.json`

The target folder should be:

```bash
<your-vault>/.obsidian/plugins/voxbar-ob/
```

4. In Obsidian:

- enable Community plugins
- enable `VoxBar for Obsidian`
- open the plugin settings and confirm the VoxBar path

## Recommended Obsidian Flow

- Select a URL in a note and run `Read selection or note with VoxBar`.
- If there is no selection, keep article notes with `source:` or `url:` in frontmatter and let the plugin fetch the original article.
- If the note itself is the source of truth, run `Read current note with VoxBar`.

## Notes

- This plugin is desktop-only because it relies on launching a local macOS app.
- It assumes VoxBar is already set up and working locally.
- It uses VoxBar's app inbox, so generated runs appear inside the VoxBar app itself.
