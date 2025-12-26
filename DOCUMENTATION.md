# BedPak - Complete Documentation

## Overview

BedPak is a backend API for hosting, sharing, and uploading Minecraft Bedrock Edition addons. It's built with Elysia (a Bun web framework) and SQLite, providing a full-featured repository for `.mcaddon` files with user authentication, package management, and a web frontend.

**Key Features:**
- User registration and authentication with JWT
- Addon package upload/download with file validation
- Category-based organization (single category per package)
- Download tracking and statistics
- Web frontend with responsive design
- Admin dashboard for user and package management
- Cloudflare Turnstile CAPTCHA integration
- Rate limiting and security headers
- Graceful shutdown and error handling

## Architecture

### Technology Stack

- **Runtime**: Bun (JavaScript runtime)
- **Framework**: Elysia (web framework for Bun)
- **Database**: SQLite (via Bun's native SQL API)
- **Authentication**: JWT + bcrypt for password hashing
- **Frontend**: Vanilla HTML/CSS/JS (with planned Svelte migration)
- **Storage**: Local filesystem for `.mcaddon` files and icons
- **Security**: Cloudflare Turnstile CAPTCHA, rate limiting, CORS

### Project Structure

```
BedPak/
├── src/
│   ├── index.ts          # Main server entry point, API routes
│   ├── auth.ts           # Authentication utilities (JWT, bcrypt, CAPTCHA)
│   ├── db_controller.ts  # Database operations and migrations
│   ├── storage.ts        # File storage operations (addons and icons)
│   └── index.test.ts     # Test file (currently empty)
├── public/
│   ├── packages.html     # Main frontend (package browser)
│   ├── package.html      # Package detail page
│   ├── admin.html        # Admin dashboard
│   ├── api-docs.html     # API documentation
│   ├── terms-of-service.html
│   ├── privacy-policy.html
│   ├── fonts/            # Monocraft font files
│   └── logos/            # BedPak logo and branding
├── storage/
│   ├── addons/           # Uploaded .mcaddon files
│   │   └── {packageId}-{packageName}/addon-{timestamp}.mcaddon
│   └── icons/            # Package icons ({packageId}.{ext})
├── dist/                 # Compiled output (if using TypeScript)
│   └── index.js
└── configuration files
    ├── package.json      # Dependencies and scripts
    ├── bun.lock          # Bun lockfile
    ├── tsconfig.json     # TypeScript configuration
    ├── AGENTS.md         # Agent guidelines
    ├── API_GUIDE.md      # API reference
    ├── README.md         # Project README
    └── TODO.txt          # Development tasks
```

### Data Flow

1. **User Registration/Login**: 
   - Frontend submits credentials to `/auth/register` or `/auth/login`
   - Server validates with CAPTCHA, hashes password, creates JWT
   - Token stored in localStorage for subsequent requests

2. **Package Upload**:
   - Authenticated user submits FormData with package metadata and `.mcaddon` file
   - Server validates file format (ZIP magic bytes), size (<200MB), and metadata
   - Creates database record, saves file to storage, generates icon if provided
   - Returns package details with category information

3. **Package Download**:
   - User requests `/packages/{name}/download`
   - Server increments download counter, streams file with proper headers
   - File served with Content-Disposition: attachment

4. **Package Browsing**:
   - Frontend fetches `/packages` with query parameters (limit, offset, category)
   - Server returns paginated results with package metadata
   - Frontend renders cards with filtering and sorting

## API Reference

### Authentication Endpoints

#### POST `/auth/register`
Register a new user account.

**Request Body:**
```json
{
  "username": "myuser",
  "email": "user@example.com",
  "password": "SecurePass123!",
  "turnstileToken": "captcha_token_from_cloudflare"
}
```

**Password Requirements:**
- Minimum 8 characters
- At least 1 number
- At least 1 special character

**Response:**
```json
{
  "success": true,
  "message": "User created successfully",
  "user": {
    "id": 1,
    "username": "myuser",
    "email": "user@example.com",
    "role": "user"
  }
}
```

#### POST `/auth/login`
Authenticate and receive JWT token.

**Request Body:**
```json
{
  "username": "myuser",
  "password": "SecurePass123!",
  "turnstileToken": "captcha_token_from_cloudflare"
}
```

**Response:**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 604800,
  "user": {
    "id": 1,
    "username": "myuser",
    "email": "user@example.com",
    "role": "user"
  }
}
```

### Package Endpoints

#### GET `/packages`
List packages with pagination and filtering.

**Query Parameters:**
- `limit` (optional, default: 20, max: 100) - Number of packages per page
- `offset` (optional, default: 0) - Pagination offset
- `category` (optional) - Filter by category slug (e.g., "adventure", "utility")

**Response:**
```json
{
  "data": [
    {
      "id": 1,
      "name": "MyAddon",
      "description": "An awesome addon",
      "author_id": 1,
      "file_path": "storage/addons/1-MyAddon/addon-1766582957723.mcaddon",
      "file_hash": "sha256_hash",
      "version": "1.0.0",
      "downloads": 42,
      "updated_at": "2025-12-26T10:30:00Z",
      "created_at": "2025-12-25T15:45:00Z",
      "icon_url": "/icons/1.png",
      "kofi_url": "https://ko-fi.com/creator",
      "long_description": "# Markdown content...",
      "youtube_url": "https://youtube.com/watch?v=...",
      "category_id": 3
    }
  ],
  "limit": 20,
  "offset": 0,
  "total": 150
}
```

#### GET `/packages/:name`
Get package details by name.

**Response:**
```json
{
  "data": {
    "id": 1,
    "name": "MyAddon",
    "description": "An awesome addon",
    "author_id": 1,
    "file_path": "storage/addons/1-MyAddon/addon-1766582957723.mcaddon",
    "file_hash": "sha256_hash",
    "version": "1.0.0",
    "downloads": 42,
    "updated_at": "2025-12-26T10:30:00Z",
    "created_at": "2025-12-25T15:45:00Z",
    "icon_url": "/icons/1.png",
    "kofi_url": "https://ko-fi.com/creator",
    "long_description": "# Markdown content...",
    "youtube_url": "https://youtube.com/watch?v=...",
    "category_id": 3
  }
}
```

#### GET `/packages/:name/full`
Get complete package data including author and category information.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "MyAddon",
    "description": "An awesome addon",
    // ... all package fields
    "author": {
      "id": 1,
      "username": "creator"
    },
    "category": {
      "id": 3,
      "name": "Adventure",
      "slug": "adventure"
    },
    "tags": [] // For backward compatibility (empty array)
  }
}
```

