# Uber & Bolt Safety Technology Teardown — Implementation Level

Task 11-b (research-subagent, safety). Companion to `docs/UBER_BOLT_TEARDOWN.md` §3.10/§4 (which covered the **UX level**); this doc goes **deeper — documented implementation behavior, server-side mechanics, retention policies, and thresholds** — using public sources only: first-party engineering blogs, safety pages, help articles, and reputable press. No decompilation, no proprietary code, no invented details.

**Source-labeling legend used throughout:**
- **[S]** = documented in a public source (URL given)
- **[S-p]** = documented only via search-result snippet of a public page (page itself login/JS-walled or fetch-blocked — noted)
- **[I]** = inferred by this agent from documented behavior (method stated)
- **[U]** = unknown / not publicly documented

Research artifacts: 44 prior web-search result files + 21 fetched pages under `scripts/research/safety/` (results/, pages/), plus new curl fetches under `scripts/research/safety/curl/`. The z-ai search/page_reader quota was exhausted (429) mid-task; all facts below were captured before or independent of that.

---

## 1. SOS / Emergency flows

### 1.1 Uber Emergency Button — documented system architecture (US/global)

Uber's own engineering blog ("Uber's Emergency Button and The Technologies Behind It", Mar 2022) is unusually detailed **[S]** — https://www.uber.com/us/en/blog/ubers-emergency-button-and-the-technologies-behind-it/ :

- **History:** first version rolled out in **India in 2015**; original system let riders/drivers contact local police from inside the app and **automatically alerted regional support teams to proactively reach out**. In 2018 enhanced: live location surfaced in-app, trip details shared with authorities, button on both rider and driver apps globally. Select markets later added **discreet texting to police** and an **IVR follow-up** channel. **[S]**
- **UX mechanics:** shield icon → Safety Toolkit → "Emergency Assistance" sheet shows **your GPS location (reverse-geocoded to a readable address, refreshed by the client calling a backend reverse-geocoding API "at a regular cadence"), car make/model, and license plate**. "Swipe To Call 911" then connects to a dispatcher. **[S]**
- **RapidSOS integration (US/Mexico):** the mobile client requests the **Emergency backend service through a gateway proxy**; Emergency Service delivers trip data (car make/model, license plate, requester name) to **RapidSOS' Emergency APIs**; simultaneously a **location worker on the client uploads location every few seconds** to location services, and real-time location updates are **streamed to the Emergency Service through Kafka**, which **continuously calls RapidSOS' Location API**. Covered ~1,200 markets / **74% of US trips** at publication. Privacy: strictly gated on user permission to share trip/location with third parties. **[S]**
- **Text-to-911:** the "Text 911" option opens the **native Messaging app with a prefilled message** (current location + vehicle make/model + 911 as recipient); the client simultaneously **creates an incident ticket** in Uber's ecosystem for follow-up. RapidSOS streaming applies to this flow too. **[S]**
- **Reliability engineering (server-side behavior):** emergency traffic is low (< 1 interaction/second globally) but the system targets near-zero downtime. Architecture: **modular "alert channels"** — each downstream integration (RapidSOS, internal support ticketing, in-app messaging, IVR) is its own decoupled channel so one failing channel doesn't block others. Channels run over **Uber's internal Kafka APIs with at-least-once delivery and DLQ (dead-letter queue)** semantics: ACK/NACK per event, server-side retries for a configured count, then DLQ for later purge/replay. Every RPC has **exponential-backoff retries**; if Kafka APIs are unavailable the service **degrades gracefully to direct RPC calls**. **[S]**
- **Alert channels beyond dispatch:**
  - **IRT (Incident Response Team):** Emergency Service **creates a ticket for Uber's internal Incident Response Team**, whose agents "proactively monitor incoming emergency tickets and follow up with our users" — via **phone calls, in-app help messages, or emails**. In-app messaging links to a help page for direct reporting. **[S]**
  - **IVR (2019):** an **automated phone call** placed to the user **20 minutes after** they tap the button (deliberately delayed so as not to interfere with the 911 call); user can confirm they're safe or connect to support agents. Built on Uber's open-source **Cadence** workflow orchestrator + **Twilio**. **[S]**
- Also documented: after tapping, "Uber's support team will follow up with a check-in to make sure you are safe." **[S]**

### 1.2 Uber SOS in India (police integration + response layer)

- 2015 launch: in-app panic button connects to police and **"also the company's own backend system in real time"** (FirstPost) **[S-p]** https://www.firstpost.com (May 2015); PCMag: "panic button, Safety Net option in India... they will also assist local law enforcement" **[S-p]**.
- Uber Help ("How does the SOS option work?"): SOS = "real-time safety alert... once activated, users can **swipe to connect directly with the police via phone call**" at a +91 number **[S-p]** https://help.uber.com (article JS-walled; snippet).
- Telangana police + Uber (Jul 2022): the SOS feature **provides Dial 100 the location, name and phone number of the person** — i.e. the state emergency line receives structured identity + live location, not just a call **[S-p]** https://timesofindia.indiatimes.com (Jul 19, 2022).
- **24x7 safety helpline (2019, India):** riders "can connect with representatives of the **Safety Incident Response Team** in English and Hindi 24x7" for non-911-grade issues (misbehaviour, disputes) **[S-p]** https://www.thehindu.com (Aug 27, 2019).
- Oct 2025: a new **Help button** "instantly alerts the police" across all 22 Indian cities Uber operates in **[S-p]** https://tech.hindustantimes.com (Oct 8, 2025).
- Washington Post (2016) noted the India SOS connects to a **local aggregated response center**, not always direct-to-police, and the app urged riders to also call 112/100 **[S-p]** https://www.washingtonpost.com — useful reminder that "SOS" implementations vary by market and are often mediated.

