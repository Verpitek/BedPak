import { sql, SQL } from "bun";

export class DB {
  sqlite: SQL;

  public constructor() {
    this.sqlite = new SQL("sqlite://bedpak.db");
  }

  public async initDB() {
    try {
      // Create users table if it doesn't exist
      await this.sqlite`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT DEFAULT 'user',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`;

      // Create packages table if it doesn't exist
      await this.sqlite`
        CREATE TABLE IF NOT EXISTS packages (
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
            FOREIGN KEY (author_id) REFERENCES users(id)
        )`;

      // Create index if it doesn't exist
      await this.sqlite`
        CREATE INDEX IF NOT EXISTS idx_packages_author ON packages(author_id)`;

      // Create tags table
      await this.sqlite`
        CREATE TABLE IF NOT EXISTS tags (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          slug TEXT NOT NULL UNIQUE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`;

      // Create package_tags junction table
      await this.sqlite`
        CREATE TABLE IF NOT EXISTS package_tags (
          package_id INTEGER NOT NULL,
          tag_id INTEGER NOT NULL,
          PRIMARY KEY (package_id, tag_id),
          FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE CASCADE,
          FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        )`;

      // Create indexes for package_tags
      await this.sqlite`
        CREATE INDEX IF NOT EXISTS idx_package_tags_package ON package_tags(package_id)`;
      await this.sqlite`
        CREATE INDEX IF NOT EXISTS idx_package_tags_tag ON package_tags(tag_id)`;

      // Run migrations
      // Create download_history table
      await this.sqlite`
        CREATE TABLE IF NOT EXISTS download_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          package_id INTEGER NOT NULL,
          date TEXT NOT NULL,
          download_count INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE CASCADE,
          UNIQUE(package_id, date)
        )`;

      // Create index for faster queries
      await this.sqlite`
        CREATE INDEX IF NOT EXISTS idx_download_history_package_date ON download_history(package_id, date)`;
      await this.sqlite`
        CREATE INDEX IF NOT EXISTS idx_download_history_date ON download_history(date)`;

      await this.runMigrations();

      // Seed default tags
      await this.seedDefaultTags();
    } catch (err) {
      console.error("Database initialization error:", err);
      throw err;
    }
  }

