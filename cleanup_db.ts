import { sql, SQL } from "bun";

const sqlite = new SQL("sqlite://bedpak.db");

async function cleanup() {
  try {
    console.log("Starting database cleanup...\n");

    // Get legitbox user ID
    const legitboxUser = await sqlite`SELECT id FROM users WHERE username = 'legitbox'`;
    
    if (!legitboxUser || legitboxUser.length === 0) {
      console.error("Error: legitbox user not found!");
      process.exit(1);
    }

    const legitboxId = legitboxUser[0].id;
    console.log(`✓ Found legitbox user (ID: ${legitboxId})`);

    // Get lunatech package
    const lunatechPackage = await sqlite`SELECT id FROM packages WHERE name = 'lunatech'`;
    const lunatechId = lunatechPackage && lunatechPackage.length > 0 ? lunatechPackage[0].id : null;

    if (lunatechId) {
      console.log(`✓ Found lunatech package (ID: ${lunatechId})`);
    } else {
      console.log(`⚠ lunatech package not found (will not be available to restore)`);
    }

    // Delete all packages except lunatech
    const deletePackagesResult = await sqlite`DELETE FROM packages WHERE name != 'lunatech'`;
    console.log(`✓ Deleted all packages except lunatech`);

    // Delete all users except legitbox
    const deleteUsersResult = await sqlite`DELETE FROM users WHERE username != 'legitbox'`;
    console.log(`✓ Deleted all users except legitbox`);

    // Verify cleanup
    const remainingUsers = await sqlite`SELECT COUNT(*) as count FROM users`;
    const remainingPackages = await sqlite`SELECT COUNT(*) as count FROM packages`;

    console.log(`\n📊 Database status after cleanup:`);
    console.log(`   Users: ${remainingUsers[0].count}`);
    console.log(`   Packages: ${remainingPackages[0].count}`);

    const allUsers = await sqlite`SELECT username FROM users`;
    const allPackages = await sqlite`SELECT name FROM packages`;

    if (allUsers.length > 0) {
      console.log(`\n✓ Remaining users: ${allUsers.map((u: any) => u.username).join(", ")}`);
    }

    if (allPackages.length > 0) {
      console.log(`✓ Remaining packages: ${allPackages.map((p: any) => p.name).join(", ")}`);
    }

    console.log(`\n✨ Database cleanup complete!`);
    sqlite.close();
    process.exit(0);
  } catch (err) {
    console.error("Cleanup error:", err);
    sqlite.close();
    process.exit(1);
  }
}

cleanup();
