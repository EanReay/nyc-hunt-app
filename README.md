[README.md](https://github.com/user-attachments/files/32631952/README.md)
# Saturday Hunt: setup

This takes about 15 minutes. After that, everyone just opens a link on their phone.

## 1. Create the database (Supabase, free)

1. Go to supabase.com and sign in. Create a **New project**. Any name and region work (US East is closest to NYC). Save the database password somewhere, though you won't need it for this.
2. When the project is ready, open **SQL Editor** in the left sidebar and start a **New query**.
3. Open `setup.sql` from this folder, copy all of it, paste it in, and click **Run**. It should say "Success". It's safe to run again if you're unsure.
4. Open **Project Settings** and find the API keys. Copy two things:
   - the **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - the **publishable key** (starts with `sb_publishable_`). If your project only shows the older keys, use the **anon / public** key instead. Never use the secret or service_role key.

## 2. Connect the app

Open `config.js` in any text editor and paste in the URL and key. Change `JUDGE_PIN` to something only the judge knows. Save.

## 3. Put it online (Netlify, free)

1. Go to app.netlify.com/drop and sign in (a free account keeps the site up for good).
2. Drag this whole folder onto the page. After a few seconds you get a link like `https://something-random.netlify.app`.
3. Optional: in Site configuration, rename the site so the link is easier to type.

If you edit a file later (like `challenges.js`), drag the folder onto the site's **Deploys** page again.

## 4. Test it before Saturday

Open the link on two phones and enter the code `NYC` (the starter hunt). Join as different teams, post a photo on each, and check that it shows up on the other phone within a few seconds. Unlock the Judge tab with your PIN, award something, and add a penalty. When you're done, go to Judge > **Reset after testing** and type RESET. That clears all test scores and photos from that hunt. Or make a separate test hunt on the Admin page and delete it when you're done.

## On game day

- Share the hunt's link in the group chat (Admin > Hunts > **Copy link**). The link fills in the hunt code. With the plain site link, people type the code instead. Each person then enters their name and picks their team. Both are remembered on their phone.
- The judge taps **Start 3-hour clock now** on the Judge tab when the hunt begins. Everyone's phone shows the countdown.
- Post a photo or video on any challenge to claim it. Photos are shrunk before uploading, so they go up fast on cell data. Videos are limited to 50 MB, about 30–60 seconds of phone video. Longer clips should go in the group chat.
- Tap any photo to see it full size. Tap again (or the ×) to close it.
- A team can delete its own posts with the **Delete** button under each one. Deleting a team's only photo for a challenge takes those points away.
- The judge can reject a bad photo from the Feed, which removes its points. They also award the judge's-call items and log penalties.

## Running more than one hunt

Each hunt has a join code, its own team names, clock, scores and photos, and its own list of challenges. When the site opens, it asks for a hunt code.

Open the **Admin** page from the link under the code box, or from the Judge tab. It uses the judge PIN.

- **Hunts**: create a hunt (name, join code, team names) and tick the challenges it includes. **Edit** changes the name, teams or challenges any time, even mid-game. **Copy link** gives a link that opens straight into that hunt. **Delete** removes the hunt with all its scores and posts.
- **Challenges**: make new challenges with a description, optional note, points (negative for a penalty), a category (an existing one or a new one), and a type: a photo each team can do once, a judge's call, or a tally. You can add a new challenge to hunts right away. Hunts set to include every challenge (like the starter `NYC` hunt) pick it up automatically.

If you set this up before hunts had codes, run `setup.sql` again. Your existing game, with its team names, clock, scores and photos, becomes the hunt with code `NYC`.

## Editing challenges

The built-in challenges are in `challenges.js`. Challenges made on the Admin page are stored in Supabase instead. Change the text, notes or points and redeploy. Give any new challenge a new `id`. Don't change an id during the game, because points already earned are tied to it.

## Things to know

- **Already set up before the Delete button was added?** Run `setup.sql` again in the Supabase SQL Editor. It adds the permission that lets deleted photos also be removed from storage. Without it, deleting still works in the app, but the file stays in Supabase.
- There are no logins. Anyone with the link can post, so only share it with the group. The judge PIN is a speed bump, not a lock.
- The free Supabase tier includes 1 GB of file storage, which is plenty for one night. Free projects pause after about a week of no use. If the app says it can't connect on Saturday, open the Supabase dashboard and click **Restore**.
- Photos stay in your Supabase project after the game. To keep them, download them from **Storage > hunt**. To clear them out, delete the project.
