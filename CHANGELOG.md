# Changes

## 1.0.2

- Move collection controls and the guest-appearances checkbox into **Make all of artist**.
- Keep Spotify's native playlist picker at the root menu level after collection.

## 1.0.1

- Move the native playlist picker to the root artist menu. This removes the extra submenu that caused the picker to close during pointer movement.
- Fix the appearances checkbox handler for Spotify menu actions, which do not supply a click event.
- Rename the option to **Include guest appearances**, use Spotify's native checked state, and save the preference between menu openings and restarts.
- Keep the checkbox visible after collection. Changing the preference clears the collected selection so the next collection uses the new value.

## 1.0.0

Initial version.