#### GET `/packages/:name/download`
Download the `.mcaddon` file.

**Response:** Binary file stream with headers:
```
Content-Type: application/octet-stream
Content-Disposition: attachment; filename="MyAddon.mcaddon"
```

#### POST `/packages`
Upload a new package (requires authentication).

**Authentication:** `Authorization: Bearer <jwt_token>`

**Request Body:** FormData with fields:
- `name` (string, required) - Package name (1-64 chars, alphanumeric+underscore+hyphen)
- `description` (string, optional) - Short description
- `longDescription` (string, optional) - Markdown long description
- `version` (string, optional) - Version in X.Y.Z format (default: "1.0.0")
- `category` (string, optional) - Category slug (e.g., "adventure")
- `youtubeUrl` (string, optional) - YouTube video URL
- `kofiUrl` (string, optional) - Ko-fi support URL
- `file` (file, required) - `.mcaddon` file (max 200MB)
- `icon` (file, optional) - Icon image (PNG/JPG/WebP/GIF/SVG, max 2MB)

**Response:** HTTP 201 with created package data.

#### PUT `/packages/:id`
Update a package (owner or admin only).

**Authentication:** `Authorization: Bearer <jwt_token>`

**Request Body:** JSON with fields to update (all optional):
- `name` (string) - New package name
- `description` (string) - New description
- `longDescription` (string or null) - New markdown description (null to remove)
- `version` (string) - New version
- `category` (string or null) - New category slug (null to remove)
- `youtubeUrl` (string or null) - New YouTube URL (null to remove)
- `kofiUrl` (string or null) - New Ko-fi URL (null to remove)
- `iconBase64` (string) - Base64 encoded new icon
- `fileBase64` (string) - Base64 encoded new `.mcaddon` file

