# Add Server Manual

Use this guide to add a custom server link in Letterboxd+.

## Required fields
- `Name`: any readable name (example: `SmashyStream`).
- `Link Template`: must include `{tmdbId}`.

Example:
`https://player.smashystream.com/movie/{tmdbId}`

## Steps
1. Open the extension popup.
2. Expand `Servers`.
3. Click `Add New Server +`.
4. Enter `Name`.
5. Enter `Link Template` with `{tmdbId}`.
6. Click `Check connection`.
7. If successful, click `Save server`.

## Validation rules
- Name is mandatory.
- Link is mandatory.
- Link must include `{tmdbId}`.
- Link must start with `https://`.
- Duplicate link templates are blocked (`Already exists <server_name>`).

## Notes
- Default servers are locked (grey) and cannot be deleted.
- Custom servers can be deleted from the saved list.
