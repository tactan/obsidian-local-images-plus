import { URL } from "url";
import path from "path";
import { 
  App, 
  DataAdapter,
  TFile,
  Plugin
} from "obsidian";

// Generate a unique session ID for this plugin instance
let currentSessionId = Date.now().toString();

// Function to regenerate the session ID and clear caches
export function regenerateSessionId(app?: Plugin): string {
  currentSessionId = Date.now().toString();
  processedUrlsPerFile.clear();
  
  // Clear the app.processedFiles set if app is provided
  if (app && app.processedFiles instanceof Set) {
    app.processedFiles.clear();
    logError('Cleared global app.processedFiles set.', false);
  } else if (app) {
    app.processedFiles = new Set<string>();
    logError('Initialized global app.processedFiles set.', false);
  }
  
  console.log('Generated new session ID and cleared all URL caches and processed files set:', currentSessionId);
  return currentSessionId;
}

// Function to get the current session ID
export function getSessionId(): string {
  return currentSessionId;
}

// Helper function to generate a unique key for a URL in a specific file
export function getUrlKey(url: string, filePath: string): string {
  return `${url}#${filePath}#${getSessionId()}`;
}

// Map to track processed URLs per file to prevent duplicate processing
// Using a nested Map structure: filePath -> Map of URL keys -> boolean
const processedUrlsPerFile = new Map<string, Map<string, boolean>>();

// Helper function to clear the processed URLs
export function clearProcessedUrls(filePath?: string) {
  if (filePath) {
    // Clear only the Map for the specified file
    processedUrlsPerFile.delete(filePath);
  } else {
    // Clear the entire Map
    processedUrlsPerFile.clear();
  }
}

// Helper function to check if a URL is already processed for a file without modifying the tracking state
export function isUrlProcessedForFile(url: string, filePath: string): boolean {
  const fileUrls = processedUrlsPerFile.get(filePath);
  if (!fileUrls) return false;
  
  const urlKey = getUrlKey(url, filePath);
  return fileUrls.has(urlKey);
}

// Helper function to check if a URL is already processed in any file
export function isUrlProcessedGlobally(url: string): boolean {
  for (const [filePath, urlMap] of processedUrlsPerFile.entries()) {
    for (const [urlKey, processed] of urlMap.entries()) {
      if (urlKey.startsWith(url + '#') && processed) {
        return true;
      }
    }
  }
  return false;
}

// Helper function to mark a URL as processed for a file
export function markUrlAsProcessed(url: string, filePath: string): void {
  if (!processedUrlsPerFile.has(filePath)) {
    processedUrlsPerFile.set(filePath, new Map<string, boolean>());
  }
  
  const fileUrls = processedUrlsPerFile.get(filePath);
  const urlKey = getUrlKey(url, filePath);
  fileUrls.set(urlKey, true);
}

import { renameImage } from "./image-renamer";

// Regular expression to match markdown image links with expanded image formats
// Includes: jpg, jpeg, png, gif, webp, bmp, avif, svg, tiff, ico
export const MD_SEARCH_PATTERN = /!\[([^\]]*)\]\(([^)]+\.(jpe?g|png|gif|webp|bmp|avif|svg|tiff?|ico)(?:\?[^)]*)?)\)/gi;


import {
  isUrl,
  downloadImage,
  readFromDisk,
  cleanFileName,
  logError,
  trimAny,
  pathJoin,
  normalizePath,
  base64ToBuff,
  md5Sig,
  getFileExt,
  blobToJpegArrayBuffer,
  getImageDimensions
} from "./utils";

import{
  ISettings,
  SUPPORTED_OS
} from "./config";

import { convertToWebp } from "./webp-converter";

import AsyncLock from "async-lock";
import moment from "moment";

