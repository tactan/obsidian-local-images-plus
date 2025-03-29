import { Notice } from 'obsidian';

/**
 * Set to track URLs that have already been converted to WebP
 * This prevents duplicate processing of the same image URL
 */
const convertedUrls = new Set<string>();

/**
 * Clears the cache of converted URLs
 * Call this when starting to process a new file
 */
export const clearConvertedUrlsCache = (): void => {
    convertedUrls.clear();
    console.log('WebP converter: URL cache cleared');
};

/**
 * Converts a Blob to an ArrayBuffer
 * @param blob - The Blob to convert
 * @returns Promise resolving to an ArrayBuffer
 * @throws Error if the conversion fails
 */
const blobToArrayBuffer = async (blob: Blob): Promise<ArrayBuffer> => {
    if (!blob || blob.size === 0) {
        throw new Error('Invalid or empty Blob provided');
    }
    
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = (error) => reject(new Error(`Failed to convert Blob to ArrayBuffer: ${error}`));
        reader.readAsArrayBuffer(blob);
    });
};

/**
 * Converts an image to WebP format
 * @param imageData - The original image data as ArrayBuffer
 * @param mimeType - The MIME type of the original image
 * @param quality - The quality of the WebP image (1-100)
 * @returns Promise resolving to the WebP image as ArrayBuffer
 * @throws Error if conversion fails, image data is invalid, or mime type is unsupported
 */
