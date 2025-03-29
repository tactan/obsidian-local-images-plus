import path, { resolve } from "path";
import { fromBuffer } from "file-type";
import isSvg from "is-svg";
import filenamify from "filenamify";
import md5 from "crypto-js/md5";
const fs2 = require('fs').promises;
import fs from "fs";
 
 
 

import {
  FORBIDDEN_SYMBOLS_FILENAME_PATTERN,
  MD_LINK,
  USER_AGENT,
  NOTICE_TIMEOUT,
  APP_TITLE,
  VERBOSE,
  ATT_SIZE_ACHOR
} from "./config";

import {
  requestUrl,
  Notice,
  TFile
} from "obsidian";
 

//import { TIMEOUT } from "dns";
//import fs from "fs";





/*
https://stackoverflow.com/a/48032528/1020973
It will be better to do it type-correct.
*/


export async function showBalloon(str: string, show: boolean = true, timeout = NOTICE_TIMEOUT) {
  if (show) {
    new Notice(APP_TITLE + "\r\n" + str, timeout);
  };
}


export function displayError(error: Error | string, file?: TFile): void {
  if (file) {
    showBalloon(`LocalImagesPlus: Error while handling file ${file.name}, ${error.toString()}`);
  } else {
    showBalloon(error.toString());
  }

  logError(`LocalImagesPlus: error: ${error}`, false);
}

export async function logError(str: any, isObj: boolean = false) {

  if (VERBOSE) {

    console.log(APP_TITLE + ":  ");

    if (isObj) {
      console.table(str);
    }
    else {
      console.log(str);
    }
  }
};

export function md5Sig(contentData: ArrayBuffer | string | null = undefined): string | null {
  if (!contentData) {
    logError("md5Sig: Received null or undefined contentData", false);
    return null;
  }
  try {
    let dataToHash: string;
    if (typeof contentData === 'string') {
      dataToHash = contentData;
    } else if (contentData instanceof ArrayBuffer && contentData.byteLength > 0) {
      const dec = new TextDecoder("utf-8");
      const arrMid = Math.round(contentData.byteLength / 2);
      const chunk = 15000;
      const startChunk = contentData.slice(0, Math.min(chunk, contentData.byteLength));
      const midChunk = contentData.slice(arrMid, Math.min(arrMid + chunk, contentData.byteLength));
      const endChunk = contentData.slice(Math.max(0, contentData.byteLength - chunk));
      dataToHash = [startChunk, midChunk, endChunk]
        .map(x => {
          try { return dec.decode(x); } catch { return ''; }
        })
        .join('');
    } else if (contentData instanceof ArrayBuffer && contentData.byteLength === 0) {
      logError("md5Sig: Received empty ArrayBuffer", false);
      return null;
    } else {
      logError("md5Sig: Received unexpected data type or empty buffer", false);
      return null;
    }
    if (!dataToHash) {
      logError("md5Sig: No data to hash after processing input", false);
      return null;
    }
    const signature = md5(dataToHash).toString();
    return signature + "_MD5";
  } catch (e) {
    logError(`Cannot generate md5: ${e}`, false);
    return null;
  }
}