   private async runMigrations() {
     try {
       // Check if role column exists in users table
       const userTableInfo = await this.sqlite`PRAGMA table_info(users)`;
       const hasRoleColumn = userTableInfo.some(
         (col: Record<string, unknown>) => col.name === "role"
       );

       if (!hasRoleColumn) {
         await this.sqlite`ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'`;
         console.log("✓ Migration: Added role column to users table");
       }

       // Check if icon_url column exists in packages table
       const packagesTableInfo = await this.sqlite`PRAGMA table_info(packages)`;
       const hasIconUrlColumn = packagesTableInfo.some(
         (col: Record<string, unknown>) => col.name === "icon_url"
       );

       if (!hasIconUrlColumn) {
         await this.sqlite`ALTER TABLE packages ADD COLUMN icon_url TEXT`;
         console.log("✓ Migration: Added icon_url column to packages table");
       }

       // Check if kofi_url column exists in packages table
       const packagesTableInfoUpdated = await this.sqlite`PRAGMA table_info(packages)`;
       const hasKofiUrlColumn = packagesTableInfoUpdated.some(
         (col: Record<string, unknown>) => col.name === "kofi_url"
       );

       if (!hasKofiUrlColumn) {
         await this.sqlite`ALTER TABLE packages ADD COLUMN kofi_url TEXT`;
         console.log("✓ Migration: Added kofi_url column to packages table");
       }

       // Check if long_description column exists in packages table
       const packagesTableInfoForLongDesc = await this.sqlite`PRAGMA table_info(packages)`;
       const hasLongDescriptionColumn = packagesTableInfoForLongDesc.some(
         (col: Record<string, unknown>) => col.name === "long_description"
       );

       if (!hasLongDescriptionColumn) {
         await this.sqlite`ALTER TABLE packages ADD COLUMN long_description TEXT`;
         console.log("✓ Migration: Added long_description column to packages table");
       }

       // Check if min_game_version column exists in packages table
       const packagesTableInfoForGameVersion = await this.sqlite`PRAGMA table_info(packages)`;
       const hasMinGameVersionColumn = packagesTableInfoForGameVersion.some(
         (col: Record<string, unknown>) => col.name === "min_game_version"
       );

       if (!hasMinGameVersionColumn) {
         await this.sqlite`ALTER TABLE packages ADD COLUMN min_game_version TEXT`;
         console.log("✓ Migration: Added min_game_version column to packages table");
       }

       // Check if max_game_version column exists in packages table
       const packagesTableInfoForMaxGameVersion = await this.sqlite`PRAGMA table_info(packages)`;
       const hasMaxGameVersionColumn = packagesTableInfoForMaxGameVersion.some(
         (col: Record<string, unknown>) => col.name === "max_game_version"
       );

       if (!hasMaxGameVersionColumn) {
         await this.sqlite`ALTER TABLE packages ADD COLUMN max_game_version TEXT`;
         console.log("✓ Migration: Added max_game_version column to packages table");
       }

        // Check if youtube_url column exists in packages table
        const packagesTableInfoForYoutube = await this.sqlite`PRAGMA table_info(packages)`;
        const hasYoutubeUrlColumn = packagesTableInfoForYoutube.some(
          (col: Record<string, unknown>) => col.name === "youtube_url"
        );

        if (!hasYoutubeUrlColumn) {
          await this.sqlite`ALTER TABLE packages ADD COLUMN youtube_url TEXT`;
          console.log("✓ Migration: Added youtube_url column to packages table");
        }

        // Check if discord_url column exists in packages table
        const packagesTableInfoForDiscord = await this.sqlite`PRAGMA table_info(packages)`;
        const hasDiscordUrlColumn = packagesTableInfoForDiscord.some(
          (col: Record<string, unknown>) => col.name === "discord_url"
        );

        if (!hasDiscordUrlColumn) {
          await this.sqlite`ALTER TABLE packages ADD COLUMN discord_url TEXT`;
          console.log("✓ Migration: Added discord_url column to packages table");
        }

       // Check if category_id column exists in packages table (for single-category system)
       const packagesTableInfoForCategory = await this.sqlite`PRAGMA table_info(packages)`;
       const hasCategoryIdColumn = packagesTableInfoForCategory.some(
         (col: Record<string, unknown>) => col.name === "category_id"
       );

       if (!hasCategoryIdColumn) {
         await this.sqlite`ALTER TABLE packages ADD COLUMN category_id INTEGER REFERENCES tags(id)`;
         console.log("✓ Migration: Added category_id column to packages table");
         
         // Migrate existing package_tags to category_id (use first tag as category)
         const packagesWithTags = await this.sqlite`
           SELECT DISTINCT pt.package_id, pt.tag_id 
           FROM package_tags pt 
           WHERE pt.tag_id = (
             SELECT MIN(pt2.tag_id) FROM package_tags pt2 WHERE pt2.package_id = pt.package_id
           )
         `;
         
         for (const row of packagesWithTags) {
           await this.sqlite`UPDATE packages SET category_id = ${row.tag_id} WHERE id = ${row.package_id}`;
         }
         
         console.log("✓ Migration: Migrated existing tags to category_id");
       }

       // Clean up old tags and add new categories
       await this.migrateToNewCategories();
     } catch (err) {
       console.error("Migration error:", err);
     }
   }

