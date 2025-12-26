import { readFile, writeFile, unlink, mkdir } from "fs/promises";
import { createReadStream, existsSync } from "fs";
import { createHash } from "crypto";
import { join, dirname } from "path";

const STORAGE_DIR = join(import.meta.dir, "..", "storage", "addons");
const ICONS_DIR = join(import.meta.dir, "..", "storage", "icons");
const TEMP_DIR = join(import.meta.dir, "..", "storage", "temp");

// Supported icon formats
const ALLOWED_ICON_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_ICON_SIZE = 2 * 1024 * 1024; // 2MB

/**
 * Sanitize package name for safe filesystem use
 * Removes any characters that could cause path traversal or filesystem issues
 */
function sanitizeForFilesystem(name: string): string {
  // Remove path separators and other dangerous characters
  return name
    .replace(/[/\\:*?"<>|]/g, "_")
    .replace(/\.\./g, "_")
    .replace(/^\.+/, "_")
    .slice(0, 64); // Limit length
}

export interface FileUpload {
  filename: string;
  data: Buffer;
}

/**
 * Calculate SHA-256 hash of a file
 */
export async function calculateFileHash(filePath: string): Promise<string> {
  const fileContent = await readFile(filePath);
  return createHash("sha256").update(fileContent).digest("hex");
}

/**
 * Calculate hash from buffer
 */
export function calculateBufferHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Ensure storage directories exist
 */
export async function initializeStorage(): Promise<void> {
  try {
    if (!existsSync(STORAGE_DIR)) {
      await mkdir(STORAGE_DIR, { recursive: true });
    }
    if (!existsSync(ICONS_DIR)) {
      await mkdir(ICONS_DIR, { recursive: true });
    }
    if (!existsSync(TEMP_DIR)) {
      await mkdir(TEMP_DIR, { recursive: true });
    }
  } catch (err) {
    console.error("Failed to initialize storage:", err);
    throw err;
  }
}

/**
 * Validate that file is a .mcaddon file (ZIP format)
 */
function validateMcaddonFile(fileBuffer: Buffer): boolean {
  // Check for ZIP magic bytes (PK\x03\x04)
  if (fileBuffer.length < 4) {
    return false;
  }

  const magicBytes = fileBuffer.subarray(0, 4);
  return (
    magicBytes[0] === 0x50 &&
    magicBytes[1] === 0x4b &&
    magicBytes[2] === 0x03 &&
    magicBytes[3] === 0x04
  );
}

/**
 * Save add-on file to storage
 */
export async function saveAddon(
  packageId: number,
  packageName: string,
  fileBuffer: Buffer
): Promise<{ filePath: string; fileHash: string }> {
  try {
    // Validate file is a valid .mcaddon (ZIP) file
    if (!validateMcaddonFile(fileBuffer)) {
      throw new Error(
        "Invalid file format. Only .mcaddon files (ZIP format) are supported"
      );
    }

    await initializeStorage();

    // Sanitize package name for filesystem safety
    const safePackageName = sanitizeForFilesystem(packageName);
    
    // Create package directory
    const packageDir = join(STORAGE_DIR, `${packageId}-${safePackageName}`);
    if (!existsSync(packageDir)) {
      await mkdir(packageDir, { recursive: true });
    }

    // Generate filename with timestamp
    const timestamp = Date.now();
    const filename = `addon-${timestamp}.mcaddon`;
    const filePath = join(packageDir, filename);

    // Calculate hash before saving
    const fileHash = calculateBufferHash(fileBuffer);

    // Write file to disk
    await writeFile(filePath, fileBuffer);

    return {
      filePath: join(packageDir, filename),
      fileHash,
    };
  } catch (err) {
    console.error("Failed to save addon file:", err);
    throw err;
  }
}

/**
 * Get add-on file path
 */
export function getAddonPath(packageId: number, packageName: string): string {
  const safePackageName = sanitizeForFilesystem(packageName);
  const packageDir = join(STORAGE_DIR, `${packageId}-${safePackageName}`);
  return packageDir;
}

/**
 * Delete add-on files
 */
export async function deleteAddon(
  packageId: number,
  packageName: string
): Promise<void> {
  try {
    const packageDir = getAddonPath(packageId, packageName);

    if (existsSync(packageDir)) {
      // Delete all files in the directory
      const files = await readDir(packageDir);
      for (const file of files) {
        const filePath = join(packageDir, file);
        await unlink(filePath);
      }

      // Remove directory
      await rmdir(packageDir);
    }
  } catch (err) {
    console.error("Failed to delete addon:", err);
    throw err;
  }
}

/**
 * Get the latest addon file in a package directory
 */
export async function getLatestAddonFile(
  packageId: number,
  packageName: string
): Promise<string | null> {
  try {
    const packageDir = getAddonPath(packageId, packageName);

    if (!existsSync(packageDir)) {
      return null;
    }

    const files = await readDir(packageDir);
    const addonFiles = files.filter((f) => f.endsWith(".mcaddon"));

    if (addonFiles.length === 0) {
      return null;
    }

    // Return the most recent file (last modified)
    addonFiles.sort();
    return join(packageDir, addonFiles[addonFiles.length - 1]);
  } catch (err) {
    console.error("Failed to get latest addon file:", err);
    return null;
  }
}

/**
 * Read directory contents
 */
async function readDir(dirPath: string): Promise<string[]> {
  try {
    const { readdir } = await import("fs/promises");
    return await readdir(dirPath);
  } catch {
    return [];
  }
}

/**
 * Remove directory
 */
async function rmdir(dirPath: string): Promise<void> {
  try {
    const { rm } = await import("fs/promises");
    await rm(dirPath, { recursive: true, force: true });
  } catch (err) {
    console.error("Failed to remove directory:", err);
  }
}

/**
 * Get file stream for downloading
 */
export function getAddonStream(filePath: string) {
  if (!existsSync(filePath)) {
    return null;
  }
  return createReadStream(filePath);
}

/**
 * Validate icon file type by checking magic bytes
 */
function validateIconType(buffer: Buffer): { valid: boolean; mimeType: string | null; extension: string | null } {
  if (buffer.length < 4) {
    return { valid: false, mimeType: null, extension: null };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return { valid: true, mimeType: "image/png", extension: "png" };
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return { valid: true, mimeType: "image/jpeg", extension: "jpg" };
  }

  // WebP: 52 49 46 46 ... 57 45 42 50
  if (buffer.length >= 12 &&
      buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
    return { valid: true, mimeType: "image/webp", extension: "webp" };
  }

  // GIF: 47 49 46 38
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return { valid: true, mimeType: "image/gif", extension: "gif" };
  }

  // SVG: Check for XML/SVG content (text-based)
  const content = buffer.toString("utf8", 0, Math.min(buffer.length, 1024)).trim();
  if (content.startsWith("<?xml") || content.startsWith("<svg") || content.includes("<svg")) {
    return { valid: true, mimeType: "image/svg+xml", extension: "svg" };
  }

  return { valid: false, mimeType: null, extension: null };
}

/**
 * Sanitize SVG content to prevent XSS attacks
 * Removes scripts, event handlers, and dangerous elements
 */
function sanitizeSvg(buffer: Buffer): Buffer {
  let content = buffer.toString("utf8");
  
  // Remove script tags and their content
  content = content.replace(/<script[\s\S]*?<\/script>/gi, "");
  
  // Remove on* event handlers (onclick, onload, onerror, etc.)
  content = content.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, "");
  content = content.replace(/\s+on\w+\s*=\s*[^\s>]+/gi, "");
  
  // Remove javascript: URLs
  content = content.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href=""');
  content = content.replace(/xlink:href\s*=\s*["']javascript:[^"']*["']/gi, 'xlink:href=""');
  
  // Remove data: URLs that could contain scripts (keep safe image data URIs)
  content = content.replace(/href\s*=\s*["']data:(?!image\/)[^"']*["']/gi, 'href=""');
  content = content.replace(/xlink:href\s*=\s*["']data:(?!image\/)[^"']*["']/gi, 'xlink:href=""');
  
  // Remove foreignObject elements (can embed HTML)
  content = content.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "");
  
  // Remove use elements with external references
  content = content.replace(/<use[^>]*xlink:href\s*=\s*["'](?!#)[^"']*["'][^>]*\/?>/gi, "");
  
  // Remove iframe, embed, object elements
  content = content.replace(/<(iframe|embed|object)[\s\S]*?<\/\1>/gi, "");
  content = content.replace(/<(iframe|embed|object)[^>]*\/?>/gi, "");
  
  // Remove set and animate elements that could trigger scripts
  content = content.replace(/<set[^>]*on\w+[^>]*\/?>/gi, "");
  content = content.replace(/<animate[^>]*on\w+[^>]*\/?>/gi, "");
  
  return Buffer.from(content, "utf8");
}

