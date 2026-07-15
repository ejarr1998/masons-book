rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /entries/{entryId} {
      // Anyone with the view link can read PUBLIC entries. Private entries
      // require a signed-in edit-mode session (i.e. someone who entered the
      // PIN). This has to be checked against a real field ("isPrivate"),
      // not just whatever tags happen to be on the entry — Firestore can
      // only safely allow a query to run if it can verify, from the query's
      // own filters, that every possible result satisfies the rule. Our
      // view-mode query explicitly filters `where("isPrivate", "==", false)`,
      // which lines up exactly with this rule, so Firestore can prove it's
      // safe. A rule based on an arbitrary tags array (with no matching
      // query filter) can't be proven that way, so don't reintroduce that.
      allow read: if request.auth != null || resource.data.isPrivate == false;
      // Writes require a signed-in Firebase Auth session, which the app only
      // creates after the correct PIN is entered on a device (see app.js).
      // Note: this is a light deterrent, not a hard security boundary — see README.
      allow write: if request.auth != null;
    }
    match /kids/{kidId} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    match /settings/{docId} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    match /tags/{tagId} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    match /trips/{tripId} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}
