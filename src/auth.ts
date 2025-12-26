import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";

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