   private async migrateToNewCategories() {
     try {
       // Check if we've already done this migration by looking for a new category
       const hasNewCategory = await this.sqlite`SELECT id FROM tags WHERE slug = 'game-mechanics' LIMIT 1`;
       
       if (hasNewCategory.length === 0) {
         // Map old tags to new categories where possible
         const tagMigrationMap: Record<string, string> = {
           "items": "equipment",
           "blocks": "decoration",
           "biomes": "world-generation",
           "dimensions": "world-generation",
           "weapons": "equipment",
           "tools": "equipment",
           "armor": "equipment",
           "survival": "game-mechanics",
           "creative": "utility",
           "qol": "utility",
           "utilities": "utility",
           "tweaks": "game-mechanics",
           "overhaul": "game-mechanics",
         };

         // Update packages that have old category slugs to use new ones
         for (const [oldSlug, newSlug] of Object.entries(tagMigrationMap)) {
           const oldTag = await this.sqlite`SELECT id FROM tags WHERE slug = ${oldSlug} LIMIT 1`;
           if (oldTag.length > 0) {
             // We'll handle this after seeding new categories
           }
         }

         console.log("✓ Migration: Category migration prepared (will complete after seeding)");
       }
     } catch (err) {
       console.error("Category migration error:", err);
     }
   }

   private async seedDefaultTags() {
     try {
       // New Modrinth-style fixed categories
       const defaultCategories = [
         // Gameplay categories
         { name: "Adventure", slug: "adventure" },
         { name: "Decoration", slug: "decoration" },
         { name: "Economy", slug: "economy" },
         { name: "Equipment", slug: "equipment" },
         { name: "Food", slug: "food" },
         { name: "Game Mechanics", slug: "game-mechanics" },
         { name: "Magic", slug: "magic" },
         { name: "Management", slug: "management" },
         { name: "Minigame", slug: "minigame" },
         { name: "Mobs", slug: "mobs" },
         { name: "Optimisation", slug: "optimisation" },
         { name: "Social", slug: "social" },
         { name: "Storage", slug: "storage" },
         { name: "Technology", slug: "technology" },
         { name: "Transportation", slug: "transportation" },
         { name: "Utility", slug: "utility" },
         { name: "World Generation", slug: "world-generation" },
         // Server-specific categories
         { name: "Administration", slug: "administration" },
         { name: "Anti-Cheat", slug: "anti-cheat" },
         { name: "Chat", slug: "chat" },
         { name: "Moderation", slug: "moderation" },
         { name: "Permissions", slug: "permissions" },
       ];

       for (const category of defaultCategories) {
         await this.sqlite`INSERT OR IGNORE INTO tags (name, slug) VALUES (${category.name}, ${category.slug})`;
       }
     } catch (err) {
       console.error("Seed categories error:", err);
     }
   }

  public async createUser(
    username: string,
    email: string,
    passwordHash: string,
    role: string = "user",
  ) {
    return await this
      .sqlite`INSERT INTO users (username, email, password_hash, role) VALUES(${username}, ${email}, ${passwordHash}, ${role}) RETURNING *`;
  }

   public async removeUser(userId: number) {
     await this.sqlite`DELETE FROM users WHERE id = ${userId}`;
   }

  public async getUser(username: string) {
    const results = await this
      .sqlite`SELECT * FROM users WHERE username = ${username}`;
    return results[0];
  }

  public async getUserById(userId: number) {
    const results = await this
      .sqlite`SELECT * FROM users WHERE id = ${userId}`;
    return results[0];
  }

  public async getUserByEmail(email: string) {
    const results = await this
      .sqlite`SELECT * FROM users WHERE email = ${email}`;
    return results[0];
  }

   public async updateUserRole(userId: number, newRole: string) {
     return await this
       .sqlite`UPDATE users SET role = ${newRole} WHERE id = ${userId} RETURNING *`;
   }

