# Add Public & Private Rooms

Add room visibility to the existing room system. Do not rewrite unrelated functionality.

## Room Creation

When creating a room, allow the host to choose:

```text
Public
Private
```

If **Private** is selected, require a password.

Store the room state similar to:

```json
{
  "id": "room-id",
  "movieId": "movie-id",
  "visibility": "private",
  "passwordHash": "...",
  "adminId": "user-id",
  "users": []
}
```

For public rooms:

```json
{
  "visibility": "public"
}
```

Do not store plaintext passwords.

Use a secure password-hashing library such as `bcrypt` or `argon2`.

## Joining

### Public

```text
/room/:roomId
→ join directly
```

### Private

```text
/room/:roomId
→ show password modal
→ submit password
→ validate on server
→ allow access if correct
```

Do not put the password in the URL or expose it to the client.

Incorrect passwords should show a clear error without exposing any sensitive information.

## UI

Update the room creation UI with:

```text
Visibility

○ Public
● Private

Password: [••••••••]
```

Only show the password field when Private is selected.

For private rooms, show a password modal when an unauthenticated/new user opens the room.

Keep the existing anonymous `userId` cookie/session system.

## Important

* No database.
* No WebSocket changes.
* No playback synchronization.
* No authentication system.
* Keep `data/current.json` as the current room storage.
* Keep the implementation small and focused.
* Existing public rooms must continue working.