### 1.3 Bolt Emergency Assist

- Official rider safety page: "Quickly and discreetly alert an **emergency response team** with our in-app Emergency Assist button. **This will also notify our Safety team, who will make an immediate welfare call.**" **[S]** https://bolt.eu/en/rides/safety/
- Driver-side page: "Emergency assist — Drivers can quickly and discreetly alert the **emergency services** by tapping the in-app Emergency Assist button"; plus "**Safety incident management:** In the unlikely event of a safety incident, our **High Priority Safety team will take immediate action**"; plus "**Collaboration with the police:** We have dedicated communication channels where police officers can obtain the required information." **[S]** https://bolt.eu/en/driver/safety/
- South Africa launch (Nov 2020): Emergency Assist routed to private armed-response partner **Namola**, which **guarantees a call-back within 90 seconds**, establishes the nature of the incident, and dispatches appropriate responders **[S-p]** (three outlets independently: thestar.co.za, itweb.co.za, gadget.co.za, Nov 24, 2020). This is the only **hard response-time number** either company's SOS chain has publicly attached.
- Kenya commentary (techtrendske.co.ke, Feb 2025): Emergency Assist = instant emergency access + real-time location sharing **[S-p]**.
- Zikoko × Bolt (Nov 2024) on the Safety Team: **500+ people**; core in Tallinn; **24/7 Safety Specialists in Safety Hubs including Nigeria and Kenya** (also Portugal, Azerbaijan, Thailand, Poland) **[S]** https://www.zikoko.com/2024/11/how-the-bolt-safety-team-works/
- Bolt 2025 safety wave (ITWeb, Jun 30, 2025): AI-powered dash cams, in-app emergency tools, **mandatory rider ID verification** **[S-p]** https://www.itweb.co.za.

### 1.4 What a SMALL platform (MIZIGO) can actually implement

Uber's chain is: **trigger → confirm screen with location data → call dispatch (with data pushed where possible) → parallel alert channels (ops ticket, in-app msg, delayed welfare call)**. Only the ops-ticket + welfare-call + log layers are buildable without a RapidSOS-class partner; the **architecture lesson** (decoupled alert channels, retries, idempotency) is buildable at any scale **[I]**.

Concrete minimum (see §9 spec): SOS button → slide-to-confirm (Bolt-style discreet, Uber-style "here's your location + vehicle details first") → **`tel:` to a configured ops/emergency number** + **prefilled SMS** (Uber Text-911 pattern) + server `SAFETY_ALERT` event + admin Ops alert + post-alert check-in prompt. Response target we can commit to publicly: an ops callback SLA we set ourselves (Bolt's "immediate welfare call" wording is the benchmark; Namola's 90 s is the aggressive end) **[I]**.

---

## 2. Trip sharing internals

### 2.1 Payload contents (what the recipient sees)

- **Uber:** "Those people will receive a text with a link containing your trip details. **Opening it displays your driver's first name and vehicle information, plus your map location** [in real time]" **[S-p]** https://www.uber.com (Riders — Share Your Trip Status). Help FAQ: recipient notification "contains your **driver's first name, vehicle info, and your map location in real-time**" **[S-p]** https://help.uber.com (Sharing your trip status FAQ). Note the deliberate minimality: first name only, no phone numbers, no full address in the notification copy.
- **Bolt:** "Send the **car's make, model, registration number, and live location** to friends or family via a shareable link. All trips are also tracked and recorded." **[S]** https://bolt.eu/en/rides/. For drivers: "Share your real-time location with friends or family, so they know you're safe" (Driver trip sharing) **[S]** https://bolt.eu/en/driver/safety/.
- Chloe Fan's recipient-experience walkthrough (Uber link from recipient's perspective — ETA status focus) **[S]** https://www.chloefan.com/uber-share-trip-recipient-experience/ (page body is thin; treat as UX corroboration only).

### 2.2 Expiry & validity policies

- **Bolt (2023+ blog):** "The link will expire in **48 hours after your trip was finished**. Car's location is **taken from Driver's GPS**." **[S-p]** https://bolt.eu/en/blog/share-trip-details-with-friends/ (Nov 15, 2023; blog JS-walled, snippet from bolt.eu domain). Earlier Bolt behavior (per prior teardown §3.8 and 2019-era docs) was **valid for one ride only** — i.e. Bolt moved from per-ride to a bounded post-trip window. **[S for the change; the "one ride" era is in the prior teardown's sources]**
- **Uber:** share terminates when the trip ends (status stops updating and the link stops live-following); exact link-TTL after trip end is **[U]** — Uber's public help pages don't state an expiry hour count. Do not quote one.
- **No-auth viewing:** both links open in a browser **without an app or login** (Uber link opens a web view with live map; Bolt: "works with no app installed" — prior teardown §3.8, bolt.eu blog "Trip-sharing functionality launched for Bolt drivers") **[S]**.

### 2.3 Web Share API on mobile web (MIZIGO's native share path)

- `navigator.share()` requires **transient user activation** (must be triggered by a UI event, cannot be launched arbitrarily by script) **[S]** https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share. Supports `{title, text, url}`; **file sharing** requires `navigator.canShare({files})` feature-detection first **[S]** (same MDN page). Desktop browsers generally lack the OS share sheet → must fall back to clipboard/copy **[S-p]** https://ruchern.dev (Jan 2023).
- MIZIGO already implements exactly this pattern in `src/components/mizigo/shared/share.ts` (navigator.share → clipboard fallback) **[S — our codebase]**.

