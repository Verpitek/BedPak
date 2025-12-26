import { describe, test, expect, beforeAll, afterAll } from "bun:test";

// Set JWT_SECRET for tests
process.env.JWT_SECRET = "test-secret-key-for-testing-purposes-only";

// Import after setting env
import { validatePassword, hashPassword, comparePassword, generateToken, verifyToken, extractToken } from "./auth";

describe("Auth Module", () => {
  describe("validatePassword", () => {
    test("should reject password shorter than 8 characters", () => {
      const result = validatePassword("Pass1!");
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Password must be at least 8 characters");
    });

    test("should reject password without numbers", () => {
      const result = validatePassword("Password!");
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Password must contain at least one number");
    });

    test("should reject password without special characters", () => {
      const result = validatePassword("Password1");
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Password must contain at least one special character");
    });

    test("should accept valid password", () => {
      const result = validatePassword("SecurePass1!");
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });
  });

  describe("hashPassword and comparePassword", () => {
    test("should hash and verify password correctly", async () => {
      const password = "TestPassword123!";
      const hash = await hashPassword(password);
      
      expect(hash).not.toBe(password);
      expect(hash.length).toBeGreaterThan(0);
      
      const isMatch = await comparePassword(password, hash);
      expect(isMatch).toBe(true);
      
      const isWrongMatch = await comparePassword("WrongPassword123!", hash);
      expect(isWrongMatch).toBe(false);
    });
  });

  describe("JWT tokens", () => {
    test("should generate and verify token", () => {
      const payload = {
        id: 1,
        username: "testuser",
        email: "test@example.com",
        role: "user",
      };
      
      const token = generateToken(payload);
      expect(token).toBeTruthy();
      expect(typeof token).toBe("string");
      
      const decoded = verifyToken(token);
      expect(decoded).not.toBeNull();
      expect(decoded?.id).toBe(payload.id);
      expect(decoded?.username).toBe(payload.username);
      expect(decoded?.email).toBe(payload.email);
      expect(decoded?.role).toBe(payload.role);
    });

    test("should return null for invalid token", () => {
      const decoded = verifyToken("invalid-token");
      expect(decoded).toBeNull();
    });
  });

  describe("extractToken", () => {
    test("should extract token from Bearer header", () => {
      const token = extractToken("Bearer abc123");
      expect(token).toBe("abc123");
    });

    test("should return null for missing header", () => {
      expect(extractToken(undefined)).toBeNull();
    });

    test("should return null for invalid format", () => {
      expect(extractToken("Basic abc123")).toBeNull();
      expect(extractToken("Bearer")).toBeNull();
      expect(extractToken("abc123")).toBeNull();
    });
  });
});

describe("API Endpoints", () => {
  const baseUrl = "http://localhost:3000";
  let serverProcess: ReturnType<typeof Bun.spawn> | null = null;

  beforeAll(async () => {
    // Start the server in a separate process (with dev mode to skip CAPTCHA)
    serverProcess = Bun.spawn(["bun", "run", "src/index.ts", "--dev"], {
      env: { ...process.env, JWT_SECRET: "test-secret-key-for-testing-purposes-only" },
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    
    // Wait for server to start
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  afterAll(() => {
    if (serverProcess) {
      serverProcess.kill();
    }
  });

  describe("GET /health", () => {
    test("should return health status", async () => {
      const response = await fetch(`${baseUrl}/health`);
      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data.status).toBe("ok");
      expect(data.timestamp).toBeTruthy();
      expect(typeof data.uptime).toBe("number");
    });
  });

  describe("Security Headers", () => {
    test("should include security headers in response", async () => {
      const response = await fetch(`${baseUrl}/health`);
      
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(response.headers.get("X-Frame-Options")).toBe("DENY");
      expect(response.headers.get("X-XSS-Protection")).toBe("1; mode=block");
      expect(response.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    });
  });

  describe("Rate Limiting", () => {
    test("should include rate limit headers on non-health endpoints", async () => {
      const response = await fetch(`${baseUrl}/packages`);
      
      expect(response.headers.get("X-RateLimit-Limit")).toBeTruthy();
      expect(response.headers.get("X-RateLimit-Remaining")).toBeTruthy();
      expect(response.headers.get("X-RateLimit-Reset")).toBeTruthy();
    });
  });

  describe("GET /packages", () => {
    test("should return packages list", async () => {
      const response = await fetch(`${baseUrl}/packages`);
      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data).toHaveProperty("data");
      expect(data).toHaveProperty("limit");
      expect(data).toHaveProperty("offset");
      expect(data).toHaveProperty("total");
      expect(Array.isArray(data.data)).toBe(true);
    });

    test("should respect pagination parameters", async () => {
      const response = await fetch(`${baseUrl}/packages?limit=5&offset=0`);
      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data.limit).toBe(5);
      expect(data.offset).toBe(0);
    });

    test("should reject invalid pagination parameters", async () => {
      const response = await fetch(`${baseUrl}/packages?limit=abc`);
      expect(response.status).toBe(400);
    });
  });

  describe("POST /auth/register", () => {
    test("should reject registration with missing fields", async () => {
      const response = await fetch(`${baseUrl}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "test" }),
      });
      
      expect(response.status).toBe(400);
    });

    test("should reject registration with invalid email", async () => {
      const response = await fetch(`${baseUrl}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "testuser",
          email: "invalid-email",
          password: "SecurePass1!",
        }),
      });
      
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("email");
    });

    test("should reject registration with weak password", async () => {
      const response = await fetch(`${baseUrl}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "testuser",
          email: "test@example.com",
          password: "weak",
        }),
      });
      
      expect(response.status).toBe(400);
    });
  });

  describe("POST /auth/login", () => {
    test("should reject login with missing credentials", async () => {
      const response = await fetch(`${baseUrl}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      
      expect(response.status).toBe(400);
    });

    test("should reject login with invalid credentials", async () => {
      const response = await fetch(`${baseUrl}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "nonexistent",
          password: "WrongPass1!",
        }),
      });
      
      expect(response.status).toBe(401);
    });
  });

  describe("Protected Endpoints", () => {
    test("should reject admin endpoint without token", async () => {
      const response = await fetch(`${baseUrl}/admin/users`);
      expect(response.status).toBe(401);
    });

    test("should reject package upload without token", async () => {
      const response = await fetch(`${baseUrl}/packages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "test-package" }),
      });
      
      expect(response.status).toBe(401);
    });
  });

  describe("GET /packages/:name", () => {
    test("should return 404 for non-existent package", async () => {
      const response = await fetch(`${baseUrl}/packages/non-existent-package-xyz`);
      expect(response.status).toBe(404);
    });
  });

  describe("GET /user/:username", () => {
    test("should return 404 for non-existent user", async () => {
      const response = await fetch(`${baseUrl}/user/non-existent-user-xyz`);
      expect(response.status).toBe(404);
    });
  });
});
