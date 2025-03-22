# Development Task: Enhance Obsidian Local Images Plus Plugin

**Objective:** Add WebP conversion and image renaming functionalities to the Obsidian Local Images Plus plugin, referencing the Image Converter for ObsidianMD plugin for implementation guidance.

**Current Date:** 2025-03-22

**Plugin Repositories:**
- Local Images Plus: [https://github.com/tactan/obsidian-local-images-plus](https://github.com/tactan/obsidian-local-images-plus)
- Image Converter for ObsidianMD: [https://github.com/xRyul/obsidian-image-converter](https://github.com/xRyul/obsidian-image-converter)

**Base Plugin Code:** Local Images Plus (cloned locally)

**New Features to Implement:**

1.  **WebP Conversion:**
    -   Add options to convert images to WebP format for both web images and pasted images.
    -   Support conversion from common formats (JPG, JPEG, PNG, HEIC, TIF) to WebP.
    -   Implement a quality setting (30-100) for WebP conversion.
    -   Provide two separate options in settings: "Convert Images to WebP (Web Images)" and "Convert Images to WebP (Pasted Images)".
    -   Integrate WebP conversion into both automatic processing and manual command execution.

2.  **Image Renaming:**
    -   Implement image renaming based on a user-defined rule.
    -   Support variables in the renaming rule: `{date:FORMAT}`, `{time:FORMAT}`, `{notename}`, `{counter:00X}`, `{width}`, `{height}`.
    -   Apply renaming during online image saving and pasted image conversion.
    -   Integrate renaming into both automatic processing and manual command execution.

**Implementation Reference:** Image Converter for ObsidianMD plugin (for WebP conversion and renaming logic).

**Task List:**

## Task 1: Setup WebP Conversion Settings

**Description:** Add new settings to the Local Images Plus plugin settings tab to control WebP conversion for web images and pasted images, and to set WebP quality.

**Steps:**

1.  **Modify `src/settings.ts`:**
    -   Add a new interface `LocalImagesPlusSettings` to include:
        -   `convertWebpForWebImages: boolean;` (default: `false`)
        -   `convertWebpForPastedImages: boolean;` (default: `false`)
        -   `webpQuality: number;` (default: `80`)
    -   Update `DEFAULT_SETTINGS` to include default values for these new settings.
    -   In `LocalImagesPlusSettingTab` class, within the `display()` method, add the following settings:
        -   A `Setting` for "Convert Images to WebP (Web Images)" with a `ToggleComponent`.
        -   A `Setting` for "Convert Images to WebP (Pasted Images)" with a `ToggleComponent`.
        -   A `Setting` for "WebP Quality" with a `SliderComponent`, range 30-100, displaying current value, and taking integer steps.

2.  **Verify Settings UI:**
    -   Run Obsidian with the modified plugin.
    -   Open plugin settings for "Local Images Plus".
    -   Verify that the new settings "Convert Images to WebP (Web Images)", "Convert Images to WebP (Pasted Images)", and "WebP Quality" are displayed correctly with their respective UI components (toggles and slider).
    -   Check that the "WebP Quality" slider ranges from 30 to 100 and displays the current value.

**Status:** [ ] Pending / [ ] Completed

**Context Output (after completion):** Output the modified code snippets from `src/settings.ts` showing the added settings to `LocalImagesPlusSettings`, `DEFAULT_SETTINGS`, and `LocalImagesPlusSettingTab.display()`.

---

## Task 2: Implement WebP Conversion Logic

**Description:** Implement the core WebP conversion logic.  This involves adding a function to convert images to WebP format, referencing the Image Converter for ObsidianMD plugin for guidance on image conversion libraries and implementation.

**Steps:**

1.  **Install necessary library:** Determine if a suitable image processing library is needed for WebP conversion.  If so, install it using `npm install` or `yarn add`.  *(Initially assume no external library is needed and investigate built-in browser capabilities or simple libraries first. If needed, research and install a suitable library like 'sharp' or 'jimp' later if browser APIs are insufficient, but prioritize simpler solutions first.)*

2.  **Create `src/webp-converter.ts`:**
    -   Create a new file `src/webp-converter.ts`.
    -   Implement a function `convertToWebp(imageData: ArrayBuffer, mimeType: string, quality: number): Promise<ArrayBuffer>`:
        -   This function should take image data as `ArrayBuffer`, the original `mimeType`, and `quality` (0-100) as input.
        -   It should convert the `imageData` to WebP format with the specified `quality`.
        -   Return the converted WebP image data as `ArrayBuffer`.
        -   Handle different input `mimeType` (JPG, JPEG, PNG, HEIC, TIF).  *(Initially focus on JPG/JPEG and PNG, and add HEIC/TIF later if feasible and necessary)*.
        -   *(Refer to Image Converter for ObsidianMD plugin's code for image conversion implementation details and potential library usage.  Look for functions related to WebP conversion and image format handling.)*
        -   For initial implementation, a basic conversion using browser APIs might be sufficient. Explore ` OffscreenCanvas` and `HTMLCanvasElement.toBlob()` with `image/webp` mime type.

3.  **Test `convertToWebp` function:**
    -   Create a simple test function or use a temporary command in the plugin to test `convertToWebp`.
    -   Read an image file (e.g., a PNG or JPG from the plugin's directory or a test image in the vault) as `ArrayBuffer`.
    -   Call `convertToWebp` with the image data, mime type, and a quality value.
    -   Save the returned `ArrayBuffer` as a WebP file in the vault or plugin directory.
    -   Verify that the saved file is a valid WebP image and that the conversion was successful.

**Status:** [ ] Pending / [ ] Completed

**Context Output (after completion):** Output the code of `src/webp-converter.ts`, including the `convertToWebp` function.  Also, describe the method used for testing and the verification steps taken.

---

## Task 3: Integrate WebP Conversion into Image Processing

**Description:** Integrate the `convertToWebp` function into the existing image processing logic of Local Images Plus. This involves modifying the image downloading and pasting functions to conditionally convert images to WebP based on the plugin settings.

**Steps:**

1.  **Modify `src/main.ts` (or relevant image processing file):**
    -   Locate the function in Local Images Plus that handles downloading and processing web images (e.g., `processAllImagesInCurrentNote`, or similar).
    -   Locate the function that handles processing pasted images (e.g., during `paste` event handling).
    -   In the web image processing function:
        -   After downloading an image and obtaining its `ArrayBuffer` and `mimeType`, check if "Convert Images to WebP (Web Images)" setting is enabled (`this.settings.convertWebpForWebImages`).
        -   If enabled, and if the original image is in a convertible format (JPG, JPEG, PNG, HEIC, TIF), call `convertToWebp` function with the image data, mime type, and `this.settings.webpQuality`.
        -   Replace the original image data with the returned WebP image data and update the `mimeType` to `image/webp`.
    -   In the pasted image processing function:
        -   Similarly, after obtaining pasted image data and `mimeType`, check if "Convert Images to WebP (Pasted Images)" setting is enabled (`this.settings.convertWebpForPastedImages`).
        -   If enabled, and if the original image is in a convertible format, call `convertToWebp` and update image data and `mimeType`.
    -   Ensure that the file extension is updated to `.webp` when saving the converted image locally.

2.  **Update Command Execution:**
    -   Verify that the existing commands (e.g., "Local Images Plus: Process all images in current note") correctly trigger the WebP conversion when the corresponding settings are enabled.
    -   Test manual execution of commands with WebP conversion settings turned on and off to ensure it works as expected.

3.  **Test WebP Conversion Integration:**
    -   Enable "Convert Images to WebP (Web Images)" setting.
    -   Process a note with online images (using command or automatic processing if enabled).
    -   Verify that the downloaded images are saved as WebP format in the local directory.
    -   Check the image links in the note are updated to point to the local WebP images.
    -   Repeat the test with "Convert Images to WebP (Pasted Images)" setting enabled and paste an image into a note. Verify WebP conversion for pasted images.
    -   Test with different image formats (JPG, PNG) to ensure conversion works for supported types.
    -   Test with WebP conversion settings disabled to ensure original image format is preserved when settings are off.

**Status:** [ ] Pending / [ ] Completed

**Context Output (after completion):** Output the modified code snippets from `src/main.ts` (or relevant files) showing how `convertToWebp` is integrated into web image and pasted image processing. Describe the testing scenarios and verification results.

---

## Task 4: Implement Image Renaming Settings and Logic

**Description:** Add settings for image renaming and implement the renaming logic based on the user-defined rule and supported variables.

**Steps:**

1.  **Modify `src/settings.ts`:**
    -   Add a new setting to `LocalImagesPlusSettings` interface:
        -   `imageRenameRule: string;` (default: `{notename}-{counter:001}`)
    -   Update `DEFAULT_SETTINGS` with the default rename rule.
    -   In `LocalImagesPlusSettingTab.display()`, add a `Setting` for "Image Rename Rule" with a `TextAreaComponent` to allow multi-line rule input.  Provide example variables in the setting description (e.g., `{date:YYYYMMDD}`, `{notename}`, `{counter:00X}`).

2.  **Verify Renaming Settings UI:**
    -   Run Obsidian and open plugin settings.
    -   Verify that the "Image Rename Rule" setting is displayed with a text area.
    -   Check the setting description includes example variables.

3.  **Create `src/image-renamer.ts`:**
    -   Create a new file `src/image-renamer.ts`.
    -   Implement a function `renameImage(originalName: string, rule: string, noteName: string, counter: number, width?: number, height?: number): string`:
        -   This function takes the `originalName`, `renameRule`, `noteName`, `counter`, and optional `width`, `height` as input.
        -   Parse the `renameRule` and replace variables with their corresponding values:
            -   `{date:FORMAT}`: Current date formatted using `FORMAT` (e.g., YYYYMMDD, see Moment.js formatting).
            -   `{time:FORMAT}`: Current time formatted using `FORMAT`.
            -   `{notename}`:  The name of the current Obsidian note.
            -   `{counter:00X}`:  Incrementing counter with leading zeros (X is the number of digits).
            -   `{width}`: Image width (if available).
            -   `{height}`: Image height (if available).
        -   Return the new image name based on the rule.
        -   *(Refer to Image Converter for ObsidianMD plugin for implementation details on rule parsing and variable replacement. Look for functions related to image renaming and rule handling.)*
        -   For date/time formatting, use Moment.js library which is available in Obsidian environment.

4.  **Test `renameImage` function:**
    -   Create a simple test function or use a temporary command to test `renameImage`.
    -   Test with different rename rules and variables.
    -   Verify that the function generates correct filenames based on the rules and variables.
    -   Test different date/time formats, counter formats, and note names.

**Status:** [ ] Pending / [ ] Completed

**Context Output (after completion):** Output the code of `src/settings.ts` showing the added `imageRenameRule` setting and UI. Output the code of `src/image-renamer.ts`, including the `renameImage` function. Describe the testing scenarios and verification results for image renaming.

---

## Task 5: Integrate Image Renaming into Image Processing

**Description:** Integrate the image renaming logic into the image saving process in Local Images Plus. Apply renaming when saving both web images and pasted images after (or before) WebP conversion if enabled.

**Steps:**

1.  **Modify `src/main.ts` (or relevant image processing file):**
    -   Locate the image saving logic in the web image processing and pasted image processing functions (identified in Task 3).
    -   Before saving the image locally:
        -   Get the current note name.
        -   Maintain a counter for images within the note (initialize to 1 at the start of processing a note, increment for each image).
        -   Call `renameImage` function with the original filename (without extension), `this.settings.imageRenameRule`, note name, and the current counter value.  Pass `width` and `height` if available (may require fetching image dimensions).
        -   Use the returned new filename when saving the image locally.
        -   Update the image link in the note with the new filename.
        -   *(Consider where to best place the counter logic - possibly within the note processing function to reset for each note.)*

2.  **Update Command Execution:**
    -   Verify that image renaming is applied correctly when using manual commands (e.g., "Local Images Plus: Process all images in current note").

3.  **Test Image Renaming Integration:**
    -   Set an image rename rule in plugin settings (e.g., `{date:YYYYMMDD}-{notename}-{counter:001}`).
    -   Process a note with online images (using command or automatic processing).
    -   Verify that the downloaded images are saved with the renamed filenames according to the rule.
    -   Check that the image links in the note are updated to the renamed local image filenames.
    -   Test with different rename rules and variables to ensure they are correctly applied.
    -   Test with pasted images and verify renaming is also applied.
    -   Test scenarios with and without WebP conversion enabled to ensure renaming works in both cases.

**Status:** [ ] Pending / [ ] Completed

**Context Output (after completion):** Output the modified code snippets from `src/main.ts` (or relevant files) showing how `renameImage` is integrated into web image and pasted image processing and saving. Describe the testing scenarios and verification results for image renaming, including combinations with WebP conversion.

---

## Task 6: Final Testing and Documentation

**Description:** Perform comprehensive final testing of all implemented features and ensure existing functionality remains intact. Update documentation (README) to reflect the new features and settings.

**Steps:**

1.  **Comprehensive Testing:**
    -   Test all combinations of WebP conversion settings (on/off for web and pasted images) and image renaming rules.
    -   Test with various image formats (JPG, PNG, and if implemented, HEIC, TIF).
    -   Test both automatic processing and manual command execution for all features.
    -   Verify that existing functionalities of Local Images Plus (downloading local images, replacing links, PNG to JPEG conversion if it exists) are still working correctly and are not broken by the new changes.
    -   Test edge cases and error handling (e.g., invalid rename rules, unsupported image formats).

2.  **Update README.md:**
    -   Update the plugin's `README.md` file to describe the new WebP conversion and image renaming features.
    -   Document the new settings: "Convert Images to WebP (Web Images)", "Convert Images to WebP (Pasted Images)", "WebP Quality", and "Image Rename Rule".
    -   Explain the supported variables for image renaming rules with examples.
    -   Update command descriptions if necessary to reflect the new functionalities.
    -   Ensure the documentation is clear, concise, and accurate.

3.  **Code Review and Cleanup:**
    -   Review all modified and newly added code for clarity, efficiency, and adherence to coding standards.
    -   Add comments to the code where necessary to explain complex logic or important sections.
    -   Remove any debugging code or temporary test code.

**Status:** [ ] Pending / [ ] Completed

**Context Output (after completion):** Confirm that all tests passed and existing functionality is preserved. Output the updated `README.md` content or a summary of changes made to it.  Indicate that code review and cleanup are complete.

---

**Completion:** Once all tasks are marked as completed and verified, the development task is considered finished.
