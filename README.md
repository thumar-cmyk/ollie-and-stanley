# Ollie & Stanley (v4)

A tap-to-walk web game set in the family's real downstairs, starring cat brothers
Ollie and Stanley. Plain HTML/CSS/JS: no build step and no CDNs. It works offline
once loaded and can be added to the home screen (Safari: Share > Add to Home Screen;
Chrome: menu > Add to Home screen / Install app).

## Play
* Turn the phone sideways (portrait shows a "turn your phone" screen).
* Tap a spot and your cat walks there. Tap furniture and toys to play with them.
* Catch bugs and mice, and tap food on the counter before Stanley steals it.
* The two faces (bottom-left) switch between Ollie and Stanley. The other cat follows you around.
* Small arrows near the doorways lead to the next room. Tapping the floor right at a doorway works too.
* Everything else is in the menu (top-right): cat sounds and soft music, Free play or a 3-minute round,
  "Be the House", "Play with 2-3 phones" and How to play.

## v4: calm by default

Nehas found v3 too busy, so v4 keeps all the features but shows one thing at a time:
* **Clean screen:** just the room, the cats, two small faces, a small score chip and one menu button.
  "Best" only shows on the round summary. No treat, help or speaker buttons on the main screen.
* **Doors:** small translucent chevrons, no pulsing. The room name shows while you press one and when you enter.
* **One event at a time:** an event director picks a critter, a snack on the counter, or a Stanley
  chase, always in the room you're looking at. It waits ~20 s at the start and 20-40 s between events
  (`events` in `js/config.js`). Chases only start when the cats are a little apart, and Stanley is a bit slower.
* **Fewer bubbles:** only "Hiss!" (chase) and the thief's eyes (snack) show. Nap points just tick the score,
  with no "zzz" popups and smaller, fainter z's. No sparkle hints. A tapped object gets a small ripple.
* **The other cat follows you** from room to room (1-2 s later) and stays loosely nearby. No roaming in single player.
  The AI cat never knocks cups or scratches the couch on its own.
* **Smooth:** the whole room is always visible (no camera pan) and rooms change with a quick 0.3 s crossfade
  and a slight push toward the door.
* **Sound:** music is off by default (Soft music in the menu), and cat sounds are quieter.
* `?busy=1` brings back the v3 behaviour (roaming, independent timers, all bubbles), `?pan=1` the camera pan,
  `?dolly=1` the doorway zoom, `?hints=1` the sparkles and the "upstairs" hint. `?gap=N` sets the event gaps (testing).

## Freddy the dog (v4.2)

Freddy (a cream curly poodle mix in a blue plaid bandana) used to chase the cats. Now he visits now and then:

- **Rare.** Never in the first minute, then about every 2–4 minutes, and only when nothing else is happening.
- **What happens:** he bursts in through the door farthest from the cats ("Freddy! 🐶 Run!"). The cats puff up and shake with a "!", then run. He chases the nearest cat for 8–12 s and trots out a door.
- **Scoring:** a caught cat tumbles (−5, no game over). Staying safe earns up to +12 when he leaves. Tap Freddy to shoo him for +8.
- **Music:** while he's out the theme ducks and a fast, staccato slapstick track plays (made live with WebAudio). It crossfades back when he leaves. The Music switch in the menu turns both off.
- **House** has a 🐶 Freddy tool with a 150 s cooldown. In multiplayer the host runs him and the other phones see him in the snapshot.
- Sprites live in `sheets/freddy-*.jpg` and are cut by `tools/cut_freddy.py` into `assets/freddy/`. Tune him in `GAME_CONFIG.freddy`.
- **Test params:** `?freddy=N` (seconds until he first appears) and `?nofreddy=1`.

## v3 (part A)

- **Each cat lives its own life.** Only the selected cat goes through a door; the other stays put and
  wanders, naps, hunts critters, steals snacks and plays with things on its own. Stanley sometimes
  roams the house looking for Ollie (and may chase her once he finds her). Door buttons show a small
  face badge pointing toward the other cat; the face buttons show which room each cat is in, and
  tapping the other cat's face switches the view to its room. Chases only happen when both cats are
  in the room you're looking at.
