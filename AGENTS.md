# Agent Guidelines

## Project Overview
BedPak is a backend API for hosting, sharing, and uploading Minecraft Bedrock add-ons. Built with Elysia and SQLite.

## Build & Development Commands
- **Dev server**: `bun run --watch src/index.ts` - Starts Elysia server with hot reload on port 3000
- **Test**: No test framework configured yet (`bun test` when tests are added)

## Code Style Guidelines

**Imports**: Use ES6 imports at the top of files. Import statements must be ordered (external packages first, then local modules).
```typescript
import { Elysia } from "elysia";
import { DB } from "./db_controller";
```

**Naming**: Use camelCase for variables/functions, PascalCase for classes/exports. Database columns use snake_case (e.g., `password_hash`, `author_id`).

**Types**: Strict TypeScript mode enabled. All function parameters and returns must be typed. Use `public`/`private` access modifiers for class members.

**Formatting**: 2-space indentation, double quotes for strings, no semicolons except in SQL queries.

**Error Handling**: Wrap database operations with try-catch. Return results/errors from async functions explicitly.

**Functions**: Use `async`/`await` for database calls. Public methods in classes should be prefixed with `public`. SQL templates use backticks for interpolation: `` `...${variable}...` ``.

**Database**: Use Bun's native SQL API. Parameterized queries prevent injection. Methods should return query results directly via `RETURNING *`.