export async function replaceAsync(str: any, regex: RegExp | Array<RegExp>, asyncFn: any) {
  const regexArray = Array.isArray(regex) ? regex : [regex];
  const data = [];
  let errorflag = false;
  const filesArr = [];

  logError("replaceAsync: \r\nstr: " + str + "\r\nregex: ")
  logError(regexArray, true);

  for (const re of regexArray) {
    logError("cur regex: " + re);
    // Reset lastIndex to ensure we start from the beginning
    if (re instanceof RegExp && re.global) {
      re.lastIndex = 0;
    }
    
    const matches = str.matchAll(re);
    
    for (const match of matches) {
      logError("match: " + match);
      
      try {
        let anchor = "";
        let link = "";
        let caption = "";
        let AttSize = "";
        
        if (match.groups) {
          if (match.groups.anchor) {
            anchor = trimAny(match.groups.anchor, [")", "(", "]", "[", " "]);
            
            // Process attachment size if present
            if (anchor) {
              const AttSizeMatch = anchor.matchAll(ATT_SIZE_ACHOR);
              for (const sizeMatch of AttSizeMatch) {
                AttSize = (sizeMatch.groups.attsize !== undefined) ? 
                  trimAny(sizeMatch.groups.attsize, [")", "(", "]", "[", " "]) : 
                  (sizeMatch.groups.attsize2 !== undefined) ? 
                    trimAny(sizeMatch.groups.attsize2, [")", "(", "]", "[", " "]) : 
                    "";
              }
            }
          }
          
          if (match.groups.link) {
            link = (match.groups.link.match(MD_LINK) ?? [match.groups.link])[0];
            caption = trimAny((match.groups.link.match(MD_LINK) !== null ?
              (match.groups.link.split(link).length > 1 ?
                match.groups.link.split(link)[1] : "") :
              ""), [")", "]", "(", "[", " "]);
            link = trimAny(link, [")", "(", "]", "[", " "]);
          }
        }
        
        const replp = trimAny(match[0], ["[", "(", "]"]);
        
        logError(
          "repl: " + replp +
          "\r\nahc: " + anchor +
          "\r\nlink: " + link +
          "\r\ncaption: " + caption + 
          "\r\nAttSize: " + AttSize
        );
        
        const result = await asyncFn(replp, anchor, link, caption, AttSize);
        data.push(result);
      } catch (error) {
        console.error('Error in replaceAsync:', error);
        logError('Error processing match: ' + error, false);
        data.push(null);
        errorflag = true;
      }
    }
  }

  logError("Processed results: ");
  logError(data, true);

  data.forEach((element) => {
    if (element !== null) {
      if (Array.isArray(element) && element.length >= 3) {
        logError('el: ' + element[0] + '  el2: ' + element[1] + element[2]);
        str = str.replaceAll(element[0], element[1] + element[2]);
        filesArr.push(element[1]);
      } else if (typeof element === 'string') {
        logError("Skipping replacement for string element: " + element);
      } else {
        logError("Skipping replacement for element with unexpected format");
      }
    } else {
      logError("Skipping null element");
      errorflag = true;
    }
  });
  
  return [str, errorflag, filesArr];
}

export function isUrl(link: string) {
  logError("IsUrl: " + link, false);
  try {
    return Boolean(new URL(link));
  } catch (_) {
    return false;
  }
}






export async function copyFromDisk(src: string, dest: string): Promise<null> {
  logError("copyFromDisk: " + src + " to " + dest, false);
  try {
    await fs.copyFile(src, dest, null, (err: Error) => {
      if (err) {
        logError("Error:" + err, false);
      }

    });
  }
  catch (e) {
    logError("Cannot copy: " + e, false);
    return null;
  }
}


 

export async function base64ToBuff(data: string): Promise<ArrayBuffer> {
  logError("base64ToBuff: \r\n", false);
  try {
    const BufferData = Buffer.from(data.split("base64,")[1], 'base64');
    logError(BufferData);
    return BufferData;
  }
  catch (e) {

    logError("Cannot read base64: " + e, false);
    return null;
  }
}

export async function readFromDiskB(file: string, count: number = undefined): Promise<Buffer> {

  try {

    const buffer = Buffer.alloc(count);
    const fd: number = fs.openSync(file, "r+")
    fs.readSync(fd, buffer, 0, buffer.length, 0)
    logError(buffer)
    fs.closeSync(fd)
    return buffer

  } catch (e) {
    logError("Cannot read the file: " + e, false);
    return null
  }



}


export async function readFromDisk(file: string): Promise<ArrayBuffer> {
  logError("readFromDisk: " + file, false);

  try {
    const data = await fs2.readFile(file, null);
    return Buffer.from(data);
  }
  catch (e) {

    logError("Cannot read the file: " + e, false);
    return null;
  }
}

export async function downloadImage(url: string): Promise<ArrayBuffer> {

  logError("Downloading: " + url, false);
  const headers = {
    'method': 'GET',
    'User-Agent': USER_AGENT
  }

  try {
    const res = await requestUrl({ url: url, headers })
    logError(res, true);
    return res.arrayBuffer;
  }
  catch (e) {
    // Log the initial error
    logError("Initial download attempt failed: " + e, false);
    
    // Fallback mechanism: Try again with a Referer header
    try {
      // Extract the origin from the URL to use as Referer
      const origin = new URL(url).origin;
      
      // Create new headers with both User-Agent and Referer
      const fallbackHeaders = {
        'method': 'GET',
        'User-Agent': USER_AGENT,
        'Referer': origin // Add Referer header to bypass anti-leeching protections
      }
      
      logError("Attempting fallback download with Referer: " + origin, false);
      const fallbackRes = await requestUrl({ url: url, headers: fallbackHeaders });
      logError("Fallback download successful", false);
      return fallbackRes.arrayBuffer;
    }
    catch (fallbackError) {
      // If fallback also fails, log the error and return null
      logError("Fallback download also failed: " + fallbackError, false);
      return null;
    }
  }
}