- **Things to tap** (with a cat selected; sparkles hint where): sofa / loveseat (seat or back, kneads,
  curls up), coffee table, window sill (sunny: double nap points), kitchen bench, dining chair,
  bench and table, the stairs (sit on a step), cat tree (+5), rug (walk on, then tap your cat to
  roll), toy mice (+1), cups/glasses (crash, -5) and the couch arm (scratch, -5). Tap the floor to
  hop down. All zones are data in `js/config.js` -> `rooms.<id>.objects`.
- **Audio** (`js/audio.js`, all synthesized live, nothing downloaded): an original slow lullaby loop
  and cat voices made with formant synthesis (Stanley's are lower and grumpier). The speaker button
  opens Music / Sounds toggles with volume sliders (saved on the phone). On iPhone the silent switch
  mutes the game (audio session "ambient").
- Test switches: `noroam=1`, `noaiobj=1`, `nohunt=1`, `roam=N` (seconds between roam checks).

## v3 (part B)

- **Camera.** The room photo is shown slightly zoomed (`camera.zoom` 1.15) and gently pans to keep
  your cat centred. `?nopan=1` turns it off.
- **Doorway transitions.** Going through a door pushes the camera into that doorway, dips, then pulls
  back out of the matching doorway in the next room (drawn from the room photos, no download).
  `?nodolly=1` or the phone's "reduce motion" setting uses a plain fade instead. Real walkthrough
  video clips were planned but the source clips weren't available; see "Limitations".
- **House mode (1 phone).** "Be the House" on the help card: both cats run on AI and you get the
  House toolbar (treat, spider, mouse, snack, toy) with cooldowns/charges, a map button showing where
  each cat is, and free room switching. House scores when cats take its treats/snacks (+3/+5), catch
  its critters quickly (+10) or chase its toys (+1).
- **Play with 2-3 phones.** "Play with 2–3 phones" on the help card. One phone hosts and gets a 4-letter
  code, the others type the code and pick a role: **Ollie**, **Stanley** or **The House**. Empty roles
  are played by the AI. The host phone runs the game; the others send taps and get a snapshot 10x a
  second. Each cat phone follows its own cat; the score is shared, with per-cat stats and a House
  score. If a phone drops it reconnects automatically (same role). If the host goes away, the others
  get "Play on this phone" and carry on solo from where they were.
  - Uses [PeerJS](https://peerjs.com) 1.5.4 (vendored, MIT, `js/vendor/`) with the free public PeerJS
    signalling server, then a direct WebRTC data channel between phones.
  - **Limitation:** there is no TURN relay server. Phones on the same Wi-Fi almost always connect;
    phones on different networks (especially cellular / strict NAT) may fail with "Couldn't reach
    the host". The public signalling server can also be down occasionally.
- Test switches: `house=1` (House mode), `host=<role>&code=ABCD`, `join=ABCD&role=<role>`.

## v2 gameplay
* **Score** (top centre) with +N / -N popups; best score is saved on the device.
* **Critters**: a spider (drops down on a thread) or a mouse (runs in from a door) shows up now and then.
  Walk a cat onto it: spider +10, mouse +25. A red door badge shows a critter in another room.
* **Counter snacks** (Kitchen, Kitchen Walkway, Dining table): a cat "eyes" the food, walks over and
  jumps up. Tap the food first to put it away (+3); if the cat gets it: "Bad kitty!" -15.
* **Chase**: Stanley catching Ollie -10; escaping +5 (if you're playing Ollie, steer him away!).
* **Treat** button (20 s cooldown), then tap the floor: the nearest cat runs over (+2); distracts Stanley.
* **Naps**: a cat left alone ~18 s curls up and earns +1 every 4 s. Tap it to wake it.
* **3-minute round** with a summary screen, or **Free Play**. "?" shows the how-to-play card.
* Score never goes below 0.

All tunables are in `js/config.js` (`scoring`, `critters`, `snacks`, `treat`, `nap`, `round`) and
snack spots are per-room `surfaces` polygons with the floor point (`from`) the cat jumps up from.

## Cat animation
Sprites come from AI-generated sprite sheets in `sheets/` (side view, white background).
`python3 tools/cut_sheets.py` cuts them out (rembg), aligns the 4 walk frames on the feet and
body centre, and writes `assets/cats/<cat>/{walk-0..3,sit,pounce,nap}.png` + `js/sprites.js`.
States: walk (ping-pong frames + a hip-pivot leg swing), run (same, faster and wider), sit (idle),
pounce (crouch then hop when catching, and when eating on the counter), nap (curled).
`rel` in config sets each pose's height vs. a sitting cat (from measuring head size on the sheets).
The face buttons still use the real photos.

## Files
```
index.html            page shell, PWA meta tags
manifest.json         install manifest (icons in assets/icons/)
sw.js                 service worker (offline cache; bump CACHE when files change)
css/style.css         UI
js/config.js          ALL room + cat data (floors, depth, doors)
js/game.js            engine (rendering, pathing, AI, sound)
assets/rooms/1920/    room photos (phones with big screens)
assets/rooms/1280/    same photos, smaller (used on low-res screens)
assets/cats/          animation frames (stanley/, ollie/) + round photo face buttons
rooms/                original 3840x2160 frames pulled from the house videos
tools/                cut_sheets.py, cut_cats.py, make_icons.py, serve.sh
sheets/               AI sprite sheets (source art for the cat animations)
tests/test_game.py    Playwright end-to-end test
```

## Add a room (front entry, upstairs, ...)
1. Save a landscape 16:9 frame as `rooms/<name>.jpg`, then make the two game sizes:
   ```
   python3 -c "from PIL import Image; im=Image.open('rooms/NAME.jpg').convert('RGB')
   [im.resize((w,w*9//16),Image.LANCZOS).save(f'assets/rooms/{w}/NAME.jpg',quality=80,optimize=True,progressive=True) for w in (1920,1280)]"
   ```
2. Add an entry to `rooms` in `js/config.js`:
   ```js
   entry: {
     name: "Front Entry", image: "NAME.jpg",
     floor: [[0.2,0.6],[0.8,0.6],[0.9,0.99],[0.1,0.99]],   // trace the visible floor
     depth: { y1: 0.6, s1: 0.10, y2: 1.0, s2: 0.22 },       // cat height at two floor rows
     spawn: [0.5, 0.85],
     doors: [{ to: "hallway", x: 0.5, y: 0.92, arrow: "down", floor: [0.5, 0.93] }]
   }
   ```
   and add a matching door in the neighbouring room (e.g. in `hallway.doors`).
   For upstairs, turn the stairway's `hints` entry into a real door.
3. Add the image names to `ROOMS` in `sw.js` and bump `CACHE`.
4. Open `index.html?debug=1&room=entry`. The floor polygon shows in green and every
   tap prints its coordinates (top-right), so you can trace the floor. `depth`: a
   sitting cat is about 1/3 the height of a kitchen counter, so pick
   `s1`/`s2` (fractions of the photo height) to match furniture at those rows.

## Better cat sprites
`python3 tools/cut_cats.py --stanley stanley.jpg --ollie ollie.jpg`
removes the background (rembg), writes `assets/cats/*.png` + round faces, and writes
check sheets to `tools/out/*-check.jpg` (cut-out on dark and on light background, so you can check the edges).
If a new photo faces a different way, set `faces` in config (1 = right, -1 = left,
0 = front) and adjust `height` (Stanley sitting = 1.0, Ollie lying = 0.62).
Then run `python3 tools/make_icons.py` to refresh the app icons.

## Debug / test URL params
* `?debug=1`: floor polygons, tap coordinates, and Stanley's chase timer cut to 2-3 s
* `?room=kitchen`: start in a room
* `?res=1280|1920`: force photo size
* `?spawn=spider,mouse,snack`: spawn those in the start room right away
* `?nohelp=1` skip the how-to card; `?round=1&roundsecs=20` start a short round
* `?nochase=1`, `?nocritters=1`, `?nosnacks=1`, `?napafter=3`: switch features off / speed naps up

## Hosting
`tools/serve.sh` starts `tools/catgame_server.py` on port 8765 (correct MIME types,
no-cache on code) and tries a Cloudflare quick tunnel. Any static HTTPS host works
(GitHub Pages, Netlify, Cloudflare Pages). Just upload this folder. The service
worker needs HTTPS (or localhost).
