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

Open the link on two phones. Join as different teams, post a photo on each, and check that it shows up on the other phone within a few seconds. Unlock the Judge tab with your PIN, award something, and add a penalty. When you're done, go to Judge > **Reset after testing** and type RESET. That clears all test scores and photos from the game.

## On game day

- Share the link in the group chat. Each person enters their name and picks their team. The choice is remembered on their phone.
- The judge taps **Start 3-hour clock now** on the Judge tab when the hunt begins. Everyone's phone shows the countdown.
- Post a photo or video on any challenge to claim it. Photos are shrunk before uploading, so they go up fast on cell data. Videos are limited to 50 MB, about 30–60 seconds of phone video. Longer clips should go in the group chat.
- Tap any photo to see it full size. Tap again (or the ×) to close it.
- A team can delete its own posts with the **Delete** button under each one. Deleting a team's only photo for a challenge takes those points away.
- The judge can reject a bad photo from the Feed, which removes its points. They also award the judge's-call items and log penalties.

## Editing challenges

All challenges are in `challenges.js`. Change the text, notes or points and redeploy. Give any new challenge a new `id`. Don't change an id during the game, because points already earned are tied to it.

## Things to know

- **Already set up before the Delete button was added?** Run `setup.sql` again in the Supabase SQL Editor. It adds the permission that lets deleted photos also be removed from storage. Without it, deleting still works in the app, but the file stays in Supabase.
- There are no logins. Anyone with the link can post, so only share it with the group. The judge PIN is a speed bump, not a lock.
- The free Supabase tier includes 1 GB of file storage, which is plenty for one night. Free projects pause after about a week of no use. If the app says it can't connect on Saturday, open the Supabase dashboard and click **Restore**.
- Photos stay in your Supabase project after the game. To keep them, download them from **Storage > hunt**. To clear them out, delete the project.