export function imageTagProcessor(app: Plugin,
                                  noteFile: TFile,
                                  settings: ISettings,
                                  defaultdir: boolean
                                 ) {
  
  // Get the file path
  const filePath = noteFile.path;
  
  // Initialize the Map for this file if it doesn't exist
  if (!processedUrlsPerFile.has(filePath)) {
    processedUrlsPerFile.set(filePath, new Map<string, boolean>());
  }
                                  
  const unique = Math.random().toString(16).slice(2,);
  const noteId = noteFile.path;
  
  // Initialize counter for this note if it doesn't exist
  if (!app.imageCounters) {
    app.imageCounters = new Map();
  }
  
  if (!app.imageCounters.has(noteId)) {
    app.imageCounters.set(noteId, 0);
  }
  
  // Initialize processed files tracking if it doesn't exist
  if (!app.processedFiles) {
    app.processedFiles = new Set();
  }

  async function processImageTag(match: string,
                                 anchor: string,
                                 link: string,
                                 caption: string,
                                 imgsize: string) {

    // Get the file path
    const filePath = noteFile.path;
    
    // Check if this URL has already been processed in this file using the new helper function
    if (isUrlProcessedForFile(link, filePath)) {
      logError("Skipping already processed URL in this file: " + link, false);
      // Return original match to avoid corrupting content
      return match;
    }
    
    // Mark the URL as processed for this file at the beginning to prevent duplicate processing
    // even if there's an error during processing
    markUrlAsProcessed(link, filePath);

    // Get a fresh counter for this note using getNextCounter if available, otherwise fallback
    const counter = app.getNextCounter ? 
      await app.getNextCounter(noteId) : 
      (app.imageCounters.set(noteId, app.imageCounters.get(noteId) + 1), app.imageCounters.get(noteId));
    
    // Enhanced logging
    logError("processImageTag: "+match+" (counter: "+counter+")");
    logError("Anchor: "+anchor+", Link: "+link+", Caption: "+caption+", Size: "+imgsize);
    
    // Verify link starts with http or data
    if (!isUrl(link) || !(link.startsWith('http') || link.startsWith('data:'))) {
      logError("Link is not a valid URL or doesn't start with http/data: " + link, false);
      return null;
    }
    
    // Check if this file has already been processed by handlePastedFiles
    // This prevents double processing of the same file
    const signatureInput = link + noteId + getSessionId();
    const fileSignature = md5Sig(signatureInput);
    if (fileSignature && app.processedFiles && app.processedFiles.has(fileSignature)) {
      logError("Skipping already processed file (session signature match): " + link, false);
      return match;
    }

    try {

      var lock = new AsyncLock();
      let fpath;
      let fileData: ArrayBuffer; 
      const opsys = process.platform;
      const mediaDir = await getMDir(app.app, noteFile, settings, defaultdir, unique);
      await app.ensureFolderExists(mediaDir);
      const protocol=link.slice(0,5);

      if (protocol == "data:"){
         logError("ReadBase64: \r\n"+fpath, false);
         fileData = await  base64ToBuff(link);
      } 
      else 

      if (protocol == "file:")  
        {
         logError("Readlocal: \r\n"+fpath, false);
          if (SUPPORTED_OS.win.includes(opsys)) {fpath=link.replace("file:///",""); }
          else if (SUPPORTED_OS.unix.includes(opsys)) { fpath=link.replace("file://",""); }
          else { fpath=link.replace("file://",""); }

             fileData = await readFromDisk(fpath);
             if ( fileData === null ) {
                   fileData = await readFromDisk(decodeURI(fpath));}
        }
        else{
            //Try to download several times with enhanced logging
            let trycount  = 0;
            while (trycount < settings.tryCount){ 
                logError("\r\n\nDownloading (try): "+trycount+" for URL: "+link+"\r\n\n");
                // Force download using fetch
                try {
                    fileData = await downloadImage(link);
                    if (fileData !== null) {
                        logError("Download successful on attempt: " + trycount, false);
                        break;
                    }
                } catch (error) {
                    logError("Download attempt " + trycount + " failed: " + error, false);
                }
                trycount++;
            }
        }
         if ( fileData  === null ){
            logError("Cannot get an attachment content!", false);
            return null;
         }

         
         if( Math.round(fileData.byteLength/1024) < settings.filesizeLimit) {
            logError("Lower limit of the file size!", false);
            return null;
         }

        // Obtain image dimensions using the new utility function
        const dimensions = await getImageDimensions(fileData);
        let imgWidth, imgHeight;
        if (dimensions) {
          imgWidth = dimensions.width;
          imgHeight = dimensions.height;
        }

        try {
     

  const { fileName, needWrite } = await lock.acquire(match, async function() {

  
    const parsedUrl = new URL(link);
     
    let fileExt = await getFileExt(fileData, parsedUrl.pathname);
   

 
    if (fileExt == "png" && settings.PngToJpeg) {
 
      const blob = new Blob([new Uint8Array(fileData)]);
      fileData = await blobToJpegArrayBuffer(blob, settings.JpegQuality*0.01)

      logError("arbuf: ")
      logError(fileData)
    }
    
    // Check if WebP conversion should be applied
    // Always convert if convertWebpForPastedImages is enabled, regardless of protocol
    if (settings.convertWebpForPastedImages || 
        (settings.convertWebpForWebImages && 
         protocol !== "file:" && 
         protocol !== "data:")) {
      
      // Define supported mime types for WebP conversion
      const supportedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/bmp'];
      
      // Determine mime type based on file extension
      let mimeType = 'image/jpeg'; // Default
      if (fileExt === 'png') mimeType = 'image/png';
      else if (fileExt === 'gif') mimeType = 'image/gif';
      else if (fileExt === 'bmp') mimeType = 'image/bmp';
      else if (fileExt === 'jpg' || fileExt === 'jpeg') mimeType = 'image/jpeg';
      
      // Parse the skip conversion formats from settings
      const formatsToSkip = settings.skipWebPConversionFormats
        .split('|')
        .map(ext => ext.trim().toLowerCase())
        .filter(ext => ext.length > 0);
      
      // Extract extension from URL
      const urlExt = link.split('.').pop()?.toLowerCase() || '';
      
      // Check if either detected extension or URL extension is in the skip list
      const shouldSkipBasedOnExt = formatsToSkip.includes(fileExt.toLowerCase()) || 
                                  (urlExt && formatsToSkip.includes(urlExt));
      
      logError("Formats to skip WebP conversion: " + formatsToSkip.join(', '), false);
      logError("URL extension: " + urlExt + ", File extension: " + fileExt + ", Should skip: " + shouldSkipBasedOnExt, false);
      
      // Only convert supported mime types and if not in skip list
      if (supportedMimeTypes.includes(mimeType) && !shouldSkipBasedOnExt) {
        try {
          logError("Converting to WebP: " + mimeType + " for link: " + link, false);
          // Convert to WebP using the imported function, passing the formats to skip
          fileData = await convertToWebp(fileData, mimeType, settings.webpQuality, link, formatsToSkip);
          
          // Check if conversion actually occurred by examining the file extension again
          const finalFileExt = await getFileExt(fileData, parsedUrl.pathname);
          if (finalFileExt === 'webp') {
            fileExt = 'webp';
            logError("WebP conversion successful for: " + link, false);
          } else {
            logError("WebP conversion skipped due to format exclusion: " + mimeType, false);
          }
        } catch (error) {
          logError("WebP conversion failed: " + error, false);
          // Continue with original file if conversion fails
        }
      } else {
        logError("Mime type not supported for WebP conversion: " + mimeType, false);
      }
    }
          const { fileName, needWrite } = await chooseFileName(
            app.app.vault.adapter,
            mediaDir,
            link,
            fileData,
            settings,
            noteFile.basename, // Pass the original note name without modification to preserve spaces
            counter, // Using the dynamic counter from imageCounters map
            imgWidth,
            imgHeight
          );
          return {fileName, needWrite};
    });



          if (needWrite && fileName) {
            await app.app.vault.createBinary(fileName, fileData);
            
            // Mark this file as processed to prevent double processing
            if (fileSignature && app.processedFiles) {
              app.processedFiles.add(fileSignature);
              logError(`Added session signature to app.processedFiles: ${fileSignature}`, false);
            }
          }

          if (fileName) {
            
                let shortName = "";
                const rdir = await getRDir(noteFile, settings, fileName, link);
                let pathWiki = rdir[0];
                let pathMd = rdir[1];
                   

          if (settings.addNameOfFile  && protocol == "file:") {

                        if (!app.app.vault.getConfig("useMarkdownLinks")) {

                                 shortName = "\r\n[[" +
                                 fileName +
                                   "\|" +
                                 rdir[2]["lnkurid"]  + "]]\r\n";
                        }
                        else
                          {
                                 shortName = "\r\n[" +
                                 rdir[2]["lnkurid"]  +
                                 "](" +
                                 rdir[2]["pathuri"] +
                                    ")\r\n";
                          }
                }

              if (!app.app.vault.getConfig("useMarkdownLinks")){
                
                // image caption
                (!settings.useCaptions || !caption.length) ? caption="" : caption="\|"+caption;
                
                // image size has higher priority
                (!settings.useCaptions || !imgsize.length) ? caption="" : caption="\|"+imgsize;

                 const replacement = `![[${pathWiki}${caption}]]`;
                 logError(`Wiki link replacement: ${replacement} for original link: ${link}`, false);
                 // Mark this file as processed to prevent double processing
                 if (fileSignature) {
                   app.processedFiles.add(fileSignature);
                 }
                 // URL already added to processedUrls at the beginning of processing
                 return  [match, replacement, `${shortName}`];
              }
              
              else{
                ( !settings.useCaptions || !caption.length ) ? caption="" : caption=" "+caption;
                const replacement = `![${anchor}](${pathMd}${caption})`;
                logError(`Markdown link replacement: ${replacement} for original link: ${link}`, false);
                // Mark this file as processed to prevent double processing
                if (fileSignature) {
                  app.processedFiles.add(fileSignature);
                }
                // URL already added to processedUrls at the beginning of processing
                return [match, replacement, `${shortName}`];
              }



          } else {
            logError("No valid filename generated", false);
            return null;
          }

        } catch (error) {
          if (error.message === "File already exists.") {
          } else {
            throw error;
          }
        }
      
      return null;
    } catch (error) {
      logError("Image processing failed: " + error, false);
      return null;
    }
  }

  return processImageTag;
}


 


