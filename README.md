# BedPak

![Apache 2.0 License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)

A comprehensive backend API for hosting, sharing, and uploading Minecraft Bedrock Edition content. Built with Elysia and SQLite, providing a full-featured repository for Bedrock add-ons, behavior packs, resource packs, and other content with user authentication, package management, and a web frontend.

## Features

- **User Authentication**: JWT-based registration/login with password hashing and optional two-factor authentication (2FA)
- **Two-Factor Authentication (2FA)**: TOTP-based 2FA with QR code setup, backup codes, and secure disable process
- **Content Management**: Upload, download, update, and delete `.mcaddon` files and other Bedrock content
- **Category System**: Modrinth-style categories (Adventure, Decoration, Utility, Survival, etc.)
- **Web Frontend**: Responsive HTML/CSS/JS interface for browsing and managing content
- **Admin Dashboard**: User and content management for administrators
- **Security**: Cloudflare Turnstile CAPTCHA, rate limiting, security headers, and 2FA support
- **File Validation**: Magic byte validation for content files and icons
- **SVG Sanitization**: Automatic removal of dangerous SVG content
- **Rate Limiting**: Configurable rate limits with proper headers
- **CORS Support**: Configurable CORS origins for API access

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) (v1.0.0 or later)

### Installation

1. Clone the repository:
   ```bash
    git clone https://github.com/Verpitek/BedPak.git
   cd bedpak
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your JWT_SECRET and TURNSTILE_SECRET_KEY
   ```

4. Start the development server:
   ```bash
   bun run dev
   ```

5. Open http://localhost:3000 in your browser.

### Development Mode

Run with `--dev` flag to disable CAPTCHA verification:
```bash
bun run dev --dev
```

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | Yes | - | Secret for signing JWT tokens |
| `TURNSTILE_SECRET_KEY` | Yes* | - | Cloudflare Turnstile secret key for CAPTCHA verification. Required unless running with `--dev` flag. |
| `CORS_ORIGINS` | No | (allow all) | Comma-separated list of allowed origins |
| `DATABASE_PATH` | No | `bedpak.db` | Path to SQLite database file |
| `PORT` | No | `3000` | Port to run server on |

### File Limits

- **Content files**: Maximum 200MB, must be valid `.mcaddon` (ZIP format)
- **Icons**: Maximum 2MB, supported formats: PNG, JPEG, WebP, GIF, SVG

### Security

**Two-Factor Authentication (2FA)**
BedPak supports optional two-factor authentication (2FA) for enhanced account security:
- Users can enable 2FA from their profile modal
- Uses time-based one-time passwords (TOTP) compatible with Google Authenticator, Authy, Microsoft Authenticator, etc.
- QR code display for easy setup with authenticator apps
- 10 backup codes for account recovery if access to authenticator is lost
- Disabling 2FA requires both password and valid 2FA code
- Login automatically prompts for 2FA code if enabled on the account

## API Reference

BedPak provides a comprehensive RESTful API for programmatic access. For detailed API documentation, see the interactive [API Documentation](http://localhost:3000/api-docs.html) or [API_GUIDE.md](API_GUIDE.md).

### Quick API Examples

**Register a user:**
```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"myuser","email":"user@example.com","password":"SecurePass123!"}'
```

**Enable 2FA:**
```bash
# 1. Get setup QR code and backup codes
curl -X POST http://localhost:3000/auth/2fa/setup \
  -H "Authorization: Bearer YOUR_TOKEN"

# 2. Verify with authenticator code
curl -X POST http://localhost:3000/auth/2fa/enable \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "secret": "JBSWY3DPEBLW64TMMQ...",
    "token": "123456",
    "backupCodes": ["ABC12DEF", ...]
  }'
```

**Upload content:**
```bash
curl -X POST http://localhost:3000/packages \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: multipart/form-data" \
  -F "name=MyContent" \
  -F "file=@./content.mcaddon"
```

**Download content:**
```bash
curl http://localhost:3000/packages/MyContent/download -o content.mcaddon
```

**List packages:**
```bash
curl "http://localhost:3000/packages?limit=20&offset=0"
```

## Frontend

BedPak includes a responsive web frontend with these pages:

- **`/`** - Package browser with search and filtering
- **`/package/:name`** - Package details with markdown rendering
- **`/admin`** - Admin dashboard (admin users only)
- **`/api-docs.html`** - Interactive API documentation
- **`/terms-of-service.html`** - Terms of service
- **`/privacy-policy.html`** - Privacy policy

## Development

### Project Structure

```
BedPak/
├── src/
│   ├── index.ts          # Main server entry point
│   ├── auth.ts           # Authentication utilities
│   ├── db_controller.ts  # Database operations
│   ├── storage.ts        # File storage operations
│   └── index.test.ts     # Test suite
├── public/               # Frontend HTML/CSS/JS
├── storage/              # Uploaded addons and icons
├── dist/                 # Compiled output
└── configuration files
```

### Available Commands

- `bun run dev` - Start development server with hot reload
- `bun test` - Run test suite
- `bun run build` - Build for production
- `bun run start` - Start production server

### Code Style

- **Imports**: ES6 imports, external packages first
- **Naming**: camelCase variables/functions, PascalCase classes
- **Types**: Strict TypeScript, all parameters and returns typed
- **Formatting**: 2-space indentation, double quotes, no semicolons (except SQL)
- **Database**: Use parameterized queries, return results via `RETURNING *`

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `bun test`
5. Submit a pull request

## License

BedPak is licensed under the Apache License 2.0. See [LICENSE](LICENSE) for details.

## Disclaimer

BedPak is an independent service not affiliated with Microsoft or Mojang Studios.

Minecraft is a trademark of Mojang Studios.