export async function getFileExt(content: ArrayBuffer, link: string) {

  const fileExtByLink = path.extname(link).replace("\.", "");
  const fileExtByBuffer = (await fromBuffer(content))?.ext;

  // if XML, probably it is SVG
  if (fileExtByBuffer == "xml" || !fileExtByBuffer) {
    const buffer = Buffer.from(content);
    if (isSvg(buffer)) return "svg";
  }


  logError("fileExtByBuffer"+fileExtByBuffer)

  if (fileExtByBuffer != undefined && fileExtByBuffer && fileExtByBuffer.length <= 5 && fileExtByBuffer?.length > 0) {
    return fileExtByBuffer;
  }

  logError("fileExtByLink  " +fileExtByLink)
  
  if (fileExtByLink != undefined  && fileExtByLink.length <= 5 && fileExtByLink?.length > 0) {
    return fileExtByLink;
  }

  return "unknown";
}


//https://stackoverflow.com/questions/26156292/trim-specific-character-from-a-string

export function trimAny(str: string, chars: Array<string>) {
  var start = 0,
    end = str.length;

  while (start < end && chars.indexOf(str[start]) >= 0)
    ++start;

  while (end > start && chars.indexOf(str[end - 1]) >= 0)
    --end;

  return (start > 0 || end < str.length) ? str.substring(start, end) : str;
}


export function cFileName(name: string) {
  const cleanedName = name.replace(
    /(\)|\(|\"|\'|\#|\]|\[|\:|\>|\<|\*|\|)/g,
    " "
  );
  return cleanedName;
}

//new filenamify, without forbidden symbols
export function cleanFileName(name: string) {
  // Rely solely on filenamify for filename cleaning
  const cleanedName = filenamify(name);
  return cleanedName;
}

//original filenamify
//export function cleanFileName(name: string) {
//  const cleanedName = filenamify(name).replace(
//    FORBIDDEN_SYMBOLS_FILENAME_PATTERN,
//    "_"
//  );
//  return cleanedName;
//}

export function pathJoin(parts: Array<string>): string {
  const result = path.join(...parts);
  // it seems that obsidian do not understand paths with backslashes in Windows, so turn them into forward slashes
  return result.replace(/\\/g, "/");
}

export function normalizePath(path: string) {
  return path.replace(/\\/g, "/");

}

export function encObsURI(e: string) {
  return e.replace(/[\\\x00\x08\x0B\x0C\x0E-\x1F ]/g, (function (e) {
    return encodeURIComponent(e)
  }
  ))
}




/**
 * https://github.com/mnaoumov/obsidian-dev-utils
 * 
 * Converts a Blob object to a JPEG ArrayBuffer with the specified quality.
 *
 * @param blob - The Blob object to convert.
 * @param jpegQuality - The quality of the JPEG image (0 to 1).
 * @returns A promise that resolves to an ArrayBuffer.
 */
export async function blobToJpegArrayBuffer(blob: Blob, jpegQuality: number): Promise<ArrayBuffer> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = (): void => {
      const image = new Image();
      image.onload = (): void => {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) {
          throw new Error('Could not get 2D context.');
        }
        const imageWidth = image.width;
        const imageHeight = image.height;
        let data = '';

        canvas.width = imageWidth;
        canvas.height = imageHeight;

        context.fillStyle = '#fff';
        context.fillRect(0, 0, imageWidth, imageHeight);
        context.save();

        context.translate(imageWidth / 2, imageHeight / 2);
        context.drawImage(image, 0, 0, imageWidth, imageHeight, -imageWidth / 2, -imageHeight / 2, imageWidth, imageHeight);
        context.restore();

        data = canvas.toDataURL('image/jpeg', jpegQuality);

        const arrayBuffer =  base64ToBuff(data);
        resolve(arrayBuffer);
      };

      image.src = reader.result as string;
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Gets the dimensions (width and height) of an image from ArrayBuffer data.
 * @param imageData ArrayBuffer containing image data (can be any supported image format).
 * @returns A promise resolving to an object with width and height properties, or null if dimensions couldn't be determined.
 * This function is used to extract dimensions for placeholder replacement in image naming patterns.
 */
export async function getImageDimensions(imageData: ArrayBuffer): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve, reject) => {
    try {
      const blob = new Blob([imageData]);
      const imageUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(imageUrl);
        resolve({ width: img.width, height: img.height });
      };
      img.onerror = (error) => {
        URL.revokeObjectURL(imageUrl);
        console.error('Error getting image dimensions:', error);
        resolve(null);
      };
      img.src = imageUrl;
    } catch (e) {
      console.error('Exception in getImageDimensions:', e);
      resolve(null);
    }
  });
}
 