export async function getRDir(
                              noteFile: TFile,
                              settings: ISettings,
                              fileName: string,
                              link: string = undefined):
                              Promise<Array<any>>{
    let pathWiki = "";
    let pathMd = "";

    const notePath = normalizePath(noteFile.parent.path);
    const parsedPath = path.parse(normalizePath(fileName));
    
    const parsedPathE = {
        parentd: path.basename(parsedPath["dir"]),
        basen: (parsedPath["name"]+parsedPath["ext"]),
        lnkurid: path.basename(decodeURI(link)),
        pathuri:  encodeURI(normalizePath(fileName))
      };



  switch (settings.pathInTags) {
    case "baseFileName":
      pathWiki = pathMd = parsedPathE["basen"];
      break;
    case "onlyRelative":
      pathWiki =  pathJoin([path.relative(path.sep + notePath, path.sep + parsedPath["dir"]),parsedPathE["basen"]]);
      pathMd = encodeURI(pathWiki);
      break;
    case "fullDirPath":
      pathWiki = fileName.replace(/\\/g, "/");
      pathMd = parsedPathE["pathuri"];
      break;
    default:
      pathWiki = fileName;
      pathMd = parsedPathE["pathuri"];
  };
return [pathWiki, pathMd, parsedPathE];

}


export async function getMDir(app: App,
                              noteFile: TFile,
                              settings: ISettings,
                              defaultdir: boolean = false,
                              unique: string = ""): Promise<string>{


    const notePath = noteFile.parent.path;
    const date = new Date();
    const current_date = moment().format(settings.DateFormat); 
    const obsmediadir = app.vault.getConfig("attachmentFolderPath");
    const mediadir = settings.mediaRootDir;
    var attdir = settings.saveAttE;
    if (defaultdir) { attdir  = ""};
    let root="/";




          switch (attdir) {
            
            case 'inFolderBelow':
               root = mediadir
               .replace("${notename}", noteFile.basename)
               .replace("${unique}", unique)
               .replace("${date}", current_date);
              break;

            case 'nextToNoteS':
               root = (pathJoin([noteFile.parent.path,mediadir]))
               .replace("${notename}", noteFile.basename)
               .replace("${unique}", unique)
               .replace("${date}", current_date);
              break;

            default:
            
            if ( obsmediadir === '/' ){
                  root = obsmediadir;
            }
            else if ( obsmediadir === './' ){
                  root = pathJoin([noteFile.parent.path]);
            }
            else if  ( obsmediadir.match (/\.\/.+/g) !== null ) {
                  root = pathJoin([noteFile.parent.path, obsmediadir.replace('\.\/','')]);
            }
            else{
                  root = normalizePath(obsmediadir);
            }

          }

return trimAny(root,["/","\\"]);


}










