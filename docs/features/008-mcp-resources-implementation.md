# ADR 008: MCP Resources Implementation

## Context

Implement MCP resources for managing Coolify entities through the available API endpoints.

## API Endpoints Used

- Database Management:
  - GET `/databases` - List databases
  - GET `/databases/{uuid}` - Get database details
  - POST `/databases/{type}` - Create database
  - PATCH `/databases/{uuid}` - Update database
  - DELETE `/databases/{uuid}` - Delete database

- Deployment Management:
  - GET `/deployments` - List deployments
  - GET `/deployments/{uuid}` - Get deployment details
  - GET `/deploy` - Deploy by tag or uuid

- Application Management:
  - GET `/applications` - List applications
  - GET `/applications/{uuid}` - Get application details
  - POST `/applications/public` - Create public application
  - DELETE `/applications/{uuid}` - Delete application

- Service Management:
  - GET `/services` - List services
  - GET `/services/{uuid}` - Get service details
  - POST `/services` - Create service
  - DELETE `/services/{uuid}` - Delete service

## Implementation Checklist

- [ ] Database Resources
  - [ ] resources://coolify/databases/list
  - [ ] resources://coolify/databases/{id}
  - [ ] resources://coolify/databases/create/{type}
  - [ ] resources://coolify/databases/{id}/update
  - [ ] resources://coolify/databases/{id}/delete

- [ ] Deployment Resources
  - [ ] resources://coolify/deployments/list
  - [ ] resources://coolify/deployments/{id}
  - [ ] resources://coolify/deploy
    - Support for tag-based deployment
    - Support for UUID-based deployment
    - Force rebuild option

- [ ] Application Resources
  - [ ] resources://coolify/applications/list
  - [ ] resources://coolify/applications/{id}
  - [ ] resources://coolify/applications/create
  - [ ] resources://coolify/applications/{id}/delete

- [ ] Service Resources
  - [ ] resources://coolify/services/list
  - [ ] resources://coolify/services/{id}
  - [ ] resources://coolify/services/create
  - [ ] resources://coolify/services/{id}/delete

- [ ] Testing
  - [ ] Database operation tests
  - [ ] Deployment operation tests
  - [ ] Application operation tests
  - [ ] Service operation tests
  - [ ] Error handling tests
  - [ ] Permission validation tests

## Dependencies

- ADR 001 (Core Server Setup)
- ADR 005 (Application Deployment)
- ADR 006 (Database Management)
- ADR 007 (Service Management)