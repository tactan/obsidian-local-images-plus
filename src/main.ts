import {
  Notice,
  Plugin,
  TFile,
  Editor,
  htmlToMarkdown,
  MarkdownView,
  TFolder,
} from "obsidian"

import SettingTab from "./settingstab"

import {
  imageTagProcessor,
  getMDir,
  getRDir,
} from "./contentProcessor"

import { convertToWebp } from "./webp-converter"

import {
  replaceAsync,
  cFileName,
  md5Sig,
  trimAny,
  logError,
  showBalloon,
  displayError,
  encObsURI,
  pathJoin,
  blobToJpegArrayBuffer,
  getFileExt,
  readFromDiskB,
  getImageDimensions
} from "./utils"

import {
  APP_TITLE,
  ISettings,
  DEFAULT_SETTINGS,
  MD_SEARCH_PATTERN,
  NOTICE_TIMEOUT,
  TIMEOUT_LIKE_INFINITY,

} from "./config"

import { renameImage } from "./image-renamer"
import { UniqueQueue } from "./uniqueQueue"
import path from "path"
import { ModalW1 } from "./modal"
const fs = require('fs').promises;





//import { count, log } from "console"

export default class LocalImagesPlugin extends Plugin {
  settings: ISettings
  modifiedQueue = new UniqueQueue<TFile>()
  intervalId = 0
  newfProcInt: number
  newfCreated: Array<string> = []
  noteModified: Array<TFile> = []
  newfMoveReq: boolean = true
  newfCreatedByDownloader: Array<string> = []
  imageCounters: Map<string, number> = new Map() // Track image counters per note
  processedPastedFiles: Set<string> = new Set() // Track processed pasted files to prevent duplicate saves
  skipProcessingForPaths: Set<string> = new Set() // Track paths that should be skipped in automatic processing
  skipProcessingTimeout: number = 30000 // Default timeout (30 seconds) for removing paths from skip list

  // Returns the next counter for a given noteId; if not initialized, sets it to 1
  private getNextCounter(noteId: string): number {
    let counter = this.imageCounters.get(noteId);
    if (counter === undefined) {
      counter = 1;
    } else {
      counter++;
    }
    this.imageCounters.set(noteId, counter);
    return counter;
  }

  // Gets the current counter for a given noteId without incrementing it
  private getCounter(noteId: string): number {
    const counter = this.imageCounters.get(noteId);
    return counter === undefined ? 0 : counter;
  }

  // Resets the counter for the given noteId
  private resetCounter(noteId: string): void {
    this.imageCounters.set(noteId, 0);
  }

  // Helper function to read a file as ArrayBuffer
  private readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  // Enhanced helper function to handle Markdown image link paste
  private async handleMarkdownImageLink(markdownText: string, editor: Editor, activeFile: TFile): Promise<void> {
    // Enhanced regex to capture markdown image link: ![alt](url) with more file extensions
    const mdImgRegex = /!\[(.*?)\]\((https?:\/\/[^\s)]+?\.(?:jpg|jpeg|png|gif|bmp|webp|avif|svg|tiff|ico))\)/i;
    const match = markdownText.match(mdImgRegex);
    if (!match) {
      logError(`handleMarkdownImageLink: No valid image link found in text: ${markdownText.substring(0, 100)}...`);
      return;
    }
    
    const altText = match[1] || '';
    const imageUrl = match[2];
    logError(`handleMarkdownImageLink: Found Markdown image link: ${imageUrl} with alt text: ${altText}`);
    
    try {
      // Fetch with custom user-agent to avoid being blocked by some servers
      const response = await fetch(imageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      
      if (!response.ok) {
        logError(`handleMarkdownImageLink: Failed to download image from ${imageUrl} - Status: ${response.status}`);
        showBalloon(`Failed to download image: ${response.statusText}`, this.settings.showNotifications);
        return;
      }
      
      const arrayBuffer = await response.arrayBuffer();
      if (!arrayBuffer || arrayBuffer.byteLength === 0) {
        logError(`handleMarkdownImageLink: Downloaded empty image from ${imageUrl}`);
        showBalloon(`Downloaded image is empty`, this.settings.showNotifications);
        return;
      }
      
      // Get image dimensions
      let imgWidth: number | undefined = undefined;
      let imgHeight: number | undefined = undefined;
      try {
        const dimensions = await getImageDimensions(arrayBuffer);
        if (dimensions) {
          imgWidth = dimensions.width;
          imgHeight = dimensions.height;
          logError(`handleMarkdownImageLink: Image dimensions: ${imgWidth}x${imgHeight}`);
        } else {
          logError(`handleMarkdownImageLink: Could not determine image dimensions`);
        }
      } catch (error) {
        logError(`handleMarkdownImageLink: Error getting image dimensions: ${error}`);
      }
      
      // Normalize MIME type
      let finalData = arrayBuffer;
      let finalMimeType = response.headers.get("content-type") || '';
      
      // Handle missing or incorrect MIME types
      if (!finalMimeType || finalMimeType === 'application/octet-stream') {
        // Try to determine MIME type from URL extension
        const urlExt = imageUrl.split('.').pop().toLowerCase();
        if (urlExt) {
          switch (urlExt) {
            case 'jpg':
            case 'jpeg':
              finalMimeType = 'image/jpeg';
              break;
            case 'png':
              finalMimeType = 'image/png';
              break;
            case 'gif':
              finalMimeType = 'image/gif';
              break;
            case 'webp':
              finalMimeType = 'image/webp';
              break;
            case 'svg':
              finalMimeType = 'image/svg+xml';
              break;
            case 'avif':
              finalMimeType = 'image/avif';
              break;
            case 'tiff':
            case 'tif':
              finalMimeType = 'image/tiff';
              break;
            case 'ico':
              finalMimeType = 'image/x-icon';
              break;
            default:
              finalMimeType = 'image/png'; // Default fallback
          }
        } else {
          finalMimeType = 'image/png'; // Default fallback
        }
        logError(`handleMarkdownImageLink: Determined MIME type from URL: ${finalMimeType}`);
      }
      
      // Extract extension from MIME type
      let finalExtension = finalMimeType.split("/")[1] || 'png';
      if (finalExtension === 'jpeg') finalExtension = 'jpg';
      if (finalExtension === 'svg+xml') finalExtension = 'svg';
      if (finalExtension === 'x-icon') finalExtension = 'ico';
      
      let webpConversionSuccessful = false;
      
      // Convert to WebP if enabled
      if (this.settings.convertWebpForPastedImages) {
        logError(`handleMarkdownImageLink: WebP conversion enabled, attempting conversion...`);
        
        // Skip conversion for SVG files
        if (finalMimeType === 'image/svg+xml') {
          logError(`handleMarkdownImageLink: Skipping WebP conversion for SVG file`);
        } else {
          try {
            const mimeTypeForConversion = finalMimeType || 'image/png';
            const webpData = await convertToWebp(arrayBuffer, mimeTypeForConversion, this.settings.webpQuality);
            
            if (webpData && webpData.byteLength > 0) {
              finalData = webpData;
              finalMimeType = 'image/webp';
              finalExtension = 'webp';
              webpConversionSuccessful = true;
              logError(`handleMarkdownImageLink: WebP conversion successful`);
            } else {
              logError(`handleMarkdownImageLink: WebP conversion produced empty data, using original format`);
            }
          } catch (error) {
            logError(`handleMarkdownImageLink: WebP conversion failed: ${error}. Using original format.`);
          }
        }
      } else {
        logError(`handleMarkdownImageLink: WebP conversion not enabled, using original format: ${finalMimeType}`);
      }
      
      // Get the media directory for this note
      const mdir = await getMDir(this.app, activeFile, this.settings);
      logError(`handleMarkdownImageLink: Media directory for note: ${mdir}`);
      await this.ensureFolderExists(mdir);
      
      // Get the counter
      const noteId = activeFile.path;
      const counter = this.getNextCounter(noteId);
      
      // Generate filename from URL
      let urlParts = imageUrl.split('/');
      let originalFileName = urlParts[urlParts.length - 1];
      
      // Remove query parameters from filename
      if (originalFileName.includes('?')) {
        originalFileName = originalFileName.split('?')[0];
      }
      
      // If filename is generic without extension, force set a default name
      if (!originalFileName.includes('.') || originalFileName.trim() === '') {
        logError(`handleMarkdownImageLink: Pasted image file seems generic or missing extension`);
        originalFileName = `pasted-image-${Date.now()}.${finalExtension}`;
      }
      
      // Generate the final filename
      const finalFilename = renameImage(
        originalFileName,
        this.settings.imageRenameRule,
        activeFile.basename,
        counter,
        imgWidth,
        imgHeight,
        finalExtension
      );
      
      const finalPath = pathJoin([mdir, finalFilename]);
      
      // Add to skip processing paths to prevent duplicate processing
      this.skipProcessingForPaths.add(finalPath);
      this.schedulePathForSkipProcessingCleanup(finalPath);
      
      // Save image file locally
      logError(`handleMarkdownImageLink: Saving image to: ${finalPath}`);
      await this.app.vault.adapter.writeBinary(finalPath, finalData);
      logError(`handleMarkdownImageLink: Image saved successfully to ${finalPath}`);
      
      // Add to processed files
      this.processedPastedFiles.add(finalPath);
      
      // Get relative path for markdown replacement
      const newlink = await getRDir(activeFile, this.settings, finalPath);
      
      // Create markdown link with original alt text
      const markdownLink = `![[${newlink[0]}|${altText}]]`;
      
      // Replace the markdown link in the editor with the new local link
      const content = editor.getValue();
      const newContent = content.replace(match[0], markdownLink);
      editor.setValue(newContent);
      
      logError(`handleMarkdownImageLink: Replaced original Markdown image link with local link: ${markdownLink}`);
      showBalloon(`Image downloaded and saved as ${finalFilename}`, this.settings.showNotifications);
    } catch (error) {
      logError(`handleMarkdownImageLink: Error processing Markdown image link: ${error}`);
      showBalloon(`Error processing image link: ${error.message}`, this.settings.showNotifications);
    }
  }

