# Game design findings

What we tried for a core mechanic, why it did not work, and what to try next.
Read this before you start a new game idea. The rules of the current prototype are in `docs/game.md`.

## What the user wants

- A game, not a sandbox. Nintendo style: one core mechanic that is easy to explain, tight levels, mini missions.
- Heist, stealth or puzzle box. Thematic for an Australian white ibis (a "bin chicken").
- No humans (too complex to make). The noisy miners are the guards. They react to noise and disruption.
- Every rule must show on the screen. Some people play with the sound off.

## Prototypes and results

### 1. Noise stealth (on paper only)

"Everything you do makes noise. The miners mob noise."
Rejected before a build: noise is hard to see, and each surface needs its own feedback.

### 2. Stuck (`?level=yard`, removed)

"Stick your head in any rubbish to get its power, but you can't get it off." A cone (a squawk blasts the miners; off at a fence post) and a bucket (the miners can't see you; off when you run into something heavy).

Playtest: weird and not fun. The player put on the bucket, stumbled round blind, could not pick up the trophy, knocked the bucket off by accident, got swooped, and gave up.

Why it failed:
- The gimmick is a limit with no fun verb. You do not want to repeat "being stuck" again and again.
- The first item was all problem (blind, no peck).
- The way off happened by accident, not by choice.
- Too many new rules at once: two items, two miners, a daze timer, two ways off.
- The goal and the "can't peck" rule were only in text.
- The worn cone clipped through the head and bill.
- The level was a flat square.

### 3. Hide in the rubbish (`?level=barbie`, now in the code)

"Hide in the rubbish. Move when nobody's looking." A box or a bin with the legs out; miners with gaze fans fill a meter when rubbish moves in view.

Playtest: the player got 2 of 3 slices home. More annoying and tedious than fun. The sight cones were easy to avoid.

Why it failed:
- **The core verb is waiting.** The best play is to stand still until a fan goes away. A game of statues is only fun when the stakes are high and the waits are short.
- **Tedious and easy at the same time.** That is the worst mix. The yard is wide open, so each fan covers a small part of it, and a path round them is easy to find. Then the bird crosses about 30 units at about 1 unit per second, three times.
- **No choices.** The guards move in fixed patterns, and the bird can't act on them: no lure, no distraction, no tool. With nothing to decide, the player just follows the gaps.
- **Repetition.** Three trips on the same route, with nothing new on the second and third.
- **No pressure.** No clock, and no reason to take a risk.
- The things that worked: the look (legs out of a box, googly eyes), the yard as a place (slope, deck, Hills Hoist), and the markers and count.

### What the bots told us

A headless bot played each route and won. That proved the routes work, but it said nothing about fun. A bot that knows the answer can't feel boredom or confusion.

## Patterns across the failures

1. **Each idea was a limit or a rule about avoiding things, not a verb that is fun to do.** Nintendo gimmicks start with a verb that feels good in an empty room (throw the cap, inhale, jump). The limit comes after, to shape the levels.
2. **Levels came before the fun.** We built a full level each time, before we knew if the core action felt good.
3. **What already feels good in this project is physical and fast:** a run that tips a bin, the stubbies as bowling pins, the snap at a diving miner (hit-stop, camera shake, the tumble), the footy, the sprinkler. Neither prototype used these.
4. **Stealth needs agency.** It is fun when you can act on the guards (lure, distract, take out) and when getting caught is close and exciting. Pure avoidance is a timing chore.

## Rules for the next attempt

- Find the fun in a toy first: one verb, a small test space, two minutes of play. Build a level only after the user says the toy is fun.
- The core action must be fun with no goal at all.
- Short loops: a round of 60 to 120 s, with a clear score or result, that you want to play again.
- Pressure: a clock or a threat that makes the player act, not wait.
- Teach one thing at a time. Show every rule in the world.
- A bot playtest only proves a route works. Judge fun from what a first-time player does in the first minute.

## MDA: where we sit

MDA (Hunicke, LeBlanc and Zubek, 2004) splits a game into three layers:
- **Mechanics:** the rules and the code (a throw, a timer, a gaze fan).
- **Dynamics:** what happens when a player uses the mechanics over time (rushing, waiting, improvising).
- **Aesthetics:** what the player feels. Eight kinds of fun: sensation, fantasy, narrative, challenge, fellowship, discovery, expression, submission.

The designer makes mechanics and can only hope for the aesthetics. The player feels the aesthetics first and sees the mechanics last. So pick the target aesthetics first, then the dynamics that give them, then the mechanics that cause those dynamics.

### How useful it is

- Useful: it shows our mistake. Both prototypes started from a mechanic ("stuck", "hide") and did not check what dynamics it gave. The dynamics were stumbling (Stuck) and waiting (Hide), and the aesthetic was frustration and tedium.
- Useful: a common language to judge an idea before we build it. "What will the player do over and over, and how does that feel?"
- Limit: the eight aesthetics are a loose list. Some are feelings (sensation), some are motives (fellowship), and "submission" (a game as a pastime) is vague.
- Limit: it says nothing about game feel: the response of the controls, the hit-stop, the sounds. For an action game that is most of the sensation. Use it with a game feel check.
- Limit: dynamics come from play, not from paper. MDA does not replace a toy and a playtest. It tells you what to look for in one.

### Our target

| Aesthetic | Rank | Why |
|---|---|---|
| Sensation | 1 | The look and the physics are the best things we have. The core action must feel good alone. |
| Fantasy | 1 | A cheeky bin chicken that gets away with it in an Australian back yard. The theme is the hook. |
| Challenge | 2 | The user asked for tight levels and mini missions, not a sandbox. |
| Discovery | 3 | Puzzle-box yards: find the trick, the short cut, the second route. |
| Expression | 3 | More than one way to solve a mission. Style in how you do it. |
| Narrative | 4 | Light: a reason for each job, told by the props. No story engine. |
| Fellowship | none | Single player. |
| Submission | avoid | This is the sandbox the user does not want. The disguise game gave a bad form of it: long, low-stakes play. |

Short version: "a cheeky bin chicken pulling off quick, physical heists" (sensation and fantasy first, then challenge).

### The dynamics that give it

- Quick decisions under pressure, not waiting.
- Risk and reward: a fast, greedy route against a safe one.
- Improvising with physics: things tip, roll and fall in new ways each time.
- Close calls: a dive that only just misses.
- Short loops and quick retries.

### The prototypes on MDA

| Prototype | Mechanics | Dynamics we got | Aesthetic we got |
|---|---|---|---|
| Stuck | Wear one item; one way off each | Stumbling, accidental exits, confusion | Frustration |
| Hide | Disguises; gaze fans; freeze to stay hidden | Waiting for gaps, a slow walk, the same route three times | Tedium (low challenge, low sensation) |
| A. Bill toss (not built) | Grab, aim, fling | Trick shots, knock-ons, improvising | Sensation, challenge, expression |
| B. Bin night (not built) | Timer, tip bins, mob, truck | Rushing, risk and reward, chaos | Challenge, sensation, fantasy |

A and B aim at the target. Hide could only reach it with a new core verb. This is the same answer as the scores below, from a second view.

## Candidates

Each one scored 1 (poor) to 5 (good) on: the verb is fun alone, easy to explain, room for clever levels, use of what already works, low build cost.

### A. Bill toss: "Anything in your bill, you can fling."

The bird grabs a prop and flicks its head to throw it. Hit a miner on its perch (then snap it), knock over a stack, hit the tap, bowl the stubbies, land things in a bin.

- For: a fun verb with skill (aim, timing). Uses the grab, the physics and the snap that already feel good. Clear puzzle levels are possible ("knock all three miners off with two stubbies"). Cheap: a throw is the drop with a velocity.
- Against: physics throws can feel random. It needs an aim guide (an arc). It can drift into a sandbox without hard goals.
- Scores: verb 4, explain 5, levels 4, reuse 5, cost 5.

### B. Bin night: "Raid the street before the truck comes."

A timed round (90 s). The bins are out on the street. Tip a bin, dig through the spill, grab the best food, and get it to the nest. Miners mob you; snap them. The truck comes down the street and takes each bin it reaches. Score and medals.

- For: the most thematic. Pressure fixes the waiting. Bin tipping, slams and dives already work. Short loops that you want to play again. Each street can be a new layout and a new rule (a dog behind a fence, a sprinkler, a gate).
- Against: closer to an arcade score attack than a puzzle box. It needs a truck, rubbish spill props and a score system. Chaos can hide the rules.
- Scores: verb 4, explain 5, levels 3, reuse 4, cost 3.

### C. Snap duel: "Guard your chips from the mob."

The bird sits on a stash. Waves of miners dive at it. Snap them at the right time (a parry). Different miners have different dive patterns.

- For: the snap is the juiciest action in the project. Easy to explain. Cheap.
- Against: a combat arena, not a heist or puzzle. Shallow without many enemy types. Moves away from what the user asked for.
- Scores: verb 4, explain 5, levels 2, reuse 5, cost 4.

### D. Bin chicken gang: "Lead a mob of ibises. Big jobs need more birds."

Collect lone ibises. Squawk to send the mob at a target. Three tip a bin; a chorus scares the miners.

- For: funny, thematic (ibises come in mobs), clear puzzles ("this needs 4 birds").
- Against: follower AI, path finding and group control are a lot of work. Close to an existing well-known series.
- Scores: verb 3, explain 5, levels 4, reuse 3, cost 1.

### E. Hide in the rubbish, fixed

Keep the disguises, but make the spaces small and dense, give tools (a squawk lure, a thrown stubby to make a miner look away), and add a clock.

- For: the look is good and the code exists.
- Against: the core verb is still waiting. Tools and a clock treat the symptoms. Low ceiling.
- Scores: verb 2, explain 4, levels 3, reuse 5, cost 4.

### F. One push: "Set off a chain reaction to get the food."

Each level is a physics domino puzzle. Push one thing, and the chain gets the food to you.

- For: a puzzle box with clear goals.
- Against: physics chains break in small ways and are hard to read. Little to do for most of the time.
- Scores: verb 2, explain 4, levels 4, reuse 3, cost 2.

## Inspiration: Dumpster Gang

A co-op game (1 to 4 players) where raccoons cause chaos: ridiculous missions, steal what you can carry, throw and smash nearly everything, climb and use vents, carry heavy loot together. Chaos brings a human Exterminator who hunts and traps the gang; you rescue caught friends. Between missions: hats with abilities, and a hideout you decorate with the loot.

On MDA it aims at fellowship (co-op mishaps) and sensation (physics chaos) first, then fantasy (the raccoon menace), with light challenge from the Exterminator and expression from the hats and the hideout.

What to take, as general patterns (not its content):
- **Chaos has a cost.** The more mess, the stronger the response. That makes chaos a choice with a risk, not free.
- **Carry and throw as the main actions.** It agrees with candidate A.
- **Big loot is slow.** Heavy things change how you move, so a greedy grab is a risk.
- **Loot comes home and stays.** A place that shows what you stole is a reason to play again.

What not to take:
- **Co-op.** Fellowship is its main fun, and network play is a big cost. Design for one player. Co-op can come later.
- **Climbing and vents.** That is the raccoon's fantasy. An ibis wades, probes with its bill and flies.
- **Hats with abilities, the Exterminator, the jail and the rescue.** These are its own content. No humans here in any case.
- **Sandbox first.** It says "chaotic co-op sandbox". The user wants tight missions.

What only an ibis has, for a distinct game:
- A long bill: probe into things, flick things out, fling with a toss of the head.
- It flies: a short flap up to a fence top, a shed roof or a bin lid, and a glide down. Height is its own route and its view.
- It lives in a colony: the loot goes to the colony tree in the park, not a hideout. The colony grows and the tree fills with junk.
- Its guards are a mob of small birds that attack from the air, and it can fight back (the snap).

### Candidate G. Mob rules: "The more mess you make, the bigger the mob."

A timed raid (Bin night, candidate B) with a chaos meter. Each tipped bin, smashed stack and stolen snack adds to the score multiplier, and calls in more miners. At low chaos, one or two miners scold. At high chaos, a mob swoops in waves, and a hit makes you drop what you hold. Snap them to break up the mob. Fling food toward the colony tree, or drag big loot (a whole loaf, a pizza box) slowly for big points. Bank the loot at the tree to cash in the multiplier.

- For: a real choice in every second (bank now, or make more mess for a bigger multiplier). Pressure, risk and close calls. Uses tipping, flinging, dives and the snap. Thematic: noisy miners really do mob intruders in groups.
- Against: the score attack and the chaos-brings-a-hunter pattern are common (wanted levels, the Exterminator). It must feel distinct through the air mob, the snap, the fling and the colony. It needs a mob director, a chaos meter, a score and drag carry.
- Scores: verb 4, explain 5, levels 3, reuse 4, cost 3.

## Recommendation

1. Build toy A (bill toss) in a small test yard: grab, an aim arc, a flick throw, things to hit (miners on posts, stubbies, a bin). No mission. The user plays it for two minutes.
2. If the throw feels good, put it in a 90 s Bin night round with mob rules (B and G): fling food toward the colony tree, knock miners off, tip bins from far away, and choose between banking the loot and making more mess.
3. Keep the disguises and the back yard pieces as level parts. Don't make hiding the core.

Do not build a full level until the user says the toy is fun.

## Toy A: the fling (`?level=fling`, built, waiting for a playtest)

- Pick up a lemon (or a stubby, a cereal box). Hold peck to aim: the bird winds up, an arc of dots shows the flight and a ring where it lands. The longer the hold (up to 0.9 s), the farther. Turn to aim. The arc goes red, and the miner gets a white outline, when the throw will hit it. Let go: a head whip and a whoosh, and the prop flies end over end.
- A hit knocks the miner down as a snap does: tumble, yelp, hit lines, puffs, hit-stop, camera shake. It flies off to a far perch and comes back later, so there are always targets.
- While the bird aims, the camera rises and turns behind it, so high miners and the hit stay in view.
- Challenges (optional): 5 miners down, a hit on a miner in the air, a long shot (12+), all stubbies down.
- What we learned while making it: a fixed angle of 35 degrees could not reach a miner on a 3.2 high post 9 away at full power (now 43 degrees, up to 20 units per second). The arc must use the prop's drag and the same start point as the throw, or a red arc misses. "On target" is stricter (0.55) than a hit (0.85), so a red arc is a sure hit on a still miner. The arc does not stop at props in the way.
- A bot that holds until the arc goes red hit 3 of 3 perched miners from about 9 away.
- Questions for the playtest: does the throw feel good with no goal? Is the arc too much help (no skill)? Is the hold-to-charge too slow? Do the miners' attacks give enough pressure?
