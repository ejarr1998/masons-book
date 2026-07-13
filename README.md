[README.md](https://github.com/user-attachments/files/29947877/README.md)
# The Jarrett Book

A private, install-on-your-phone place to keep Mason's (and future siblings')
moments — photos, funny things he says, milestones, growth stats, letters,
and the pregnancy chapter — without posting any of it to social media.

## First-time setup (do this before using it for real)

### 1. Deploy Firestore & Storage rules
These lock down *writing* to people who've entered the PIN, while keeping
*reading* open (so the view-only link works for anyone you send it to,
like grandparents).

In the Firebase console:
- **Firestore Database → Rules** tab → paste in the contents of `firestore.rules` → Publish
- **Storage → Rules** tab → paste in the contents of `storage.rules` → Publish

### 2. Enable Anonymous Authentication
- **Build → Authentication → Sign-in method** → enable **Anonymous**
- This is what lets the app grant "edit access" after a correct PIN, without
  a real login system.

### 3. Change the PIN
Open `app.js`, find this line near the top:
```js
const EDIT_PIN = "123456"; // ⚠️ CHANGE THIS before sharing the edit link with anyone
```
Change it to whatever 4–6 digit PIN you and Rachel want to use, then save.

### 4. Push to GitHub & enable Pages
```bash
cd masons-book
git init
git add .
git commit -m "Initial build"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/masons-book.git
git push -u origin main
```
Then in the repo: **Settings → Pages → Deploy from branch → main → / (root)**.
Give it a minute — your site will be live at
`https://YOUR_USERNAME.github.io/masons-book/`.

### 5. Get your two links
- **View link** (share freely, e.g. with grandparents):
  `https://YOUR_USERNAME.github.io/masons-book/`
- **Edit link** (only you and Rachel use this):
  `https://YOUR_USERNAME.github.io/masons-book/?edit=1`

The first time each of you opens the edit link, you'll enter the PIN once.
After that, your phone remembers it — tapping the edit link goes straight
to edit mode from then on. (This is stored in that browser only — if you
clear site data or switch phones, you'll enter the PIN once more.)

### 6. Install as an app
Open the link on your phone → browser share/menu → **"Add to Home Screen"**
(iOS Safari) or **"Install app"** (Android Chrome). Do this separately for
the view link and edit link if you want both, though most people will just
install the edit link on their own phone.

## Adding a second (or third, or fourth) kid

No code changes needed — this is done right in the app now:

1. Open the **edit link** and unlock with your PIN
2. Tap the small **⚙️ gear icon** in the top-right of the header (next to
   "Edit mode") — this is intentionally tucked away since you'll only use
   it a couple of times over many years
3. Tap **+ Add a child**, enter their name and birthdate, save

A new tab appears automatically, and any entry you tag with that kid's
chip will show on their page and, if tagged with both, the shared Family
Feed too. Kids are stored in Firestore's `kids` collection — if you ever
want to double check or manually fix something, you can also edit it
directly from the Firebase console (Firestore Database → `kids` collection).

## A few honest notes

- **The PIN is a convenience gate, not a security system.** There's no
  backend server here, so real protection comes from (a) the edit link
  being long and unguessable, and (b) Firestore/Storage rules requiring a
  signed-in session before any write succeeds. The PIN just controls when
  your own browser signs in. Don't post the edit link anywhere public.
- **Back up regularly.** Firestore + Storage are reliable, but nothing beats
  owning your own copy. Consider periodically exporting your Firestore data
  (Firebase console → Firestore → Export) as a 20-year insurance policy.
- **Offline support:** Firestore has built-in offline persistence, so adding
  an entry with no signal (hospital wifi, e.g.) will sync once you're back
  online.

## File structure
```
index.html      — app shell, all screens/modals
style.css       — design system (parchment/forest/rust palette)
app.js          — Firebase logic, rendering, add-entry flow, PIN gate
manifest.json   — PWA install config
sw.js           — offline shell caching
firestore.rules / storage.rules — security rules to paste into console
icons/          — placeholder app icons (swap for your own anytime)
```
