# Team API Documentation

## Overview
The Team API enables scalable collaboration where multiple users can share API keys and messages within a team. This architecture is designed to scale from small teams to large organizations.

## Base URL
```
/api/teams
```

## Authentication
All endpoints require authentication. Include the session cookie or authorization header in requests.

---

## Endpoints

### 1. Create Team
**POST** `/api/teams`

Create a new team. The user creating the team becomes the owner.

**Request Body:**
```json
{
  "name": "Marketing Team"
}
```

**Response (201):**
```json
{
  "message": "Team created successfully",
  "team": {
    "id": "team_123",
    "name": "Marketing Team",
    "createdAt": "2024-04-26T10:00:00Z",
    "members": [
      {
        "id": "member_123",
        "userId": "user_123",
        "role": "OWNER",
        "joinedAt": "2024-04-26T10:00:00Z",
        "user": {
          "id": "user_123",
          "name": "John Doe",
          "email": "john@example.com",
          "picture": "https://..."
        }
      }
    ],
    "apiKeys": []
  }
}
```

---

### 2. List User Teams
**GET** `/api/teams`

Get all teams the current user is a member of.

**Response (200):**
```json
{
  "teams": [
    {
      "id": "team_123",
      "name": "Marketing Team",
      "createdAt": "2024-04-26T10:00:00Z",
      "members": [...],
      "apiKeys": [...]
    }
  ]
}
```

---

### 3. Get Team Details
**GET** `/api/teams/:teamId`

Get detailed information about a specific team.

**Parameters:**
- `teamId` (path): The team ID

**Response (200):**
```json
{
  "team": {
    "id": "team_123",
    "name": "Marketing Team",
    "createdAt": "2024-04-26T10:00:00Z",
    "members": [...],
    "apiKeys": [...]
  }
}
```

**Error (403):**
```json
{
  "message": "You don't have access to this team"
}
```

---

### 4. Update Team
**PATCH** `/api/teams/:teamId`

Update team information (owner only).

**Request Body:**
```json
{
  "name": "New Team Name"
}
```

**Response (200):**
```json
{
  "message": "Team updated successfully",
  "team": {...}
}
```

**Error (403):**
```json
{
  "message": "Only owners can update team details"
}
```

---

### 5. Add Team Member
**POST** `/api/teams/:teamId/members`

Add a new member to the team (admin or owner only).

**Request Body:**
```json
{
  "email": "friend@example.com",
  "role": "MEMBER"
}
```

**Valid Roles:**
- `MEMBER` (default): Can view messages and use team API keys
- `ADMIN`: Can add/remove members and view messages
- `OWNER`: Can manage team, created only during team creation

**Response (201):**
```json
{
  "message": "Member added successfully",
  "member": {
    "id": "member_456",
    "userId": "user_456",
    "role": "MEMBER",
    "joinedAt": "2024-04-26T11:00:00Z",
    "user": {
      "id": "user_456",
      "name": "Jane Doe",
      "email": "friend@example.com",
      "picture": "https://..."
    }
  }
}
```

**Errors:**
```json
// User doesn't have permission
{
  "message": "You don't have permission to add members"
}

// User not found
{
  "message": "User with this email not found"
}

// Already a member
{
  "message": "User is already a member of this team"
}
```

---

### 6. Remove Team Member
**DELETE** `/api/teams/:teamId/members/:memberId`

Remove a member from the team (admin or owner only).

**Response (200):**
```json
{
  "message": "Member removed successfully"
}
```

**Errors:**
```json
// Permission denied
{
  "message": "You don't have permission to remove members"
}

// Can't remove only owner
{
  "message": "Cannot remove the only owner"
}
```

---

### 7. Get Team Messages
**GET** `/api/teams/:teamId/messages`

Get all messages from all API keys in the team.

**Query Parameters:**
- `limit` (number, default: 50, max: 200): Number of messages to return
- `offset` (number, default: 0): Pagination offset

**Response (200):**
```json
{
  "messages": [
    {
      "id": "msg_123",
      "sender": "Customer Name",
      "email": "customer@example.com",
      "subject": "Hello",
      "message": "I have a question...",
      "phone": "+1-555-0000",
      "website": "https://customer-site.com",
      "receivedAt": "2024-04-26T11:00:00Z",
      "apiKey": {
        "id": "key_123",
        "name": "Contact Form"
      }
    }
  ],
  "pagination": {
    "limit": 50,
    "offset": 0,
    "total": 250
  }
}
```

---

## Architecture & Scalability

### Entity Relationships
```
User
  ├── Team (via TeamMember)
  │   ├── TeamMember (defines role)
  │   └── ApiKey (team owns multiple keys)
  │       └── Message (key receives messages)
  └── ApiKey (personal keys)
      └── Message
```

### Scalability Features

1. **Role-Based Access Control (RBAC)**
   - OWNER: Full team management
   - ADMIN: Add/remove members, view messages
   - MEMBER: View messages only

2. **Shared Message Pool**
   - Multiple team members access the same messages
   - No data duplication
   - Single source of truth

3. **Team API Keys**
   - Teams can own their own API keys
   - Individual users still have personal API keys
   - Flexible key assignment

4. **Database Indexing**
   - Indexed queries on `teamId`, `userId`, `createdAt`
   - Efficient pagination with limit/offset

5. **Future Extensibility**
   - Ready for features: audit logs, permissions, team quotas
   - Designed for multi-tenancy support

---

## Example Usage

### Create a Team and Add Friends

```bash
# 1. Create team
curl -X POST http://localhost:3000/api/teams \
  -H "Content-Type: application/json" \
  -d '{"name": "Friends Group"}'

# 2. Add friends
curl -X POST http://localhost:3000/api/teams/team_123/members \
  -H "Content-Type: application/json" \
  -d '{"email": "friend1@example.com", "role": "MEMBER"}'

# 3. Get shared messages
curl http://localhost:3000/api/teams/team_123/messages?limit=50
```

### Frontend Usage

```typescript
import { teamClient } from "@/lib/team-client"

// Create team
const team = await teamClient.createTeam("My Team")

// Add members
await teamClient.addTeamMember(team.id, "friend@example.com", "MEMBER")

// Get shared messages
const { messages, pagination } = await teamClient.getTeamMessages(team.id)
```

---

## Error Handling

All errors return appropriate HTTP status codes:

- `400` - Bad Request: Missing or invalid parameters
- `401` - Unauthorized: Not authenticated
- `403` - Forbidden: No permission for this action
- `404` - Not Found: Resource doesn't exist
- `500` - Server Error: Internal server error

---

## Rate Limiting

(Future implementation) Currently unlimited. Consider adding rate limits for production:
- 100 requests/minute per user
- 1000 requests/minute per API key
