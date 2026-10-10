# Obsidian Local Images Plus

Obsidian Local Images Plus is a plugin for [Obsidian](https://obsidian.md/) 

***

**By using this software, you accept all terms and agree to the [license agreement](https://github.com/Sergei-Korneev/obsidian-local-images-plus/blob/main/LICENSE).**

**The author of this software is not obligated to provide any form of support and assumes no liability.**

***

 

> **Note for release 0.16.7:** I want to thank [First To Eleven](https://youtu.be/CX8wttXDDbI), [The Petersens](https://youtu.be/1RjYGOslK50?t=660) and the other guys (including one AI) for helping me write this and other software. ;)

## Main features of the plugin include:

- Downloading media files from copied/pasted content of web pages
- Localizing media files from copied/pasted content of word / Open Office documents
- Downloading any filetypes from web
- Saving attachments next to note in folder named after  note
- Downloading files embedded in markdown tags from web to vault 
- Downloading individual remote images via context menu (right-click → Download this image)
- Saving base64 embedded images to vault
- Flexible file naming with templates (${md5}, ${md5:N}, ${originalname}, ${notename}, ${date}, ${unique})
- Converting PNG images to JPEG images with various quality
- Attachments de-duplication by using MD5 hashing algorithm
- Removing orphaned attachments from vault



## Installation

**IMPORTANT: BEFORE INSTALLING THE NEW VERSION, DELETE ALL PREVIOUS VERSIONS OF THIS PLUGIN FROM `MYVAULT/.obsidian/plugins/`**

- Download the latest version from [GitHub](https://github.com/Sergei-Korneev/obsidian-local-images-plus) / [GitHub page](https://sergei-korneev.github.io/obsidian-local-images-plus). [Read release notes](https://github.com/Sergei-Korneev/obsidian-local-images-plus/releases).
- Remove obsidian-local-images plugin to avoid any conflicts.
- Extract the archive into your Obsidian vault (e.g. Myvault/.obsidian/plugins)
- Restart Obsidian.
- Or install from "Obsidian Community Plugins"
- Open "Community plugins" dialog and change plugin settings at will.
- Enjoy


## Updating

- Update the plugin from Obsidian settings and restart Obsidian


```

This plugin has known compatibility issues with the following plugins:

* Paste Image Rename

* Pretty BibTex

```


## Usage

Just copy any web content, Word/Open Office content and paste it into your regular note or a note in canvas.

This plugin also handles all attachments (screenshots/drag-and-drop for files/audio records).




![img](docs/exampleimage.gif?raw=true)

Use it in the command/menu mode or in automatic mode (toggle "Automatic processing" option in the settings):


![img](docs/commands.png?raw=true)


![img](docs/menuex.png?raw=true)


```Localize attachments for the current note (plugin folder)``` - your active note will be processed and attachments will be saved in the folder preconfigured in the plugin settings. 

or

```Localize attachments for the current note (Obsidian folder)``` - your active note will be processed and attachments will be saved in the folder preconfigured in the Obsidian settings.

or


```Localize attachments for all your notes (plugin folder)``` - will be processed all the pages in your vault, that corresponds to **Include** parameter in the plugin's settings and attachments will be saved in the folder(s) preconfigured in the plugin settings.



**NOTE: This plugin can change all your notes at once, so you should consider doing backups of your files periodically.**

You can also insert any file e.g:

```![mypdf](http://mysite/mypdf.pdf)```

```![mylocalfile](file:///mylinuxdisk/mysong.mp3)```

Files will be copied or downloaded to your attachments folder.

![img](docs/examplepdf.gif?raw=true)

**NOTE: I would not recommend to use this plugin for copying really big files, since buffered reading from disk not implemented yet.**

This plugin also allows you to remove unused attachments by running commands:

```Remove all orphaned attachments (Plugin folder)```

and

```Remove all orphaned attachments (Obsidian folder)```

The first one searches orphans in the folder next to the active note, while the second one searches all unused attachments for all your notes. (this requires you to set some root subfolder in Obsidian settings)


All attachment names are generated according to MD5, therefore they are pretty unique within the vault.        

This means you can place an attachment file anywhere within your vault, replace the absolute path in a tag with the file name and Obsidian will still show it in your note.
 



## Donations

Share your  wishes and ideas about this software or buy me a coffee (or hot chocolate)

<a href="https://www.buymeacoffee.com/sergeikorneev" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="60" width="217"></a>

## Credits

[niekcandaele's](https://github.com/niekcandaele/obsidian-local-images)

[aleksey-rezvov](https://github.com/aleksey-rezvov/obsidian-local-images)


## Build from source
```
npm run build
npm run dev
```


## Fork-only: sequential image numbering and static-image WebP conversion

The maintained fork branch `feature/counter-multiformat-webp` builds on the upstream 0.17.0 code without merging the old `feature/add-webpconvert-rename` branch.

- **File name template:** `${notename}-${counter}` gives `My Note-1`, `My Note-2`; `${notename}-${counter:001}` gives `001`, `002`; `${counter:0001}` gives `0001`, `0002`. The width is the number of digits in the format. Only the new `${...}` syntax is supported.
- **Counter scope:** one sequence per note path and template; the first use in a session scans existing filenames in the destination directory to continue after the highest matching counter. Parallel remote downloads can finish out of note order; unsuccessful downloads may consume numbers.
- **Compression:** when image compression is enabled with type WebP, static PNG, JPEG, AVIF, BMP, TIFF, or ICO images that the Obsidian desktop browser decoder supports are converted to WebP. GIF, animated GIF, SVG, existing WebP, and non-image attachments are never converted. Failures keep the original bytes and extension. AVIF decoding is platform dependent.
- **Compatibility:** existing upstream naming and JPEG mode are unchanged unless the new template or WebP conversion is enabled. When loading an old fork `data.json` without `FileNameTemplate` or `ImgCompressionType`, previous `imageRenameRule`, `convertWebpForWebImages`, `convertWebpForPastedImages` and `webpQuality` settings are migrated in memory.
- **Safety:** back up the vault and plugin `data.json` before enabling bulk note processing. Do not run both the old fork and this fork under different plugin directories; both have the same plugin ID.
- **Tests:** `npm ci && node --test tests/*.test.cjs && npm run build`. The build uses the existing Rollup pipeline.