async function chooseFileName(
  adapter: DataAdapter,
  dir: string,
  link: string,
  contentData: ArrayBuffer,
  settings: ISettings,
  noteName?: string,
  counter?: number,
  imgWidth?: number,
  imgHeight?: number
): Promise<{ fileName: string; needWrite: boolean }> {
  // Initialize baseName to prevent ReferenceError
  let baseName = "";
  
  logError("chooseFileName - Input parameters:", false);
  logError(`Link: ${link}, NoteName: ${noteName}, Counter: ${counter}`, false);
  
  const parsedUrl = new URL(link);
  const ignoredExt = settings.ignoredExt.split("|");
  let fileExt = await getFileExt(contentData, parsedUrl.pathname);
  
  // Determine if we need to use a target extension (for WebP conversion)
  let targetExt: string | undefined = undefined;
  const protocol = link.slice(0,5);
  
  // If the file has been converted to WebP, use WebP as the target extension
  if (fileExt === "webp" && 
      ((settings.convertWebpForWebImages && protocol !== "file:" && protocol !== "data:") ||
       (settings.convertWebpForPastedImages && protocol === "file:"))) {
    targetExt = "webp";
    logError("Using WebP as target extension for converted image", false);
  } else {
    logError("file: "+link+" content: "+contentData+" file ext: "+fileExt,false);
  }
  

 
  if (fileExt == "unknown" && !settings.downUnknown) {
    return { fileName: "", needWrite: false };
    }
  

  if (ignoredExt.includes(fileExt)) {
    return { fileName: "", needWrite: false };
  }


 
  
  let needWrite = true;
  let fileName = "";
  let suggestedName = "";
  
  // Always use renameImage for consistent naming across pasted and downloaded images
  if (settings.imageRenameRule) {
    // Get the base filename from the link
    const linkBaseName = path.basename(link);
    logError("Using renameImage with: " + linkBaseName + ", rule: " + settings.imageRenameRule + 
             ", noteName: " + noteName + ", counter: " + counter, false);
    
    // Pass the original note name without any transformation to preserve spaces
    const newName = renameImage(linkBaseName, settings.imageRenameRule, noteName, counter, imgWidth, imgHeight, targetExt);
    logError("Generated new name: " + newName, false);
    
    // The renameImage function already includes the extension, so don't append it again
    suggestedName = pathJoin([dir, cleanFileName(newName)]);
  } else if (!settings.useMD5ForNewAtt) {
    // Use a simple counter-based name if no rename rule and not using MD5
    const extensionToUse = targetExt || fileExt;
    suggestedName = pathJoin([dir, cleanFileName(`image-${counter}.${extensionToUse}`)]);
  } else {
    // Fallback to MD5-based naming
    baseName = md5Sig(contentData);
    // Use targetExt if available, otherwise use the original fileExt
    const extensionToUse = targetExt || fileExt;
    suggestedName = pathJoin([dir, cleanFileName(`${baseName}.${extensionToUse}`)]);
  }
  
  // Ensure we have a baseName for MD5 comparison, even when using imageRenameRule
  if (!baseName) {
    baseName = md5Sig(contentData);
    logError(`Computed MD5 signature for content: ${baseName}`, false);
  }
  
  logError(`Generated baseName: ${baseName}, Extension: ${fileExt}`, false);
    if (await adapter.exists(suggestedName, false)) {
      const fileData = await adapter.readBinary(suggestedName);
            const existing_file_md5 = md5Sig(fileData);
            logError(`Checking existing file: ${suggestedName}`, false);
            logError(`Existing MD5: ${existing_file_md5}, Current MD5: ${baseName}`, false);
            if (existing_file_md5 === baseName){
              fileName = suggestedName;
              needWrite = false;
            }
            else{
              // Use targetExt if available, otherwise use the original fileExt
              const extensionToUse = targetExt || fileExt;
              const randomName = Math.random().toString(9).slice(2,);
              fileName = pathJoin([dir, cleanFileName(randomName +`.${extensionToUse}`)]);
              logError(`Generated random filename: ${fileName}`, false);
            }

    } else {
      fileName = suggestedName;
    }

  logError("File name: "+ fileName,false);
  if (!fileName) {
    throw new Error("Failed to generate file name for media file.");
  }

  //linkHashes.ensureHashGenerated(link, contentData);

  return { fileName, needWrite };
}