   public async updateUserProfile(
     userId: number,
     username?: string,
     email?: string,
     password?: string,
   ) {
     // Get current user data to preserve unchanged fields
     const currentUser = await this.getUserById(userId);
     if (!currentUser) {
       return [];
     }

     // Use provided values or fall back to current values
     const newUsername = username !== undefined && username !== null ? username : currentUser.username;
     const newEmail = email !== undefined && email !== null ? email : currentUser.email;
     let newPasswordHash = currentUser.password_hash;

     // Only hash password if provided
     if (password !== undefined && password !== null) {
       const { hashPassword } = await import("./auth");
       newPasswordHash = await hashPassword(password);
     }

     return await this
       .sqlite`UPDATE users SET username = ${newUsername}, email = ${newEmail}, password_hash = ${newPasswordHash} WHERE id = ${userId} RETURNING *`;
   }

  public async getAllUsers() {
    return await this.sqlite`SELECT id, username, email, role, created_at FROM users ORDER BY created_at DESC`;
  }
   
  public async createPackage(
    name: string,
    description: string,
    authorId: number,
    filePath: string,
    fileHash: string,
    version: string,
    iconUrl?: string,
    kofiUrl?: string,
    longDescription?: string,
    youtubeUrl?: string,
    discordUrl?: string,
    categoryId?: number
  ) {
    const iconUrlValue = iconUrl || null;
    const kofiUrlValue = kofiUrl || null;
    const longDescValue = longDescription || null;
    const youtubeUrlValue = youtubeUrl || null;
    const discordUrlValue = discordUrl || null;
    const categoryIdValue = categoryId || null;
    
    return await this.sqlite`INSERT INTO packages (name, description, author_id, file_path, file_hash, version, icon_url, kofi_url, long_description, youtube_url, discord_url, category_id) VALUES(${name}, ${description}, ${authorId}, ${filePath}, ${fileHash}, ${version}, ${iconUrlValue}, ${kofiUrlValue}, ${longDescValue}, ${youtubeUrlValue}, ${discordUrlValue}, ${categoryIdValue}) RETURNING *`;
  }

  public async getPackage(name: string) {
    const results = await this.sqlite`SELECT * FROM packages WHERE name = ${name}`;
    return results[0];
  }

