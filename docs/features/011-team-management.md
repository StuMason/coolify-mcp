# ADR 011: Team Management

## Context

Implementation of team management features through MCP resources, allowing users to manage teams and team members in Coolify.

## API Endpoints Used

- GET `/teams` (List)
  - Lists all teams
  - Response: Array of Team objects
  - Auth: Bearer token required

- GET `/teams/{id}` (Get)
  - Get team details by ID
  - Response: Team object
  - Auth: Bearer token required

- GET `/teams/{id}/members` (List Members)
  - Get team members by team ID
  - Response: Array of User objects
  - Auth: Bearer token required

- GET `/teams/current` (Get Current)
  - Get currently authenticated team
  - Response: Team object
  - Auth: Bearer token required

- GET `/teams/current/members` (Get Current Members)
  - Get currently authenticated team members
  - Response: Array of User objects
  - Auth: Bearer token required

## Implementation Checklist

- [ ] Basic Team Management
  - [ ] List teams resource
  - [ ] Get team details
  - [ ] List team members
  - [ ] Get current team
  - [ ] Get current team members

- [ ] Team Features
  - [ ] Team information display
  - [ ] Member list management
  - [ ] Team permissions handling
  - [ ] Current team context

- [ ] Resource Testing
  - [ ] Unit tests for team operations
  - [ ] Integration tests with mock data
  - [ ] Live test with real Coolify instance
  - [ ] Permission testing

## Dependencies

- ADR 001 (Core Server Setup)
- ADR 002 (Server Information Resources)