// Helper function to check if a file should be skipped based on path
// This should be consistent with the skipProcessingForPaths logic in main.ts
export function shouldSkipProcessing(app: Plugin, filePath: string, noteId: string): boolean {
  if (!app.processedFiles) {
    return false;
  }
  
  const fileSignature = md5Sig(filePath + noteId + getSessionId());
  return fileSignature ? app.processedFiles.has(fileSignature) : false;
}

/**
 * Process markdown files on a timer to find and handle image links
 * @param app The plugin instance
 * @param settings Plugin settings
 */
export async function processMdFilesOnTimer(app: Plugin, settings: ISettings): Promise<void> {
  try {
    // Get all markdown files in the vault
    const markdownFiles = app.app.vault.getMarkdownFiles();
    
    for (const file of markdownFiles) {
      try {
        // Clear the processed URLs for this file at the beginning of processing
        clearProcessedUrls(file.path);
        
        // Read the file content
        const content = await app.app.vault.read(file);
        
        // Check if the file contains markdown image links
        const hasImageLinks = MD_SEARCH_PATTERN.test(content);
        
        // Reset the regex lastIndex to ensure it works correctly in subsequent calls
        MD_SEARCH_PATTERN.lastIndex = 0;
        
        if (hasImageLinks) {
          logError(`Found markdown image links in file: ${file.path}`, false);
          
          // If the file contains image links, process it
          // This assumes there's a processPage function defined elsewhere
          // that will be called to process the file
          if (app.processPage) {
            logError(`Processing file with image links: ${file.path}`, false);
            await app.processPage(file, false);
          } else {
            logError(`processPage function not available for file: ${file.path}`, false);
          }
        }
      } catch (error) {
        logError(`Error processing file ${file.path}: ${error}`, false);
      }
    }
  } catch (error) {
    logError(`Error in processMdFilesOnTimer: ${error}`, false);
  }
}

