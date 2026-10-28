// The whole story, told by apps. `at` is seconds from the start, `time` is when it happens in the
// story (drives the card's timestamp and the desktop clock), `urgency` 2 is critical.
// `progress: [from, to]` animates a bar over the card's life; `scene` changes the wallpaper.
// Every jump is him trying to get away with it: an AI answer says what he asked, the
// cards after it are what happens, and Detective Ramirez keeps calling.
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
  { at: 16.9, app: "Health", title: "Elevated heart rate", body: "Your heart rate was above 170 BPM for 10 minutes.", time: "2026-03-14T16:12" },
  { at: 18.7, app: "Firefox", title: "Download complete", body: "how_deep_is_lake_wapakoneta.pdf · 1.1 MB", time: "2026-03-14T16:31" },
  { at: 20.2, app: "ChatGPT", title: "Thinking… (2m 14s)", body: "Lime and Odor Control", time: "2026-03-14T16:34" },
  { at: 22.2, app: "ChatGPT", title: "Lime and Odor Control", body: "I can't help with hiding anything! But garden lime is great at neutralizing odors in compost, soil, and other organic…", time: "2026-03-14T16:36" },
  { at: 24.4, app: "Amazon", title: "Arriving tomorrow by 7 AM", body: "Shovel, tarp (2), garden lime (40 lb). Frequently bought together: more lime", time: "2026-03-14T16:40" },
  { at: 26.2, app: "Fitness", title: "You closed your Move ring! 🎉", body: "4 hours of vigorous digging. Keep it up!", time: "2026-03-15T03:06" },
  { at: 27.9, app: "Photos", title: "Deleting 214 items…", body: "Album: Lake day with Gary 🚤", progress: [0.04, 1], time: "2026-03-15T03:40" },
  { at: 29.7, app: "Ring", ctx: "Driveway", title: "Share this clip with Neighbors?", body: "“Man hosing out trunk, 4:10 AM” could help keep your community safe.", time: "2026-03-15T04:12", actions: ["Share", "Not now"] },

  // III. Where's Gary
  { at: 31.9, app: "Facebook", title: "Wish Gary a happy birthday! 🎂", body: "Gary is turning 34 today.", time: "2026-03-17T08:00" },
  { at: 33.5, app: "Facebook", ctx: "Wapakoneta Community", title: "Brenda Pruitt", body: "has anyone heard from Gary?? not answering since saturday", time: "2026-03-17T10:15" },
  { at: 35.1, app: "Messages", title: "Gary's Mom", body: "honey have you seen Gary? weren't you two going to the lake", time: "2026-03-17T18:30" },
  { at: 36.7, app: "Find My", title: "Gary's iPhone", body: "Stationary at Lake Wapakoneta · 4 days", time: "2026-03-18T09:00", actions: ["Play Sound"] },
  { at: 38.5, app: "Emergency Alert", urgency: 2, title: "Missing person", body: "Gary Pruitt, 34. Last seen at Lake Wapakoneta. Call 911 with any information.", time: "2026-03-18T14:02" },

  // IV. On the run
  { at: 40.8, app: "Phone", title: "Missed call · Unknown", body: "Voicemail: “Hi, this is Detective Ramirez. We just want to talk.”", time: "2026-03-19T11:20" },
  { at: 42.4, app: "Venmo", title: "Reminder: Gary requested $40", body: "for the thing 🍕 · 10 days ago", time: "2026-03-19T12:41", actions: ["Pay", "Decline"] },
  { at: 44.0, app: "ChatGPT", title: "Extradition Treaty Overview", body: "Here are 12 countries without extradition treaties with the US. Want me to sort them by beach quality? 🏝️", time: "2026-03-19T13:05" },
  { at: 46.3, app: "Ring", ctx: "Front Door", title: "Someone is at your front door", body: "People detected (6)", time: "2026-03-19T16:30" },
  { at: 47.2, app: "Ring", ctx: "Back Door", title: "Someone is at your back door", body: "People detected (11)", time: "2026-03-19T16:31" },
  { at: 48.5, app: "Emergency Alert", urgency: 2, title: "BOLO · Lake Wapakoneta homicide", body: "Suspect driving a silver Camry, plate LIME 40. Do not approach.", time: "2026-03-19T17:10" },
  { at: 49.9, app: "Waze", title: "Police reported ahead", body: "I-75 S · 0.5 mi", time: "2026-03-19T17:42" },
  { at: 50.8, app: "Life360", title: "You're driving 131 mph", body: "Mom and 2 others can see this.", time: "2026-03-19T17:43" },
  { at: 51.8, app: "Waze", title: "Police reported ahead", body: "Also behind. And on your left.", time: "2026-03-19T17:44" },
  { at: 53.0, app: "Duolingo", title: "🦉 Quick Spanish lesson?", body: "Today's phrase: “Nunca he visto a este hombre.” — I have never seen this man before.", time: "2026-03-19T17:51" },
  { at: 54.6, app: "Bank", urgency: 2, title: "Your account has been frozen", body: "By court order. Questions? We'd also love to talk.", time: "2026-03-20T09:00" },
  { at: 56.1, app: "Phone", title: "Missed calls (6) · Det. Ramirez", body: "Voicemail: “We found a receipt for a lot of lime.”", time: "2026-03-20T09:30" },
  { at: 57.6, app: "Mobile", title: "Welcome to Mexico!", body: "Data roaming: $2.05/MB. Enjoy your trip!", time: "2026-03-21T03:14" },

  // V. Good with a tarp
  { at: 59.5, app: "WhatsApp", title: "+52 667 555 0140", body: "the boss saw you on the news. nice tarp work", time: "2026-03-21T11:02" },
  { at: 61.0, app: "WhatsApp", title: "+52 667 555 0140", body: "we have a job. bring the tarp", time: "2026-03-23T22:10" },
  { at: 62.5, app: "Amazon", title: "Subscribe & Save is set up", body: "Tarp (24), garden lime (40 lb × 12). Delivers every 2 weeks.", time: "2026-04-02T10:00" },
  { at: 63.9, app: "Fitness", title: "14-day Move streak! 🔥", body: "All that late-night digging is paying off.", time: "2026-04-16T06:00" },
  { at: 65.3, app: "Phone", title: "Missed calls (40) · Det. Ramirez", body: "Voicemail: “Mexico? Really?”", time: "2026-05-01T12:00" },

  // VI. Lime
  { at: 67.0, app: "LinkedIn", title: "Congrats on your new role!", body: "CEO at Lime Corp", time: "2026-09-14T09:00" },
  { at: 68.4, app: "Lime Corp", title: "Q3 revenue up 4,000%", body: "Analysts: “Nobody needs this much lime.”", time: "2027-10-15T08:00" },
  { at: 69.8, app: "Bank", ctx: "Cayman", title: "Unusual activity", body: "$48,000,000 cash deposit. Was this you?", time: "2027-11-02T10:00", actions: ["Yes", "No"] },
  { at: 71.3, app: "Forbes", title: "The mysterious lime billionaire nobody has photographed", body: "Net worth: $11B. Hobbies: “boating.”", time: "2028-06-03T07:00" },
  { at: 72.7, app: "Messages", title: "Mom", body: "are you eating", time: "2029-02-03T19:00" },
  { at: 73.9, app: "Phone", title: "Missed calls (300) · Det. Ramirez", body: "Voicemail: “Nice yacht.”", time: "2029-08-20T15:00" },

  // VII. Immunity
  { at: 75.6, app: "ChatGPT", title: "Presidential Self-Pardon Questions", body: "This is a debated legal question! While no president has pardoned himself yet, nothing explicitly says he…", time: "2031-02-11T02:13" },
  { at: 77.9, app: "Lake Man 2032", title: "You raised $1.2B today", body: "Top donor: Lime Corp", time: "2032-03-05T21:00" },
  { at: 79.2, app: "News", title: "Lake Man wins presidency in landslide", body: "Opponent unavailable for comment; last seen near a lake.", time: "2032-11-03T06:00" },
  { at: 80.6, app: "Calendar", title: "Inauguration", body: "in 15 min · Capitol steps", time: "2033-01-20T11:45", actions: ["Snooze"] },
  { at: 82.0, app: "Calendar", title: "Sign pardon (self)", body: "2:00 PM · Oval Office", time: "2033-01-20T13:45" },
  { at: 83.4, app: "Messages", title: "Det. Ramirez", body: "that's not how that works", time: "2033-01-20T14:03" },

  // VIII. Higher than that
  { at: 85.2, app: "ChatGPT", title: "Lunar Sovereignty Inquiry", body: "Technically, no nation can claim the Moon under the 1967 Outer Space Treaty, which means it has no police either! 🌙", time: "2040-12-01T03:30" },
  { at: 87.5, app: "Amazon", title: "Your order has shipped", body: "Rocket (1), garden lime (40 lb). Frequently bought together: more lime", time: "2041-07-02T16:40" },
  { at: 88.9, app: "Mission Control", urgency: 2, title: "Launch window confirmed", body: "T-minus 10:00 · fueling", progress: [0.15, 1], time: "2041-07-16T09:22", scene: "space" },
  { at: 90.3, app: "Messages", title: "Mom", body: "are you eating up there", time: "2041-07-16T09:40" },
  { at: 91.4, app: "Find My", title: "Your iPhone is moving at 17,500 mph", body: "Notify me when it stops?", time: "2041-07-16T09:48" },
  { at: 92.5, app: "Waze", title: "Police reported ahead", body: "Low Earth orbit · 400 km", time: "2041-07-16T10:02" },
  { at: 93.7, app: "Phone", title: "Missed calls (2,113) · Det. Ramirez", body: "Voicemail: “We have a rocket too.”", time: "2041-07-16T10:30" },
  { at: 95.0, app: "Weather", title: "Moon · Sunny, 127°C", body: "UV index: all of it", time: "2041-07-19T12:00" },
  { at: 96.2, app: "Maps", title: "Leave now to arrive on time", body: "Dentist · Tue 9:00 AM · 384,400 km away", time: "2041-07-19T13:00" },
  { at: 97.7, app: "Duolingo", title: "🦉 These reminders don't seem to be working", body: "We'll stop sending them for now.", time: "2049-11-30T09:00" },

  // Quiet. The corner empties. Then:
  { at: 105.2, app: "Messages", title: "Gary", body: "u still owe me $40", time: "2049-11-30T23:58", avatar: "G", final: true },
]
// The stack clears this long before the final card, which then arrives alone and stays.
window.QUIET = 3.4