  async onload() {

    await this.loadSettings()

    this.addCommand({
      id: "download-images",
      name: "Localize attachments for the current note (plugin folder)",
      callback: this.processActivePage(false),
    })


    this.addCommand({
      id: "download-images-def",
      name: "Localize attachments for the current note (Obsidian folder)",
      callback: this.processActivePage(true),
    })

    if (!this.settings.disAddCom) {

      this.addRibbonIcon("dice", APP_TITLE + "\r\nLocalize attachments (plugin folder)", () => {
        this.processActivePage(false)()
      });

      this.addCommand({
        id: "set-title-as-name",
        name: "Set the first found # header as a note name.",
        callback: this.setTitleAsName,
      })

      this.addCommand({
        id: "download-images-all",
        name: "Localize attachments for all your notes (plugin folder)",
        callback: this.openProcessAllModal,
      })

      this.addCommand({
        id: "convert-selection-to-URI",
        name: "Convert selection to URI",
        callback: this.convertSelToURI,
      })

      this.addCommand({
        id: "convert-selection-to-md",
        name: "Convert selection from html to markdown",
        callback: this.convertSelToMD,
      })

      this.addCommand({
        id: "remove-orphans-from-obsidian-folder",
        name: "Remove all orphaned attachments (Obsidian folder)",
        callback: () => { this.removeOrphans("obsidian")() },
      })

      this.addCommand({
        id: "remove-orphans-from-plugin-folder",
        name: "Remove all orphaned attachments (Plugin folder)",
        callback: () => { this.removeOrphans("plugin")() },
      })
    }






    // Some file has been created

    this.app.vault.on('create', async (file: TFile) => {
      
      logError("New file created: " + file.path)

      if (this.ExemplaryOfMD(file.path)){
        this.onMdCreateFunc(file)
      } else{
        this.onFCreateFunc(file)
      }

    })


    // Some file has been deleted

    this.app.vault.on('delete', async (file: TFile) => {
 
      if (!file ||
        !(file instanceof TFile) ||
        !(this.ExemplaryOfMD(file.path)) ||
        !this.settings.removeMediaFolder ||
        this.settings.saveAttE != "nextToNoteS") {
        return
      }


      let rootdir = this.settings.mediaRootDir
      const useSysTrash = (this.app.vault.getConfig("trashOption") === "system")
    
      if (this.settings.saveAttE !== "obsFolder" &&
        path.basename(rootdir).includes("${notename}") &&
        !rootdir.includes("${date}")) {

        rootdir = rootdir.replace("${notename}", file.basename)

        if (this.settings.saveAttE == "nextToNoteS") {
          rootdir = pathJoin([path.dirname(file?.path || ""), rootdir])
        }

        try {
          if (this.app.vault.getAbstractFileByPath(rootdir) instanceof TFolder) {
            this.app.vault.trash(app.vault.getAbstractFileByPath(rootdir), useSysTrash)
            showBalloon("Attachment folder " + rootdir + " was moved to trash can.", this.settings.showNotifications)
          }
        } catch (e) {
          logError(e)
          return
        };
      }
    })



    this.app.vault.on('rename', async (file: TFile, oldPath: string) => {
     
      if (!file ||
        !(file instanceof TFile) ||
        !(this.ExemplaryOfMD(file.path)) ||
        !this.settings.removeMediaFolder ||
        this.settings.saveAttE != "nextToNoteS" ||
        this.settings.pathInTags != "onlyRelative") {
        return
      }

      let oldRootdir = this.settings.mediaRootDir

      if (path.basename(oldRootdir).includes("${notename}") &&
        !oldRootdir.includes("${date}")) {

        oldRootdir = oldRootdir.replace("${notename}", path.parse(oldPath)?.name)
        let newRootDir = oldRootdir.replace(path.parse(oldPath)?.name, path.parse(file.path)?.name)
        let newRootDir_ = newRootDir
        let oldRootdir_ = oldRootdir

        oldRootdir_ = pathJoin([(path.dirname(oldPath) || ""), oldRootdir])
        newRootDir_ = pathJoin([(path.dirname(file.path) || ""), newRootDir])


        try {
          if (this.app.vault.getAbstractFileByPath(oldRootdir_) instanceof TFolder) {
            await this.ensureFolderExists(path.dirname(newRootDir_))
            //await this.app.fileManager.renameFile(app.vault.getAbstractFileByPath(oldRootdir),newRootDir)
            await this.app.vault.adapter.rename(oldRootdir_, newRootDir_)
            showBalloon("Attachment folder was renamed to " + newRootDir_, this.settings.showNotifications)
          }
        } catch (e) {
          showBalloon("Cannot move attachment folder: \r\n" + e, this.settings.showNotifications)
          logError(e)
          return
        };
        let content = await this.app.vault.cachedRead(file)
        content = content
          .replaceAll("](" + encodeURI(oldRootdir), "](" + encodeURI(newRootDir))
          .replaceAll("[" + oldRootdir, "[" + newRootDir)
        this.app.vault.modify(file, content)

      }
    })



    // Some file has been modified

    this.app.vault.on('modify', async (file: TFile) => {
      if (!this.newfMoveReq)
        return
      logError("File modified: " + file.path , false)
 
      if (!file ||
        !(file instanceof TFile) ||
        !(this.ExemplaryOfMD(file.path))) {
        return
      } else {
        if (this.settings.processAll) {
          if (!this.noteModified.includes(file)) {
            this.noteModified.push(file)
          }
          this.setupNewMdFilesProcInterval()
        }


      }

    })




    this.app.workspace.on(

      "editor-paste",
      (evt: ClipboardEvent, editor: Editor, info: MarkdownView) => {
        this.onPasteFunc(evt, editor, info)

      }
    )

    this.setupQueueInterval()
    this.addSettingTab(new SettingTab(this.app, this))

  }






