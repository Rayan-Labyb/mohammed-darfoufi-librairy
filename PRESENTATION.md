# Presenting the library WITHOUT internet

The whole app is self-contained: no web fonts, no CDNs, no external
images. Every cover lives in `public/covers/`, and the book data is in
a local SQLite database. It runs 100% offline.

## Option 1 — Full app on a laptop with Node.js (recommended)

```bash
npm start
```

Then open **http://localhost:3000** in any browser.

- Everything works: search, filters, library map, book details, dark mode
- The **Librarian space is fully unlocked** (local database — no GitHub
  token needed offline), so you can even demo adding a book live
- Data persists in `data/` between runs; `npm run seed` restores the
  catalog from `data/books.json` if ever needed

## Option 2 — Show it to the audience's phones (no internet needed either)

The server listens on all network interfaces. Start a **Wi-Fi hotspot**
on a phone (hotspots work with no mobile data), connect the laptop to
it, then everyone joins the hotspot Wi-Fi and opens:

```
http://<laptop-ip>:3000
```

The server prints the address to reach on start-up. No internet
required — the hotspot is just a local network.

## Option 3 — No Node.js on the presentation machine

The static build (`docs/` folder) works offline with any tiny web
server. From the project folder:

```bash
python3 -m http.server 3000 --directory docs
```

Then open http://localhost:3000. This serves the read-only public site
(the librarian space needs the real server from Option 1).

Note: double-clicking `index.html` from the file manager will NOT work —
browsers block local file access for the app's data loading. Use one of
the servers above.

## What does NOT work offline (by design)

- The live site at rayan-labyb.github.io (that IS the internet)
- The "Auto-fetch" button in the admin form (pulls book info online)
- The Google/Amazon purchase links (they open web pages anyway)
- Online librarian editing (that is the GitHub-hosted version)

None of these affect browsing, searching, or finding books on a shelf.
