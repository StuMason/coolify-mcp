# ADR 010: Private Key Management

## Context

Implementation of private key management features through MCP resources, allowing users to manage SSH keys for server access and deployment.

## API Endpoints Used

- GET `/security/keys` (List)
  - Lists all private keys
  - Response: Array of PrivateKey objects
  - Auth: Bearer token required

- POST `/security/keys` (Create)
  - Create a new private key
  - Required fields:
    - private_key
  - Optional fields:
    - name
    - description
  - Response: { uuid: string }
  - Auth: Bearer token required

- GET `/security/keys/{uuid}` (Get)
  - Get private key details
  - Response: PrivateKey object
  - Auth: Bearer token required

- PATCH `/security/keys` (Update)
  - Update a private key
  - Required fields:
    - private_key
  - Optional fields:
    - name
    - description
  - Response: { uuid: string }
  - Auth: Bearer token required

- DELETE `/security/keys/{uuid}` (Delete)
  - Delete a private key
  - Response: { message: string }
  - Auth: Bearer token required

## Implementation Checklist

- [ ] Basic Key Management
  - [ ] List private keys resource
  - [ ] Get private key details
  - [ ] Create private key
  - [ ] Update private key
  - [ ] Delete private key

- [ ] Security Features
  - [ ] Secure key storage
  - [ ] Key validation
  - [ ] Usage tracking
  - [ ] Access control

- [ ] Resource Testing
  - [ ] Unit tests for key operations
  - [ ] Integration tests with mock data
  - [ ] Live test with real Coolify instance
  - [ ] Security testing

## Dependencies

- ADR 001 (Core Server Setup)
- ADR 002 (Server Information Resources)