/**
 * Save package icon to storage
 */
export async function saveIcon(
  packageId: number,
  iconBuffer: Buffer
): Promise<{ iconPath: string; iconUrl: string }> {
  try {
    // Validate file size
    if (iconBuffer.length > MAX_ICON_SIZE) {
      throw new Error(`Icon file too large. Maximum size is ${MAX_ICON_SIZE / (1024 * 1024)}MB`);
    }

    // Validate file type
    const typeInfo = validateIconType(iconBuffer);
    if (!typeInfo.valid || !typeInfo.extension) {
      throw new Error("Invalid icon format. Only PNG, JPEG, WebP, GIF, and SVG are supported");
    }

    await initializeStorage();

    // Sanitize SVG files to prevent XSS
    let bufferToSave = iconBuffer;
    if (typeInfo.extension === "svg") {
      bufferToSave = sanitizeSvg(iconBuffer);
    }

    // Generate filename
    const filename = `${packageId}.${typeInfo.extension}`;
    const filePath = join(ICONS_DIR, filename);

    // Delete existing icon if exists (might be different extension)
    await deleteIcon(packageId);

    // Write file to disk
    await writeFile(filePath, bufferToSave);

    return {
      iconPath: filePath,
      iconUrl: `/icons/${filename}`,
    };
  } catch (err) {
    console.error("Failed to save icon:", err);
    throw err;
  }
}