**Response:** Updated package data.

#### DELETE `/packages/:id`
Delete a package (owner or admin only).

**Authentication:** `Authorization: Bearer <jwt_token>`

**Response:**
```json
{
  "success": true,
  "message": "Package deleted successfully"
}
```

### Category Endpoints

#### GET `/categories`
List all available categories.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "Adventure",
      "slug": "adventure",
      "created_at": "2025-12-25T15:45:00Z"
    },
    // ... all categories
  ]
}
```

#### GET `/tags/:slug`
Get category by slug (legacy endpoint, uses same categories).

### User Endpoints

#### GET `/user/:username`
Get public user information.

**Response:**
```json
{
  "id": 1,
  "username": "myuser",
  "role": "user",
  "created_at": "2025-12-25T15:45:00Z"
}
```

#### GET `/packages/author/:username`
Get packages by author.

**Response:**
```json
{
  "author": "myuser",
  "data": [
    // array of packages
  ],
  "total": 5
}
```

### Admin Endpoints (Admin Role Required)

#### GET `/admin/users`
List all users (admin only).

#### PUT `/admin/users/:userId/role`
Update user role (admin only).

**Request Body:**
```json
{
  "role": "admin" // "user", "developer", or "admin"
}
```

#### POST `/admin/tags`
Create a new category/tag (admin only).

#### DELETE `/admin/tags/:id`
Delete a category/tag (admin only).

### Utility Endpoints

#### GET `/health`
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-12-26T10:30:00Z",
  "uptime": 12345.67
}
```

#### GET `/api/config`
Get frontend configuration.

**Response:**
```json
{
  "devMode": false
}
```

## Database Schema

### Users Table
```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'user',  -- 'user', 'developer', 'admin'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Packages Table
```sql
CREATE TABLE packages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    author_id INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    file_hash TEXT NOT NULL,
    version TEXT,
    downloads INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    icon_url TEXT,
    kofi_url TEXT,
    long_description TEXT,
    youtube_url TEXT,
    category_id INTEGER REFERENCES tags(id),
    FOREIGN KEY (author_id) REFERENCES users(id)
);

CREATE INDEX idx_packages_author ON packages(author_id);
```

### Tags Table (Categories)
```sql
CREATE TABLE tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Package_Tags Table (Legacy - for backward compatibility)
```sql
CREATE TABLE package_tags (
    package_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (package_id, tag_id),
    FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE INDEX idx_package_tags_package ON package_tags(package_id);
CREATE INDEX idx_package_tags_tag ON package_tags(tag_id);
```

### Categories (Pre-defined)
The system uses a fixed set of categories similar to Modrinth:

**Gameplay Categories:**
- Adventure, Decoration, Economy, Equipment, Food, Game Mechanics, Magic, Management
- Minigame, Mobs, Optimisation, Social, Storage, Technology, Transportation, Utility, World Generation

**Server Categories:**
- Administration, Anti-Cheat, Chat, Moderation, Permissions

## File Storage

### Addon Files
Location: `storage/addons/{packageId}-{packageName}/addon-{timestamp}.mcaddon`

**File Naming:**
- Package directory: `{packageId}-{sanitizedPackageName}`
- Individual files: `addon-{timestamp}.mcaddon`
- Multiple versions can exist (latest is used for downloads)

**Validation:**
- File must start with ZIP magic bytes (`PK\x03\x04`)
- Maximum size: 200MB
- Extension must be `.mcaddon`

### Icon Files
Location: `storage/icons/{packageId}.{extension}`

**Supported Formats:**
- PNG, JPEG, WebP, GIF, SVG
- Maximum size: 2MB
- SVG files are sanitized to prevent XSS attacks

**Validation:**
- Checks magic bytes for format validation
- SVG content is sanitized (removes scripts, event handlers)
- Returns appropriate MIME type for serving

## Security Features

### Authentication & Authorization
- **JWT Tokens**: 7-day expiration, signed with secret from `JWT_SECRET` env var
- **Password Hashing**: bcrypt with salt rounds 10
- **Role System**: Three levels - user, developer, admin
- **Ownership Validation**: Package owners can edit/delete their own packages
- **Admin Override**: Admins can manage all packages and users

