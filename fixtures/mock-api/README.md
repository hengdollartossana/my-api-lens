# Mock API

Implements `fixtures/specs/messy-v3.json` with deliberate spec mismatches, so diff and run features have something to find.

Run: `pnpm mock:api` (port from `MOCK_API_PORT`, default 4010).
In tests, get the URL with `mockBaseUrl()` from `fixtures/mock-api/base-url.ts`.

## Auth
- `POST /api/v1/auth/login` with `{"username":"demo","password":"demo"}` returns `{ token, refreshToken }`.
- `POST /api/v1/auth/refresh` with the refresh token (`mock-refresh-token`) returns a new token pair.
- Every other route needs `Authorization: Bearer mock-access-token`, otherwise 401.

## Deliberate mismatches
| Endpoint | Mismatch | What happens |
|---|---|---|
| `GET /api/v1/{tenant}/users` | Missing required field | Second user (`u2`) has no `email` |
| `GET /api/v1/{tenant}/users/{userId}` | Extra field | Response includes `internalNote`, not in the spec |
| `GET /api/v1/{tenant}/orders` | Wrong type | `total.amount` is the string `"42.50"`, spec says number |
| `GET /api/v1/{tenant}/orders/{orderId}` | Unexpected null | `shippingAddress` is `null`, spec does not allow null |
| `POST /api/v1/{tenant}/users` | Undocumented status | Body email `taken@example.com` returns 409, spec only documents 201 and 401 |

Other behaviour: `userId` / `orderId` of `missing` returns 404; `DELETE .../orders/{orderId}` returns 204.