  public async getAllPackages(limit: number = 20, offset: number = 0) {
    return await this.sqlite`
      SELECT 
        p.*,
        t.id as tag_id, t.name as tag_name, t.slug as tag_slug
      FROM packages p
      LEFT JOIN tags t ON p.category_id = t.id
      ORDER BY p.created_at DESC 
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  public async getPackagesByAuthor(authorId: number) {
    return await this.sqlite`SELECT * FROM packages WHERE author_id = ${authorId} ORDER BY created_at DESC`;
  }

  public async updatePackage(
    packageId: number,
    name?: string,
    description?: string,
    version?: string,
    iconUrl?: string | null,
    kofiUrl?: string | null,
    longDescription?: string | null,
    youtubeUrl?: string | null,
    discordUrl?: string | null,
    categoryId?: number | null
  ) {
    // Get current package data to preserve unchanged fields
    const currentPkg = await this.sqlite`SELECT * FROM packages WHERE id = ${packageId}`;
    if (!currentPkg || currentPkg.length === 0) {
      return [];
    }

    const current = currentPkg[0] as Record<string, unknown>;

    // Use provided values or fall back to current values
    const newName = name !== undefined ? name : current.name as string;
    const newDescription = description !== undefined ? description : current.description as string;
    const newVersion = version !== undefined ? version : current.version as string;
    const newIconUrl = iconUrl !== undefined ? (iconUrl || null) : current.icon_url as string | null;
    const newKofiUrl = kofiUrl !== undefined ? (kofiUrl || null) : current.kofi_url as string | null;
    const newLongDescription = longDescription !== undefined ? (longDescription || null) : current.long_description as string | null;
    const newYoutubeUrl = youtubeUrl !== undefined ? (youtubeUrl || null) : current.youtube_url as string | null;
    const newDiscordUrl = discordUrl !== undefined ? (discordUrl || null) : current.discord_url as string | null;
    const newCategoryId = categoryId !== undefined ? categoryId : current.category_id as number | null;

    return await this.sqlite`UPDATE packages SET name = ${newName}, description = ${newDescription}, version = ${newVersion}, icon_url = ${newIconUrl}, kofi_url = ${newKofiUrl}, long_description = ${newLongDescription}, youtube_url = ${newYoutubeUrl}, discord_url = ${newDiscordUrl}, category_id = ${newCategoryId}, updated_at = CURRENT_TIMESTAMP WHERE id = ${packageId} RETURNING *`;
  }

  public async deletePackage(packageId: number) {
    await this.sqlite`DELETE FROM packages WHERE id = ${packageId}`;
  }

   public async incrementDownloads(packageId: number) {
     const today = new Date().toISOString().split('T')[0];
     // Update download_history with UPSERT
     await this.sqlite`
       INSERT INTO download_history (package_id, date, download_count) 
       VALUES (${packageId}, ${today}, 1)
       ON CONFLICT(package_id, date) DO UPDATE SET 
         download_count = download_count + 1,
         updated_at = CURRENT_TIMESTAMP
     `;
     // Increment total downloads in packages table
     return await this.sqlite`UPDATE packages SET downloads = downloads + 1 WHERE id = ${packageId} RETURNING *`;
   }

   public async updatePackageIcon(packageId: number, iconUrl: string) {
     return await this.sqlite`UPDATE packages SET icon_url = ${iconUrl} WHERE id = ${packageId} RETURNING *`;
   }

   public async getTotalPackageCount(): Promise<number> {
     const result = await this.sqlite`SELECT COUNT(*) as count FROM packages`;
     return result[0]?.count ?? 0;
   }

   public async getAdminCount(): Promise<number> {
     const result = await this.sqlite`SELECT COUNT(*) as count FROM users WHERE role = 'admin'`;
     return result[0]?.count ?? 0;
   }

  // ==================== TAG METHODS ====================

  public async createTag(name: string, slug: string) {
    return await this.sqlite`INSERT INTO tags (name, slug) VALUES (${name}, ${slug}) RETURNING *`;
  }

  public async getAllTags() {
    return await this.sqlite`SELECT * FROM tags ORDER BY name ASC`;
  }

  public async getTagById(tagId: number) {
    const results = await this.sqlite`SELECT * FROM tags WHERE id = ${tagId}`;
    return results[0];
  }

  public async getTagBySlug(slug: string) {
    const results = await this.sqlite`SELECT * FROM tags WHERE slug = ${slug}`;
    return results[0];
  }

  public async getPopularTags(limit: number = 10) {
    return await this.sqlite`
      SELECT t.*, COUNT(pt.package_id) as usage_count
      FROM tags t
      LEFT JOIN package_tags pt ON t.id = pt.tag_id
      GROUP BY t.id
      ORDER BY usage_count DESC, t.name ASC
      LIMIT ${limit}
    `;
  }

  public async deleteTag(tagId: number) {
    await this.sqlite`DELETE FROM tags WHERE id = ${tagId}`;
  }

  // ==================== PACKAGE-TAG METHODS ====================

  public async addTagToPackage(packageId: number, tagId: number) {
    return await this.sqlite`INSERT OR IGNORE INTO package_tags (package_id, tag_id) VALUES (${packageId}, ${tagId}) RETURNING *`;
  }

  public async removeTagFromPackage(packageId: number, tagId: number) {
    await this.sqlite`DELETE FROM package_tags WHERE package_id = ${packageId} AND tag_id = ${tagId}`;
  }

  public async getPackageTags(packageId: number) {
    return await this.sqlite`
      SELECT t.*
      FROM tags t
      INNER JOIN package_tags pt ON t.id = pt.tag_id
      WHERE pt.package_id = ${packageId}
      ORDER BY t.name ASC
    `;
  }

  public async setPackageTags(packageId: number, tagIds: number[]) {
    // Remove all existing tags for the package
    await this.sqlite`DELETE FROM package_tags WHERE package_id = ${packageId}`;
    
    // Add new tags
    for (const tagId of tagIds) {
      await this.sqlite`INSERT OR IGNORE INTO package_tags (package_id, tag_id) VALUES (${packageId}, ${tagId})`;
    }
  }

  public async getPackagesByTag(tagId: number, limit: number = 20, offset: number = 0) {
    return await this.sqlite`
      SELECT p.*
      FROM packages p
      INNER JOIN package_tags pt ON p.id = pt.package_id
      WHERE pt.tag_id = ${tagId}
      ORDER BY p.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  public async getPackagesByTags(tagSlugs: string[], limit: number = 20, offset: number = 0) {
    // Get packages that have ALL the specified tags
    const tagCount = tagSlugs.length;
    if (tagCount === 0) {
      return await this.getAllPackages(limit, offset);
    }

    // Build a query that finds packages matching all tags
    // Using GROUP BY and HAVING COUNT to ensure all tags are present
    return await this.sqlite`
      SELECT p.*, COUNT(DISTINCT t.id) as matched_tags
      FROM packages p
      INNER JOIN package_tags pt ON p.id = pt.package_id
      INNER JOIN tags t ON pt.tag_id = t.id
      WHERE t.slug IN (${tagSlugs})
      GROUP BY p.id
      HAVING matched_tags = ${tagCount}
      ORDER BY p.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  public async getPackagesCountByTags(tagSlugs: string[]): Promise<number> {
    const tagCount = tagSlugs.length;
    if (tagCount === 0) {
      return await this.getTotalPackageCount();
    }

    const result = await this.sqlite`
      SELECT COUNT(*) as count FROM (
        SELECT p.id
        FROM packages p
        INNER JOIN package_tags pt ON p.id = pt.package_id
        INNER JOIN tags t ON pt.tag_id = t.id
        WHERE t.slug IN (${tagSlugs})
        GROUP BY p.id
        HAVING COUNT(DISTINCT t.id) = ${tagCount}
      )
    `;
    return result[0]?.count ?? 0;
  }

  // Get packages with ANY matching tags (for related packages)
  public async getPackagesWithAnyTags(tagSlugs: string[], limit: number = 20, offset: number = 0) {
    if (tagSlugs.length === 0) {
      return await this.getAllPackages(limit, offset);
    }

    // Get packages that have ANY of the specified tags, ordered by how many tags match
    const packages = await this.sqlite`
      SELECT p.*, COUNT(DISTINCT t.id) as matched_tags
      FROM packages p
      INNER JOIN package_tags pt ON p.id = pt.package_id
      INNER JOIN tags t ON pt.tag_id = t.id
      WHERE t.slug IN (${tagSlugs})
      GROUP BY p.id
      ORDER BY matched_tags DESC, p.downloads DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    // Enrich with tags for each package
    const enrichedPackages = [];
    for (const pkg of packages) {
      const tags = await this.getPackageTags(pkg.id);
      enrichedPackages.push({
        ...pkg,
        tags: tags.map((tag: Record<string, unknown>) => ({
          id: tag.id,
          name: tag.name,
          slug: tag.slug,
        })),
      });
    }

    return enrichedPackages;
  }

  // ==================== FULL PACKAGE DATA ====================

  public async getFullPackageData(packageName: string) {
    // Get the package
    const pkg = await this.getPackage(packageName);
    if (!pkg) {
      return null;
    }

    // Get the author
    const author = await this.getUserById(pkg.author_id);

    // Get the category (single category system)
    let category = null;
    if (pkg.category_id) {
      category = await this.getTagById(pkg.category_id);
    }

    // Get the tags (for backwards compatibility, also check package_tags)
    const tags = await this.getPackageTags(pkg.id);

    return {
      ...pkg,
      author: author ? {
        id: author.id,
        username: author.username,
      } : null,
      category: category ? {
        id: category.id,
        name: category.name,
        slug: category.slug,
      } : null,
      tags: tags.map((tag: Record<string, unknown>) => ({
        id: tag.id,
        name: tag.name,
        slug: tag.slug,
      })),
    };
  }

  // ==================== CATEGORY METHODS ====================

  public async getPackagesByCategory(categorySlug: string, limit: number = 20, offset: number = 0) {
    const category = await this.getTagBySlug(categorySlug);
    if (!category) {
      return [];
    }

    return await this.sqlite`
      SELECT 
        p.*,
        t.id as tag_id, t.name as tag_name, t.slug as tag_slug
      FROM packages p
      LEFT JOIN tags t ON p.category_id = t.id
      WHERE p.category_id = ${category.id}
      ORDER BY p.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  public async getPackagesCountByCategory(categorySlug: string): Promise<number> {
    const category = await this.getTagBySlug(categorySlug);
    if (!category) {
      return 0;
    }

    const result = await this.sqlite`
      SELECT COUNT(*) as count FROM packages WHERE category_id = ${category.id}
    `;
    return result[0]?.count ?? 0;
  }

  public async setPackageCategory(packageId: number, categoryId: number | null) {
    return await this.sqlite`UPDATE packages SET category_id = ${categoryId}, updated_at = CURRENT_TIMESTAMP WHERE id = ${packageId} RETURNING *`;
  }

   // ==================== DOWNLOAD HISTORY METHODS ====================

   public async getDailyDownloads(packageId: number, days: number = 30): Promise<Array<{date: string, count: number}>> {
     try {
       const today = new Date().toISOString().split('T')[0];
       const startDate = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
       
       // Generate date series using recursive CTE
       const results = await this.sqlite`
         WITH RECURSIVE dates(date) AS (
           SELECT ${startDate}
           UNION ALL
           SELECT date(date, '+1 day')
           FROM dates
           WHERE date < ${today}
         )
         SELECT 
           dates.date as date,
           COALESCE(dh.download_count, 0) as count
         FROM dates
         LEFT JOIN download_history dh ON dates.date = dh.date AND dh.package_id = ${packageId}
         ORDER BY dates.date DESC
       `;
       
       return results.map((row: Record<string, unknown>) => ({
         date: row.date as string,
         count: row.count as number
       }));
     } catch (err) {
       console.error("Error fetching daily downloads:", err);
       return [];
     }
   }

   public async getMonthlyDownloads(packageId: number, months: number = 12): Promise<Array<{month: string, count: number}>> {
     try {
       // Calculate start date (first day of month X months ago)
       const now = new Date();
       const startDate = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
       const startYearMonth = startDate.getFullYear() + '-' + String(startDate.getMonth() + 1).padStart(2, '0');
       
       const results = await this.sqlite`
         SELECT 
           strftime('%Y-%m', date) as month,
           SUM(download_count) as total_downloads
         FROM download_history
         WHERE package_id = ${packageId}
           AND date >= ${startYearMonth + '-01'}
         GROUP BY strftime('%Y-%m', date)
         ORDER BY month DESC
         LIMIT ${months}
       `;
       
       return results.map((row: Record<string, unknown>) => ({
         month: row.month as string,
         count: row.total_downloads as number
       }));
     } catch (err) {
       console.error("Error fetching monthly downloads:", err);
       return [];
     }
   }

   public async getTotalDownloadsByDateRange(startDate: string, endDate: string): Promise<number> {
     try {
       const result = await this.sqlite`
         SELECT COALESCE(SUM(download_count), 0) as total
         FROM download_history
         WHERE date >= ${startDate} AND date <= ${endDate}
       `;
       return result[0]?.total ?? 0;
     } catch (err) {
       console.error("Error fetching total downloads by date range:", err);
       return 0;
     }
   }

}