---

## 3. Ride Check / anomaly detection

### 3.1 Uber RideCheck (documented)

- **Sensors:** "uses the **GPS, accelerometer, gyroscope, and other sensors on the driver's smartphone** to monitor for irregular" movements (MIT Technology Review, Sep 2019) **[S-p]** https://www.technologyreview.com; same wording in The Verge, Sep 17, 2019 **[S-p]**. 2016 VentureBeat piece shows the ancestry: Uber already used **gyrometer + accelerometer data from drivers' phones** to verify feedback claims (harsh braking etc.) **[S-p]**.
- **Detected scenarios (public list):** possible **crash**, **unexpectedly long stop** (Uber Newsroom, Sep 17, 2019) **[S]** https://www.uber.com/us/en/newsroom/ridecheck/; a 2024 ABC7 piece adds "**goes off course**, stops unexpectedly **or ends a trip early**" **[S-p]** https://www.abc7news.com (Apr 12, 2024). Uber's safety hub: "By using sensors and GPS data, RideCheck can help detect if a trip goes **unusually off-course** or if a **possible crash** has occurred" **[S-p]** https://www.uber.com/us/en/safety.
- **Response behavior (documented):** "When a RideCheck is initiated, **both a rider and driver will receive a notification asking if everything is OK**. They can let us know through the app that all is well, or take other actions like **using the emergency button or reporting the issue to Uber's Safety Line**. Our safety team may also follow up by phone to inquire about the RideCheck. In the event of a crash, we can also help **expedite the insurance claims process**." **[S]** (Uber Newsroom, above.)
- **Thresholds (speeds, g-forces, stop durations):** **[U]** — never published. Do not invent "30 min" etc. The only public number: post-trip rider location tracking was 5 minutes (2017 privacy change, unrelated) **[S-p]** https://www.reuters.com.

### 3.2 Bolt Ride Check + static vehicle checks (documented)

- Rider page: "Ride Check — This functionality allows us to detect any **unexpected & excessively long stops** during rides." **[S]** https://bolt.eu/en/rides/safety/
- Driver page: "**Trip safety monitoring** — If your car remains **still for too long**, we'll **contact both you and your rider** to make sure everything's okay." **[S]** https://bolt.eu/en/driver/safety/
- Zikoko × Bolt (implementation behavior): "with Ride Check, the team can **proactively detect whether a vehicle is stopped for too long, and will automatically engage with the rider and driver in-app** to confirm everything is okay. **If one of them confirms they need assistance, the feature will also provide them with the option to directly call emergency services, share the trip, record the audio or request Bolt Assistance with one touch via the in-app notification.**" **[S]** https://www.zikoko.com/2024/11/how-the-bolt-safety-team-works/ — note the escalation ladder: check-in → one-touch emergency/share/audio/assist.
- Launch coverage (CIO Africa, Dec 14, 2023): "Bolt can now automatically engage with riders and drivers in-app when a vehicle remains still for too long to confirm everything is okay" **[S-p]**.
- Driver-side blog labels this "**Static vehicle checks** — We monitor your driving activity when you are on a trip in the Bolt Driver app" + check-in (snippet; page JS-walled) **[S-p]** https://bolt.eu/en/blog/staying-safe-on-the-road (Oct 30, 2024). The prior teardown's "specialist calls both parties" wording matches Zikoko + driver-page behavior.
- 2024 investment coverage: "upgrading existing features like Ride Check to **proactively detect if a trip's route unexpectedly changes**" (Nigeria, €100M safety investment) **[S-p]** https://thenationonlineng.net (Nov 14, 2024) — i.e. route-deviation detection is in Bolt's Ride Check scope in at least some markets.
- Bolt thresholds: **[U]**.

### 3.3 What a GPS-only web platform can do (no accelerometer/gyro)

