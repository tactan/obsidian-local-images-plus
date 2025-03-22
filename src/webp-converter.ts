import { Notice } from 'obsidian';

/**
 * Converts a Blob to an ArrayBuffer
 * @param blob - The Blob to convert
 * @returns Promise resolving to an ArrayBuffer
 */
const blobToArrayBuffer = async (blob: Blob): Promise<ArrayBuffer> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(new Error('Failed to convert Blob to ArrayBuffer'));
        reader.readAsArrayBuffer(blob);
    });
};

/**
 * Converts an image to WebP format
 * @param imageData - The original image data as ArrayBuffer
 * @param mimeType - The MIME type of the original image
 * @param quality - The quality of the WebP image (1-100)
 * @returns Promise resolving to the WebP image as ArrayBuffer
 */
export const convertToWebp = async (
    imageData: ArrayBuffer, 
    mimeType: string, 
    quality: number
): Promise<ArrayBuffer> => {
    // Validate input parameters
    if (!imageData || imageData.byteLength === 0) {
        throw new Error('Invalid image data provided');
    }
    
    // Check if the mime type is supported
    const supportedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/bmp'];
    if (!supportedMimeTypes.includes(mimeType)) {
        throw new Error(`Unsupported image format: ${mimeType}. Only JPEG, PNG, GIF, and BMP are supported for WebP conversion.`);
    }
    
    // Clamp quality between 1 and 100
    const webpQuality = Math.max(1, Math.min(100, quality)) / 100;
    
    try {
        // Create a blob URL from the image data
        const blob = new Blob([imageData], { type: mimeType });
        const imageUrl = URL.createObjectURL(blob);
        
        // Create and load the image
        const img = new Image();
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = () => reject(new Error('Failed to load image for WebP conversion'));
            img.src = imageUrl;
        });
        
        // Release the blob URL
        URL.revokeObjectURL(imageUrl);
        
        // Create a canvas with the image dimensions
        let canvas: HTMLCanvasElement | OffscreenCanvas;
        let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
        
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
        if ('convertToBlob' in canvas) {
            // OffscreenCanvas uses convertToBlob
            const webpBlob = await (canvas as OffscreenCanvas).convertToBlob({
                type: 'image/webp',
                quality: webpQuality
            });
            return await blobToArrayBuffer(webpBlob);
        } else {
            // HTMLCanvasElement uses toBlob
            return await new Promise<ArrayBuffer>((resolve, reject) => {
                (canvas as HTMLCanvasElement).toBlob(
                    async (blob) => {
                        if (blob) {
                            try {
                                const buffer = await blobToArrayBuffer(blob);
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
        new Notice('Failed to convert image to WebP format');
        throw error;
    }
};