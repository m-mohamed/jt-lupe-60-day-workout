/** Apply idempotent Agent SQLite startup and retirement migrations. */
export function initializeAgentSchema(database) {
  // Personal OAuth was removed in favor of the workspace secret. Delete any
  // credential left by an older Agent version so retired personal keys do not
  // remain stranded in Durable Object SQLite.
  void database.sql`DROP TABLE IF EXISTS training_credentials`;
  void database.sql`CREATE TABLE IF NOT EXISTS training_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL,
    text TEXT NOT NULL,
    created TEXT NOT NULL
  )`;
}
