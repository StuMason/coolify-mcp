# ADR 012: Backup Management

## Context

Implement backup and restore capabilities for databases and services using MCP resources and server-side commands.

## Implementation Strategy

### MCP Resources

- `resources://coolify/backups/databases/{id}`
  - GET: List available backups
  - POST: Create new backup
  - DELETE: Remove backup

- `resources://coolify/backups/databases/{id}/restore`
  - POST: Restore from backup

### Database-Specific Implementations

#### PostgreSQL
```bash
# Backup
pg_dump -U ${POSTGRES_USER} -h localhost ${POSTGRES_DB} > backup.sql

# Restore
psql -U ${POSTGRES_USER} -h localhost ${POSTGRES_DB} < backup.sql
```

#### MySQL/MariaDB
```bash
# Backup
mysqldump -u ${MYSQL_USER} -p${MYSQL_PASSWORD} ${MYSQL_DATABASE} > backup.sql

# Restore
mysql -u ${MYSQL_USER} -p${MYSQL_PASSWORD} ${MYSQL_DATABASE} < backup.sql
```

#### MongoDB
```bash
# Backup
mongodump --uri="mongodb://${MONGO_INITDB_ROOT_USERNAME}:${MONGO_INITDB_ROOT_PASSWORD}@localhost:27017" --out=backup

# Restore
mongorestore --uri="mongodb://${MONGO_INITDB_ROOT_USERNAME}:${MONGO_INITDB_ROOT_PASSWORD}@localhost:27017" backup
```

#### Redis
```bash
# Backup (using RDB)
redis-cli -a ${REDIS_PASSWORD} SAVE

# Restore
# (Copy dump.rdb to redis data directory)
```

### Implementation Checklist

- [ ] Core Backup Infrastructure
  - [ ] Backup storage location management
  - [ ] Backup file naming and versioning
  - [ ] Backup rotation and cleanup
  - [ ] Backup metadata tracking

- [ ] Database Type Support
  - [ ] PostgreSQL backup/restore
  - [ ] MySQL/MariaDB backup/restore
  - [ ] MongoDB backup/restore
  - [ ] Redis backup/restore
  - [ ] Other database types

- [ ] MCP Integration
  - [ ] Backup resource endpoints
  - [ ] Restore resource endpoints
  - [ ] Backup listing and management
  - [ ] Progress tracking and status updates

- [ ] Security Features
  - [ ] Backup encryption
  - [ ] Secure credential handling
  - [ ] Access control

- [ ] Testing
  - [ ] Backup creation tests
  - [ ] Restore verification tests
  - [ ] Error handling
  - [ ] Security testing

## Dependencies

- ADR 001 (Core Server Setup)
- ADR 002 (Server Information Resources)
- ADR 006 (Database Management)
- ADR 008 (MCP Resources Implementation)