export const convertToWebp = async (
    imageData: ArrayBuffer, 
    mimeType: string, 
    quality: number,
    sourceUrl?: string,
    skipFormats: string[] = []
): Promise<ArrayBuffer> => {
    // Check if this URL has already been processed
    if (sourceUrl && convertedUrls.has(sourceUrl)) {
        console.log(`WebP conversion skipped: URL already processed: ${sourceUrl}`);
        return imageData; // Return original data without converting
    }
    
    // Check if the mime type is in the skip formats list
    const normalizedSkipFormats = skipFormats.map(format => format.toLowerCase().trim());
    if (normalizedSkipFormats.includes(mimeType.toLowerCase())) {
        console.log(`WebP conversion skipped: MIME type ${mimeType} is in the skip formats list`);
        return imageData; // Return original data without converting
    }
    
    // Extract the simple MIME format and check if it's in the skip list
    const simpleMimeFormat = mimeType.split('/').pop()?.toLowerCase();
    if (simpleMimeFormat && normalizedSkipFormats.includes(simpleMimeFormat)) {
        console.log(`WebP conversion skipped internally: Format ${simpleMimeFormat} is in the skip list [${normalizedSkipFormats.join(', ')}]`);
        return imageData; // Return original data without converting
    }
    // Validate input parameters
    if (!imageData || imageData.byteLength === 0) {
        throw new Error('Invalid or empty image data provided. Cannot convert to WebP.');
    }
    
    // Normalize and validate mime type
    let normalizedMimeType = mimeType;
    if (!normalizedMimeType || typeof normalizedMimeType !== 'string' || normalizedMimeType.trim() === '') {
        console.log('Invalid MIME type provided, using default (image/png)');
        normalizedMimeType = 'image/png';
    } else {
        normalizedMimeType = normalizedMimeType.toLowerCase();
    }
    
    // Check if the mime type is supported
    // AVIF format is now supported based on the browser's ability to process AVIF images via canvas
    const supportedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/bmp', 'image/avif'];
    if (!supportedMimeTypes.includes(normalizedMimeType)) {
        throw new Error(`Unsupported image format: ${normalizedMimeType}. Only JPEG, PNG, GIF, BMP, and AVIF are supported for WebP conversion.`);
    }
    
    // Check if the mime type is in the skip formats list using the normalized mime type
    // This is a second check using the normalized mime type
    if (normalizedSkipFormats.some(format => normalizedMimeType.includes(format))) {
        console.log(`WebP conversion skipped: Normalized MIME type ${normalizedMimeType} matches a format in the skip list`);
        return imageData; // Return original data without converting
    }
    
    // Normalize quality parameter
    let normalizedQuality = 80; // Default quality of 80
    if (typeof quality === 'number' && !isNaN(quality)) {
        normalizedQuality = Math.max(1, Math.min(100, quality));
    } else {
        console.log('Invalid quality parameter provided, using default quality (80)');
    }
    
    // Clamp quality between 0 and 1 for the actual conversion
    const webpQuality = normalizedQuality / 100;
    
    // Log conversion attempt details
    console.log(`WebP conversion started:
    - MIME type: ${normalizedMimeType}
    - Image data size: ${imageData.byteLength} bytes
    - Target quality: ${normalizedQuality}%
    - WebP quality factor: ${webpQuality.toFixed(2)}
    - Conversion timestamp: ${new Date().toISOString()}`);
    
    try {
        console.log('Creating blob and image for WebP conversion...');
        // Create a blob URL from the image data
        const blob = new Blob([imageData], { type: normalizedMimeType });
        const imageUrl = URL.createObjectURL(blob);
        
        // Create and load the image
        const img = new Image();
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = () => reject(new Error(`Failed to load image for WebP conversion. MIME type: ${normalizedMimeType}, Size: ${imageData.byteLength} bytes`));
            img.src = imageUrl;
        });
        
        // Release the blob URL to prevent memory leaks
        URL.revokeObjectURL(imageUrl);
        
        // Create a canvas with the image dimensions
        let canvas: HTMLCanvasElement | OffscreenCanvas;
        let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
        
        console.log(`Creating canvas for WebP conversion:
    - Image dimensions: ${img.width}x${img.height}
    - Aspect ratio: ${(img.width/img.height).toFixed(2)}
    - Estimated memory usage: ~${Math.round((img.width * img.height * 4) / 1024)} KB`);
        
        // Try to use OffscreenCanvas if available (better performance)
        if (typeof OffscreenCanvas !== 'undefined') {
            canvas = new OffscreenCanvas(img.width, img.height);
            ctx = canvas.getContext('2d');
        } else {
            // Fallback to regular HTMLCanvasElement
            canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            ctx = canvas.getContext('2d');
        }
        
        if (!ctx) {
            throw new Error('Failed to create canvas context for WebP conversion');
        }
        
        // Draw the image on the canvas
        ctx.drawImage(img, 0, 0);
        
        // Convert to WebP
        console.log(`Converting to WebP using ${('convertToBlob' in canvas) ? 'OffscreenCanvas' : 'HTMLCanvasElement'} with quality ${webpQuality.toFixed(2)}`);
        
        if ('convertToBlob' in canvas) {
            // OffscreenCanvas uses convertToBlob
            const webpBlob = await (canvas as OffscreenCanvas).convertToBlob({
                type: 'image/webp',
                quality: webpQuality
            });
            const result = await blobToArrayBuffer(webpBlob);
            const compressionRatio = imageData.byteLength > 0 ? (result.byteLength / imageData.byteLength * 100).toFixed(1) : 'N/A';
            const savings = imageData.byteLength > result.byteLength ? 
                ((imageData.byteLength - result.byteLength) / 1024).toFixed(1) + ' KB saved' : 
                'No size reduction';
            console.log(`WebP conversion successful:
    - Result size: ${result.byteLength} bytes (${compressionRatio}% of original)
    - ${savings}
    - Conversion method: OffscreenCanvas`);
            
            // Add URL to the set of processed URLs if provided
            if (sourceUrl) {
                convertedUrls.add(sourceUrl);
                console.log(`Added to WebP conversion cache: ${sourceUrl}`);
            }
            
            return result;
        } else {
            // HTMLCanvasElement uses toBlob
            return await new Promise<ArrayBuffer>((resolve, reject) => {
                (canvas as HTMLCanvasElement).toBlob(
                    async (blob) => {
                        if (blob) {
                            try {
                                const buffer = await blobToArrayBuffer(blob);
                                const compressionRatio = imageData.byteLength > 0 ? (buffer.byteLength / imageData.byteLength * 100).toFixed(1) : 'N/A';
                                const savings = imageData.byteLength > buffer.byteLength ? 
                                    ((imageData.byteLength - buffer.byteLength) / 1024).toFixed(1) + ' KB saved' : 
                                    'No size reduction';
                                console.log(`WebP conversion successful:
    - Result size: ${buffer.byteLength} bytes (${compressionRatio}% of original)
    - ${savings}
    - Conversion method: HTMLCanvasElement`);
                                
                                // Add URL to the set of processed URLs if provided
                                if (sourceUrl) {
                                    convertedUrls.add(sourceUrl);
                                    console.log(`Added to WebP conversion cache: ${sourceUrl}`);
                                }
                                
                                resolve(buffer);
                            } catch (error) {
                                reject(error);
                            }
                        } else {
                            reject(new Error('Canvas toBlob returned null'));
                        }
                    },
                    'image/webp',
                    webpQuality
                );
            });
        }
    } catch (error) {
        console.error('WebP conversion failed:', error);
        new Notice('Failed to convert image to WebP format. Check console for details.');
        
        // Enhance error message with more context
        const errorDetails = {
            mimeType: normalizedMimeType,
            imageSize: imageData?.byteLength || 'unknown',
            quality: normalizedQuality,
            errorType: error instanceof Error ? error.constructor.name : typeof error,
            timestamp: new Date().toISOString(),
            browserInfo: navigator.userAgent
        };
        
        console.error('WebP conversion error details:', errorDetails);
        
        const errorMessage = error instanceof Error 
            ? `WebP conversion failed: ${error.message} (MIME: ${normalizedMimeType}, Size: ${errorDetails.imageSize} bytes, Quality: ${normalizedQuality})` 
            : `WebP conversion failed with unknown error (MIME: ${normalizedMimeType}, Size: ${errorDetails.imageSize} bytes, Quality: ${normalizedQuality})`;
            
        throw new Error(errorMessage);
    }
};
