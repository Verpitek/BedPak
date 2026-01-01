import { Elysia } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import { cors } from "@elysiajs/cors";
import { basename } from "path";
import { DB } from "./db_controller";
import {
  validatePassword,
  hashPassword,
  comparePassword,
  generateToken,
  verifyToken,
  extractToken,
  verifyTurnstile,
  generate2FASecret,
  verify2FAToken,
  generateBackupCodes,
  hashBackupCodes,
  verifyBackupCode,
  DEV_MODE,
} from "./auth";
import {
  saveAddon,
  deleteAddon,
  getLatestAddonFile,
  calculateFileHash,
  getAddonStream,
  initializeStorage,
  saveIcon,
  deleteIcon,
  getIconFile,
} from "./storage";

const database = new DB();

// Constants
const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB max file size
const USERNAME_REGEX = /^[a-zA-Z0-9_-]{3,32}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PACKAGE_NAME_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
const VERSION_REGEX = /^\d+\.\d+\.\d+$/;

// Rate limiting configuration
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute window
const RATE_LIMIT_MAX_REQUESTS = 600; // Max requests per window for general endpoints
const LOGIN_RATE_LIMIT_MAX = 5; // Max login attempts per window
const LOGIN_RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minute window for login

// Rate limiting storage (in-memory, consider Redis for production clusters)
interface RateLimitEntry {
  count: number;
  resetTime: number;
}
const rateLimitStore = new Map<string, RateLimitEntry>();
const loginRateLimitStore = new Map<string, RateLimitEntry>();

// Rate limiting helper
function checkRateLimit(
  store: Map<string, RateLimitEntry>,
  key: string,
  maxRequests: number,
  windowMs: number,
): { allowed: boolean; remaining: number; resetTime: number } {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetTime) {
    // Create new entry
    const resetTime = now + windowMs;
    store.set(key, { count: 1, resetTime });
    return { allowed: true, remaining: maxRequests - 1, resetTime };
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetTime: entry.resetTime };
  }

  entry.count++;
  return {
    allowed: true,
    remaining: maxRequests - entry.count,
    resetTime: entry.resetTime,
  };
}

// Get client IP from request
function getClientIP(
  headers: Record<string, string | undefined>,
  server: { requestIP?: (req: Request) => { address: string } | null } | null,
  request: Request,
): string {
  // Check X-Forwarded-For header (for reverse proxies)
  const forwarded = headers["x-forwarded-for"];
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  // Check X-Real-IP header
  const realIP = headers["x-real-ip"];
  if (realIP) {
    return realIP;
  }
  // Fall back to direct connection IP
  if (server?.requestIP) {
    const ip = server.requestIP(request);
    if (ip) return ip.address;
  }
  return "unknown";
}

// Clean up expired rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (now > entry.resetTime) {
      rateLimitStore.delete(key);
    }
  }
  for (const [key, entry] of loginRateLimitStore) {
    if (now > entry.resetTime) {
      loginRateLimitStore.delete(key);
    }
  }
}, 60 * 1000); // Clean up every minute

// Input validation helpers
function validateUsername(username: string): {
  valid: boolean;
  error?: string;
} {
  if (!username || username.length < 3) {
    return { valid: false, error: "Username must be at least 3 characters" };
  }
  if (username.length > 32) {
    return { valid: false, error: "Username must be at most 32 characters" };
  }
  if (!USERNAME_REGEX.test(username)) {
    return {
      valid: false,
      error:
        "Username can only contain letters, numbers, underscores, and hyphens",
    };
  }
  return { valid: true };
}

function validateEmail(email: string): { valid: boolean; error?: string } {
  if (!email) {
    return { valid: false, error: "Email is required" };
  }
  if (!EMAIL_REGEX.test(email)) {
    return { valid: false, error: "Invalid email format" };
  }
  if (email.length > 255) {
    return { valid: false, error: "Email is too long" };
  }
  return { valid: true };
}

function validatePackageName(name: string): { valid: boolean; error?: string } {
  if (!name || name.length < 1) {
    return { valid: false, error: "Package name is required" };
  }
  if (name.length > 64) {
    return {
      valid: false,
      error: "Package name must be at most 64 characters",
    };
  }
  if (!PACKAGE_NAME_REGEX.test(name)) {
    return {
      valid: false,
      error:
        "Package name can only contain letters, numbers, underscores, and hyphens",
    };
  }
  return { valid: true };
}

function validateVersion(version: string): { valid: boolean; error?: string } {
  if (!version) {
    return { valid: true }; // Version is optional, defaults to 1.0.0
  }
  if (!VERSION_REGEX.test(version)) {
    return {
      valid: false,
      error: "Version must be in format X.Y.Z (e.g., 1.0.0)",
    };
  }
  return { valid: true };
}

