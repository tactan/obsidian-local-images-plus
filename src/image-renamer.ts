import moment from 'moment';

/**
 * Renames an image file based on a specified rule pattern
 * 
 * @param originalName - The original filename of the image
 * @param rule - The renaming rule with placeholders
 * @param noteName - The name of the note the image belongs to
 * @param counter - A counter value for sequential numbering
 * @param width - Optional width of the image
 * @param height - Optional height of the image
 * @param targetExtension - Optional extension to override the original (fixes double extension issues when converting formats)
 * @returns The new filename based on the rule
 */
export function renameImage(
    originalName: string, 
    rule: string, 
    noteName: string, 
    counter: number, 
    width?: number, 
    height?: number,
    targetExtension?: string
): string {
    // Extract the file extension from the original name or use the target extension if provided
    const extensionMatch = originalName.match(/\.([^.]+)$/);
    const extension = targetExtension ? `.${targetExtension}` : (extensionMatch ? extensionMatch[0] : '');
    
    // Extract the filename without extension for the {filename} placeholder
    const filenameWithoutExt = originalName.replace(/\.[^.]+$/, '');
    
    // Remove the extension from the rule if it exists
    let baseRule = rule;
    if (baseRule.includes('.')) {
        baseRule = baseRule.substring(0, baseRule.lastIndexOf('.'));
    }
    
    let result = baseRule;
    
    // Replace {date:FORMAT} placeholders
    result = result.replace(/{date:([^}]+)}/g, (match, format) => {
        try {
            // Use moment to format the current date using the provided format string
            // Format is passed directly to moment without modification to preserve special characters
            const formattedDate = moment().format(format);
            
            // Check if moment returned 'Invalid date' which can happen with certain format strings
            if (formattedDate === 'Invalid date') {
                throw new Error('Moment returned Invalid date');
            }
            
            return formattedDate;
        } catch (error: any) {
            // Enhanced error logging with detailed message to help diagnose format issues
            console.error(`Error formatting date with format '${format}': ${error.message || error}`);
            console.error('Using fallback date format YYYYMMDD instead');
            
            // Fallback to a safe format that doesn't use special characters
            // YYYYMMDD is used as it's filesystem-safe across platforms
            return moment().format('YYYYMMDD');
        }
    });
    
    // Replace {time:FORMAT} placeholders
    result = result.replace(/{time:([^}]+)}/g, (match, format) => {
        try {
            // Use moment to format the current time using the provided format string
            // Format string is passed directly to preserve any special characters
            const formattedTime = moment().format(format);
            
            // Validate the result to catch silent failures
            if (formattedTime === 'Invalid date') {
                throw new Error('Moment returned Invalid date');
            }
            
            return formattedTime;
        } catch (error: any) {
            // Enhanced error logging with explicit error type and detailed message
            console.error(`Error formatting time with format '${format}': ${error.message || error}`);
            console.error('Using fallback time format HHmmss instead');
            
            // Fallback to a filesystem-safe format without special characters
            // HHmmss is used as it's compatible with all operating systems
            return moment().format('HHmmss');
        }
    });
    
    // Replace {notename} placeholder
    // Note: noteName is used as-is without modification, preserving any spaces
    // This ensures consistency between online and pasted images
    result = result.replace(/{notename}/g, noteName);
    
    // Replace {filename} placeholder with the original filename (without extension)
    result = result.replace(/{filename}/g, filenameWithoutExt);
    
    // Replace {counter:FORMAT} placeholders
    result = result.replace(/{counter:([^}]+)}/g, (match, format) => {
        try {
            // Use the length of the format string as the padding length if format consists solely of digits
            if (/^[0-9]+$/.test(format)) {
                const padding = format.length;
                return counter.toString().padStart(padding, '0');
            } else {
                console.warn(`Unrecognized counter format '${format}', using default formatting`);
                return counter.toString();
            }
        } catch (error: any) {
            // Enhanced error logging with explicit error type and detailed message
            console.error(`Error formatting counter with format '${format}': ${error.message || error}`);
            return counter.toString();
        }
    });
    
    // Note: If you continue to experience issues with date/time formats containing special characters,
    // consider validating format strings before passing them to moment.js or escaping special characters
    // by wrapping them in square brackets, e.g., 'YYYY-MM-DD [at] HH:mm:ss'
    
    // Replace {width} placeholder if width is provided
    if (width !== undefined) {
        result = result.replace(/{width}/g, width.toString());
    }
    
    // Replace {height} placeholder if height is provided
    if (height !== undefined) {
        result = result.replace(/{height}/g, height.toString());
    }
    
    // Add the extension (prioritizing targetExtension if provided)
    return result + extension;
}
