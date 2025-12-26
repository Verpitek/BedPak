# BedPak API Quick Reference

## Base URL
```
http://localhost:3000
```

## Authentication

### Register User
```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "myuser",
    "email": "user@example.com",
    "password": "SecurePass123!"
  }'
```

**Password Requirements:**
- Minimum 8 characters
- At least 1 number
- At least 1 special character

### Login
```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "myuser",
    "password": "SecurePass123!"
  }'
```

**Response includes JWT token (7-day expiration)**

---

## Package Management

### Upload Addon
```bash
# 1. Encode addon as base64
FILE_B64=$(base64 < my_addon.mcaddon | tr -d '\n')

# 2. Optional: Encode icon as base64
ICON_B64=$(base64 < icon.png | tr -d '\n')

# 3. Upload (with icon)
curl -X POST http://localhost:3000/packages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d "{
    \"name\": \"MyAddon\",
    \"description\": \"My awesome addon\",
    \"version\": \"1.0.0\",
    \"iconBase64\": \"$ICON_B64\",
    \"fileBase64\": \"$FILE_B64\"
  }"
```

**Requirements:**
- Token (Bearer auth required)
- Only .mcaddon files (ZIP format)
- Unique package name

**Icon Upload (Optional):**
- Supported formats: PNG, JPEG, WebP, GIF, SVG
- Maximum size: 2MB
- Send as `iconBase64` field (base64 encoded)
- Icons are stored at `/icons/{packageId}.{ext}`
- SVG files are automatically sanitized to prevent XSS

### Download Addon
```bash
curl http://localhost:3000/packages/MyAddon/download \
  -o my_addon.mcaddon
```

**Result:**
- Binary .mcaddon file downloaded
- Download counter incremented

### List All Packages
```bash
# Default: 20 per page
curl http://localhost:3000/packages

# With pagination
curl "http://localhost:3000/packages?limit=50&offset=0"
```

### Get Package Details
```bash
curl http://localhost:3000/packages/MyAddon
```

### List User Packages
```bash
curl http://localhost:3000/packages/author/myuser
```

### Update Package (Owner Only)
```bash
curl -X PUT http://localhost:3000/packages/1 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "version": "1.1.0",
    "description": "Updated description"
  }'
```

**Note:** Only package owner or admin can update

### Delete Package (Owner Only)
```bash
curl -X DELETE http://localhost:3000/packages/1 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Result:**
- Package deleted from database
- Associated files deleted from storage

---

## File Format

Only `.mcaddon` files are accepted (ZIP format with ZIP magic bytes: `PK\x03\x04`)

### Valid .mcaddon Structure
```
addon.mcaddon (ZIP)
├── behavior_packs/
│   └── my_pack/
│       └── manifest.json
├── resource_packs/
│   └── my_pack/
│       └── manifest.json
└── (optional other files)
```

---

## Error Responses

### Invalid File Format
```json
{
  "error": "Invalid file format. Only .mcaddon files (ZIP format) are supported"
}
```

### Unauthorized
```json
{
  "error": "Unauthorized: Missing or invalid token"
}
```

### Duplicate Package Name
```json
{
  "error": "Package name already exists"
}
```

### Not Found
```json
{
  "error": "Package not found"
}
```

### Access Denied
```json
{
  "error": "Forbidden: You do not own this package"
}
```

---

## Storage

Files stored at: `storage/addons/{packageId}-{packageName}/addon-{timestamp}.mcaddon`

Example:
```
storage/addons/1-MyAddon/addon-1766582957723.mcaddon
storage/addons/2-AnotherPack/addon-1766582850123.mcaddon
```

---

## Tips

- Keep your JWT token secure (7-day expiration)
- Use base64 encoding for file uploads
- Package names must be unique
- Only you (or admin) can update/delete your packages
- Download counter tracks popularity
