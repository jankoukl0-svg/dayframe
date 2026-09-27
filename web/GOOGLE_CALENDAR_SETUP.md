# Google Calendar setup

Dayframe uses Google Identity Services in the browser and requests only read-only Calendar event access:

`https://www.googleapis.com/auth/calendar.events.readonly`

No Google client secret is shipped to the browser. The short-lived access token is stored only in `sessionStorage` and is removed when the user disconnects.

## Google Cloud

1. Create or select a Google Cloud project.
2. Enable the Google Calendar API.
3. Configure the Google Auth Platform consent screen.
4. Create an OAuth 2.0 Client ID with application type **Web application**.
5. Add the Dayframe production origin under **Authorized JavaScript origins**:
   - `https://dayframe2.vercel.app`
6. Add localhost origins if you want to test locally, for example:
   - `http://127.0.0.1:4173`
   - `http://localhost:4173`
7. If the OAuth app is in testing mode, add the Google accounts that should be allowed to connect as test users.

## Vercel

Set this environment variable on the `dayframe2` project for Production (and Preview if desired):

`NEXT_PUBLIC_GOOGLE_CLIENT_ID=<your OAuth web client id>`

Then redeploy. The static Vite production build inlines only the public client ID.

## Current integration contract

- Google -> Dayframe is read-only.
- Events are loaded from the user's primary Google Calendar.
- Google events are displayed separately from Dayframe tasks, milestones, Czech holidays, and observances.
- Timed events appear in the week timeline; all-day events appear above the timeline.
- The monthly calendar shows both timed and all-day Google events.
- Disconnecting revokes the current access token when Google Identity Services exposes revocation and clears the local session token.