### CAPTCHA Protection
- **Cloudflare Turnstile**: Integrated for registration and login
- **Dev Mode**: Can be disabled with `--dev` flag for development
- **Rate Limiting**: Separate stricter limits for login attempts

### Rate Limiting
- **General Endpoints**: 100 requests per minute per IP
- **Login Endpoints**: 5 attempts per 15 minutes per IP
- **Headers**: Includes `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- **Storage**: In-memory Map (consider Redis for production clusters)

### Security Headers
All responses include:
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: geolocation=(), microphone=(), camera=()`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`

### CORS Configuration
- Configurable via `CORS_ORIGINS` environment variable
- Default: Allow all origins
- Methods: GET, POST, PUT, DELETE, OPTIONS
- Headers: Content-Type, Authorization
- Credentials: true

### File Upload Security
- **Path Traversal Prevention**: Sanitized filenames using `basename()`
- **File Type Validation**: Checks magic bytes, not just extensions
- **Size Limits**: Enforced at API level (200MB for addons, 2MB for icons)
- **SVG Sanitization**: Removes scripts, event handlers, dangerous elements

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | Yes | - | Secret for signing JWT tokens |
| `TURNSTILE_SECRET_KEY` | Yes* | - | Cloudflare Turnstile secret key for CAPTCHA verification. Required unless running with `--dev` flag. |
| `CORS_ORIGINS` | No | (allow all) | Comma-separated list of allowed origins |

### Development Mode
Start server with `--dev` flag to:
- Disable CAPTCHA verification (TURNSTILE_SECRET_KEY not required)
- Enable development logging

### Default Port
Server runs on port 3000 by default.

## Frontend

### Pages

#### `packages.html` - Main Package Browser
- Browse, search, and filter packages
- User authentication (login/register)
- Package upload for developers/admins
- Responsive design with mobile support
- Pagination and sorting options
- Category filtering

#### `package.html` - Package Detail Page
- Detailed package information
- Markdown rendering for long descriptions
- Related packages (same category)
- Download button with support popup
- YouTube video embedding
- Ko-fi support links

#### `admin.html` - Admin Dashboard
- User management (view, role changes)
- Package management (view, edit, delete)
- Category management
- Admin-only access

#### Static Pages
- `api-docs.html` - API documentation
- `terms-of-service.html` - Legal terms
- `privacy-policy.html` - Privacy policy

### Frontend Features
- **Authentication**: JWT token storage in localStorage
- **File Upload**: Progress bars, validation, drag-and-drop support
- **Markdown Support**: Client-side markdown rendering
- **Responsive Design**: Mobile-friendly CSS
- **Accessibility**: ARIA labels, semantic HTML
- **SEO**: Meta tags, structured data, sitemap

### JavaScript Architecture
- Modular functions for API calls
- Event-driven UI updates
- Form validation and error handling
- Local storage for form data persistence
- URL parameter synchronization

## Development

### Setup

1. **Install Bun**: `curl -fsSL https://bun.sh/install | bash`
2. **Clone Repository**: `git clone <repo-url>`
3. **Install Dependencies**: `bun install`
4. **Set Environment Variables**: Create `.env` file with `JWT_SECRET` and `TURNSTILE_SECRET_KEY` (optional if using `--dev` flag)
5. **Start Server**: `bun run dev`

### Available Commands

- `bun run dev` - Start development server with hot reload
- `bun test` - Run tests (when implemented)

### Code Style Guidelines

**Imports**: ES6 imports, external packages first, then local modules.
**Naming**: camelCase variables/functions, PascalCase classes, snake_case database columns.
**Types**: Strict TypeScript, all parameters and returns typed.
**Formatting**: 2-space indentation, double quotes, no semicolons (except SQL).
**Error Handling**: Try-catch around database operations.
**Database**: Use parameterized queries, return results via `RETURNING *`.

### Database Migrations

The system includes automatic migrations in `src/db_controller.ts`:

