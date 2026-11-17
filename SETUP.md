# Yearbook Hub on Cloudflare: setup (about 20 minutes)

You do not need to install anything. Everything is done in your web browser, using GitHub (which you already use)
and a free Cloudflare account (no credit card).

## What's in this folder
- `public/`          the web pages students see
- `src/worker.js`    the small program that saves everyone's progress
- `wrangler.jsonc`   the settings file you will edit once (step 3)

## 1. Make a free Cloudflare account
Go to https://dash.cloudflare.com/sign-up and sign up. Skip anything that asks you to add a domain or pay.

## 2. Create the database
1. In the Cloudflare dashboard, find **Storage & databases** in the left menu, then **D1 SQL database**.
2. Click **Create database**. Name it `yearbook-hub`. Click **Create**.
3. On the database's page, find the **Database ID** (a long code with dashes) and copy it.
You do NOT need to create any tables. The site does that by itself the first time it runs.

## 3. Put the files on GitHub
1. Make a NEW repository on GitHub (for example `Yearbook-Cloudflare`).
2. Click **Add file > Upload files**. Unzip this folder first, then drag in `public`, `src`, `wrangler.jsonc`,
   `SETUP.md` and `README.md` (the folders and files, not the outer folder). Click **Commit changes**.
3. In the repo, click `wrangler.jsonc`, click the pencil (Edit), and replace `PASTE_YOUR_DATABASE_ID_HERE`
   with the Database ID from step 2. Keep the quotes. Click **Commit changes**.

## 4. Connect GitHub to Cloudflare
1. In Cloudflare: **Workers & Pages > Create application**, and choose the option to **import a repository / connect to Git**.
2. Allow Cloudflare to see your GitHub, and pick the repo from step 3.
3. For the project (Worker) name, use exactly `yearbook-hub`. This must match the `name` in `wrangler.jsonc`.
4. Leave the build command empty and leave the deploy command as it is (`npx wrangler deploy`).
5. Click **Save and Deploy** and wait for it to finish.

## 5. Add your class code and advisor passcode
1. Open your new Worker in Cloudflare, then **Settings > Variables and Secrets > Add**.
2. Add two entries. Choose the type **Secret** for both (not "Text"):
   - `STUDENT_CODE`     the class code you give students
   - `ADVISOR_PASSCODE` your private passcode
3. Save/Deploy. (Secrets stay put when the site redeploys. Plain "Text" variables can get wiped.)

## 6. Open the site
Your address looks like `https://yearbook-hub.YOUR-NAME.workers.dev` (it's shown on the Worker's page).
Click **I'm the advisor** and sign in. The roster and pages 1-124 load automatically, with no pages assigned.
In **Admin**, set your deadline dates and mark any editors.

## Moving your data from the old Netlify site (optional)
The old site has to still be working. Sign in there as advisor, press Ctrl+Shift+J, paste the line shown in
Admin > "Import from the old site" here, then paste the result into the box and click **Import data**.
If the old site is paused, start fresh instead.

## If something goes wrong
- **Build fails mentioning a name**: change `name` in `wrangler.jsonc` to match the project name you picked in step 4.
- **Build fails mentioning the database**: re-copy the Database ID into `wrangler.jsonc` (step 3).
- **Site says setup is incomplete**: add the two secrets (step 5), then trigger a new deploy.
- **Site says the database isn't connected**: the Database ID in `wrangler.jsonc` is missing or wrong.
