import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import speakeasy from "speakeasy";
import QRCode from "qrcode";

let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  // Allow a dummy secret in test environment
  if (process.env.NODE_ENV === 'test') {
    console.warn('WARNING: Using dummy JWT_SECRET for testing. Set JWT_SECRET environment variable for production.');
    JWT_SECRET = 'test-secret-key-for-testing-purposes-only';
  } else {
    throw new Error("FATAL: JWT_SECRET environment variable is required. Set it before starting the server.");
  }
}

// Check for dev mode flag or test environment
export const DEV_MODE = process.argv.includes("--dev") || process.env.NODE_ENV === "test";

// Cloudflare Turnstile configuration
const envKey = process.env.TURNSTILE_SECRET_KEY;
if (!DEV_MODE && !envKey) {
  throw new Error("FATAL: TURNSTILE_SECRET_KEY environment variable is required when not in dev mode.");
}
const TURNSTILE_SECRET_KEY = DEV_MODE ? "dev-mode-dummy-secret" : envKey!;
const JWT_EXPIRATION = 7 * 24 * 60 * 60; // 7 days in seconds

export interface JWTPayload {
  id: number;
  username: string;
  email: string;
  role: string;
}

/**
 * Validates password strength
 * Requirements: minimum 8 chars, at least 1 number, at least 1 special character
 */
export function validatePassword(password: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push("Password must be at least 8 characters");
  }

  if (!/\d/.test(password)) {
    errors.push("Password must contain at least one number");
  }

  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push("Password must contain at least one special character");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Hashes a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  const saltRounds = 10;
  return await bcrypt.hash(password, saltRounds);
}

/**
 * Compares plain password with hashed password
 */
export async function comparePassword(
  password: string,
  hash: string
): Promise<boolean> {
  return await bcrypt.compare(password, hash);
}

/**
 * Generates a JWT token
 */
export function generateToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRATION,
  });
}

/**
 * Verifies and decodes a JWT token
 */
export function verifyToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Extracts token from Authorization header
 */
export function extractToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return null;
  }

  return parts[1];
}

/**
 * Verifies Cloudflare Turnstile token
 * @param token - The Turnstile response token from the client
 * @param remoteIp - Optional client IP address for additional validation
 * @returns Object with success status and optional error message
 */
export async function verifyTurnstile(
  token: string | undefined,
  remoteIp?: string
): Promise<{ success: boolean; error?: string }> {
  // Skip CAPTCHA verification in dev mode
  if (DEV_MODE) {
    return { success: true };
  }

  // If no token provided, skip verification (for clients without Turnstile widget)
  if (!token) {
    return { success: true };
  }

  try {
    const formData = new URLSearchParams({
      secret: TURNSTILE_SECRET_KEY,
      response: token,
    });

    if (remoteIp) {
      formData.append("remoteip", remoteIp);
    }

    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });

    const data = await response.json() as {
      success: boolean;
      "error-codes"?: string[];
      challenge_ts?: string;
      hostname?: string;
    };

    if (!data.success) {
      const errorCodes = data["error-codes"] || [];
      console.error("Turnstile verification failed:", errorCodes);
      return { success: false, error: "CAPTCHA verification failed" };
    }

    return { success: true };
  } catch (err) {
    console.error("Turnstile verification error:", err);
    return { success: false, error: "CAPTCHA verification service error" };
  }
}

/**
 * Generates a 2FA secret for TOTP setup
 * @param username - User's username for labeling
 * @returns Object containing secret and QR code data URL
 */
export async function generate2FASecret(username: string): Promise<{
  secret: string;
  qrCodeUrl: string;
}> {
  const secret = speakeasy.generateSecret({
    name: `BedPak (${username})`,
    issuer: "BedPak",
    length: 32,
  });

  // Generate QR code as data URL with dark theme colors
  // Dark mode: #0f0f0f (dark), #d0d0d0 (light)
  let qrCodeUrl = "";
  if (secret.otpauth_url) {
    qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url, {
      color: {
        dark: "#c4a574", // Gold accent color (modules)
        light: "#0f0f0f", // Dark background
      },
    });
  }

  return {
    secret: secret.base32,
    qrCodeUrl,
  };
}

/**
 * Verifies a TOTP token against a secret
 * @param token - 6-digit TOTP code from authenticator app
 * @param secret - Base32 encoded secret
 * @returns True if token is valid
 */
export function verify2FAToken(token: string, secret: string): boolean {
  return speakeasy.totp.verify({
    secret: secret,
    encoding: "base32",
    token: token,
    window: 2, // Allow 2 steps of variance
  });
}

/**
 * Generates backup codes for account recovery
 * @returns Array of 10 backup codes
 */
export function generateBackupCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < 10; i++) {
    // Generate 8-character codes like: ABC12DEF
    const code = Math.random()
      .toString(36)
      .substring(2, 10)
      .toUpperCase();
    codes.push(code);
  }
  return codes;
}

/**
 * Hashes backup codes for storage (one-way)
 * @param codes - Array of backup codes
 * @returns JSON string of hashed codes
 */
export async function hashBackupCodes(codes: string[]): Promise<string> {
  const hashedCodes = await Promise.all(
    codes.map(code => bcrypt.hash(code, 5))
  );
  return JSON.stringify(hashedCodes);
}

/**
 * Verifies a backup code against hashed codes
 * @param code - Backup code to verify
 * @param hashedCodesJson - JSON string of hashed codes
 * @returns Object with isValid and remainingCodes
 */
export async function verifyBackupCode(
  code: string,
  hashedCodesJson: string
): Promise<{ isValid: boolean; remainingCodes?: string[] }> {
  try {
    const hashedCodes = JSON.parse(hashedCodesJson) as string[];
    for (let i = 0; i < hashedCodes.length; i++) {
      const match = await bcrypt.compare(code, hashedCodes[i]);
      if (match) {
        // Remove the used code and rehash
        hashedCodes.splice(i, 1);
        const newHashedCodes = await Promise.all(
          hashedCodes.map(c => bcrypt.hash(c, 5))
        );
        return {
          isValid: true,
          remainingCodes: newHashedCodes,
        };
      }
    }
    return { isValid: false };
  } catch {
    return { isValid: false };
  }
}