  setupQueueInterval() {
    if (this.intervalId) {
      const intervalId = this.intervalId
      this.intervalId = 0
      window.clearInterval(intervalId)
    }
    if (
      this.settings.realTimeUpdate &&
      this.settings.realTimeUpdateInterval > 0
    ) {
      this.intervalId = window.setInterval(
        this.processModifiedQueue,
        this.settings.realTimeUpdateInterval * 1000
      )
      this.registerInterval(this.intervalId)
    }
  }


  private getCurrentNote(): TFile | null {
    try {
      const noteFile = app.workspace.activeEditor.file
      return noteFile
    } catch (e) {
      showBalloon("Cannot get current note! ", this.settings.showNotifications)

    }
    return null

  }


  private async processPage(file: TFile, defaultdir: boolean = false): Promise<any> {
    
    if (file == null ) {return null}

    // Check if this file should be skipped due to recent processing
    if (this.skipProcessingForPaths.has(file.path)) {
      logError(`Skipping automatic processing for recently handled file: ${file.path}`);
      return null;
    }

    // Get the current counter for this note (without resetting it)
    const currentCounter = this.getCounter(file.path);
    logError(`Current counter for note: ${file.path} is ${currentCounter}`);

    const content = await this.app.vault.cachedRead(file)
    if (content.length == 0) {return null}
    
    logError(`Content length: ${content.length}`);
    logError(`Content preview: ${content.substring(0, 100)}...`);
    logError(`Testing regex patterns on content...`);
    
    // Log each regex pattern test result
    for (const reg_p of MD_SEARCH_PATTERN) {
      logError(`Pattern ${reg_p.toString()} test result: ${reg_p.test(content)}`);
    }

    const fixedContent = await replaceAsync(
      content,
      MD_SEARCH_PATTERN,
      imageTagProcessor(this,
        file,
        this.settings,
        defaultdir
      )
    )




    if (content != fixedContent[0] && fixedContent[1] === false) {
      this.modifiedQueue.remove(file)
      await this.app.vault.modify(file, fixedContent[0])

      fixedContent[2].forEach((element: string) => {
        this.newfCreatedByDownloader.push(element)
      })

      showBalloon(`Attachments for "${file.path}" were processed.`, this.settings.showNotifications)

    }

    else if (content != fixedContent[0] && fixedContent[1] === true) {

      this.modifiedQueue.remove(file)
      await this.app.vault.modify(file, fixedContent[0])

      fixedContent[2].forEach((element: string) => {
        this.newfCreatedByDownloader.push(element)
      })

      showBalloon(`WARNING!\r\nAttachments for "${file.path}" were processed, but some attachments were not downloaded/replaced...`, this.settings.showNotifications)
    }
    else {
      if (this.settings.showNotifications) {
        showBalloon(`Page "${file.path}" has been processed, but nothing was changed.`, this.settings.showNotifications)
      }
    }
  }

  // using arrow syntax for callbacks to correctly pass this context

  processActivePage = (defaultdir: boolean = false) => async () => {
    logError("processActivePage")
    try {
      const activeFile = this.getCurrentNote()
      await this.processPage(activeFile, defaultdir)
    } catch (e) {
      showBalloon(`Please select a note or click inside selected note in canvas.`, this.settings.showNotifications)
      return
    }
  }

  processAllPages = async () => {
    const files = this.app.vault.getMarkdownFiles()
 
    const pagesCount = files.length

    const notice = this.settings.showNotifications
      ? new Notice(
        APP_TITLE + `\nStart processing. Total ${pagesCount} pages. `,
        TIMEOUT_LIKE_INFINITY
      )
      : null

    for (const [index, file] of files.entries()) {
      if (this.ExemplaryOfMD(file.path)) {
        if (notice) {
          //setMessage() is undeclared but factically existing, so ignore the TS error  //@ts-expect-error
          notice.setMessage(
            APP_TITLE + `\nProcessing \n"${file.path}" \nPage ${index} of ${pagesCount}`
          )
        }
        await this.processPage(file)
      }
    }
    if (notice) {
      // dum @ts-expect-error
      notice.setMessage(APP_TITLE + `\n${pagesCount} pages were processed.`)

      setTimeout(() => {
        notice.hide()
      }, NOTICE_TIMEOUT)
    }
  }




