/*
 * Ollie & Stanley: ALL room + cat data lives here.
 *
 * Coordinates are normalized to the room photo: x 0 = left edge, 1 = right edge;
 * y 0 = top edge, 1 = bottom edge (closest to the camera).
 *
 * To add a room: drop a 16:9 photo into assets/rooms/1920/ and assets/rooms/1280/
 * (same file name), add an entry to ROOMS below, and add a door to it from a
 * neighbouring room. Open the game with ?debug=1 to see floor polygons and
 * the coordinates of every tap (handy for tracing a new floor).
 */
window.GAME_CONFIG = {
  version: 1,
  startRoom: "living",
  startCat: "ollie",

  cats: {
    stanley: {
      name: "Stanley",
      sprite: "assets/cats/stanley.png",
      face: "assets/cats/stanley-face.png",
      color: "#f2a7b5",
      // Height multiplier vs. the room's depth scale (he is sitting up).
      height: 1.0,
      // Which way the cat looks in the photo: 1 = right, -1 = left, 0 = front.
      faces: 1,
      // Shadow: centre height above the feet and size, as fractions of sprite height/width.
      shadow: { y: 0.02, w: 0.42, h: 0.08 },
      speed: 0.30,       // image-widths per second at the front of the room
      chaseSpeed: 0.55,
      bully: true
    },
    ollie: {
      name: "Ollie",
      sprite: "assets/cats/ollie.png",
      face: "assets/cats/ollie-face.png",
      color: "#c9a27a",
      height: 0.95,      // lying, seen from above: the sprite includes the sprawled legs
      faces: -1,
      shadow: { y: 0.30, w: 0.42, h: 0.24 },
      speed: 0.30,
      fleeSpeed: 0.50
    }
  },

  ai: {
    chaseMin: 8, chaseMax: 20,   // seconds between bully checks
    chaseChance: 0.6,
    debugChaseMin: 2, debugChaseMax: 3  // used with ?debug=1
  },

  /*
   * Room fields:
   *  name     shown when entering
   *  image    file name inside assets/rooms/{1920,1280}/
   *  floor    walkable polygon [[x,y],...] (clockwise or not, no self-crossing)
   *  depth    {y1,s1,y2,s2}: a sitting cat whose feet are at y1 is s1 of the
   *           photo's height tall; at y2 it is s2 tall (linear in between)
   *  doors    [{to, x, y, arrow, floor:[x,y]}]: button position, arrow
   *           direction (left/right/up/down), and the floor point next to the
   *           door (cats walk there to leave, and appear there when arriving)
   *  hints    disabled buttons, e.g. "Upstairs: coming soon"
   *  spawn    floor point used if no door leads back to the room you came from
   */
  rooms: {
    hallway: {
      name: "Hallway",
      image: "hallway.jpg",
      floor: [[0.19,0.50],[0.44,0.50],[0.47,0.47],[0.64,0.47],[0.64,0.60],[0.72,0.74],[0.75,0.86],[0.75,0.99],[0.20,0.99],[0.19,0.80]],
      depth: { y1: 0.50, s1: 0.10, y2: 1.0, s2: 0.22 },
      spawn: [0.45, 0.85],
      doors: [
        { to: "living", x: 0.42, y: 0.42, arrow: "up", floor: [0.43, 0.55] }
      ]
    },
    living: {
      name: "Living Room",
      image: "living-room.jpg",
      floor: [[0.16,0.50],[0.25,0.50],[0.26,0.67],[0.43,0.67],[0.50,0.57],[0.56,0.54],[0.57,0.70],[0.80,0.71],[0.80,0.99],[0.17,0.99],[0.16,0.86]],
      depth: { y1: 0.53, s1: 0.08, y2: 1.0, s2: 0.23 },
      spawn: [0.5, 0.85],
      doors: [
        { to: "hallway", x: 0.50, y: 0.92, arrow: "down", floor: [0.50, 0.93] },
        { to: "stairway", x: 0.06, y: 0.62, arrow: "left", floor: [0.20, 0.88] },
        { to: "kitchen", x: 0.90, y: 0.62, arrow: "right", floor: [0.76, 0.84] }
      ]
    },
    stairway: {
      name: "Stairway",
      image: "stairway.jpg",
      floor: [[0.71,0.58],[0.82,0.54],[0.97,0.52],[0.96,0.70],[0.94,0.86],[0.99,0.99],[0.70,0.99]],
      depth: { y1: 0.55, s1: 0.10, y2: 1.0, s2: 0.24 },
      spawn: [0.84, 0.75],
      doors: [
        { to: "living", x: 0.93, y: 0.40, arrow: "right", floor: [0.90, 0.60] }
      ],
      hints: [
        { label: "Upstairs: coming soon!", x: 0.25, y: 0.30, arrow: "up" }
      ]
    },
    kitchen: {
      name: "Kitchen",
      image: "kitchen.jpg",
      floor: [[0.00,0.62],[0.12,0.62],[0.13,0.78],[0.50,0.83],[0.52,0.92],[0.56,0.83],[0.64,0.80],[0.67,0.63],[0.88,0.63],[0.89,0.92],[0.88,0.99],[0.00,0.99]],
      depth: { y1: 0.62, s1: 0.10, y2: 1.0, s2: 0.19 },
      spawn: [0.75, 0.80],
      doors: [
        { to: "living", x: 0.30, y: 0.93, arrow: "down", floor: [0.30, 0.95] },
        { to: "dining", x: 0.04, y: 0.45, arrow: "left", floor: [0.06, 0.70] },
        { to: "walkway", x: 0.60, y: 0.53, arrow: "up", floor: [0.71, 0.66] },
        { to: "pantry", x: 0.82, y: 0.40, arrow: "up", floor: [0.81, 0.66] },
        { to: "mudroom", x: 0.95, y: 0.62, arrow: "right", floor: [0.86, 0.84] }
      ]
    },
    walkway: {
      name: "Kitchen Walkway",
      image: "kitchen-toward-dining.jpg",
      floor: [[0.36,0.47],[0.52,0.45],[0.56,0.62],[0.60,0.78],[0.72,0.99],[0.24,0.99],[0.29,0.80],[0.29,0.60]],
      depth: { y1: 0.47, s1: 0.08, y2: 1.0, s2: 0.26 },
      spawn: [0.45, 0.85],
      doors: [
        { to: "dining", x: 0.43, y: 0.36, arrow: "up", floor: [0.44, 0.50] },
        { to: "kitchen", x: 0.48, y: 0.93, arrow: "down", floor: [0.47, 0.94] }
      ]
    },
    dining: {
      name: "Dining Room",
      image: "dining-room.jpg",
      floor: [[0.17,0.85],[0.30,0.81],[0.65,0.83],[0.74,0.86],[0.78,0.82],[0.88,0.80],[0.99,0.78],[0.99,0.99],[0.17,0.99]],
      depth: { y1: 0.80, s1: 0.20, y2: 1.0, s2: 0.26 },
      spawn: [0.45, 0.92],
      doors: [
        { to: "kitchen", x: 0.09, y: 0.62, arrow: "left", floor: [0.22, 0.92] }
      ]
    },
    pantry: {
      name: "Pantry",
      image: "pantry.jpg",
      floor: [[0.18,0.92],[0.60,0.92],[0.66,0.99],[0.16,0.99]],
      depth: { y1: 0.93, s1: 0.24, y2: 1.0, s2: 0.27 },
      spawn: [0.38, 0.97],
      doors: [
        { to: "kitchen", x: 0.85, y: 0.72, arrow: "right", floor: [0.50, 0.97] }
      ]
    },
    mudroom: {
      name: "Mudroom",
      image: "mudroom.jpg",
      floor: [[0.25,0.98],[0.33,0.78],[0.40,0.70],[0.48,0.72],[0.52,0.73],[0.65,0.80],[0.65,0.99],[0.25,0.99]],
      depth: { y1: 0.72, s1: 0.11, y2: 1.0, s2: 0.21 },
      spawn: [0.50, 0.88],
      doors: [
        { to: "kitchen", x: 0.10, y: 0.52, arrow: "left", floor: [0.32, 0.93] }
      ]
    }
  }
};
