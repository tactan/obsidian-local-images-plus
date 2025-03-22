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
    
    // Remove the extension from the rule if it exists
    let baseRule = rule;
    if (baseRule.includes('.')) {
        baseRule = baseRule.substring(0, baseRule.lastIndexOf('.'));
    }
    
    let result = baseRule;
    
    // Replace {date:FORMAT} placeholders
    result = result.replace(/{date:([^}]+)}/g, (match, format) => {
        return moment().format(format);
    });
    
    // Replace {time:FORMAT} placeholders
    result = result.replace(/{time:([^}]+)}/g, (match, format) => {
        return moment().format(format);
    });
    
    // Replace {notename} placeholder
    result = result.replace(/{notename}/g, noteName);
    
    // Replace {counter:FORMAT} placeholders
    result = result.replace(/{counter:([^}]+)}/g, (match, format) => {
        // Determine padding from format (e.g., "001" means pad to 3 digits)
        const paddingMatch = format.match(/^(0+)/);
        if (paddingMatch) {
            const padding = paddingMatch[0].length;
            return counter.toString().padStart(padding, '0');
        }
        return counter.toString();
    });
    
    // Replace {width} placeholder if width is provided
    if (width !== undefined) {
        result = result.replace(/{width}/g, width.toString());
    }
    
    // Replace {height} placeholder if height is provided
    if (height !== undefined) {
        result = result.replace(/{height}/g, height.toString());
    }
    
    // Add the original extension back
    return result + extension;
}