// Sanitize filename for Content-Disposition header
function sanitizeFilename(filename: string): string {
  // Remove any characters that could cause header injection
  return filename.replace(/["\r\n\\]/g, "_").replace(/[^\x20-\x7E]/g, "_");
}

// Escape HTML entities to prevent XSS in dynamic meta tags
function escapeHtml(text: string): string {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Initialize database and storage on startup
await database.initDB();
await initializeStorage();

// Security headers middleware
const securityHeaders = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

// Request logging helper
function logRequest(
  method: string,
  path: string,
  status: number,
  duration: number,
  ip: string,
): void {
  const timestamp = new Date().toISOString();
  console.log(
    `[${timestamp}] ${method} ${path} ${status} ${duration}ms - ${ip}`,
  );
}

const app = new Elysia()
  // CORS configuration
  .use(
    cors({
      origin: process.env.CORS_ORIGINS?.split(",") || true, // Allow all origins by default, or specify via env
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      credentials: true,
    }),
  )
  .use(
    staticPlugin({
      assets: "public", // The physical folder in your project
      prefix: "", // This removes the need to put '/public' in your HTML tags
    }),
  )
  // Request logging and security headers middleware
  .onRequest(({ request, set }) => {
    // Store request start time for logging
    (request as Request & { startTime: number }).startTime = Date.now();
  })
  .onAfterHandle(({ request, set, server }) => {
    // Add security headers to all responses
    Object.entries(securityHeaders).forEach(([header, value]) => {
      set.headers[header] = value;
    });

     // Log request
     const startTime =
       (request as Request & { startTime?: number }).startTime || Date.now();
     const duration = Date.now() - startTime;
     const ip = getClientIP(
       request.headers as unknown as Record<string, string | undefined>,
       server,
       request,
     );
     const url = new URL(request.url);
     const status = typeof set.status === "number" ? set.status : 200;
     logRequest(request.method, url.pathname, status, duration, ip);
  })
  // Global rate limiting middleware
  .onBeforeHandle(({ request, set, server }) => {
    const ip = getClientIP(
      request.headers as unknown as Record<string, string | undefined>,
      server,
      request,
    );
    const url = new URL(request.url);

    // Skip rate limiting for static files and health check
    if (url.pathname.startsWith("/public/") || url.pathname === "/health") {
      return;
    }

    const rateLimit = checkRateLimit(
      rateLimitStore,
      ip,
      RATE_LIMIT_MAX_REQUESTS,
      RATE_LIMIT_WINDOW,
    );

    // Set rate limit headers
    set.headers["X-RateLimit-Limit"] = String(RATE_LIMIT_MAX_REQUESTS);
    set.headers["X-RateLimit-Remaining"] = String(rateLimit.remaining);
    set.headers["X-RateLimit-Reset"] = String(
      Math.ceil(rateLimit.resetTime / 1000),
    );

    if (!rateLimit.allowed) {
      set.status = 429;
      set.headers["Retry-After"] = String(
        Math.ceil((rateLimit.resetTime - Date.now()) / 1000),
      );
      return { error: "Too many requests. Please try again later." };
    }
  })
  // Health check endpoint
  .get("/health", () => {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  })
  // Config endpoint for frontend
  .get("/api/config", () => {
    return {
      devMode: DEV_MODE,
    };
  })
   .get("/", () => Bun.file("./public/packages.html"))
   .get("/admin", () => Bun.file("./public/admin.html"))
   .get("/package/:name", async ({ params: { name }, set }) => {
     try {
       if (!name || name.length === 0) {
         return Bun.file("./public/package.html");
       }

       // Fetch package data to generate dynamic meta tags
       const pkg = await database.getFullPackageData(name);

       if (!pkg) {
         // Return default page if package not found
         return Bun.file("./public/package.html");
       }

       // Read the base HTML
       const baseHtml = await Bun.file("./public/package.html").text();

       // Prepare metadata
       const title = `${pkg.name} - BedPak`;
        const description = pkg.description || "Minecraft Bedrock content";
        const imageUrl = pkg.icon_url || "/logos/bedpak_mascot.webp";
       const currentUrl = `https://bedpak.com/package/${encodeURIComponent(name)}`;

       // Create new HTML with updated meta tags
       let updatedHtml = baseHtml.replace(
         /<title>Package - BedPak<\/title>/,
         `<title>${escapeHtml(title)}</title>`,
       );

       // Replace description meta tag (handle multi-line)
        updatedHtml = updatedHtml.replace(
          /(<meta[\s\n]*name="description"[\s\n]*content=")Download this Minecraft Bedrock content from BedPak(")/s,
          `$1${escapeHtml(description)}$2`,
        );

         // Replace og:title - use just package name for Discord
         updatedHtml = updatedHtml.replace(
           /(<meta\s+property="og:title"\s+content=")Package - BedPak(")/,
           `$1${escapeHtml(pkg.name)}$2`,
         );

        // Replace og:description (handle multi-line) - use short description
         updatedHtml = updatedHtml.replace(
           /(<meta[\s\n]*property="og:description"[\s\n]*content=")Download this Minecraft Bedrock content from BedPak\.(")/s,
           `$1${escapeHtml(description)}$2`,
         );

         // Replace og:image - use package icon with full URL for Discord
         const fullImageUrl = imageUrl.startsWith("http") 
           ? imageUrl 
           : `https://bedpak.com${imageUrl}`;
          updatedHtml = updatedHtml.replace(
            /(<meta\s+property="og:image"\s+content=")\/logos\/bedpak_mascot\.webp(")/,
            `$1${escapeHtml(fullImageUrl)}$2`,
          );

       // Replace og:url
       updatedHtml = updatedHtml.replace(
         /(<meta\s+property="og:url"\s+content=")(")/,
         `$1${escapeHtml(currentUrl)}$2`,
       );

        // Replace twitter:title - use just package name
        updatedHtml = updatedHtml.replace(
          /(<meta\s+name="twitter:title"\s+content=")Package - BedPak(")/,
          `$1${escapeHtml(pkg.name)}$2`,
        );

        // Replace twitter:description (handle multi-line)
         updatedHtml = updatedHtml.replace(
           /(<meta[\s\n]*name="twitter:description"[\s\n]*content=")Download this Minecraft Bedrock content from BedPak\.(")/s,
           `$1${escapeHtml(description)}$2`,
         );

         // Replace twitter:image - use full URL
         updatedHtml = updatedHtml.replace(
           /(<meta\s+name="twitter:image"\s+content=")\/logos\/bedpak_mascot\.webp(")/,
           `$1${escapeHtml(fullImageUrl)}$2`,
        );

       set.headers["Cache-Control"] = "public, max-age=3600";
       set.headers["Content-Type"] = "text/html; charset=utf-8";

       return new Response(updatedHtml, {
         headers: {
           "Content-Type": "text/html; charset=utf-8",
           "Cache-Control": "public, max-age=3600",
         },
       });
     } catch (err) {
       console.error("Error serving package page:", err);
       return Bun.file("./public/package.html");
     }
   })
  .get("/fonts/:filename", ({ params: { filename } }) => {
    // Prevent path traversal by using only the base filename
    const safeFilename = basename(filename);
    if (safeFilename !== filename || filename.includes("..")) {
      return new Response("Invalid filename", { status: 400 });
    }
    return Bun.file(`./public/fonts/${safeFilename}`);
  })
  .get("/logos/:filename", ({ params: { filename } }) => {
    // Prevent path traversal by using only the base filename
    const safeFilename = basename(filename);
    if (safeFilename !== filename || filename.includes("..")) {
      return new Response("Invalid filename", { status: 400 });
    }
    return Bun.file(`./public/logos/${safeFilename}`);
  })
  .get("/icons/:filename", ({ params: { filename }, set }) => {
    // Prevent path traversal
    const safeFilename = basename(filename);
    if (safeFilename !== filename || filename.includes("..")) {
      set.status = 400;
      return new Response("Invalid filename", { status: 400 });
    }

    const iconData = getIconFile(safeFilename);
    if (!iconData) {
      set.status = 404;
      return new Response("Icon not found", { status: 404 });
    }

    // Build headers - add CSP for SVG to prevent script execution
    const headers: Record<string, string> = {
      "Content-Type": iconData.mimeType,
      "Cache-Control": "public, max-age=86400", // Cache for 24 hours
      "X-Content-Type-Options": "nosniff",
    };

    // Extra security for SVG files
    if (iconData.mimeType === "image/svg+xml") {
      headers["Content-Security-Policy"] =
        "default-src 'none'; style-src 'unsafe-inline'";
      headers["Content-Disposition"] = "inline";
    }

    return new Response(iconData.file, { headers });
  })
  .post("/auth/register", async ({ body, set, request, server }) => {
    try {
      const { username, email, password, turnstileToken } = body as {
        username?: string;
        email?: string;
        password?: string;
        turnstileToken?: string;
      };

      // Verify Turnstile CAPTCHA
      const ip = getClientIP(
        request.headers as unknown as Record<string, string | undefined>,
        server,
        request,
      );
      const turnstileResult = await verifyTurnstile(turnstileToken, ip);
      if (!turnstileResult.success) {
        set.status = 400;
        return { error: turnstileResult.error };
      }

      // Validate inputs
      if (!username || !email || !password) {
        set.status = 400;
        return { error: "Username, email, and password are required" };
      }

      // Validate username format
      const usernameValidation = validateUsername(username);
      if (!usernameValidation.valid) {
        set.status = 400;
        return { error: usernameValidation.error };
      }

      // Validate email format
      const emailValidation = validateEmail(email);
      if (!emailValidation.valid) {
        set.status = 400;
        return { error: emailValidation.error };
      }

      // Validate password strength
      const passwordValidation = validatePassword(password);
      if (!passwordValidation.valid) {
        set.status = 400;
        return {
          error: "Password does not meet requirements",
          details: passwordValidation.errors,
        };
      }

      // Check if user already exists
      const existingUser = await database.getUser(username);
      if (existingUser) {
        set.status = 409;
        return { error: "Username already exists" };
      }

      const existingEmail = await database.getUserByEmail(email);
      if (existingEmail) {
        set.status = 409;
        return { error: "Email already exists" };
      }

      // Hash password and create user
      const passwordHash = await hashPassword(password);
      const newUser = await database.createUser(
        username,
        email,
        passwordHash,
        "user",
      );

      set.status = 201;
      return {
        success: true,
        message: "User created successfully",
        user: {
          id: newUser.id,
          username: newUser.username,
          email: newUser.email,
          role: newUser.role,
        },
      };
    } catch (err) {
      console.error("Registration error:", err);
      set.status = 500;
      return { error: "Failed to register user" };
    }
  })
  .post("/auth/login", async ({ body, set, request, server }) => {
    try {
      // Apply stricter rate limiting for login endpoint
      const ip = getClientIP(
        request.headers as unknown as Record<string, string | undefined>,
        server,
        request,
      );
      const loginRateLimit = checkRateLimit(
        loginRateLimitStore,
        ip,
        LOGIN_RATE_LIMIT_MAX,
        LOGIN_RATE_LIMIT_WINDOW,
      );

      set.headers["X-RateLimit-Limit"] = String(LOGIN_RATE_LIMIT_MAX);
      set.headers["X-RateLimit-Remaining"] = String(loginRateLimit.remaining);
      set.headers["X-RateLimit-Reset"] = String(
        Math.ceil(loginRateLimit.resetTime / 1000),
      );

      if (!loginRateLimit.allowed) {
        set.status = 429;
        set.headers["Retry-After"] = String(
          Math.ceil((loginRateLimit.resetTime - Date.now()) / 1000),
        );
        return { error: "Too many login attempts. Please try again later." };
      }

      const { username, password, turnstileToken, totpCode } = body as {
        username?: string;
        password?: string;
        turnstileToken?: string;
        totpCode?: string;
      };

      // Verify Turnstile CAPTCHA
      const turnstileResult = await verifyTurnstile(turnstileToken, ip);
      if (!turnstileResult.success) {
        set.status = 400;
        return { error: turnstileResult.error };
      }

      // Validate inputs
      if (!username || !password) {
        set.status = 400;
        return { error: "Username and password are required" };
      }

      // Find user
      const user = await database.getUser(username);
      if (!user) {
        set.status = 401;
        return { error: "Invalid username or password" };
      }

      // Verify password
      const passwordMatch = await comparePassword(password, user.password_hash);
      if (!passwordMatch) {
        set.status = 401;
        return { error: "Invalid username or password" };
      }

      // Check if 2FA is enabled for this user
      if (user.two_factor_enabled) {
        // If 2FA is enabled, require TOTP code
        if (!totpCode) {
          set.status = 403;
          return { error: "2FA required", requiresTwoFactor: true };
        }

        // Verify TOTP code
        if (!user.two_factor_secret || !verify2FAToken(totpCode, user.two_factor_secret)) {
          set.status = 401;
          return { error: "Invalid 2FA code" };
        }
      }

      // Generate JWT token
      const token = generateToken({
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      });

      return {
        success: true,
        token,
        expiresIn: 7 * 24 * 60 * 60, // 7 days in seconds
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
        },
      };
    } catch (err) {
      console.error("Login error:", err);
      set.status = 500;
      return { error: "Failed to login" };
    }
  })
  .post("/auth/2fa/setup", async ({ headers, set }) => {
    try {
      // Extract and verify token
      const authHeader = headers["authorization"];
      const token = extractToken(authHeader);

      if (!token) {
        set.status = 401;
        return { error: "Unauthorized: Missing or invalid token" };
      }

      const payload = verifyToken(token);
      if (!payload) {
        set.status = 401;
        return { error: "Unauthorized: Invalid token" };
      }

      const user = await database.getUserById(payload.id);
      if (!user) {
        set.status = 404;
        return { error: "User not found" };
      }

      // Generate 2FA secret and backup codes
      const { secret, qrCodeUrl } = await generate2FASecret(user.username);
      const backupCodes = generateBackupCodes();

      return {
        secret,
        qrCodeUrl,
        backupCodes,
      };
    } catch (err) {
      console.error("2FA setup error:", err);
      set.status = 500;
      return { error: "Failed to setup 2FA" };
    }
  })
  .post("/auth/2fa/enable", async ({ headers, body, set }) => {
    try {
      // Extract and verify token
      const authHeader = headers["authorization"];
      const token = extractToken(authHeader);

      if (!token) {
        set.status = 401;
        return { error: "Unauthorized: Missing or invalid token" };
      }

      const payload = verifyToken(token);
      if (!payload) {
        set.status = 401;
        return { error: "Unauthorized: Invalid token" };
      }

      const user = await database.getUserById(payload.id);
      if (!user) {
        set.status = 404;
        return { error: "User not found" };
      }

      const { secret, backupCodes, token: totpToken } = body as {
        secret: string;
        backupCodes: string[];
        token: string;
      };

      // Verify the TOTP token
      if (!verify2FAToken(totpToken, secret)) {
        set.status = 400;
        return { error: "Invalid 2FA token" };
      }

      // Hash backup codes
      const hashedBackupCodes = await hashBackupCodes(backupCodes);

      // Update user in database
      await database.sqlite`
        UPDATE users 
        SET two_factor_enabled = 1, 
            two_factor_secret = ${secret},
            backup_codes = ${hashedBackupCodes}
        WHERE id = ${user.id}
      `;

      return { success: true, message: "2FA enabled successfully" };
    } catch (err) {
      console.error("2FA enable error:", err);
      set.status = 500;
      return { error: "Failed to enable 2FA" };
    }
  })
  .post("/auth/2fa/disable", async ({ headers, body, set }) => {
    try {
      // Extract and verify token
      const authHeader = headers["authorization"];
      const token = extractToken(authHeader);

      if (!token) {
        set.status = 401;
        return { error: "Unauthorized: Missing or invalid token" };
      }

      const payload = verifyToken(token);
      if (!payload) {
        set.status = 401;
        return { error: "Unauthorized: Invalid token" };
      }

      const user = await database.getUserById(payload.id);
      if (!user) {
        set.status = 404;
        return { error: "User not found" };
      }

      // Check if 2FA is enabled
      if (!user.two_factor_enabled) {
        set.status = 400;
        return { error: "2FA is not enabled" };
      }

      const { password, totpCode } = body as { password: string; totpCode: string };

      // Verify password
      const passwordValid = await comparePassword(password, user.password_hash);
      if (!passwordValid) {
        set.status = 401;
        return { error: "Invalid password" };
      }

      // Verify TOTP code
      if (!user.two_factor_secret || !verify2FAToken(totpCode, user.two_factor_secret)) {
        set.status = 401;
        return { error: "Invalid 2FA code" };
      }

      // Disable 2FA
      await database.sqlite`
        UPDATE users 
        SET two_factor_enabled = 0, 
            two_factor_secret = NULL,
            backup_codes = NULL
        WHERE id = ${user.id}
      `;

      return { success: true, message: "2FA disabled successfully" };
    } catch (err) {
      console.error("2FA disable error:", err);
      set.status = 500;
      return { error: "Failed to disable 2FA" };
    }
  })
  .get("/auth/2fa/status", async ({ headers, set }) => {
    try {
      // Extract and verify token
      const authHeader = headers["authorization"];
      const token = extractToken(authHeader);

      if (!token) {
        set.status = 401;
        return { error: "Unauthorized: Missing or invalid token" };
      }

      const payload = verifyToken(token);
      if (!payload) {
        set.status = 401;
        return { error: "Unauthorized: Invalid token" };
      }

      const user = await database.getUserById(payload.id);
      if (!user) {
        set.status = 404;
        return { error: "User not found" };
      }

      return {
        twoFactorEnabled: user.two_factor_enabled === 1,
      };
    } catch (err) {
      console.error("2FA status error:", err);
      set.status = 500;
      return { error: "Failed to get 2FA status" };
    }
  })
  .get("/user/:username", async ({ params: { username }, set }) => {
    try {
      if (!username || username.length === 0) {
        set.status = 400;
        return { error: "Username is required" };
      }

      const user = await database.getUser(username);

      if (!user) {
        set.status = 404;
        return { error: "User not found" };
      }

      // Return only non-sensitive user data
      set.headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
      return {
        id: user.id,
        username: user.username,
        role: user.role,
        created_at: user.created_at,
      };
    } catch (err) {
      console.error("Fetch user error:", err);
      set.status = 500;
      return { error: "Failed to fetch user" };
    }
  })
  .get("/user/id/:userId", async ({ params: { userId }, set }) => {
    try {
      const id = parseInt(userId);
      if (isNaN(id)) {
        set.status = 400;
        return { error: "Invalid user ID" };
      }

      const user = await database.getUserById(id);

      if (!user) {
        set.status = 404;
        return { error: "User not found" };
      }

      // Return only non-sensitive user data
      set.headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
      return {
        id: user.id,
        username: user.username,
        role: user.role,
        created_at: user.created_at,
      };
    } catch (err) {
      console.error("Fetch user by ID error:", err);
      set.status = 500;
      return { error: "Failed to fetch user" };
    }
  })
  .get("/admin/users", async ({ headers, set }) => {
    try {
      // Extract and verify token
      const authHeader = headers["authorization"];
      const token = extractToken(authHeader);

      if (!token) {
        set.status = 401;
        return { error: "Unauthorized: Missing or invalid token" };
      }

      const payload = verifyToken(token);
      if (!payload) {
        set.status = 401;
        return { error: "Unauthorized: Invalid or expired token" };
      }

      // Re-verify admin role from database (in case role was changed)
      const currentUser = await database.getUserById(payload.id);
      if (!currentUser || currentUser.role !== "admin") {
        set.status = 403;
        return { error: "Forbidden: Only admins can view users" };
      }

      // Get all users
      const users = await database.getAllUsers();

      return {
        success: true,
        users: users.map((user: Record<string, unknown>) => ({
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          created_at: user.created_at,
        })),
      };
    } catch (err) {
      console.error("Fetch users error:", err);
      set.status = 500;
      return { error: "Failed to fetch users" };
    }
  })
   .put(
     "/admin/users/:userId/role",
     async ({ params: { userId }, headers, body, set }) => {
       try {
         // Extract and verify token
         const authHeader = headers["authorization"];
         const token = extractToken(authHeader);

         if (!token) {
           set.status = 401;
           return { error: "Unauthorized: Missing or invalid token" };
         }

         const payload = verifyToken(token);
         if (!payload) {
           set.status = 401;
           return { error: "Unauthorized: Invalid or expired token" };
         }

         // Re-verify admin role from database (in case role was changed)
         const currentUser = await database.getUserById(payload.id);
         if (!currentUser || currentUser.role !== "admin") {
           set.status = 403;
           return { error: "Forbidden: Only admins can change user roles" };
         }

         // Get target user
         const targetUserId = parseInt(userId);
         if (isNaN(targetUserId)) {
           set.status = 400;
           return { error: "Invalid user ID" };
         }

         const targetUser = await database.getUserById(targetUserId);

         if (!targetUser) {
           set.status = 404;
           return { error: "User not found" };
         }

         // Validate new role
         const bodyObj = body as Record<string, unknown>;
         const newRole = bodyObj.role as string | undefined;
         if (!newRole) {
           set.status = 400;
           return { error: "Role is required" };
         }

         const validRoles = ["user", "developer", "admin"];
         if (!validRoles.includes(newRole)) {
           set.status = 400;
           return {
             error: `Invalid role. Must be one of: ${validRoles.join(", ")}`,
           };
         }

         // Prevent demoting the last admin
         if (targetUser.role === "admin" && newRole !== "admin") {
           const adminCount = await database.getAdminCount();
           if (adminCount <= 1) {
             set.status = 400;
             return {
               error:
                 "Cannot demote the last admin. Promote another user to admin first.",
             };
           }
         }

         // Update user role
         const updatedUser = await database.updateUserRole(
           targetUserId,
           newRole as string,
         );
         const userData = (
           updatedUser as unknown as Record<string, unknown>[]
         )[0];

         return {
           success: true,
           message: "User role updated successfully",
           user: {
             id: userData.id,
             username: userData.username,
             role: userData.role,
           },
         };
       } catch (err) {
         console.error("Update user role error:", err);
         set.status = 500;
         return { error: "Failed to update user role" };
       }
     },
   )
   .put(
     "/admin/users/:userId",
     async ({ params: { userId }, headers, body, set }) => {
       try {
         // Extract and verify token
         const authHeader = headers["authorization"];
         const token = extractToken(authHeader);

         if (!token) {
           set.status = 401;
           return { error: "Unauthorized: Missing or invalid token" };
         }

         const payload = verifyToken(token);
         if (!payload) {
           set.status = 401;
           return { error: "Unauthorized: Invalid or expired token" };
         }

         // Re-verify admin role from database
         const currentUser = await database.getUserById(payload.id);
         if (!currentUser || currentUser.role !== "admin") {
           set.status = 403;
           return { error: "Forbidden: Only admins can edit users" };
         }

         // Get target user
         const targetUserId = parseInt(userId);
         if (isNaN(targetUserId)) {
           set.status = 400;
           return { error: "Invalid user ID" };
         }

         const targetUser = await database.getUserById(targetUserId);
         if (!targetUser) {
           set.status = 404;
           return { error: "User not found" };
         }

         const bodyObj = body as Record<string, unknown>;
         const username = bodyObj.username as string | undefined;
         const email = bodyObj.email as string | undefined;
         const password = bodyObj.password as string | undefined;

         // Validate if provided
         if (username !== undefined && username !== null) {
           const usernameValidation = validateUsername(username);
           if (!usernameValidation.valid) {
             set.status = 400;
             return { error: usernameValidation.error };
           }

           // Check for duplicate username (excluding current user)
           if (username !== targetUser.username) {
             const existingUser = await database.getUser(username);
             if (existingUser) {
               set.status = 409;
               return { error: "Username already exists" };
             }
           }
         }

         if (email !== undefined && email !== null) {
           const emailValidation = validateEmail(email);
           if (!emailValidation.valid) {
             set.status = 400;
             return { error: emailValidation.error };
           }

           // Check for duplicate email (excluding current user)
           if (email !== targetUser.email) {
             const existingEmail = await database.getUserByEmail(email);
             if (existingEmail) {
               set.status = 409;
               return { error: "Email already exists" };
             }
           }
         }

         if (password !== undefined && password !== null) {
           const passwordValidation = validatePassword(password);
           if (!passwordValidation.valid) {
             set.status = 400;
             return {
               error: "Password does not meet requirements",
               details: passwordValidation.errors,
             };
           }
         }

         // Perform updates
         const updatedUser = await database.updateUserProfile(
           targetUserId,
           username,
           email,
           password,
         );
         const userData = (
           updatedUser as unknown as Record<string, unknown>[]
         )[0];

         return {
           success: true,
           message: "User updated successfully",
           user: {
             id: userData.id,
             username: userData.username,
             email: userData.email,
             role: userData.role,
           },
         };
       } catch (err) {
         console.error("Update user error:", err);
         set.status = 500;
         return { error: "Failed to update user" };
       }
     },
   )
   .delete(
     "/admin/users/:userId",
     async ({ params: { userId }, headers, set }) => {
       try {
         // Extract and verify token
         const authHeader = headers["authorization"];
         const token = extractToken(authHeader);

         if (!token) {
           set.status = 401;
           return { error: "Unauthorized: Missing or invalid token" };
         }

         const payload = verifyToken(token);
         if (!payload) {
           set.status = 401;
           return { error: "Unauthorized: Invalid or expired token" };
         }

         // Re-verify admin role from database
         const currentUser = await database.getUserById(payload.id);
         if (!currentUser || currentUser.role !== "admin") {
           set.status = 403;
           return { error: "Forbidden: Only admins can delete users" };
         }

         // Get target user
         const targetUserId = parseInt(userId);
         if (isNaN(targetUserId)) {
           set.status = 400;
           return { error: "Invalid user ID" };
         }

         const targetUser = await database.getUserById(targetUserId);
         if (!targetUser) {
           set.status = 404;
           return { error: "User not found" };
         }

         // Prevent deleting the last admin
         if (targetUser.role === "admin") {
           const adminCount = await database.getAdminCount();
           if (adminCount <= 1) {
             set.status = 400;
             return {
               error:
                 "Cannot delete the last admin. Promote another user to admin first.",
             };
           }
         }

         // Delete the user
         await database.removeUser(targetUserId);

         return {
           success: true,
           message: "User deleted successfully",
         };
       } catch (err) {
         console.error("Delete user error:", err);
         set.status = 500;
         return { error: "Failed to delete user" };
       }
     },
   )
  .post("/admin/tags", async ({ headers, body, set }) => {
    try {
      // Extract and verify token
      const authHeader = headers["authorization"];
      const token = extractToken(authHeader);

      if (!token) {
        set.status = 401;
        return { error: "Unauthorized: Missing or invalid token" };
      }

      const payload = verifyToken(token);
      if (!payload) {
        set.status = 401;
        return { error: "Unauthorized: Invalid or expired token" };
      }

      // Re-verify admin role from database
      const currentUser = await database.getUserById(payload.id);
      if (!currentUser || currentUser.role !== "admin") {
        set.status = 403;
        return { error: "Forbidden: Only admins can create tags" };
      }

      const { name, slug } = body as { name?: string; slug?: string };

      if (!name || !slug) {
        set.status = 400;
        return { error: "Name and slug are required" };
      }

      // Validate name
      if (name.length < 1 || name.length > 32) {
        set.status = 400;
        return { error: "Tag name must be between 1 and 32 characters" };
      }

      // Validate slug (lowercase, alphanumeric, hyphens only)
      const slugRegex = /^[a-z0-9-]+$/;
      if (!slugRegex.test(slug) || slug.length < 1 || slug.length > 32) {
        set.status = 400;
        return {
          error:
            "Tag slug must be lowercase alphanumeric with hyphens, 1-32 characters",
        };
      }

      // Check if tag already exists
      const existingTag = await database.getTagBySlug(slug);
      if (existingTag) {
        set.status = 409;
        return { error: "Tag with this slug already exists" };
      }

      const newTag = await database.createTag(name, slug);

      set.status = 201;
      return {
        success: true,
        message: "Tag created successfully",
        data: newTag[0],
      };
    } catch (err) {
      console.error("Create tag error:", err);
      set.status = 500;
      return { error: "Failed to create tag" };
    }
  })
  .delete("/admin/tags/:id", async ({ params: { id }, headers, set }) => {
    try {
      // Extract and verify token
      const authHeader = headers["authorization"];
      const token = extractToken(authHeader);

      if (!token) {
        set.status = 401;
        return { error: "Unauthorized: Missing or invalid token" };
      }

      const payload = verifyToken(token);
      if (!payload) {
        set.status = 401;
        return { error: "Unauthorized: Invalid or expired token" };
      }

      // Re-verify admin role from database
      const currentUser = await database.getUserById(payload.id);
      if (!currentUser || currentUser.role !== "admin") {
        set.status = 403;
        return { error: "Forbidden: Only admins can delete tags" };
      }

      const tagId = parseInt(id);
      if (isNaN(tagId)) {
        set.status = 400;
        return { error: "Invalid tag ID" };
      }

      // Check if tag exists
      const tag = await database.getTagById(tagId);
      if (!tag) {
        set.status = 404;
        return { error: "Tag not found" };
      }

      await database.deleteTag(tagId);

      return {
        success: true,
        message: "Tag deleted successfully",
      };
    } catch (err) {
      console.error("Delete tag error:", err);
      set.status = 500;
      return { error: "Failed to delete tag" };
    }
  })
  // ==================== CATEGORY ENDPOINTS ====================
  .get("/categories", async ({ set }) => {
    try {
      const categories = await database.getAllTags();
      set.headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
      return { success: true, data: categories };
    } catch (err) {
      console.error("Fetch categories error:", err);
      set.status = 500;
      return { error: "Failed to fetch categories" };
    }
  })
  // Legacy tags endpoint (redirects to categories)
  .get("/tags", async ({ query, set }) => {
    try {
      const popular = query.popular === "true";
      const limitParam = query.limit;

      if (popular) {
        const parsedLimit = limitParam ? parseInt(limitParam) : 10;
        if (isNaN(parsedLimit) || parsedLimit < 1) {
          set.status = 400;
          return { error: "Invalid limit parameter" };
        }
        const limit = Math.min(Math.max(parsedLimit, 1), 50);
        const tags = await database.getPopularTags(limit);
        set.headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
        return { success: true, data: tags };
      }

      const tags = await database.getAllTags();
      set.headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
      return { success: true, data: tags };
    } catch (err) {
      console.error("Fetch tags error:", err);
      set.status = 500;
      return { error: "Failed to fetch tags" };
    }
  })
  .get("/tags/:slug", async ({ params: { slug }, set }) => {
    try {
      if (!slug || slug.length === 0) {
        set.status = 400;
        return { error: "Tag slug is required" };
      }

      const tag = await database.getTagBySlug(slug);

      if (!tag) {
        set.status = 404;
        return { error: "Tag not found" };
      }

      set.headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
      return { success: true, data: tag };
    } catch (err) {
      console.error("Fetch tag error:", err);
      set.status = 500;
      return { error: "Failed to fetch tag" };
    }
  })
  .get("/packages", async ({ query, set }) => {
    try {
      const parsedLimit = parseInt(query.limit || "20");
      const parsedOffset = parseInt(query.offset || "0");
      const categoryParam = query.category;

      if (isNaN(parsedLimit) || isNaN(parsedOffset)) {
        set.status = 400;
        return { error: "Invalid limit or offset parameters" };
      }

      const limit = Math.min(Math.max(parsedLimit, 1), 100);
      const offset = Math.max(parsedOffset, 0);

      // Handle category filtering (single category system)
      if (categoryParam && categoryParam.length > 0) {
        const categorySlug = categoryParam.trim().toLowerCase();

        const packages = await database.getPackagesByCategory(
          categorySlug,
          limit,
          offset,
        );
        const total = await database.getPackagesCountByCategory(categorySlug);

        set.headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
        return {
          data: packages,
          limit,
          offset,
          total,
          filters: { category: categorySlug },
        };
      }

      const packages = await database.getAllPackages(limit, offset);
      const total = await database.getTotalPackageCount();

      set.headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
      return {
        data: packages,
        limit,
        offset,
        total,
      };
    } catch (err) {
      console.error("Fetch packages error:", err);
      set.status = 500;
      return { error: "Failed to fetch packages" };
    }
  })
  .get("/packages/:name/full", async ({ params: { name }, set }) => {
    try {
      if (!name || name.length === 0) {
        set.status = 400;
        return { error: "Package name is required" };
      }

      const fullData = await database.getFullPackageData(name);

      if (!fullData) {
        set.status = 404;
        return { error: "Package not found" };
      }

      set.headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
      return { success: true, data: fullData };
    } catch (err) {
      console.error("Fetch full package data error:", err);
      set.status = 500;
      return { error: "Failed to fetch package" };
    }
  })
  .get("/packages/:name/related", async ({ params: { name }, query, set }) => {
    try {
      if (!name || name.length === 0) {
        set.status = 400;
        return { error: "Package name is required" };
      }

      // Get the package to find its category
      const fullData = await database.getFullPackageData(name);

      if (!fullData) {
        set.status = 404;
        return { error: "Package not found" };
      }

      // If package has no category, return empty array
      if (!fullData.category) {
        set.headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
        return { success: true, data: [] };
      }

      const parsedLimit = parseInt(query.limit || "6");
      const limit = Math.min(Math.max(parsedLimit, 1), 10);

      // Get packages in the same category
      const relatedPackages = await database.getPackagesByCategory(
        fullData.category.slug,
        limit + 1,
        0,
      );

      // Filter out the current package and enrich with category data
      const filtered = [];
      for (const pkg of relatedPackages) {
        if (pkg.id !== fullData.id && filtered.length < limit) {
          // Get category for each related package
          let category = null;
          if (pkg.category_id) {
            const categoryRecord = await database.getTagById(pkg.category_id);
            if (categoryRecord) {
              category = {
                id: categoryRecord.id,
                name: categoryRecord.name,
                slug: categoryRecord.slug,
              };
            }
          }
          filtered.push({
            ...pkg,
            category,
          });
        }
      }
      set.headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
      return { success: true, data: filtered };
    } catch (err) {
      console.error("Fetch related packages error:", err);
      set.status = 500;
      return { error: "Failed to fetch related packages" };
    }
  })
  .get("/packages/:name", async ({ params: { name }, set }) => {
    try {
      if (!name || name.length === 0) {
        set.status = 400;
        return { error: "Package name is required" };
      }

      const pkg = await database.getPackage(name);

      if (!pkg) {
        set.status = 404;
        return { error: "Package not found" };
      }

      set.headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
      return { data: pkg };
    } catch (err) {
      console.error("Fetch package error:", err);
      set.status = 500;
      return { error: "Failed to fetch package" };
    }
  })
  .get("/packages/author/:username", async ({ params: { username }, set }) => {
    try {
      if (!username || username.length === 0) {
        set.status = 400;
        return { error: "Author username is required" };
      }

      const user = await database.getUser(username);

      if (!user) {
        set.status = 404;
        return { error: "User not found" };
      }

      const packages = await database.getPackagesByAuthor(user.id);

      set.headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
      return {
        author: username,
        data: packages,
        total: packages.length,
      };
    } catch (err) {
      console.error("Fetch user packages error:", err);
      set.status = 500;
      return { error: "Failed to fetch user packages" };
    }
  })
  .post("/packages", async (context) => {
    try {
      // Extract and verify token
      const authHeader = context.headers["authorization"];
      const token = extractToken(authHeader);

      if (!token) {
        context.set.status = 401;
        return { error: "Unauthorized: Missing or invalid token" };
      }

      const payload = verifyToken(token);
      if (!payload) {
        context.set.status = 401;
        return { error: "Unauthorized: Invalid or expired token" };
      }

      // Re-verify role from database
      const currentUser = await database.getUserById(payload.id);
      if (
        !currentUser ||
        (currentUser.role !== "developer" && currentUser.role !== "admin")
      ) {
        context.set.status = 403;
        return {
          error: "Forbidden: Only developers and admins can upload addons",
        };
      }

      // Handle FormData
      let name: string | undefined;
      let description: string | undefined;
      let version: string | undefined;
      let kofiUrl: string | undefined;
      let longDescription: string | undefined;
      let youtubeUrl: string | undefined;
      let discordUrl: string | undefined;
      let category: string | undefined; // single category slug
      let iconBuffer: Buffer | undefined;
      let fileBuffer: Buffer | undefined;

      if (context.body instanceof FormData) {
        name = (context.body.get("name") as string | null) || undefined;
        description =
          (context.body.get("description") as string | null) || undefined;
        version = (context.body.get("version") as string | null) || undefined;
        kofiUrl = (context.body.get("kofiUrl") as string | null) || undefined;
        longDescription =
          (context.body.get("longDescription") as string | null) || undefined;
        youtubeUrl =
          (context.body.get("youtubeUrl") as string | null) || undefined;
        discordUrl =
          (context.body.get("discordUrl") as string | null) || undefined;
        category = (context.body.get("category") as string | null) || undefined;
        const file = context.body.get("file") as File | null;
        const iconFile = context.body.get("icon") as File | null;

        if (file) {
          fileBuffer = Buffer.from(await file.arrayBuffer());
        }
        if (iconFile) {
          iconBuffer = Buffer.from(await iconFile.arrayBuffer());
        }
      } else if (typeof context.body === "object" && context.body !== null) {
        const bodyObj = context.body as Record<string, unknown>;
        name = bodyObj.name as string | undefined;
        description = bodyObj.description as string | undefined;
        version = bodyObj.version as string | undefined;
        kofiUrl = bodyObj.kofiUrl as string | undefined;
        longDescription = bodyObj.longDescription as string | undefined;
        youtubeUrl = bodyObj.youtubeUrl as string | undefined;
        discordUrl = bodyObj.discordUrl as string | undefined;
        category = bodyObj.category as string | undefined;

        // If file is base64 encoded
        if (bodyObj.fileBase64) {
          fileBuffer = Buffer.from(bodyObj.fileBase64 as string, "base64");
        }
        // If icon is base64 encoded
        if (bodyObj.iconBase64) {
          iconBuffer = Buffer.from(bodyObj.iconBase64 as string, "base64");
        }
      }

      // Validate package name
      if (!name) {
        context.set.status = 400;
        return { error: "Package name is required" };
      }

      const nameValidation = validatePackageName(name);
      if (!nameValidation.valid) {
        context.set.status = 400;
        return { error: nameValidation.error };
      }

      // Validate version if provided
      if (version) {
        const versionValidation = validateVersion(version);
        if (!versionValidation.valid) {
          context.set.status = 400;
          return { error: versionValidation.error };
        }
      }

      if (!fileBuffer) {
        context.set.status = 400;
        return { error: "Package file is required" };
      }

      // Check file size limit
      if (fileBuffer.length > MAX_FILE_SIZE) {
        context.set.status = 400;
        return {
          error: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB`,
        };
      }

      // Validate file is .mcaddon (ZIP format)
      if (
        fileBuffer.length < 4 ||
        !(
          fileBuffer[0] === 0x50 &&
          fileBuffer[1] === 0x4b &&
          fileBuffer[2] === 0x03 &&
          fileBuffer[3] === 0x04
        )
      ) {
        context.set.status = 400;
        return {
          error:
            "Invalid file format. Only .mcaddon files (ZIP format) are supported",
        };
      }

      // Check if package already exists
      const existingPackage = await database.getPackage(name);
      if (existingPackage) {
        context.set.status = 409;
        return { error: "Package name already exists" };
      }

      // Validate kofiUrl if provided (must be a valid Ko-fi URL)
      if (kofiUrl) {
        const kofiUrlPattern =
          /^https?:\/\/(www\.)?ko-fi\.com\/[a-zA-Z0-9_]+\/?$/;
        if (!kofiUrlPattern.test(kofiUrl)) {
          context.set.status = 400;
          return {
            error:
              "Invalid Ko-fi URL. Must be in format: https://ko-fi.com/username",
          };
        }
      }

      // Validate youtubeUrl if provided
      if (youtubeUrl) {
        const youtubeUrlPattern =
          /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[a-zA-Z0-9_-]+/;
        if (!youtubeUrlPattern.test(youtubeUrl)) {
          context.set.status = 400;
          return {
            error: "Invalid YouTube URL. Must be a valid YouTube video URL",
          };
        }
      }

      // Validate discordUrl if provided
      if (discordUrl) {
        const discordUrlPattern =
          /^https?:\/\/(www\.)?(discord\.(gg|com)\/|discordapp\.com\/invite\/)[a-zA-Z0-9_-]+/;
        if (!discordUrlPattern.test(discordUrl)) {
          context.set.status = 400;
          return {
            error: "Invalid Discord URL. Must be a valid Discord invite link",
          };
        }
      }

      // Parse and validate category (single category system)
      let categoryId: number | undefined;
      if (category) {
        const categorySlug = category.trim().toLowerCase();
        const categoryRecord = await database.getTagBySlug(categorySlug);
        if (!categoryRecord) {
          context.set.status = 400;
          return { error: `Category not found: ${categorySlug}` };
        }
        categoryId = categoryRecord.id;
      }

      // Create package record first to get ID (without icon_url for now)
      const newPackage = await database.createPackage(
        name,
        description || "",
        payload.id,
        "", // Will update after saving file
        "", // Will update after saving file
        version || "1.0.0",
        undefined, // iconUrl - will update after saving
        kofiUrl || undefined,
        longDescription || undefined,
        youtubeUrl || undefined,
        discordUrl || undefined,
        categoryId,
      );

      const packageData = (
        newPackage as unknown as Record<string, unknown>[]
      )[0];
      const packageId = packageData?.id;

      if (!packageId) {
        context.set.status = 500;
        return { error: "Failed to create package record" };
      }

      // Save file to storage
      try {
        const { filePath, fileHash } = await saveAddon(
          packageId as number,
          name,
          fileBuffer,
        );

        // Save icon if provided
        let iconUrl: string | undefined;
        if (iconBuffer) {
          try {
            const iconResult = await saveIcon(packageId as number, iconBuffer);
            iconUrl = iconResult.iconUrl;
          } catch (iconErr) {
            // Log but don't fail the entire upload for icon errors
            console.error("Failed to save icon:", iconErr);
          }
        }

        // Update package with icon URL if we have one
        if (iconUrl) {
          await database.updatePackage(
            packageId as number,
            undefined,
            undefined,
            undefined,
            iconUrl,
          );
        }
      } catch (saveErr) {
        // Cleanup: delete package record and icon if file save fails
        await database.deletePackage(packageId as number);
        await deleteIcon(packageId as number);
        throw saveErr;
      }

      // Fetch updated package with tags
      const pkg = await database.getFullPackageData(name);

      context.set.status = 201;
      return {
        success: true,
        message: "Package created successfully",
        data: pkg,
      };
    } catch (err) {
      console.error("Package creation error:", err);
      context.set.status = 500;
      return { error: "Failed to create package" };
    }
  })
  .get("/packages/:name/download", async ({ params: { name }, set }) => {
    try {
      if (!name) {
        set.status = 400;
        return { error: "Package name is required" };
      }

      const pkg = await database.getPackage(name);

      if (!pkg) {
        set.status = 404;
        return { error: "Package not found" };
      }

      // Get the latest addon file
      const filePath = await getLatestAddonFile(pkg.id, name);

      if (!filePath) {
        set.status = 404;
        return { error: "Package file not found" };
      }

      // Increment download counter
      await database.incrementDownloads(pkg.id);

      // Return file stream
      const stream = getAddonStream(filePath);

      if (!stream) {
        set.status = 500;
        return { error: "Failed to read package file" };
      }

      // Sanitize filename for Content-Disposition header
      const safeFilename = sanitizeFilename(name);

      return new Response(stream as unknown as BodyInit, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${safeFilename}.mcaddon"`,
        },
      });
    } catch (err) {
      console.error("Download package error:", err);
      set.status = 500;
      return { error: "Failed to download package" };
    }
  })
  .put("/packages/:id", async ({ params: { id }, headers, body, set }) => {
    try {
      // Extract and verify token
      const authHeader = headers["authorization"];
      const token = extractToken(authHeader);

      if (!token) {
        set.status = 401;
        return { error: "Unauthorized: Missing or invalid token" };
      }

      const payload = verifyToken(token);
      if (!payload) {
        set.status = 401;
        return { error: "Unauthorized: Invalid or expired token" };
      }

      // Get package
      const packageId = parseInt(id);
      if (isNaN(packageId)) {
        set.status = 400;
        return { error: "Invalid package ID" };
      }

      const pkg =
        await database.sqlite`SELECT * FROM packages WHERE id = ${packageId}`;

      if (!pkg || pkg.length === 0) {
        set.status = 404;
        return { error: "Package not found" };
      }

      const packageData = pkg[0] as Record<string, unknown>;

      // Re-verify user from database and check ownership
      const currentUser = await database.getUserById(payload.id);
      if (!currentUser) {
        set.status = 401;
        return { error: "Unauthorized: User not found" };
      }

      if (
        packageData.author_id !== payload.id &&
        currentUser.role !== "admin"
      ) {
        set.status = 403;
        return { error: "Forbidden: You do not own this package" };
      }

      // Parse body
      let name: string | undefined;
      let description: string | undefined;
      let version: string | undefined;
      let iconBase64: string | undefined;
      let fileBase64: string | undefined;
      let kofiUrl: string | null | undefined;
      let longDescription: string | null | undefined;
      let youtubeUrl: string | null | undefined;
      let discordUrl: string | null | undefined;
      let category: string | null | undefined; // single category slug

      if (typeof body === "object" && body !== null) {
        const bodyObj = body as Record<string, unknown>;
        name = bodyObj.name as string | undefined;
        description = bodyObj.description as string | undefined;
        version = bodyObj.version as string | undefined;
        iconBase64 = bodyObj.iconBase64 as string | undefined;
        fileBase64 = bodyObj.fileBase64 as string | undefined;
        // kofiUrl can be explicitly set to null to remove it, or a string to set it
        if ("kofiUrl" in bodyObj) {
          kofiUrl = bodyObj.kofiUrl as string | null;
        }
        // longDescription can be explicitly set to null to remove it, or a string to set it
        if ("longDescription" in bodyObj) {
          longDescription = bodyObj.longDescription as string | null;
        }
        // youtubeUrl can be explicitly set to null to remove it, or a string to set it
        if ("youtubeUrl" in bodyObj) {
          youtubeUrl = bodyObj.youtubeUrl as string | null;
        }
        // discordUrl can be explicitly set to null to remove it, or a string to set it
        if ("discordUrl" in bodyObj) {
          discordUrl = bodyObj.discordUrl as string | null;
        }
        // category can be explicitly set to update category
        if ("category" in bodyObj) {
          category = bodyObj.category as string | null;
        }
      }

      // Validate inputs if provided
      if (name) {
        const nameValidation = validatePackageName(name);
        if (!nameValidation.valid) {
          set.status = 400;
          return { error: nameValidation.error };
        }

        // Check if new name conflicts with existing package (excluding current)
        if (name !== packageData.name) {
          const existingPackage = await database.getPackage(name);
          if (existingPackage) {
            set.status = 409;
            return { error: "Package name already exists" };
          }
        }
      }

      if (version) {
        const versionValidation = validateVersion(version);
        if (!versionValidation.valid) {
          set.status = 400;
          return { error: versionValidation.error };
        }
      }

      // Validate kofiUrl if provided (must be a valid Ko-fi URL or null to remove)
      if (kofiUrl !== undefined && kofiUrl !== null && kofiUrl !== "") {
        const kofiUrlPattern =
          /^https?:\/\/(www\.)?ko-fi\.com\/[a-zA-Z0-9_]+\/?$/;
        if (!kofiUrlPattern.test(kofiUrl)) {
          set.status = 400;
          return {
            error:
              "Invalid Ko-fi URL. Must be in format: https://ko-fi.com/username",
          };
        }
      }

      // Validate youtubeUrl if provided
      if (
        youtubeUrl !== undefined &&
        youtubeUrl !== null &&
        youtubeUrl !== ""
      ) {
        const youtubeUrlPattern =
          /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[a-zA-Z0-9_-]+/;
        if (!youtubeUrlPattern.test(youtubeUrl)) {
          set.status = 400;
          return {
            error: "Invalid YouTube URL. Must be a valid YouTube video URL",
          };
        }
      }

      // Validate discordUrl if provided
      if (
        discordUrl !== undefined &&
        discordUrl !== null &&
        discordUrl !== ""
      ) {
        const discordUrlPattern =
          /^https?:\/\/(www\.)?(discord\.(gg|com)\/|discordapp\.com\/invite\/)[a-zA-Z0-9_-]+/;
        if (!discordUrlPattern.test(discordUrl)) {
          set.status = 400;
          return {
            error: "Invalid Discord URL. Must be a valid Discord invite link",
          };
        }
      }

      // Parse and validate category if provided
      let categoryId: number | null | undefined;
      if (category !== undefined) {
        if (category === null || category === "") {
          // Clear category
          categoryId = null;
        } else {
          const categorySlug = category.trim().toLowerCase();
          const categoryRecord = await database.getTagBySlug(categorySlug);
          if (!categoryRecord) {
            set.status = 400;
            return { error: `Category not found: ${categorySlug}` };
          }
          categoryId = categoryRecord.id;
        }
      }

      let iconUrl: string | undefined;

      // Handle icon update
      if (iconBase64) {
        const iconBuffer = Buffer.from(iconBase64, "base64");

        // Validate icon size (2MB max)
        if (iconBuffer.length > 2 * 1024 * 1024) {
          set.status = 400;
          return { error: "Icon file too large. Maximum size is 2MB" };
        }

        try {
          // Delete old icon first
          await deleteIcon(packageId);

          // Save new icon
          const iconResult = await saveIcon(packageId, iconBuffer);
          iconUrl = iconResult.iconUrl;
        } catch (iconErr) {
          console.error("Failed to update icon:", iconErr);
          set.status = 500;
          return { error: "Failed to update icon" };
        }
      }

      // Handle addon file update
      if (fileBase64) {
        const fileBuffer = Buffer.from(fileBase64, "base64");

        // Check file size limit
        if (fileBuffer.length > MAX_FILE_SIZE) {
          set.status = 400;
          return {
            error: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB`,
          };
        }

        // Validate file is .mcaddon (ZIP format)
        if (
          fileBuffer.length < 4 ||
          !(
            fileBuffer[0] === 0x50 &&
            fileBuffer[1] === 0x4b &&
            fileBuffer[2] === 0x03 &&
            fileBuffer[3] === 0x04
          )
        ) {
          set.status = 400;
          return {
            error:
              "Invalid file format. Only .mcaddon files (ZIP format) are supported",
          };
        }

        try {
          // Delete old addon files
          const currentName = packageData.name as string;
          await deleteAddon(packageId, currentName);

          // Save new addon file with the new name (or current name if not changing)
          const addonName = name || currentName;
          await saveAddon(packageId, addonName, fileBuffer);
        } catch (fileErr) {
          console.error("Failed to update addon file:", fileErr);
          set.status = 500;
          return { error: "Failed to update addon file" };
        }
      }

      // Update package metadata
      const updatedPackage = await database.updatePackage(
        packageId,
        name,
        description,
        version,
        iconUrl,
        kofiUrl,
        longDescription,
        youtubeUrl,
        discordUrl,
        categoryId,
      );

      // Get updated package name for full data fetch
      const updatedPkgName = name || (packageData.name as string);
      const fullPackageData = await database.getFullPackageData(updatedPkgName);

      return {
        success: true,
        message: "Package updated successfully",
        data: fullPackageData,
      };
    } catch (err) {
      console.error("Update package error:", err);
      set.status = 500;
      return { error: "Failed to update package" };
    }
  })
  .delete("/packages/:id", async ({ params: { id }, headers, set }) => {
    try {
      // Extract and verify token
      const authHeader = headers["authorization"];
      const token = extractToken(authHeader);

      if (!token) {
        set.status = 401;
        return { error: "Unauthorized: Missing or invalid token" };
      }

      const payload = verifyToken(token);
      if (!payload) {
        set.status = 401;
        return { error: "Unauthorized: Invalid or expired token" };
      }

      // Get package
      const packageId = parseInt(id);
      if (isNaN(packageId)) {
        set.status = 400;
        return { error: "Invalid package ID" };
      }

      const pkg =
        await database.sqlite`SELECT * FROM packages WHERE id = ${packageId}`;

      if (!pkg || pkg.length === 0) {
        set.status = 404;
        return { error: "Package not found" };
      }

      const packageData = pkg[0] as Record<string, unknown>;

      // Re-verify user from database and check ownership
      const currentUser = await database.getUserById(payload.id);
      if (!currentUser) {
        set.status = 401;
        return { error: "Unauthorized: User not found" };
      }

      if (
        packageData.author_id !== payload.id &&
        currentUser.role !== "admin"
      ) {
        set.status = 403;
        return { error: "Forbidden: You do not own this package" };
      }

      // Delete files from storage
      const packageName = packageData.name as string;
      await deleteAddon(packageId, packageName);

      // Delete package from database
      await database.deletePackage(packageId);

      return {
        success: true,
        message: "Package deleted successfully",
      };
    } catch (err) {
      console.error("Delete package error:", err);
      set.status = 500;
      return { error: "Failed to delete package" };
    }
  })
  .listen(3000);

console.log(`running at ${app.server?.hostname}:${app.server?.port}`);

if (DEV_MODE) {
  console.log("DEV MODE ENABLED - CAPTCHA verification is disabled");
}

// Graceful shutdown handling
let isShuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n${signal} received. Starting graceful shutdown...`);

  // Stop accepting new connections
  try {
    app.stop();
    console.log("Server stopped accepting new connections");
  } catch (err) {
    console.error("Error stopping server:", err);
  }

  // Give existing requests time to complete (5 seconds)
  console.log("Waiting for existing requests to complete...");
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Close database connection
  try {
    database.sqlite.close();
    console.log("Database connection closed");
  } catch (err) {
    console.error("Error closing database:", err);
  }

  console.log("Graceful shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