Sensor-feasible subset on a phone-browser tracking page **[I, grounded in the above]**:
- **Stationary-too-long** (Bolt's static-vehicle check analog): driver GPS pings arrive every few seconds (MIZIGO already simulates this); if in `IN_TRANSIT`/`ARRIVING` and movement < X m over Y minutes → proactive check-in. In cargo, unlike ride-hail, **planned stops are normal** (loading, traffic, police roadblocks) → threshold should be generous and the prompt non-accusatory.
- **Route-deviation** (Uber off-course analog): compare live position against the OSRM polyline MIZIGO already stores (`route.polyline`); sustained perpendicular deviation without progress → check-in event.
- **Crash detection is NOT feasible GPS-only** — accelerometer/gyro are needed; a web page can read `DeviceMotion`/`Accelerometer` sensors only on the tracked device itself (driver's phone if driver uses the PWA), with permission. Mark as P2/experimental; do not promise it **[I]**.
- **Check-in prompt phrasing** (copy discipline from both companies): neutral, two-tap, actionable — Uber: "Is everything OK?" with "I'm OK" / "I need help"; Bolt: in-app engagement + one-touch actions. Never blame ("Why have you stopped?"), always offer the escape hatch (SOS + call ops) **[I from documented copy]**.

---

## 4. Identity verification stack

### 4.1 Driver selfie re-verification (Uber Real-Time ID Check)

- **Mechanics [S]** (Microsoft customer story + Uber India newsroom, both surfaced via search): "Real-Time ID Check uses **Microsoft Cognitive Services** intelligence to instantly **compare the selfie to the photo corresponding with the driver's photo on file**." Drivers are asked **periodically** to take a selfie **before they are able to accept rides** (2016 global launch; India Mar 2017). Sources: https://news.microsoft.com + https://learn.microsoft.com (case-study pages 404 on direct fetch — facts captured from search snippets of those pages **[S-p]**) and https://www.uber.com (India newsroom, "Selfie powered Real-Time ID Check comes to India", Mar 13, 2017 **[S-p]**).
- Blocking behavior: selfie gates **going online / accepting rides** — i.e. it is a hard block, not advisory **[S]** per the Microsoft case-study wording.
- 2025 tightening (Uber Newsroom): "Strengthening our processes to verify driver and courier identity in the US" (Oct 16, 2025) — title captured from uber.com related-articles list; contents not fetched **[U]** beyond the title.
- Modern Uber driver ID verification also includes document upload (help.uber.com: "You'll be asked to take a real-time or live photo of yourself, like a selfie" during identity verification) **[S-p]**.

### 4.2 Rider verification (Uber verified badge)

- **Process [S]:** https://www.uber.com/us/en/safety/rider-verification/ — cross-checks the rider's **signup info (name/phone) against third-party databases**; if not validated, rider may upload **government ID + selfie**. ID documents are encrypted at rest. **Drivers only ever see: rider first name, star rating, verified badge, trip details.**
- **Badge [S]:** blue "Verified" badge in Account section, **shown to drivers when the rider requests** (on the offer). Optional — unverified riders can still ride, but Uber explicitly warns unverified riders may see **longer ETAs/pickup times** because drivers can filter. (WBAL-TV Sep 18, 2024 confirms rollout + driver-feedback motive **[S]** https://www.wbaltv.com/article/uber-verification-rollout/62260737.)
- **CLEAR partnership (Nov 1, 2024) [S]:** existing CLEAR members can verify via "Verify with CLEAR" in-app; press release states **"nearly two-thirds of active Uber riders in the US are verified"** post-expansion. https://ir.clearme.com/news-events/press-releases/detail/130/uber-and-clear-partner-to-enhance-rider-verification
- Design intent (quote): "knowing riders undergo these additional verification steps helps them feel safer… verified riders tend to have fewer serious complaints from drivers" (Roger Kaiser, Head of Safety at Uber) **[S]** (same release).

### 4.3 Bolt identity verification

- **Driver side [S]:** "Our drivers submit a **real-time selfie as part of our identity verification process during registration, as well as on a regular basis**." https://bolt.eu/en/rides/safety/ — i.e. registration selfie + periodic re-verification, same shape as Uber.
- **Rider Verification [S-p]:** launched in South Africa Jul 2024 — "Rider Verification requires riders to verify their identity by **uploading a selfie and an ID picture**" (https://bolt.eu/en/blog/rider-verification/, page JS-walled; ITWeb corroboration: selfie must be "an authentic picture of a physically present person, with the face clearly visible" **[S-p]** https://www.itweb.co.za Jul 26, 2024). By 2025 Bolt made rider ID verification **mandatory** in some markets (ITWeb Jun 30, 2025 **[S-p]**). Nigeria: NIN verification for riders + random driver selfie checks announced (technext24.com, Nov 2023 **[S-p]**).
- **Full identity flow (help.bolt.com "Verify Identity") [S-p]:** photo of **front of ID** in-frame → then **three selfies: front, left, right** — a liveness-style multi-angle capture.
- **Kenya boda requirements (Bolt Support) [S-p]:** passport photo, **National ID**, **Class A motorcycle licence**, **Police Clearance Certificate** (+ PSV insurance, motorcycle ≤ ~2017-or-newer per secondary sources). https://bolt.eu (Boda Boda requirements in Kenya).

### 4.4 Pickup PIN codes (blocking vs advisory)

- **Uber "Verify My Ride" [S]:** https://www.uber.com/nz/en/blog/verify-your-ride/ — rider opts in (Settings → Verify your rides → **"Use PIN to verify rides"**, every ride or **only at night**). After requesting, rider **receives a unique 4-digit PIN**; **before entering the car, rider tells the driver the PIN**; "**You will receive an in-app confirmation once your driver has successfully entered your PIN**" — i.e. the DRIVER enters it in the driver app and the match is confirmed server-side to the rider. Fallback advice when PIN off: check driver photo + plate + make/model.
- Blocking vs advisory: the PIN is **rider-opt-in**; when on, the driver's successful entry is required to produce the in-app confirmation — press coverage (1011now, Jan 2020) framed it as an "extra layer of verification… before a trip can begin in the app" **[S-p]**. Whether the trip is *technically impossible to start* without PIN entry in every market is **[U]**; treat as "blocking on the confirmation loop, rider-opt-in." (A security.stackexchange analysis exists but was Cloudflare-walled on fetch — not counted.)
- **Bolt Pickup Codes [S-p]:** Bolt's own ad copy: "With Pickup Codes, **before your trip starts, your driver gets a code — and only you have it. No code? No ride.**" (Facebook, Jul 2026 — Bolt-promoted snippet). Support article ("My ride happened without me in Egypt"): "you can verify each trip by **matching the code with your driver**. To activate it, open the app menu, go to **Account > Trip Safety**, and enable Pick-up codes" **[S-p]** https://bolt.eu. Same rider-opt-in, code-held-by-rider, driver-must-present design.

### 4.5 Number masking (privacy calling)

- **Uber [S-p]:** "Whenever rider and driver contact each other regarding a trip, **their phone numbers will be anonymised** — neither of the sides will…" (Uber Newsroom, "Your number's always private with phone anonymisation", Aug 2019; page 404 on fetch — snippet from uber.com domain). Anonymisation is trip-scoped.
- **Bolt [S]:** "Your number stays private — When you make a call via the Bolt app, your phone number remains hidden" (rider + driver safety pages). Also "Your address and phone number remain hidden from your driver" as a general privacy posture.
- **Implementation pattern:** industry-standard proxy/relay numbers (Twilio-style masked sessions — Telesign/Routee docs describe the generic pattern: temporary number pair per session **[S-p]** developer.telesign.com). Uber-specific patent coverage for anonymized sessions exists in the patent literature (e.g. Uber Technologies filings around service-request anonymization) — **[U]** exact patent numbers not verified in this pass; do not cite specific patents.
- **MIZIGO note:** chat already masks numbers; the gap is voice — no masked-call bridge exists. Small-platform substitutes: in-app chat only + "ops will call you back" (see §9).

---

## 5. Audio recording (Bolt's flagship, Uber's US analog)

### 5.1 Bolt in-trip audio — full documented mechanics **[S]**

Source: https://bolt.eu/en/blog/audio-trip-recording-feature/ (body captured) + Daily Dispatch reproduction (Jul 7, 2023, https://www.dailydispatch.co.za/news/2023-07-07-bolt-introduces-new-audio-recording-feature-for-safety-heres-how-it-works/):

- Available in the **Safety Toolkit**, **only during an ongoing ride** (after pickup); **recording automatically ends when the ride finishes**. First use asks microphone permission.
- Start/stop at any point during the trip.
- **Pauses when another app uses the microphone and auto-resumes** when the other app closes.
- **Encrypted and stored on your device for up to 24 hours**; auto-erased from the device after 24 h.
- **Shareable ONLY via attachment to an incident report** to Bolt Customer Support; "Bolt can only access files users have shared with Customer Support as part of an incident report."
- Bolt "can't access the recording on your phone — our teams can only listen to the file after you share it."
- **No external vendor** involved in capture ("Bolt developed this feature independently, so no external vendor helps us capture or record audio").
- May be shared with local authorities (police) **when explicitly requested**.
- First launched/tested in **South Africa and Nigeria** (2023).

### 5.2 Uber audio recording (US) — documented comparison points **[S]**

Source: https://www.uber.com/us/en/ride/safety/audio-recording/ (FAQ captured):

- Rider- or driver-initiated from the Safety Toolkit; available in **a dozen+ countries across Africa, Asia, Australia, Europe, NZ, N & S America**.
- **Other party is not notified at the moment a recording starts** (general notice of capability is given; riders see "audio may be recorded" when matched; all-party-consent US states additionally notify drivers at match).
- **Encryption: "AES encryption Galois/Counter Mode (GCM) on the consumer's device. Only Uber has the key to decrypt the file after it has been submitted"** — i.e. client-side AES-GCM envelope, platform-held decryption key post-submission.
- **Retention: auto-deleted after 7 days if not submitted** (US policy; Bolt uses 24 h).
- **Access:** neither rider, driver, nor Uber can listen pre-submission; a **dedicated Safety team** reviews submitted recordings; irrelevant recordings are deleted; release to the reporting party possible case-by-case; third-party release only with legal process/emergency rules.
- **Storage cost:** ~**1 MB per 5–7 minutes** of recording — useful payload budget for web implementations.
- Sharing is **post-trip only** ("you can only share audio with Uber after a trip ends"), either via the end-of-trip pop-up or later from trip history; drivers' recordings stop when they go offline; recording **stops when a phone call takes the microphone**.

### 5.3 PWA feasibility (MediaRecorder + WebCrypto) — engineering assessment

- **MediaRecorder API** records mic streams in-browser (Chrome/Android, Firefox, desktop Chrome; **iOS Safari 14.3+** supports MediaRecorder — supported-but-partial historically; verify against MDN/caniuse at build time) **[S]** https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder + https://developer.chrome.com (Chrome Developers, "Record audio and video with MediaRecorder"). Practical PWA dictaphone precedents exist **[S-p]** (whatpwacando.today/audio-recording, progressier.com).
- **WebCrypto AES-GCM** encrypt/decrypt is standard (`SubtleCrypto.encrypt` with AES-GCM, keys can be non-extractable `CryptoKey` objects storable in IndexedDB) **[S]** https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt.
- **Constraints to state honestly [I]:** (1) a PWA cannot record in background while the screen is off/app-switched — recording dies when the tab is suspended; this is a *material* difference from native Bolt. (2) Mic permission must be granted per-session on first use (unless installed PWA). (3) Uploading after the fact only, over potentially slow connections — the 1 MB/5 min budget matters. (4) Storing the decryption key server-side (Uber pattern) vs holding it on-device (Bolt pattern) is a product decision: for MIZIGO, on-device key + submit-to-decrypt (server fetches key from the submitter's device at report time) is the closest clean-room analog; simplest v1: encrypt with a server public key so only ops can open **[I]**.
- **Kenya consent law angle:** Kenya's Computer Misuse and Crimes Act + Data Protection Act (ODPC) govern recording/consent and data retention — a 24-hour retention + incident-gated access design maps well onto data-minimization duties (see docs/research/KENYA_MARKET_PLAYBOOK.md §ODPC: 72-hour breach duty, 24-month retention) **[I — legal read of documented duties; not legal advice]**.

---

## 6. Kenya regulatory safety angle (goods vehicles)

Cross-reference: docs/research/KENYA_MARKET_PLAYBOOK.md (Task 11-c) has the launch-cost side. Safety-relevant requirements a Nairobi **cargo** marketplace should surface:

- **Licence classes by vehicle [S-p]:** NTSA category mapping per PickApp Kenya's published driver requirements (mirrors NTSA classes): 3–10 t lorry (GVW >7,500 kg) → **Class C** licence, min age 24, retest required; articulated → Class CE, age 28–30 + experience gates (https://mypickapp.co.ke). Secondary NTSA guides: Class B (light), C1 (light commercial), C (heavy), CE (articulated) (jotechcyber.co.ke, senseitechnology.co.ke, niteducation.com) **[S-p]**.
- **Commercial Service Vehicle Regulations (2025, eff. 2026) [S-p]:** new.kenyalaw.org text: "**A carrier or a driver shall not operate a commercial vehicle without a valid commercial vehicle licence issued by the Authority**" + annual **commercial vehicle inspection (KSh 1,050/yr** per the 11-c playbook's sourced figure) + new equipment rules (e.g. **underride protection devices on the rear and sides** of commercial vehicles — Capital FM, Jan 2025; monolithafrica explainer Feb 2026 — page Cloudflare-walled, snippet used). The 11-c playbook also logged the proposed **courier-hailing licence (KSh 100k + 0.5% levy)** for platforms like MIZIGO.
- **Insurance [S-p]:** carrying goods for reward requires commercial insurance cover; the Kenyan market sells **Goods-in-Transit (GIT)** policies covering loss/damage to cargo in transit by road/rail/inland waterway (Equity Bank, Mayfair, Old Mutual, First Assurance, Gains, Madison product pages all surfaced; First Assurance policy PDF documents open-top/theft exclusions — relevant to boda/pickup open-bed cargo). Boda platforms: Bolt Kenya requires **PSV insurance** for boda riders (monolithafrica 2026 + Bolt support list). uberBODA Nairobi launch (2018) advertised **additional insurance cover on every trip** for passengers (tech.africa) **[S-p]**.
- **What Uber/Bolt show in Kenya (documented):** Uber's 2025 Kenya safety push (hapakenya.com, Jul 30, 2025) — "customer & driver safety features… elevate standards across Kenya's motorcycle taxi industry" (page not fetched; snippet) **[S-p]**. Neither app publicly documents showing an **insurance certificate copy in-app in Kenya** — Uber shows insurance details in some US markets (third-party liability structure) **[U for Kenya-specific in-app insurance display]**. Mark as unknown rather than claimed.
- **What a Kenyan cargo marketplace should state (recommendation [I]):** driver profile cards should show **licence class held (C/C1/CE per vehicle), NTSA inspection validity, motor-commercial insurance validity (policy number + insurer + expiry), and a cargo-liability line** ("goods carried at owner's risk unless GIT cover purchased" or platform-arranged GIT). The Vehicle model already has `docInsurance` / `docInspection` / `insuranceExpiry` / `inspectionExpiry` columns — the gap is surfacing them to customers, not storing them.

---

## 7. Incident reporting UX

- **Uber post-trip path (documented) [S]:** "Go to **Help** in the Uber app → **Help with a trip** → Select the trip → **Report safety issue**" — audio recordings are attached at this step (uber.com audio-recording page, §5.2 above). So the report flow is: history → trip → safety issue → (evidence) → submit.
- **Safety Incident Reporting Line [S-p]:** a separate channel "found in the **Ride Details screen in the Activity section**" of the rider app (uber.com/safety/what-to-do-in-a-crash snippet) — for urgent post-incident contact; the page also instructs calling 911 first for immediate danger.
- **During-trip:** Safety Toolkit → "report safety incidents to us directly **while on a trip**" (Uber Safety Toolkit newsroom, Aug 2022 **[S-p]** https://www.uber.com — "Uber's new Safety Toolkit featuring Live Help").
- **Follow-up machinery:** Uber IRT proactively monitors emergency tickets and follows up (§1.1) — i.e. **reports are triaged into the same queue as SOS events** at Uber **[S]**.
- **Bolt post-trip:** "Rate Your Driver — ratings allow us to review driver behaviour and block those who violate our Terms of Service" + in-app report (bolt.eu) **[S]**; audio attach via incident report (§5.1); 24/7 support via app or phone; a public "Report an issue"/"Report a vehicle" web path exists on bolt.eu **[S]**. Zikoko: after a trip ends, **Safety Specialists support both parties 24/7** and ensure "all appropriate measures to prevent a similar case… are taken" **[S]**.
- **Photo attachment:** Uber's report flow supports adding details/evidence; photo attachment to reports is standard in the industry — but I found **no first-party page explicitly documenting photo attachment in incident reports** → **[U]**, present as [I] ("industry-standard; both apps accept evidence; explicit docs not captured").
- **Escalation SLAs:** only documented numbers: Namola 90-second callback for Bolt SA Emergency Assist (§1.3) and Uber IVR at +20 minutes (§1.1). General support response-time SLAs are **[U]** for both. Bolt's Safety Hubs (incl. Kenya) are 24/7 **[S]**.

---

## 8. Unknowns & clean-room discipline (do not propagate further)

1. RideCheck/Bolt anomaly **thresholds** (g-force, minutes-stationary, deviation radius) — never published. Any number in our spec is OUR product decision, not an Uber/Bolt fact.
2. Uber share-link **TTL after trip end** — not stated in captured sources.
3. Whether Uber PIN entry **hard-blocks** trip start in every PIN market — confirmation loop is documented; hard block is market-dependent/[U].
4. Specific **proxy-number patents** — do not cite numbers.
5. **In-app insurance certificate display in Kenya** by Uber/Bolt — not documented; don't claim.
6. RapidSOS' **current** market coverage beyond "1,200 markets/74% of US trips (2022)" — [U] today's figure.
7. Bolt Emergency Assist **Kenya** responder (does it route to private security or 999/112?) — [U]; techtrendske describes location sharing + instant access only.
8. z-ai search quota exhausted mid-task: some pages above are snippet-backed **[S-p]** — flagged per-fact so the next agent can re-verify with fetches when quota returns.

---

## 9. MIZIGO safety-center spec (prioritized, mapped to our stack)

Existing hooks this builds on: 17-state `ShipmentState` machine + `TRANSITIONS` (`src/lib/state-machine.ts`), `ShipmentEvent` (type/label/lat/lng/actor) written by the unified action route (`src/app/api/shipments/[id]/action/route.ts`), `Notification` + deep-link openers (`src/store/session.ts`, `notification-link.ts`), admin `OpsTab` (`src/components/mizigo/admin/OpsTab.tsx`), public track pages (`/api/track/[token]`, sha256-hashed tokens, minimal payload), masked-number chat (`ChatSheet.tsx`), `ProblemScreen.tsx` dispute categories, `share.ts` (Web Share API), Driver model (`licenceClass`, `licenceExpiry`, `verification`, `incidents`), Vehicle model (`docInsurance`, `docInspection`, `insuranceExpiry`, `inspectionExpiry`, photos).

### P0 — ship with the safety center launch

1. **Safety Center sheet (real screen, not a toast)** — new `src/components/mizigo/shared/SafetySheet.tsx`, opened from a shield icon on `ActiveTrip`/`TrackView` (customer), `DriverApp` in-trip header (driver). Contents (Uber pattern): **live location (reverse label) + vehicle + driver first name first**, then actions: SOS, Share tracking, Call support, Report an issue. Static content: safety tips (check plate/licence before loading).
2. **SOS → multi-channel alert, small-platform version** — slide-to-confirm (Uber "Swipe to call"; Bolt discreet) → (a) `tel:` call to ops emergency number from env/admin setting; (b) **prefilled SMS** to same number with shipment code + last known lat/lng + driver + customer first names (Uber Text-911 pattern — works on every Kenyan phone, no partner needed); (c) POST action `safety-alert` → `ShipmentEvent { type: "SAFETY_ALERT", actor: role, lat, lng }` + `Notification` to ALL admins with deep-link to the shipment; (d) OpsTab gets a **Safety queue row (red)** sorted by recency. Ops acks via admin action → event `SAFETY_ACKED`; unacked > 10 min → re-alert (Uber's decoupled-alert-channel lesson: each channel must succeed/fail independently; all writes are idempotent event inserts).
3. **Post-alert check-in prompt** (Uber IVR/IRT analog, manual-first): after `SAFETY_ACKED` (or 20 min after alert if unacked), prompt both parties in-app: "Are you OK?" → "I'm safe" / "I need help" → events `SAFETY_CHECKIN_OK` / `SAFETY_CHECKIN_HELP` (second re-opens SOS).
4. **Share tracking — expiry + gating** (Bolt 48h pattern): add `shareTokenExpiresAt DateTime?` to Shipment; `share-link` sets `min(POD_CONFIRMED+48h, now+48h)`; `/api/track/[token]` 404s after expiry and hides live location once `COMPLETED`+12h (show "Delivered" + arrival time only). Payload stays minimal (already: driver first name + initials + rating, vehicle model + registration, areas, live point) — no phones, no full addresses (Uber pattern). Proactive share prompt on `DRIVER_ACCEPTED` (teardown §4 item 5).
5. **Incident report upgrade** — `ProblemScreen.tsx`: add categories `SAFETY` (near-miss, harassment, unsafe driving, road accident) and `CARGO_THEFT`; attach **photos** (input capture → upload or base64 into Dispute); Dispute model gains `photos String @default("[]")`; admin Disputes tab sorts SAFETY first; SLA note in UI: "safety reports acknowledged within 1 hour, contacted same day" (our own published commitment — Bolt's welfare-call wording as the bar).
6. **Track-page check-in events for recipients** — surface `SAFETY_ALERT` (redacted: "Safety alert — ops responded") in the public track event list so a shared link doubles as an accountability trail.

### P1 — next sprint

7. **GPS anomaly detection (Ride Check analog, cargo-tuned)** — server job on the existing position stream: (a) **stationary-too-long**: `IN_TRANSIT`/`ARRIVING` and net displacement < 150 m over **30 min** (generous: planned stops are normal in cargo; make threshold admin-configurable) → event `RIDE_CHECK_STATIONARY` + in-app check-in to both parties ("Are you and the cargo OK?" → OK / Need help → SOS + ops alert); (b) **route deviation**: perpendicular distance from stored `route.polyline` > 2 km sustained 10 min with no stop events → event `RIDE_CHECK_OFFROUTE` + ops row + customer notification ("Your delivery is taking a different route — traffic or a safety event? [Check in]"). All thresholds in an admin config object, labelled **our policy** (not Uber's — see §8.1).
8. **Pickup PIN (Uber/Bolt pattern, cargo-adapted)** — generate 4-digit PIN at `DRIVER_ARRIVED`, show to customer in ActiveTrip + notification; **`loaded` action requires the PIN** (`LOADING → LOADED` transition takes `pin` in body; 3 wrong tries → MISMATCH_REPORTED-style event + ops). This makes the existing decorative POD code **blocking**, per teardown §4 item 12, and doubles as cargo chain-of-custody: receiver PIN at `DELIVERED → POD_CONFIRMED` for the recipient.
9. **Driver verification surfacing** — customer-facing driver card + track page show: licence class badge (C/C1/CE per vehicle), inspection validity, insurance validity + insurer; **"Verified" chip** from `Driver.verification` (already VERIFIED/PENDING/SUSPENDED — gate OFFER visibility on VERIFIED, matching.uber already ranks; add hard filter). Admin driver editor already has photo paths — add **selfie re-verification queue**: `verification` → PENDING with a scheduled cadence (every 90 days, Bolt's "regular basis" analog) and on any device change; selfie upload via existing driver photo flow; admin approves → VERIFIED (event `DRIVER_REVERIFIED`).
10. **Customer OTP-verified badge shown to drivers** (Uber verified-rider analog): mock-OTP auth already exists — mark `User` phone-verified; driver offer card + ChatSheet show "Verified customer" chip; unverified bookings get a soft warning in driver offer ("Customer not yet verified — confirm name at pickup" + PIN enforcement).
11. **Ops Safety queue v2** — OpsTab: dedicated Safety panel: live `SAFETY_ALERT`/`RIDE_CHECK_*`/`DISPUTED(safety)` feed with one-tap **Call customer / Call driver** (masked via ops callback: we dial both, numbers never shown to each other — manual number-masking v1, Twilio-proxy later), ack/resolve actions writing AuditLog.

### P2 — differentiators / later

12. **In-trip audio recording (Bolt analog, PWA-limited)** — `SafetySheet` → "Record audio": MediaRecorder (audio/webm;codecs=opus, iOS 14.3+) + WebCrypto AES-GCM (server public key, ops-only decryption — Uber's key model) → IndexedDB blob store, **24 h TTL**, auto-pause on visibilitychange/pagehide, auto-delete at trip end + 24 h; attach to incident report only (upload endpoint gated on Dispute creation). Copy must disclose limits: "recording runs while this screen stays open" (PWA cannot background-record — §5.3).
13. **Crash/motion sensing on driver PWA (experimental)** — DeviceMotion listener on DriverApp in-trip screen while foreground: sustained >4g spike + GPS halt → immediate `RIDE_CHECK_CRASH` event + ops alert. Clearly labelled beta; honest about sensor availability.
14. **Trusted contacts** (Uber pattern): up to 3 contacts per customer (Notification on `SAFETY_ALERT` sends them the track link with consent copy).
15. **Insurance & liability trust page** + driver-profile doc chips surfaced (§6): state goods-in-transit posture plainly, link GIT partners; show "Insured · Motor Commercial · expires DD/MM" chip on driver card (data already in Vehicle model).
16. **Women/night options** (Bolt W4W analog is out of scope for cargo, but a **"night jobs" toggle** — PIN always-on + share-link auto-minted for jobs starting 19:00–06:00 — is cheap).

**Spec-level non-goals** (documented as deliberate): no direct police-data integration (Kenya has no RapidSOS equivalent wired to us — SOS dials the standard emergency number only if ops is unreachable, and we say so honestly); no background location tracking of drivers outside ACTIVE_STATES shipments (privacy posture, Uber's own 2017 rollback precedent §2.2).

---

## 10. Source index (primary URLs)

Uber: emergency-button engineering blog · newsroom/ridecheck · ride/safety/audio-recording · us/en/safety/rider-verification · nz/en/blog/verify-your-ride · us/en/safety (hub) · us/en/newsroom (Safety Toolkit 2022) · help.uber.com (SOS option, trip-status FAQ, emergency contact) · ir.clearme.com (CLEAR) · wbaltv.com (badge rollout) · news.microsoft.com + learn.microsoft.com (Real-Time ID Check) · technologyreview.com, theverge.com, thenewsminute.com, eandt.theiet.org, pcmag.com, smartcitiesdive.com, abc7news.com (RideCheck coverage) · firstpost.com, timesofindia (India SOS/Telangana) · thehindu.com (India safety helpline) · reuters.com (post-trip tracking end).
Bolt: bolt.eu/en/rides/safety/ · bolt.eu/en/driver/safety/ · bolt.eu blog (audio trip recording — body captured; share-trip-details — snippet; staying-safe-on-the-road — snippet; rider-verification — snippet; selfie posts) · help.bolt.com (Verify Identity; Egypt pickup codes) · zikoko.com (Safety Team) · dailydispatch.co.za (audio reproduction, body captured) · thestar.co.za / itweb.co.za / gadget.co.za / memeburn.com (SA Emergency Assist + Namola 90 s) · cioafrica.co (stalled trips) · thenationonlineng.net (€100M safety) · techtrendske.co.ke, sokodirectory.com (Kenya commentary) · monolithafrica.com (NTSA rules; Bolt Kenya boda) · new.kenyalaw.org (Commercial Service Vehicle Regulations) · mypickapp.co.ke (licence-class table) · capitalfm.africa (underride rules) · equitygroupholdings.com, ke.mayfairinsurance.africa, oldmutual.co.ke, firstassurance.co.ke, gainsuranceltd.com, madison.co.ke (GIT policies) · tech.africa, hapakenya.com (uberBODA/Uber Kenya).
Web platform: developer.mozilla.org (Navigator/share, SubtleCrypto, MediaRecorder) · developer.chrome.com (MediaRecorder) · whatpwacando.today, progressier.com (PWA audio demos) · ruchern.dev (Web Share fallbacks).
Internal cross-refs: docs/UBER_BOLT_TEARDOWN.md §3.10/§4; docs/research/KENYA_MARKET_PLAYBOOK.md (NTSA costs, ODPC, courier-hailing licence); `src/lib/state-machine.ts`, `prisma/schema.prisma`, `src/app/api/track/[token]/route.ts`, `src/components/mizigo/*` (spec mapping targets).
