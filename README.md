# Ollie & Stanley (v1)

A tap-to-walk web game set in the family's real downstairs, starring cat brothers
Ollie and Stanley. Plain HTML/CSS/JS: no build step and no CDNs. It works offline
once loaded and can be added to the home screen (Safari: Share > Add to Home Screen;
Chrome: menu > Add to Home screen / Install app).

## Play
* Turn the phone sideways (portrait shows a "turn your phone" screen).
* Tap a face (bottom-left), or tap a cat, to choose who you control.
* Tap the floor and your cat walks there. Taps on furniture or walls snap to the nearest floor spot.
* Orange arrow buttons go to the next room; both cats come along.
* When you're not controlling Stanley, he sometimes hisses and chases Ollie. Ollie runs away, and if Stanley catches him there's a quick scuffle.
* Speaker button (top-right) turns the synthesized sound effects on. Sound starts off.

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