/**
 * Handle a markdown image link by downloading and processing the image
 * @param app The plugin instance
 * @param noteFile The note file containing the image link
 * @param link The image URL
 * @param settings Plugin settings
 * @returns The processed image information or null if processing failed
 */
export async function handleMarkdownImageLink(
  app: Plugin,
  noteFile: TFile,
  link: string,
  settings: ISettings
): Promise<any> {
  try {
    // Skip if not a valid URL
    if (!isUrl(link) || !link.startsWith('http')) {
      logError(`Invalid image URL: ${link}`, false);
      return null;
    }
    
    // Generate a unique signature for this file to prevent double processing
    const noteId = noteFile.path;
    const signatureInput = link + noteId + getSessionId();
    const fileSignature = md5Sig(signatureInput);
    
    // Skip if already processed by the app or in this file
    if ((fileSignature && app.processedFiles && app.processedFiles.has(fileSignature)) || isUrlProcessedForFile(link, noteId)) {
      logError(`Skipping already processed image (session signature or file cache): ${link}`, false);
      // Return original match to avoid corrupting content
      return { originalMatch: true, link };
    }
    
    // Mark the URL as processed for this file at the beginning to prevent duplicate processing
    markUrlAsProcessed(link, noteId);
    
    // Download the image
    logError(`Downloading image from URL: ${link}`, false);
    let fileData: ArrayBuffer | null = null;
    let tryCount = 0;
    
    while (tryCount < settings.tryCount && fileData === null) {
      try {
        fileData = await downloadImage(link);
        if (fileData !== null) {
          logError(`Download successful on attempt: ${tryCount}`, false);
          break;
        }
      } catch (error) {
        logError(`Download attempt ${tryCount} failed: ${error}`, false);
      }
      tryCount++;
    }
    
    if (fileData === null) {
      logError(`Failed to download image after ${settings.tryCount} attempts`, false);
      return null;
    }
    
    // Process the downloaded image
    const mediaDir = await getMDir(app.app, noteFile, settings, false);
    await app.ensureFolderExists(mediaDir);
    
    // Get file extension and prepare for WebP conversion if needed
    const parsedUrl = new URL(link);
    let fileExt = await getFileExt(fileData, parsedUrl.pathname);
    
    // Convert to WebP if enabled for web images
    if (settings.convertWebpForWebImages) {
      const supportedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/bmp'];
      let mimeType = 'image/jpeg'; // Default
      
      if (fileExt === 'png') mimeType = 'image/png';
      else if (fileExt === 'gif') mimeType = 'image/gif';
      else if (fileExt === 'bmp') mimeType = 'image/bmp';
      else if (fileExt === 'jpg' || fileExt === 'jpeg') mimeType = 'image/jpeg';
      
      // Parse the skip conversion formats from settings
      const formatsToSkip = settings.skipWebPConversionFormats
        .split('|')
        .map(ext => ext.trim().toLowerCase())
        .filter(ext => ext.length > 0);
      
      // Extract extension from URL
      const urlExt = link.split('.').pop()?.toLowerCase() || '';
      
      // Check if either detected extension or URL extension is in the skip list
      const shouldSkipBasedOnExt = formatsToSkip.includes(fileExt.toLowerCase()) || 
                                  (urlExt && formatsToSkip.includes(urlExt));
      
      logError(`Formats to skip WebP conversion: ${formatsToSkip.join(', ')}`, false);
      logError(`URL extension: ${urlExt}, File extension: ${fileExt}, Should skip: ${shouldSkipBasedOnExt}`, false);
      
      if (supportedMimeTypes.includes(mimeType) && !shouldSkipBasedOnExt) {
        try {
          logError(`Converting to WebP: ${mimeType} for link: ${link}`, false);
          // Pass the formats to skip to the convertToWebp function
          fileData = await convertToWebp(fileData, mimeType, settings.webpQuality, link, formatsToSkip);
          
          // Check if conversion actually occurred by examining the file extension again
          const finalFileExt = await getFileExt(fileData, parsedUrl.pathname);
          if (finalFileExt === 'webp') {
            fileExt = 'webp';
            logError(`WebP conversion successful for: ${link}`, false);
          } else {
            logError(`WebP conversion skipped due to format exclusion: ${mimeType}`, false);
          }
        } catch (error) {
          logError(`WebP conversion failed: ${error}`, false);
        }
      }
    }
    
    // Get a counter for this note
    if (!app.imageCounters) {
      app.imageCounters = new Map();
    }
    
    if (!app.imageCounters.has(noteId)) {
      app.imageCounters.set(noteId, 0);
    }
    
    const counter = app.getNextCounter ? 
      await app.getNextCounter(noteId) : 
      (app.imageCounters.set(noteId, app.imageCounters.get(noteId) + 1), app.imageCounters.get(noteId));
    
    // Choose a filename for the downloaded image
    const { fileName, needWrite } = await chooseFileName(
      app.app.vault.adapter,
      mediaDir,
      link,
      fileData,
      settings,
      noteFile.basename,
      counter
    );
    
    if (!fileName) {
      logError(`Failed to generate filename for: ${link}`, false);
      return null;
    }
    
    // Save the file if needed
    if (needWrite) {
      await app.app.vault.createBinary(fileName, fileData);
      
      // Mark as processed
      if (fileSignature) {
        if (!app.processedFiles) { app.processedFiles = new Set(); }
        app.processedFiles.add(fileSignature);
        logError(`Added session signature to app.processedFiles from handleMarkdownImageLink: ${fileSignature}`, false);
      }
      
      // URL already added to processedUrls at the beginning of processing
    }
    
    // Return the file information
    const rdir = await getRDir(noteFile, settings, fileName, link);
    
    // URL already added to processedUrls at the beginning of processing
    
    return {
      fileName,
      pathWiki: rdir[0],
      pathMd: rdir[1],
      originalLink: link
    };
  } catch (error) {
    logError(`Error handling markdown image link: ${error}`, false);
    return null;
  }
}