/**
 * Delete package icon
 */
export async function deleteIcon(packageId: number): Promise<void> {
  try {
    const extensions = ["png", "jpg", "webp", "gif", "svg"];
    for (const ext of extensions) {
      const filePath = join(ICONS_DIR, `${packageId}.${ext}`);
      if (existsSync(filePath)) {
        await unlink(filePath);
      }
    }
  } catch (err) {
    console.error("Failed to delete icon:", err);
  }
}

/**
 * Get icon file path for a package
 */
export function getIconPath(packageId: number): string | null {
  const extensions = ["png", "jpg", "webp", "gif", "svg"];
  for (const ext of extensions) {
    const filePath = join(ICONS_DIR, `${packageId}.${ext}`);
    if (existsSync(filePath)) {
      return filePath;
    }
  }
  return null;
}

/**
 * Get icon file for serving
 */
export function getIconFile(filename: string): { file: ReturnType<typeof Bun.file>; mimeType: string } | null {
  // Sanitize filename to prevent path traversal
  const safeFilename = filename.replace(/[/\\:*?"<>|]/g, "_").replace(/\.\./g, "_");
  const filePath = join(ICONS_DIR, safeFilename);
  
  if (!existsSync(filePath)) {
    return null;
  }

  // Determine mime type from extension
  const ext = safeFilename.split(".").pop()?.toLowerCase();
  let mimeType = "application/octet-stream";
  if (ext === "png") mimeType = "image/png";
  else if (ext === "jpg" || ext === "jpeg") mimeType = "image/jpeg";
  else if (ext === "webp") mimeType = "image/webp";
  else if (ext === "gif") mimeType = "image/gif";
  else if (ext === "svg") mimeType = "image/svg+xml";

  return { file: Bun.file(filePath), mimeType };
}