1. **Role Column**: Added to users table
2. **Icon URL**: Added to packages table
3. **Ko-fi URL**: Added to packages table
4. **Long Description**: Added to packages table
5. **YouTube URL**: Added to packages table
6. **Category ID**: Added to packages table (migrated from tags)
7. **Default Categories**: Seeded with Modrinth-style categories

### Testing

No test framework is currently configured. Use `bun test` when tests are added.

## Deployment

### Production Considerations

1. **Reverse Proxy**: Use Nginx or Caddy in front of BedPak
2. **HTTPS**: Configure SSL certificates
3. **Database**: SQLite works for small-medium deployments; consider PostgreSQL for larger scale
4. **File Storage**: Ensure sufficient disk space for addon files
5. **Backups**: Regular backups of SQLite database and storage directory
6. **Monitoring**: Logging, health checks, error tracking

### Performance Optimization

- **Caching**: Implement CDN for static assets
- **Database Indexes**: Ensure proper indexes on frequently queried columns
- **File Serving**: Consider serving static files directly via Nginx
- **Memory Management**: Monitor rate limiting storage growth

### Scaling

- **Vertical Scaling**: Increase server resources
- **Horizontal Scaling**: Add more instances with shared storage
- **Database**: Migrate from SQLite to PostgreSQL for multi-instance deployment
- **File Storage**: Use object storage (S3, Cloudflare R2) instead of local filesystem

## Maintenance

### Regular Tasks

1. **Monitor Logs**: Check for errors and rate limiting issues
2. **Backup Database**: Regular backups of `bedpak.db`
3. **Clean Storage**: Remove orphaned files if packages are deleted
4. **Update Dependencies**: `bun update` regularly
5. **Review Security**: Monitor for security advisories

### Troubleshooting

#### Common Issues

1. **Database Connection Errors**
   - Check file permissions for `bedpak.db`
   - Ensure SQLite is accessible

2. **File Upload Failures**
   - Check disk space
   - Verify file permissions in `storage/` directory
   - Confirm file size limits

3. **Authentication Issues**
   - Verify JWT_SECRET is set
   - Verify TURNSTILE_SECRET_KEY is set (unless using --dev flag)
   - Check token expiration
   - Confirm password requirements

4. **CORS Errors**
   - Verify CORS_ORIGINS configuration
   - Check frontend origin matches allowed origins

#### Logs

Enable detailed logging by monitoring console output:
- Request logging includes method, path, status, duration, and IP
- Error logging includes stack traces for server errors
- Turnstile verification errors are logged

## API Client Examples

### Using cURL

```bash
# Register a user
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"test","email":"test@example.com","password":"Test123!"}'

# Login and save token
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"test","password":"Test123!"}' | jq -r '.token')

# Upload a package
curl -X POST http://localhost:3000/packages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: multipart/form-data" \
  -F "name=MyAddon" \
  -F "description=Test addon" \
  -F "category=adventure" \
  -F "file=@./myaddon.mcaddon"
```

### Using JavaScript Fetch

```javascript
// Login
const login = async (username, password) => {
  const response = await fetch('http://localhost:3000/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  return await response.json();
};

// Upload package
const uploadPackage = async (token, formData) => {
  const response = await fetch('http://localhost:3000/packages', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData
  });
  return await response.json();
};
```

## Future Development

### Planned Features (from TODO.txt)

1. **Svelte Frontend Migration**
   - Convert vanilla JS frontend to Svelte/SvelteKit
   - Improve developer experience and maintainability
   - Enable better state management and component reuse

2. **Enhanced Features**
   - User profiles and avatars
   - Package versioning system
   - Review and rating system
   - Package dependencies
   - Advanced search with filters

3. **Infrastructure Improvements**
   - Docker containerization
   - CI/CD pipeline
   - Automated testing
   - Performance monitoring

### Contribution Guidelines

1. Follow existing code style and patterns
2. Add tests for new functionality
3. Update documentation for API changes
4. Use TypeScript for type safety
5. Consider backward compatibility

## License & Attribution

BedPak is an independent service not affiliated with Microsoft or Mojang Studios.

Minecraft is a trademark of Mojang Studios.

---

*Last Updated: December 26, 2025*
*Version: 1.0.50*