  private async handlePastedFiles(files: FileList, editor: Editor = undefined, info: MarkdownView = undefined) {
    if (!files || files.length === 0) return;
    
    logError("--- Pasted Local Image Processing ---");
    logError(`convertWebpForPastedImages setting: ${this.settings.convertWebpForPastedImages}`);
    
    try {
      const activeFile = this.getCurrentNote();
      if (!activeFile) {
        logError("No active note found to paste image into");
        showBalloon("No active note found to paste image into", this.settings.showNotifications);
        return;
      }
      
      // Get the noteId for counter tracking
      const noteId = activeFile.path;
      
      // Get the current counter for this note (without resetting it)
      const currentCounter = this.getCounter(noteId);
      logError(`Current counter for note: ${noteId} is ${currentCounter}`);
      
      // Get the media directory for this note
      const mdir = await getMDir(this.app, activeFile, this.settings);
      logError(`Media directory for note: ${mdir}`);
      await this.ensureFolderExists(mdir);
      
      // Get Obsidian's default attachment folder for estimating default paths
      const obsmdir = await getMDir(this.app, activeFile, this.settings, true);
      logError(`Obsidian default media directory: ${obsmdir}`);
      
      // Process files sequentially to avoid counter races
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileId = `${Date.now()}-${i}`; // Unique identifier for logging
        
        // Check if the file is an image
        if (!file.type.startsWith('image/')) {
          logError(`[${fileId}] Skipping non-image file: ${file.name} (${file.type})`);
          continue;
        }
        if (!file.name.includes('.')) {
          logError(`[${fileId}] Pasted file seems generic or missing extension, possible web image paste: ${file.name}`);
        }
        
        logError(`[${fileId}] Processing pasted image: ${file.name} (${file.type})`);
        
        // Estimate the default path that Obsidian might create
        const defaultObsidianPath = pathJoin([obsmdir, file.name]);
        logError(`[${fileId}] Estimated default Obsidian path: ${defaultObsidianPath}`);
        
        // Add the default path to skip processing immediately
        this.skipProcessingForPaths.add(defaultObsidianPath);
        this.schedulePathForSkipProcessingCleanup(defaultObsidianPath);
        logError(`[${fileId}] Added default path to skip processing: ${defaultObsidianPath}`);
        
        // Read the file as ArrayBuffer using new helper
        const originalData = await this.readFileAsArrayBuffer(file);
        
        // Get image dimensions from the original data
        let imgWidth: number | undefined = undefined;
        let imgHeight: number | undefined = undefined;
        try {
          logError(`[${fileId}] Getting image dimensions...`);
          const dimensions = await getImageDimensions(originalData);
          if (dimensions) {
            imgWidth = dimensions.width;
            imgHeight = dimensions.height;
            logError(`[${fileId}] Image dimensions: ${imgWidth}x${imgHeight}`);
          } else {
            logError(`[${fileId}] Could not determine image dimensions`);
          }
        } catch (error) {
          logError(`[${fileId}] Error getting image dimensions: ${error}`);
        }
        
        // Initialize variables for final file data
        let finalData = originalData;
        let finalMimeType = file.type;
        let finalExtension = file.name.split('.').pop() || 'png';
        let webpConversionSuccessful = false;
        
        // DECISION BLOCK: Determine whether to convert to WebP
        if (this.settings.convertWebpForPastedImages) {
          logError(`[${fileId}] WebP conversion enabled, FORCING conversion for all pasted images...`);
          try {
            // Always force WebP conversion using file.type or default to image/png
            const mimeTypeForConversion = file.type || 'image/png';
            logError(`[${fileId}] FORCING WebP conversion from mime type: ${mimeTypeForConversion}`);
            
            const webpData = await convertToWebp(originalData, mimeTypeForConversion, this.settings.webpQuality);
            finalData = webpData;
            finalMimeType = 'image/webp';
            finalExtension = 'webp';
            webpConversionSuccessful = true;
            logError(`[${fileId}] FORCED WebP conversion successful`);
          } catch (error) {
            logError(`[${fileId}] FORCED WebP conversion failed: ${error}. Using original format.`);
            // Keep the original values (already set above)
          }
        } else {
          logError(`[${fileId}] WebP conversion not enabled, using original format`);
        }
        
        // Get a fresh counter for each file
        const counter = this.getNextCounter(noteId);
        logError(`[${fileId}] Using counter: ${counter} for file`);
        
        // Generate the final filename ONCE after conversion decision is complete
        const finalFilename = renameImage(
          file.name,
          this.settings.imageRenameRule,
          activeFile.basename,
          counter,
          imgWidth,
          imgHeight,
          finalExtension
        );
        
        // Create the final path for the file
        const finalPath = pathJoin([mdir, finalFilename]);
        
        // Check if this file has already been processed to prevent duplicate saves
        if (this.processedPastedFiles.has(finalPath)) {
          logError(`[${fileId}] Duplicate save detected, skipping saving for ${finalPath}`);
          continue;
        }
        
        // Add to skip processing paths to prevent duplicate processing BEFORE saving
        this.skipProcessingForPaths.add(finalPath);
        this.schedulePathForSkipProcessingCleanup(finalPath);
        logError(`[${fileId}] Added final path to skip processing: ${finalPath}`);
        
        // SINGLE SAVE OPERATION BLOCK
        logError(`[${fileId}] --- SAVE OPERATION START ---`);
        logError(`[${fileId}] Saving image to: ${finalPath}`);
        logError(`[${fileId}] Format: ${finalMimeType}`);
        logError(`[${fileId}] WebP conversion: ${webpConversionSuccessful ? 'Successful' : 'Not performed/failed'}`);
        
        try {
          // Single, definitive writeBinary call
          await this.app.vault.adapter.writeBinary(finalPath, finalData);
          
          // Track this file as processed immediately after successful save
          this.processedPastedFiles.add(finalPath);
          logError(`[${fileId}] Added to processedPastedFiles: ${finalPath}`);
          
          logError(`[${fileId}] Image saved successfully to ${finalPath} with counter ${counter}`);
          
          // Get the relative path for the markdown link
          const newlink = await getRDir(activeFile, this.settings, finalPath);
          
          // Handle the markdown link insertion
          if (editor) {
            const markdownLink = `![[${newlink[0]}]]`;
            // Flag to control whether we should insert a new markdown link
            let shouldInsertMarkdownLink = true;
            
            // If WebP conversion was successful, we need to replace the original link
            // instead of just inserting a new one
            if (webpConversionSuccessful) {
              logError(`[${fileId}] WebP conversion successful, attempting to replace original link`);
              
              // Try to find and replace the original link in the editor
              // The original file might be created by the time we get here
              const originalFilePath = pathJoin([mdir, file.name]);
              const originalMarkdownLink = `![[${file.name}]]`;
              
              // Try to replace the original link with the WebP link BEFORE inserting a new one
              const replacementSuccessful = this.replaceImageLinkInEditor(editor, originalMarkdownLink, markdownLink);
              
              if (replacementSuccessful) {
                // If replacement was successful, we don't need to insert a new link
                shouldInsertMarkdownLink = false;
                logError(`[${fileId}] Successfully replaced original link with WebP link. No new link needed.`);
                
                // Schedule a delayed deletion of the original file to prevent race conditions
                setTimeout(async () => {
                  try {
                    if (await this.app.vault.adapter.exists(originalFilePath)) {
                      await this.app.vault.adapter.remove(originalFilePath);
                      logError(`[${fileId}] Deleted original file after WebP conversion: ${originalFilePath}`);
                    }
                  } catch (error) {
                    logError(`[${fileId}] Error deleting original file: ${error}`);
                  }
                }, 500); // 500ms delay to ensure file operations have completed
              } else {
                logError(`[${fileId}] Could not find original link to replace, will insert new link`);
              }
            }
            
            // Only insert a new link if we couldn't replace the original one
            if (shouldInsertMarkdownLink) {
              editor.replaceSelection(markdownLink);
              logError(`[${fileId}] Inserted new markdown link: ${markdownLink}`);
            }
          }
          
          // Schedule a delayed check for the default Obsidian file
          setTimeout(async () => {
            try {
              if (await this.app.vault.adapter.exists(defaultObsidianPath)) {
                logError(`[${fileId}] Found default Obsidian file, attempting to delete: ${defaultObsidianPath}`);
                await this.app.vault.adapter.remove(defaultObsidianPath);
                logError(`[${fileId}] Successfully deleted default Obsidian file: ${defaultObsidianPath}`);
              }
            } catch (error) {
              logError(`[${fileId}] Error checking/deleting default Obsidian file: ${error}`);
            }
          }, 500); // 500ms delay to ensure Obsidian has created the file
          
          logError(`[${fileId}] --- SAVE OPERATION END ---`);
        } catch (error) {
          // Remove from skip processing if save failed
          this.skipProcessingForPaths.delete(finalPath);
          logError(`[${fileId}] Error saving image, removed from skip processing: ${finalPath}`);
          
          logError(`[${fileId}] Error saving image: ${error}`);
          showBalloon(`Error saving image: ${error}`, this.settings.showNotifications);
        }
      }
      
      logError("--- End Pasted Local Image Processing ---");
    } catch (error) {
      logError(`Error processing pasted files: ${error}`);
      showBalloon(`Error processing pasted images: ${error}`, this.settings.showNotifications);
    }
  }

  private async onPasteFunc(evt: ClipboardEvent = undefined, editor: Editor = undefined, info: MarkdownView = undefined) {

    if (evt === undefined) { return }

    if (!this.settings.realTimeUpdate) { return }

    try {
      const activeFile = this.getCurrentNote()
      const fItems = evt.clipboardData.files
      const tItems = evt.clipboardData.items

      // Check for Markdown image link in pasted text with expanded regex
      const pastedText = evt.clipboardData.getData("text");
      const mdImgRegex = /!\[.*?\]\((https?:\/\/[^\s)]+?\.(?:jpg|jpeg|png|gif|bmp|webp|avif|svg|tiff|ico))\)/i;
      if (pastedText && mdImgRegex.test(pastedText)) {
        logError("Markdown image link detected in paste event: " + pastedText);
        showBalloon("Markdown image link detected, processing...", this.settings.showNotifications);
        await this.handleMarkdownImageLink(pastedText, editor, activeFile);
        evt.preventDefault();
        return;
      }

      for (const key in tItems) {

        // Check if it was a text/html
        if (tItems[key].kind == "string") {
          
          if (this.settings.realTimeUpdate) {
            
            const cont = htmlToMarkdown(evt.clipboardData.getData("text/html")) +
            
            htmlToMarkdown(evt.clipboardData.getData("text"))
            



            for (const reg_p of MD_SEARCH_PATTERN) {
              if (reg_p.test(cont)) {
                logError("content: " + cont)
                showBalloon("Media links were found, processing...", this.settings.showNotifications)

                this.enqueueActivePage(activeFile)
                this.setupQueueInterval()
                break
              }
            }
          }
          return
        }

      }

      // Process pasted files (images)
      if (fItems && fItems.length > 0) {
        logError(`Found ${fItems.length} files in clipboard`);
        await this.handlePastedFiles(fItems, editor, info);
      }

    } catch (e) {
      showBalloon(`Please select a note or click inside selected note in canvas.`, this.settings.showNotifications)
      return
    }


  }




  private removeOrphans = (type: string = undefined,
    filesToRemove: Array<TFile> = undefined,
    noteFile: TFile = undefined) => async () => {

      const obsmediadir = app.vault.getConfig("attachmentFolderPath")
      const allFiles = this.app.vault.getFiles()
      let oldRootdir = this.settings.mediaRootDir

      if (type == "plugin") {
        let orphanedAttachments = []
        let allAttachmentsLinks = []
        if (this.settings.saveAttE != "nextToNoteS" ||
          !path.basename(oldRootdir).endsWith("${notename}") ||
          oldRootdir.includes("${date}")) {
          showBalloon("This command requires the settings 'Next to note in the folder specified below' and pattern '${notename}' at the end to be enabled, also the path cannot contain ${date} pattern.\nPlease, change settings first!\r\n", this.settings.showNotifications)
          return
        }
         
        if (!noteFile) {
          noteFile = this.getCurrentNote()
          if (!noteFile) {
            showBalloon("Please, select a note or click inside a note in canvas!", this.settings.showNotifications)
            return
          }

        }


        if (this.ExemplaryOfMD(noteFile.path)) {

          oldRootdir = oldRootdir.replace("${notename}", path.parse(noteFile.path)?.name)
          oldRootdir = trimAny(pathJoin([path.parse(noteFile.path)?.dir, oldRootdir]), ["\/"])
          if (! await this.app.vault.exists(oldRootdir)) {
            showBalloon("The attachment folder " + oldRootdir + " does not exist!", this.settings.showNotifications)
            return
          }
          const allAttachments = await this.app.vault.getAbstractFileByPath(oldRootdir)?.children
          const metaCache = this.app.metadataCache.getFileCache(noteFile)
          const embeds = metaCache?.embeds
          const links = metaCache?.links

          if (embeds) {
            for (const embed of embeds) {
              allAttachmentsLinks.push(path.basename(embed.link))
            }
          }
          if (links) {
            for (const link of links) {
              allAttachmentsLinks.push(path.basename(link.link))
            }
          }
          if (allAttachments) {
            for (const attach of allAttachments) {
              if (!allAttachmentsLinks.includes(attach.name) && attach.children == undefined ) {
                logError("orph: " + attach.basename)
                orphanedAttachments.push(attach)
              }
            }
          }


          if (orphanedAttachments.length > 0) {
            const mod = new ModalW1(this.app)
            mod.messg = "Confirm remove " + orphanedAttachments.length + " orphan(s) from '" + oldRootdir + "'\r\n\r\n      "
            mod.plugin = this
            mod.callbackFunc = this.removeOrphans("execremove", orphanedAttachments)
            mod.open()
          } else {
            showBalloon("No orphaned files found!", this.settings.showNotifications)
          }

        }


      }



      if (type == "obsidian") {

        if (obsmediadir.slice(0, 2) == "./" || obsmediadir == "/") {
          showBalloon("This command cannot run on vault's root or on subfolder next to note!\nPlease, change settings first!\r\n", this.settings.showNotifications)
          return
        }

        const allAttachments = this.app.vault.getAbstractFileByPath(obsmediadir)?.children
        let orphanedAttachments = []
        let allAttachmentsLinks = []
        
        
 
        if (allFiles) {

          for (const file of allFiles) {
            
            //Fix for canvas files
            if (file !== null && this.ExemplaryOfCANVAS(file.path)){
             logError(file) 
              
             logError(this.app.metadataCache.getCache(file.path))
              
   
              let canvasData
              try {
                canvasData = JSON.parse(await app.vault.cachedRead(file))
              } catch (e) {
                logError("Parse canvas data error")  
                continue
              }
               
              if (canvasData.nodes && canvasData.nodes.length > 0) {
                for (const node of canvasData.nodes) {
                  
                  logError(node)
                    
                  if (node.type === "file") {
                    
                    logError("file json")
                    
                    allAttachmentsLinks.push(path.basename(node.file))
                    
                  } else if (node.type == "text") {
                    
                    logError("text json")
                   
                    //https://github.com/Fevol/obsidian-typings
                    //Undocumented API may be altered in the future
                    const AllNodeLinks = (await this.app.internalPlugins.plugins.canvas.instance.index.parseText(node.text))?.links;
 
                    logError(AllNodeLinks)
 
                    if (AllNodeLinks === undefined){continue}

                    for (const Nodelink of AllNodeLinks) {
                      allAttachmentsLinks.push(path.basename(Nodelink.link))
                    }
                  }
                }
              }
            
      

            }

          if (file !== null && this.ExemplaryOfMD(file.path)){

    
              const metaCache = this.app.metadataCache.getCache(file.path)
              const embeds = metaCache?.embeds
              const links = metaCache?.links
              logError(embeds)
              logError(links)


              if (embeds) {
                for (const embed of embeds) {
                  allAttachmentsLinks.push(path.basename(embed.link))
                }
              }
              if (links) {
                for (const link of links) {
                  allAttachmentsLinks.push(path.basename(link.link))
                }
              }
            

          }
        }

          for (const attach of allAttachments) {
            if (!allAttachmentsLinks.includes(attach.name) && attach.children == undefined ) {
              logError(allAttachmentsLinks)
              logError(attach.name)
              logError("orph: " + attach.name)
              orphanedAttachments.push(attach)
            }
          }

        }


        logError("Orphaned: ")
        logError(orphanedAttachments, true)
        if (orphanedAttachments.length > 0) {
          const mod = new ModalW1(this.app)
          mod.messg = "Confirm remove " + orphanedAttachments.length + " orphan(s) from '" + obsmediadir + "  '\r\n \
          NOTE: Be careful when running this command on Obsidian attachments folder, since some html-linked files may also be moved.\r\n      "
          mod.plugin = this
          mod.callbackFunc = this.removeOrphans("execremove", orphanedAttachments)
          mod.open()
        } else {
          showBalloon("No orphaned files found!", this.settings.showNotifications)
        }




      }


      if (type == "execremove") {
        const useSysTrash = (this.app.vault.getConfig("trashOption") === "system")
        const remcompl = this.settings.removeOrphansCompl
        let msg = "";

        if (filesToRemove) {

          filesToRemove.forEach((el: TFile) => {

            if (remcompl) {
              msg = "were deleted completely."
              this.app.vault.delete(el, true)
            } else {
              if (useSysTrash) {
                msg = "were moved to the system garbage can."
              } else {
                msg = "were moved to the Obsidian garbage can."
              }
              this.app.vault.trash(el, useSysTrash)
            }

          })
        }

        showBalloon(filesToRemove.length + " file(s) " + msg, this.settings.showNotifications)

      }

    }




  private openProcessAllModal = () => {
    const mod = new ModalW1(this.app)
    mod.messg = "Confirm processing all pages.\r\n "
    mod.plugin = this
    mod.callbackFunc = this.processAllPages
    mod.open()
  }
 



  private async onMdCreateFunc(file: TFile) {

 
    if (!file ||
      !(file instanceof TFile) ||
      !(this.settings.processCreated) ||
      !this.ExemplaryOfMD(file.path)
       )
      return


    const timeGapMs = Math.abs(Date.now() - file.stat.ctime)

    if (timeGapMs > 1000)
      return

    logError("func onMdCreateFunc: " + file.path)
    logError(file,true)
 

    var cont = await this.app.vault.cachedRead(file)
 
    logError(cont)
  
        this.enqueueActivePage(file)
        this.setupQueueInterval()
        this.setupNewMdFilesProcInterval()
 
  }

  private async onFCreateFunc(file: TFile) {
    // First check if this file should be skipped - do this check before any other processing
    if (!file || !(file instanceof TFile)) {
      return;
    }
    
    // Check both sets at the beginning to ensure we don't process files that are already handled
    if (this.processedPastedFiles.has(file.path)) {
      logError(`Skipping already processed pasted file: ${file.path}`);
      return;
    }
    
    if (this.skipProcessingForPaths.has(file.path)) {
      logError(`Skipping file that is marked for skip processing: ${file.path}`);
      return;
    }
    
    // Continue with normal processing only if the file passes all checks
    if (this.ExemplaryOfMD(file.path) || 
        this.ExemplaryOfCANVAS(file.path) || 
        !this.settings.processAll) {
      return;
    }

    if (!file.stat.ctime) {
      return;
    }

    const timeGapMs = Math.abs(Date.now() - file.stat.mtime);
    if (timeGapMs > 1000) {
      return;
    }

    // Check if this is an image file that should be converted to WebP
    const fileExt = file.path.toLowerCase().split('.').pop();
    const isConvertibleImage = ['png', 'jpg', 'jpeg', 'gif', 'bmp'].includes(fileExt);
    const isAlreadyWebp = file.path.toLowerCase().includes('.webp');
    
    if (isConvertibleImage && !isAlreadyWebp && this.settings.convertWebpForPastedImages) {
      logError(`Web browser pasted image detected: ${file.path}, will convert to WebP`);
      
      try {
        // Get the active note
        const activeFile = this.getCurrentNote();
        if (!activeFile) {
          logError(`No active note found for WebP conversion of: ${file.path}`);
          return;
        }
        
        // Get the media directory for this note
        const mdir = await getMDir(this.app, activeFile, this.settings);
        await this.ensureFolderExists(mdir);
        
        // Get a counter for the image
        const noteId = activeFile.path;
        const counter = this.getNextCounter(noteId);
        
        // Read the original file
        const originalData = await this.app.vault.adapter.readBinary(file.path);
        
        // Get image dimensions if possible
        let imgWidth: number | undefined = undefined;
        let imgHeight: number | undefined = undefined;
        try {
          const dimensions = await getImageDimensions(originalData);
          if (dimensions) {
            imgWidth = dimensions.width;
            imgHeight = dimensions.height;
            logError(`Image dimensions for ${file.path}: ${imgWidth}x${imgHeight}`);
          }
        } catch (error) {
          logError(`Error getting image dimensions for ${file.path}: ${error}`);
        }
        
        // Convert to WebP
        logError(`Converting ${file.path} to WebP...`);
        const mimeType = `image/${fileExt === 'jpg' ? 'jpeg' : fileExt}`;
        const webpData = await convertToWebp(originalData, mimeType, this.settings.webpQuality);
        
        // Generate new filename with WebP extension
        const originalFileName = path.basename(file.path);
        const finalFilename = renameImage(
          originalFileName,
          this.settings.imageRenameRule,
          activeFile.basename,
          counter,
          imgWidth,
          imgHeight,
          'webp'
        );
        
        // Create the final path for the WebP file
        const finalPath = pathJoin([mdir, finalFilename]);
        
        // Save the WebP file
        logError(`Saving WebP image to: ${finalPath}`);
        await this.app.vault.adapter.writeBinary(finalPath, webpData);
        
        // Add to processed files to prevent duplicate processing
        this.processedPastedFiles.add(finalPath);
        this.skipProcessingForPaths.add(finalPath);
        this.schedulePathForSkipProcessingCleanup(finalPath);
        
        // Get the relative path for the markdown link
        const newlink = await getRDir(activeFile, this.settings, finalPath);
        const markdownLink = `![[${newlink[0]}]]`;
        
        // Insert the link into the editor if possible
        const editor = this.app.workspace.activeEditor?.editor;
        if (editor) {
          editor.replaceSelection(markdownLink);
          logError(`Inserted markdown link: ${markdownLink}`);
        }
        
        // Delete the original file
        logError(`Deleting original file: ${file.path}`);
        await this.app.vault.adapter.remove(file.path);
        
        // Skip normal processing
        return;
      } catch (error) {
        logError(`Error converting web browser pasted image to WebP: ${error}`);
        // Continue with normal processing if conversion fails
      }
    }
    
    logError(`File created and will be processed: ${file.path}`);
    this.newfCreated.push(file.path);
    this.newfMoveReq = true;
    this.setupNewMdFilesProcInterval();
  }


  private ExemplaryOfMD(pat: string){
    const includeRegex = new RegExp(this.settings.includepattern, "i")
    return (pat.match(includeRegex)?.groups?.md != undefined)
  }


  private ExemplaryOfCANVAS(pat: string){
    const includeRegex = new RegExp(this.settings.includepattern, "i")
    return (pat.match(includeRegex)?.groups?.canvas != undefined)
  }

  private processMdFilesOnTimer = async () => {

    const th = this
    function onRet() {
      th.newfCreated = []
      th.newfCreatedByDownloader = []
      th.noteModified = []
      th.newfMoveReq = false
      window.clearInterval(th.newfProcInt)
      th.newfProcInt = 0
    }

    logError("func processMdFilesOnTimer:\r\n")
    logError(this.noteModified, true)

    try {

      window.clearInterval(this.newfProcInt)
      this.newfProcInt = 0
      this.newfMoveReq = false
      let itemcount = 0
      const useMdLinks = this.app.vault.getConfig("useMarkdownLinks")

      for (let note of this.noteModified) {

        const metaCache = this.app.metadataCache.getFileCache(note)
        let filedata = await this.app.vault.cachedRead(note)
        
        let pr = false
        for (const reg_p of MD_SEARCH_PATTERN) {
          if (reg_p.test(filedata)) {
            pr = true
            break
          }
        }

        const mdir = await getMDir(this.app, note, this.settings)
        const obsmdir = await getMDir(this.app, note, this.settings, true)
        let embeds = metaCache?.embeds

        if (obsmdir != "" && ! await this.app.vault.adapter.exists(obsmdir)) {
         if ( ! this.settings.DoNotCreateObsFolder){
          this.ensureFolderExists(obsmdir)
          showBalloon("You obsidian media folder set to '" + obsmdir + "', and has been created by the plugin. Please, try again. ", this.settings.showNotifications)
          onRet()
        }
          return
        }

        if (embeds || pr) {
          // Explicitly call processPage for each modified note
          logError(`Explicitly calling processPage for note: ${note.path}`);
          await this.processPage(note);

          await this.ensureFolderExists(mdir)

          for (let el of embeds) {

            logError(el)

            let oldpath = pathJoin([obsmdir, path.basename(el.link)])
            let oldtag = el["original"];
            logError(useMdLinks)

            logError(this.newfCreated)
            
            // Check both skipProcessingForPaths and processedPastedFiles at the beginning
            // to ensure we don't process files that are already handled
            if (this.skipProcessingForPaths.has(oldpath) || 
                this.skipProcessingForPaths.has(el.link) ||
                this.processedPastedFiles.has(oldpath) ||
                this.processedPastedFiles.has(el.link)) {
              logError(`Skipping automatic processing for already processed file: ${el.link} (oldpath: ${oldpath})`);
              continue;
            }
            
            // Add to skip processing to prevent other handlers from processing this file
            this.skipProcessingForPaths.add(oldpath);
            this.skipProcessingForPaths.add(el.link);
            this.schedulePathForSkipProcessingCleanup(oldpath);
            this.schedulePathForSkipProcessingCleanup(el.link);
            logError(`Added to skip processing during processMdFilesOnTimer: ${oldpath}, ${el.link}`);
            
            if ((this.newfCreated.indexOf(el.link) != -1 || (obsmdir != "" && (this.newfCreated.includes(oldpath) || this.newfCreated.includes(el.link)))) &&
              !this.newfCreatedByDownloader.includes(oldtag)) {

              if (! await this.app.vault.adapter.exists(oldpath)) {
                logError("Cannot find " + el.link + " skipping...")
                continue
              }

              // Get the next counter for this note
              const noteId = note.path;
              const counter = this.getNextCounter(noteId);
              
              // Get original filename without extension
              const originalName = path.basename(el.link);
              const extensionMatch = originalName.match(/\.([^.]+)$/);
              const extension = extensionMatch ? extensionMatch[0] : '';
              const nameWithoutExt = extensionMatch ? originalName.slice(0, originalName.lastIndexOf('.')) : originalName;
              
              // Get image dimensions if possible
              let imgWidth: number | undefined = undefined;
              let imgHeight: number | undefined = undefined;
              try {
                const oldBinDataForDimensions = await this.app.vault.adapter.readBinary(oldpath);
                const dimensions = await getImageDimensions(oldBinDataForDimensions);
                if (dimensions) {
                  imgWidth = dimensions.width;
                  imgHeight = dimensions.height;
                  logError(`Image dimensions for ${originalName}: ${imgWidth}x${imgHeight}`);
                }
              } catch (error) {
                logError(`Error getting image dimensions for ${originalName}: ${error}`);
              }
              
              // Rename the image using the renameImage function
              const newName = renameImage(
                originalName,
                this.settings.imageRenameRule,
                note.basename,
                counter,
                imgWidth,
                imgHeight
              );
              
              let newpath = pathJoin([mdir, newName]);
              let newlink: Array<string> = await getRDir(note, this.settings, newpath);

              logError(el.link)

              //let newBinData: Buffer | null = null

              let newBinData: ArrayBuffer | null = null
              let newMD5: string | null = null
              const oldBinData = await readFromDiskB(pathJoin([this.app.vault.adapter.basePath, oldpath]), 5000)
              const oldMD5 = md5Sig(oldBinData)
              const fileExt = await getFileExt(oldBinData, oldpath)

              logError("oldbindata: " + oldBinData)
              logError("oldext: " + fileExt)
           
              if (this.settings.PngToJpegLocal && fileExt == "png") {
                logError("converting to Jpeg")

                const blob = new Blob([new Uint8Array(await this.app.vault.adapter.readBinary(oldpath))]);
                newBinData = await blobToJpegArrayBuffer(blob, this.settings.JpegQuality*0.01)
                
                newMD5 = md5Sig(newBinData)
                logError(newBinData)
                if (newBinData != null) {

                  if (this.settings.useMD5ForNewAtt) {
                    newpath = pathJoin([mdir, newMD5 + ".jpeg"])
                  } else {
                    // Use renameImage for consistent naming
                    const newName = renameImage(
                      path.parse(el.link)?.name + ".jpeg",
                      this.settings.imageRenameRule,
                      note.basename,
                      counter,
                      imgWidth,
                      imgHeight
                    );
                    newpath = pathJoin([mdir, newName])
                  }
                  newlink = await getRDir(note, this.settings, newpath)
                }

              } else if (this.settings.useMD5ForNewAtt) {
                newpath = pathJoin([mdir, oldMD5 + path.extname(el.link)])
                newlink = await getRDir(note, this.settings, newpath)

              } else if (!this.settings.useMD5ForNewAtt) {
                // Use renameImage for consistent naming
                const newName = renameImage(
                  path.basename(el.link),
                  this.settings.imageRenameRule,
                  note.basename,
                  counter,
                  imgWidth,
                  imgHeight
                );
                newpath = pathJoin([mdir, newName])
                newlink = await getRDir(note, this.settings, newpath)
              }

              if (await this.app.vault.adapter.exists(newpath)) {

                let newFMD5
                if (newBinData != null) {
                  newFMD5 = md5Sig(await this.app.vault.adapter.readBinary(newpath))
                } else {
                  newFMD5 = md5Sig(await readFromDiskB(pathJoin([this.app.vault.adapter.basePath, newpath]), 5000))
                }

                if (newMD5 === newFMD5 || (oldMD5 === newFMD5 && oldpath != newpath)) {

                  logError(path.dirname(oldpath))
                  logError("Deleting duplicate file: " + oldpath)
                  await this.app.vault.adapter.remove(oldpath)

                } else if (oldpath != newpath) {

                  logError("Renaming existing: " + oldpath)
                  let inc = 1
                  while (await this.app.vault.adapter.exists(newpath)) {
                    // Create a unique name by adding an incrementing number
                    const originalName = path.basename(el.link);
                    const newName = renameImage(
                      `(${inc}) ` + originalName,
                      this.settings.imageRenameRule,
                      note.basename,
                      counter,
                      imgWidth,
                      imgHeight
                    );
                    newpath = pathJoin([mdir, newName]);
                    inc++
                  }

                  newlink = await getRDir(note, this.settings, newpath)
                  await this.app.vault.adapter.rename(oldpath, newpath)
                }

              } else {
                logError(`renaming  ${oldpath}  to  ${newpath}`)
                try {
                  if (newBinData != null) {
                    await this.app.vault.adapter.writeBinary(newpath, newBinData).then(
                    ); {
                      await this.app.vault.adapter.remove(oldpath)
                    }

                  } else {
                    await this.app.vault.adapter.rename(oldpath, newpath)
                  }

                } catch (error) {
                  logError(error)
                }
              }

              let addName = "";
              if (this.settings.addNameOfFile) {
                if (useMdLinks) {
                  addName = `[Open: ${path.basename(el.link)}](${newlink[1]})\r\n`
                } else {
                  addName = `[[${newlink[0]}|Open: ${path.basename(el.link)}]]\r\n`
                }
              }

              let newtag = addName + oldtag.replace(el.link, newlink[0])

              if (useMdLinks) {
                newtag = addName + oldtag.replace(encObsURI(el.link), newlink[1])
              }

              filedata = filedata.replaceAll(oldtag, newtag)
              itemcount++
            }
          }
        }
        if (itemcount > 0) {
          await this.app.vault.modify(note, filedata)
          showBalloon(itemcount + " attachments for note " + note.path + " were processed.", this.settings.showNotifications)
          itemcount = 0
        }
      }
    } catch (e) {
      logError(e)
      onRet()
    }
    onRet()
  }






  private setTitleAsName = async () => {
    try {
      const noteFile = this.getCurrentNote()
      const fileData = await this.app.vault.cachedRead(noteFile)
      const title = fileData.match(/^#{1,6} .+?($|\n)/gm)
      var ind = 0
      if (title !== null) {
        const newName = cFileName(trimAny(title[0].toString(), ["#", " "])).slice(0, 200)
        var fullPath = pathJoin([noteFile.parent.path, newName + ".md"])
        var fExist = await this.app.vault.exists(fullPath)
        if (trimAny(noteFile.path, ["\\", "/"]) != trimAny(fullPath, ["\\", "/"])) {
          while (fExist) {
            ind++
            var fullPath = pathJoin([noteFile.parent.path, newName + " (" + ind + ")" + ".md"])
            var fExist = await this.app.vault.exists(fullPath)
          }
          await this.app.vault.rename(noteFile, fullPath)

          showBalloon(`The note was renamed to ` + fullPath, this.settings.showNotifications)

        }
      }

    } catch (e) {
      showBalloon(`Cannot rename.`, this.settings.showNotifications)
      return
    }
  }






  setupNewMdFilesProcInterval() {
    logError("func setupNewFilesProcInterval: \r\n")
    window.clearInterval(this.newfProcInt)
    this.newfProcInt = 0
    this.newfProcInt = window.setInterval(
      this.processMdFilesOnTimer,
      this.settings.realTimeUpdateInterval * 1000
    )
    this.registerInterval(this.newfProcInt)
  }

  private convertSelToURI = async () => {
    this.app.workspace.activeEditor.editor.replaceSelection(encObsURI(await this.app.workspace.activeEditor.getSelection()))
  }

  private convertSelToMD = async () => {
    this.app.workspace.activeEditor.editor.replaceSelection(htmlToMarkdown(await this.app.workspace.activeEditor.getSelection()))
  }



  processModifiedQueue = async () => {
    const iteration = this.modifiedQueue.iterationQueue();
    for (const page of iteration) {
      this.processPage(page, false);
    }
  };

  enqueueActivePage(activeFile: TFile) {
    this.modifiedQueue.push(
      activeFile,
      1//this.settings.realTim3AttemptsToProcess
    )
  }




  // ------------  Load / Save settings -----------------



  async onunload() {
    this.app.workspace.off("editor-drop", null)
    this.app.workspace.off("editor-paste", null)
    this.app.workspace.off('file-menu', null)
    //this.app.vault.off("create",  null)
    logError(" unloaded.")
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
    this.setupQueueInterval()
  }

  async saveSettings() {
    try {
      await this.saveData(this.settings)
    } catch (error) {
      displayError(error)
    }
  }

  /**
   * Replaces an original image link in the editor with a new one
   * @param editor The editor instance
   * @param originalLink The original markdown image link (e.g., "![[image.png]]")
   * @param newLink The new markdown image link (e.g., "![[image.webp]]")
   * @returns boolean indicating whether the replacement was successful
   */
  private replaceImageLinkInEditor(editor: Editor, originalLink: string, newLink: string): boolean {
    if (!editor) {
      logError("Cannot replace image link: No editor provided");
      return false;
    }
    
    try {
      // Get the current content of the editor
      const content = editor.getValue();
      
      // Check if the original link exists in the content
      if (content.includes(originalLink)) {
        // Replace the original link with the new one (only replace the first occurrence)
        const newContent = content.replace(originalLink, newLink);
        
        // Set the new content back to the editor
        editor.setValue(newContent);
        
        logError(`Successfully replaced image link: ${originalLink} → ${newLink}`);
        return true;
      } else {
        logError(`Original link not found in editor: ${originalLink}`);
        return false;
      }
    } catch (error) {
      logError(`Error replacing image link: ${error}`);
      return false;
    }
  }
  
  private schedulePathForSkipProcessingCleanup(path: string) {
    if (!path) {
      logError(`Attempted to schedule cleanup for undefined path`);
      return;
    }
    
    logError(`Scheduling cleanup for path in skip list: ${path}`);
    setTimeout(() => {
      if (this.skipProcessingForPaths.has(path)) {
        this.skipProcessingForPaths.delete(path);
        logError(`Removed path from skip processing list: ${path}`);
      }
    }, this.skipProcessingTimeout);
  }

  async ensureFolderExists(folderPath: string) {
    try {
      await this.app.vault.createFolder(folderPath)
      return
    } catch (e) {
      logError(e)
      return
    }
  }
}
