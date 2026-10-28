// The whole story, told by apps. `at` is seconds from the start, `time` is when it happens in the
// story (drives the card's timestamp and the desktop clock), `urgency` 2 is critical.
// `progress: [from, to]` animates a bar over the card's life; `scene` changes the wallpaper.
window.STORY = [
  // I. The $40
  { at: 0.9, app: "Calendar", title: "Dentist", body: "Tue, Mar 17 · 9:00 AM · Dr. Okafor", time: "2026-03-09T08:02" },
  { at: 3.1, app: "Venmo", title: "Gary requested $40", body: "for the thing 🍕", time: "2026-03-09T12:41", actions: ["Pay", "Decline"] },
  { at: 5.2, app: "Venmo", title: "You declined Gary's request", body: "$40 · for the thing 🍕", time: "2026-03-09T12:42" },
  { at: 6.8, app: "Messages", title: "Gary", body: "u DECLINED?? it was ur pizza", time: "2026-03-09T12:44", avatar: "G" },
  { at: 8.1, app: "Messages", title: "Gary", body: "i watched u eat 6 slices", time: "2026-03-09T12:44", avatar: "G" },
  { at: 10.1, app: "Messages", title: "Gary", body: "ok. the lake. saturday. we settle this like men", time: "2026-03-12T21:58", avatar: "G" },
  { at: 12.2, app: "Messages", title: "Gary", body: "im here. where r u", time: "2026-03-14T16:02", avatar: "G" },
  { at: 13.9, app: "Messages", title: "Gary", body: "ok i see u. why do u have an oar", time: "2026-03-14T16:09", avatar: "G" },

  // II. Saturday night
  { at: 17.1, app: "Health", title: "Elevated heart rate", body: "Your heart rate was above 170 BPM for 10 minutes.", time: "2026-03-14T16:12" },
  { at: 19.3, app: "Firefox", title: "Download complete", body: "how_deep_is_lake_wapakoneta.pdf · 1.1 MB", time: "2026-03-14T16:31" },
  { at: 21.2, app: "Amazon", title: "Arriving tomorrow by 7 AM", body: "Shovel, tarp (2), garden lime (40 lb). Frequently bought together: more lime", time: "2026-03-14T16:40" },
  { at: 23.8, app: "Fitness", title: "You closed your Move ring! 🎉", body: "4 hours of vigorous digging. Keep it up!", time: "2026-03-15T03:06" },
  { at: 25.7, app: "Photos", title: "Deleting 214 items…", body: "Album: Lake day with Gary 🚤", progress: [0.04, 1], time: "2026-03-15T03:40" },
  { at: 27.7, app: "Ring", ctx: "Driveway", title: "Share this clip with Neighbors?", body: "“Man hosing out trunk, 4:10 AM” could help keep your community safe.", time: "2026-03-15T04:12", actions: ["Share", "Not now"] },
  { at: 29.9, app: "Maps", title: "Your week in review", body: "You visited Lake Wapakoneta 4 times this week.", time: "2026-03-15T19:00" },

  // III. Where's Gary
  { at: 32.0, app: "Facebook", title: "Wish Gary a happy birthday! 🎂", body: "Gary is turning 34 today.", time: "2026-03-17T08:00" },
  { at: 33.7, app: "Facebook", ctx: "Wapakoneta Community", title: "Brenda Pruitt", body: "has anyone heard from Gary?? not answering since saturday", time: "2026-03-17T10:15" },
  { at: 35.5, app: "Messages", title: "Gary's Mom", body: "honey have you seen Gary? weren't you two going to the lake", time: "2026-03-17T18:30" },
  { at: 37.3, app: "Find My", title: "Gary's iPhone", body: "Stationary at Lake Wapakoneta · 4 days", time: "2026-03-18T09:00", actions: ["Play Sound"] },
  { at: 39.4, app: "Emergency Alert", urgency: 2, title: "Missing person", body: "Gary Pruitt, 34. Last seen at Lake Wapakoneta. Call 911 with any information.", time: "2026-03-18T14:02" },

  // IV. The chase
  { at: 42.1, app: "Phone", title: "Missed call · Unknown", body: "Voicemail: “Hi, this is Detective Ramirez. We just want to talk.”", time: "2026-03-19T11:20" },
  { at: 44.1, app: "Venmo", title: "Reminder: Gary requested $40", body: "for the thing 🍕 · 10 days ago", time: "2026-03-19T12:41", actions: ["Pay", "Decline"] },
  { at: 45.9, app: "Phone", title: "Missed calls (6) · Det. Ramirez", body: "Voicemail: “We found a receipt for a lot of lime.”", time: "2026-03-19T16:05" },
  { at: 47.5, app: "Ring", ctx: "Front Door", title: "Someone is at your front door", body: "Person detected", time: "2026-03-19T16:30" },
  { at: 48.5, app: "Ring", ctx: "Front Door", title: "Someone is at your front door", body: "People detected (6)", time: "2026-03-19T16:31" },
  { at: 49.5, app: "Ring", ctx: "Back Door", title: "Someone is at your back door", body: "People detected (11)", time: "2026-03-19T16:31" },
  { at: 51.1, app: "Emergency Alert", urgency: 2, title: "BOLO · Lake Wapakoneta homicide", body: "Suspect driving a silver Camry, plate LIME 40. Do not approach.", time: "2026-03-19T17:10" },
  { at: 52.7, app: "Waze", title: "Police reported ahead", body: "I-75 S · 0.5 mi", time: "2026-03-19T17:42" },
  { at: 53.7, app: "Life360", title: "You're driving 131 mph", body: "Mom and 2 others can see this.", time: "2026-03-19T17:43" },
  { at: 54.7, app: "Waze", title: "Police reported ahead", body: "Also behind. And on your left.", time: "2026-03-19T17:44" },
  { at: 56.0, app: "Duolingo", title: "🦉 Quick Spanish lesson?", body: "Today's phrase: “Nunca he visto a este hombre.” — I have never seen this man before.", time: "2026-03-19T17:51" },
  { at: 57.8, app: "Bank", urgency: 2, title: "Your account has been frozen", body: "By court order. Questions? We'd also love to talk.", time: "2026-03-20T09:00" },
  { at: 59.6, app: "Mobile", title: "Welcome to Mexico!", body: "Data roaming: $2.05/MB. Enjoy your trip!", time: "2026-03-21T03:14" },
  { at: 61.6, app: "WhatsApp", title: "+52 667 555 0140", body: "the boss saw you on the news. nice tarp work", time: "2026-03-21T11:02" },

  // V. Higher
  { at: 63.5, app: "Uber", title: "Your helicopter is arriving", body: "Black Bell 407 · meet on the roof", progress: [0.25, 1], time: "2026-03-21T11:30" },
  { at: 65.5, app: "Bank", ctx: "Cayman", title: "Unusual activity", body: "$48,000,000 cash deposit. Was this you?", time: "2026-08-12T10:00", actions: ["Yes", "No"] },
  { at: 67.3, app: "Zillow", title: "3 new homes for “island, no extradition”", body: "14 acres · helipad · moat · $2.9M", time: "2026-10-03T14:20" },
  { at: 69.1, app: "Photos", title: "You have a new memory! 🌅", body: "Lake day with Gary · 1 year ago", time: "2027-03-14T09:00" },
  { at: 70.9, app: "News", title: "“Lake Man” now controls 40% of the world's lime", body: "Analysts: “Nobody needs this much lime.”", time: "2028-05-02T07:30" },
  { at: 72.5, app: "Find My", title: "Unknown AirTag found moving with you", body: "Owner: Interpol", time: "2028-09-11T22:15" },
  { at: 74.2, app: "Messages", title: "Mom", body: "are you eating", time: "2029-02-03T19:00" },
  { at: 76.0, app: "News", title: "Lake Man wins presidency in landslide", body: "Opponent unavailable for comment; last seen near a lake.", time: "2032-11-03T06:00" },
  { at: 77.8, app: "Calendar", title: "Inauguration", body: "in 15 min · Capitol steps", time: "2033-01-20T11:45", actions: ["Snooze"] },
  { at: 79.4, app: "Phone", title: "Missed calls (2,113) · Det. Ramirez", body: "Voicemail: “Still just want to talk.”", time: "2034-06-08T15:00" },
  { at: 81.0, app: "News", title: "Lake Man declares himself Emperor of Earth", body: "Says he has “no further plans.”", time: "2038-04-01T08:00" },
  { at: 82.6, app: "Amazon", title: "Your order has shipped", body: "Rocket (1), garden lime (40 lb). Frequently bought together: more lime", time: "2041-07-02T16:40" },

  // VI. Higher than that
  { at: 84.4, app: "Mission Control", urgency: 2, title: "Launch window confirmed", body: "T-minus 10:00 · fueling", progress: [0.15, 1], time: "2041-07-16T09:22", scene: "space" },
  { at: 85.9, app: "Messages", title: "Mom", body: "are you eating up there", time: "2041-07-16T09:40" },
  { at: 87.1, app: "Find My", title: "Your iPhone is moving at 17,500 mph", body: "Notify me when it stops?", time: "2041-07-16T09:48" },
  { at: 88.4, app: "Waze", title: "Police reported ahead", body: "Low Earth orbit · 400 km", time: "2041-07-16T10:02" },
  { at: 89.8, app: "Weather", title: "Moon · Sunny, 127°C", body: "UV index: all of it", time: "2041-07-19T12:00" },
  { at: 91.2, app: "Maps", title: "Leave now to arrive on time", body: "Dentist · Tue 9:00 AM · 384,400 km away", time: "2041-07-19T13:00" },
  { at: 92.8, app: "Duolingo", title: "🦉 These reminders don't seem to be working", body: "We'll stop sending them for now.", time: "2049-11-30T09:00" },

  // Quiet. The corner empties. Then:
  { at: 100.4, app: "Messages", title: "Gary", body: "u still owe me $40", time: "2049-11-30T23:58", avatar: "G", final: true },
]
// The stack clears this long before the final card, which then arrives alone and stays.
window.QUIET = 3.4
